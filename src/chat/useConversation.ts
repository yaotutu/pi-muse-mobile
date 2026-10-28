import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { useSpaceState, useSpaceStore } from '../spaces/SpaceProvider';
import { ApiError, isRequestCancelled, requestCancelled } from '../api/errors';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { StreamAggregator, projectHistory, type MessageView } from './chat-state';
import type { ConversationMessage, ConversationSnapshot } from '../api/types';
import type { ApiClient } from '../api/contracts';
import { validateOutgoingDraftMessage } from '../attachments/validation';
import type { AttachmentDraft } from '../attachments/types';
import type { PendingSubmission } from '../spaces/space-store';

let clientSequence = 0;
const nextClientId = (prefix: string) => `${prefix}-${Date.now()}-${++clientSequence}`;
const EMPTY_MESSAGE_IDS: ReadonlySet<string> = new Set();
type ConversationAuthority = {
  api: ApiClient;
  spaceId: string;
  epoch: number;
  sessionId: string | null;
  persistedMessageIds: ReadonlySet<string>;
};

/**
 * 契约明确的运行前置拒绝（server routes.ts 在开启 SSE 前返回，与 status/code 精确对应）。
 * 其中 RUN_ID_CONFLICT / MESSAGE_ID_CONFLICT 表示服务端已持有同 ID 消息，
 * 不直接判定，必须先与权威历史对账。
 */
const PRE_RUN_REJECTS: Record<string, { status: number; conflictsWithPersisted?: boolean }> = {
  MODEL_NOT_CONFIGURED: { status: 503 },
  SHUTDOWN: { status: 503 },
  INVALID_INPUT: { status: 400 },
  UNSUPPORTED_SPACE: { status: 400 },
  REQUEST_TOO_LARGE: { status: 413 },
  agent_thread_locked: { status: 409 },
  HISTORY_CONFLICT: { status: 409 },
  RUN_ID_CONFLICT: { status: 409, conflictsWithPersisted: true },
  MESSAGE_ID_CONFLICT: { status: 409, conflictsWithPersisted: true },
};
const preRunRejectOf = (error: unknown): { code: string; conflictsWithPersisted: boolean } | null => {
  if (!(error instanceof ApiError)) return null;
  // routes.ts 的 schema 拒绝（Invalid conversation request）返回 400 且无 code，同属未接受。
  if (error.status === 400 && !error.code) return { code: 'SCHEMA_INVALID', conflictsWithPersisted: false };
  const entry = error.code ? PRE_RUN_REJECTS[error.code] : undefined;
  if (!entry || entry.status !== error.status) return null;
  return { code: error.code!, conflictsWithPersisted: entry.conflictsWithPersisted === true };
};
const preRunRejectMessage = (error: ApiError) =>
  error.code === 'MODEL_NOT_CONFIGURED'
    ? '服务端模型未配置，消息未发送'
    : error.message || '服务端拒绝执行，消息未发送';

/**
 * 单次挂载仅服务一个空间的一个聊天代次；父级以 spaceId + epoch 隔离重置前的请求。
 *
 * A01 所有权契约：消息出现在权威历史（role=user 且原 messageId 匹配）之前，
 * 正文所有权在客户端（SpaceStore.pendingSubmission）；确认落盘后才移交服务端。
 * 任何终态判断只依据确切证据（权威历史包含原 ID、或终态运行证据后的完整历史核对），
 * 网络错误、404、仍 running 一律保持 unconfirmed，绝不自动重发。
 */
export function useConversation(spaceId: string, refreshKey = 0) {
  const api = useApi();
  const sessions = useSpaceStore();
  const spaceState = useSpaceState(spaceId);
  const epoch = spaceState.epoch;
  const pendingSubmission = spaceState.pendingSubmission;
  const writable = sessions.canWrite(spaceId);
  const connection = useServiceConnection();
  const enabled = connection?.enabled ?? true;
  const refreshVersion = connection?.snapshot.refreshVersion ?? 0;
  const enabledRef = useRef(enabled);
  const [views, setViews] = useState<MessageView[]>([]);
  const [authorityState, setAuthorityState] = useState<ConversationAuthority>(() => ({
    api,
    spaceId,
    epoch,
    sessionId: null,
    persistedMessageIds: EMPTY_MESSAGE_IDS,
  }));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const revisionRef = useRef<string | null>(null);
  const aliveRef = useRef(false);
  const historyRequest = useRef<AbortController | null>(null);
  const current = () => aliveRef.current && sessions.isCurrent(spaceId, epoch);
  const authority = authorityState.api === api && authorityState.spaceId === spaceId && authorityState.epoch === epoch
    ? authorityState
    : null;
  const sessionId = authority?.sessionId ?? null;
  const persistedMessageIds = authority?.persistedMessageIds ?? EMPTY_MESSAGE_IDS;

  /** 只有完整权威历史可以一次性替换视图、会话绑定与已落盘 ID 集合。 */
  const adoptHistory = useCallback((history: ConversationSnapshot) => {
    setAuthorityState({
      api,
      spaceId,
      epoch,
      sessionId: history.sessionId,
      persistedMessageIds: new Set(history.messages.map((message) => message.id)),
    });
    setViews(projectHistory(history.messages));
  }, [api, epoch, spaceId]);

  /** 权威历史核对：原 ID 已落盘则释放暂存；缺失且持有终态证据（含条目内存的流内 RUN_ERROR 记录）才可判定未发送。 */
  const reconcilePendingWithHistory = useCallback(
    (
      messages: ConversationMessage[],
      messageId: string,
      allowFail: boolean,
      failError?: string,
    ): boolean => {
      const persisted = messages.some((m) => m.role === 'user' && m.id === messageId);
      if (persisted) {
        sessions.clearPendingSubmission(spaceId, epoch, messageId);
        return true;
      }
      const terminalSeen = sessions.get(spaceId).pendingSubmission?.terminalError != null;
      if (allowFail || terminalSeen) {
        sessions.updatePendingSubmissionStatus(spaceId, epoch, messageId, {
          status: 'failed',
          error: failError ?? sessions.get(spaceId).pendingSubmission?.terminalError ?? '消息未送达服务端',
        });
      }
      return false;
    },
    [sessions, spaceId, epoch],
  );

  /**
   * 单点查询某次 run 的运行状态。返回终态证据，或 null（404 / 查询失败 / 仍运行）。
   * 竞态防线：拿到终态证据后必须重新读历史——查询期间落盘的消息不能被旧快照误判为未发送。
   * 只返回证据与历史，不写 revisionRef 等 Hook 状态；apply 由调用方在 alive/epoch/messageId 校验后执行。
   * 返回 latest 供调用方直接采用本次终态后的历史，避免重复请求。
   */
  const probeRunTerminal = useCallback(
    async (
      runId: string,
    ): Promise<{ terminal: true; message?: string; latest: ConversationSnapshot } | null> => {
      try {
        const response = await api.getAgentStatus(spaceId, runId);
        const status = response.status.status;
        if (status === 'running') return null;
        const fresh = await api.getConversation(spaceId);
        return { terminal: true, message: status === 'failed' ? '消息未送达服务端' : undefined, latest: fresh };
      } catch {
        return null;
      }
    },
    [api, spaceId],
  );

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active' && !abortRef.current) setHistoryVersion((value) => value + 1);
      previous = next;
    });
    return () => subscription.remove();
  }, []);

  // 父级以 spaceId + epoch 为 key：卸载时取消旧流，且所有异步回写都检查生命周期。
  // 不保挂载多个会话，也不让旧请求污染新会话或已退出登录的界面。
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      historyRequest.current?.abort();
      if (abortRef.current) {
        abortRef.current.abort();
        if (runIdRef.current) void api.stopRun(spaceId, runIdRef.current).catch(() => {});
      }
    };
  }, [api, spaceId]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) abortRef.current?.abort();
  }, [enabled]);

  // 历史与版本未成功加载前禁止发送，避免以旧版本覆盖其他设备的新消息。
  useEffect(() => {
    if (!enabled || abortRef.current || !writable) return;
    let alive = true;
    const controller = new AbortController();
    historyRequest.current = controller;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      setLoading(true);
      try {
        const history = await api.getConversation(spaceId, controller.signal);
        if (alive && sessions.isCurrent(spaceId, epoch)) {
          revisionRef.current = history.revision;
          const pending = sessions.get(spaceId).pendingSubmission;
          if (pending && pending.epoch === epoch) {
            const persisted = history.messages.some((m) => m.role === 'user' && m.id === pending.messageId);
            if (!persisted && pending.status === 'unconfirmed') {
              // 首读缺失不等于未发送：先看内存证据，再查该 run 的终态，均以终态之后的历史对账。
              const probe = pending.terminalError != null
                ? { terminal: true as const, message: pending.terminalError, latest: history }
                : await probeRunTerminal(pending.runId);
              if (!alive || !sessions.isCurrent(spaceId, epoch)) return;
              // 卸载/取消期间不得写 Hook 状态；代次与 messageId 校验后 probe 可能已被新提交替换。
              if (sessions.get(spaceId).pendingSubmission?.messageId !== pending.messageId) return;
              if (probe) {
                revisionRef.current = probe.latest.revision;
                reconcilePendingWithHistory(probe.latest.messages, pending.messageId, true, probe.message);
                adoptHistory(probe.latest);
                // 终态证据 + 完整历史：无论释放或判 failed，都不是历史失败，解除发送锁。
                setHistoryFailed(false);
                setError(undefined);
                setLoading(false);
                return;
              }
              // 查询失败 / 404 / 仍 running：保守待确认，保持发送锁定。
              adoptHistory(history);
              setLoading(false);
              return;
            }
            // sending / failed / unconfirmed 但已持久化：按当前快照直接对账。
            reconcilePendingWithHistory(history.messages, pending.messageId, pending.status === 'failed', pending.error);
          }
          adoptHistory(history);
          setHistoryFailed(false);
          setError(undefined);
        }
      } catch (e) {
        if (alive && sessions.isCurrent(spaceId, epoch) && !isRequestCancelled(e)) {
          setHistoryFailed(true);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (alive && sessions.isCurrent(spaceId, epoch)) setLoading(false);
      }
    })();
    return () => { alive = false; controller.abort(); if (historyRequest.current === controller) historyRequest.current = null; };
  }, [api, spaceId, historyVersion, enabled, refreshVersion, refreshKey, epoch, sessions, writable, probeRunTerminal, reconcilePendingWithHistory, adoptHistory]);

  useEffect(() => {
    if (!writable) {
      historyRequest.current?.abort();
      revisionRef.current = null;
    }
  }, [sessions, spaceId, epoch, writable]);

  const syncAfterRun = async () => {
    if (!current()) throw requestCancelled();
    const controller = new AbortController();
    historyRequest.current?.abort();
    historyRequest.current = controller;
    try { return await api.getConversation(spaceId, controller.signal); }
    finally { if (historyRequest.current === controller) historyRequest.current = null; }
  };

  /** 新发送与显式重试共用同一套终态对账；区别只在是否复用原 message/run 与附件身份。 */
  const executeSubmission = async (submission: PendingSubmission) => {
    const controller = new AbortController();
    abortRef.current = controller;
    runIdRef.current = submission.runId;
    const attachments = submission.attachments ?? [];

    // 权威历史保存前，客户端以原附件完整载荷构造乐观视图；正文仍只是用户输入文字。
    const userView: MessageView = {
      id: submission.messageId,
      role: 'user',
      text: submission.text,
      ...(attachments.length ? { attachments } : {}),
      toolCalls: [],
      feedbackAvailable: false,
    };
    const baseViews = views.some((view) => view.id === submission.messageId)
      ? views.map((view) => (view.id === submission.messageId ? userView : view))
      : [...views, userView];
    const aggregator = new StreamAggregator(baseViews);
    setViews([...aggregator.messages]);
    setRunning(true);

    let runErrorOccurred = false;
    let runErrorMessage: string | undefined;

    try {
      await api.runAgent(
        {
          spaceId,
          runId: submission.runId,
          expectedRevision: revisionRef.current!,
          message: {
            id: submission.messageId,
            content: submission.text,
            ...(attachments.length ? { attachments } : {}),
          },
        },
        (event) => {
          if (!current() || controller.signal.aborted) return;
          aggregator.push(event);
          if (event.type === 'MESSAGES_SNAPSHOT' && event.messages) {
            const snapshotIds = new Set(event.messages.map((message) => message.id));
            setAuthorityState((previous) => ({
              api,
              spaceId,
              epoch,
              sessionId: previous.api === api && previous.spaceId === spaceId && previous.epoch === epoch
                ? previous.sessionId
                : null,
              persistedMessageIds: snapshotIds,
            }));
          }
          if (event.type === 'RUN_ERROR') {
            runErrorOccurred = true;
            runErrorMessage = event.message ?? '助手运行失败，请重试';
            // 终态证据持久在暂存条目内存：卸载/切回后首次完整历史对账仍可判定未发送。
            if (event.code !== 'STOPPED') {
              sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, {
                status: 'sending',
                terminalError: runErrorMessage,
              });
            }
            setError(event.code === 'STOPPED' ? undefined : runErrorMessage);
          }
          setViews([...aggregator.messages]);
        },
        controller.signal,
      );

      if (!current()) {
        // 组件已卸载但代次仍有效：只能保守标记待确认，交给重新挂载后的历史同步对账。
        // terminalError 已在 RUN_ERROR 事件回调写入条目，此处状态降级不丢终态证据。
        if (sessions.isCurrent(spaceId, epoch)) {
          sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, { status: 'unconfirmed' });
        }
        return;
      }

      try {
        if (!enabledRef.current) {
          aggregator.settle();
          if (current()) {
            setViews([...aggregator.messages]);
            setHistoryFailed(true);
            sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, { status: 'unconfirmed' });
          }
          return;
        }

        const history = await syncAfterRun();
        if (current()) {
          revisionRef.current = history.revision;
          // 终态 RUN_ERROR + 完整历史缺失原 ID = 确切未发送证据；正常结束缺失仍待确认。
          const released = reconcilePendingWithHistory(history.messages, submission.messageId, runErrorOccurred, runErrorMessage);
          if (released) {
            adoptHistory(history);
            setHistoryFailed(false);
            // 已落盘 + RUN_ERROR：消息所有权已移交服务端，但运行失败的事实必须保留展示。
            setError(runErrorOccurred ? runErrorMessage : undefined);
          } else if (runErrorOccurred) {
            // failed 不是历史失败：完整历史与版本已成功读取，保留 pending 阻塞即可，允许恢复后手动发送。
            adoptHistory(history);
            setHistoryFailed(false);
            setError(runErrorMessage);
          } else {
            sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, {
              status: 'unconfirmed',
              error: '消息保存状态未明，请重新同步核对',
            });
            setHistoryFailed(true);
            adoptHistory(history);
          }
        }
      } catch (syncError) {
        // 权威历史拉取失败：保留聚合视图（已验证的降级路径），保持待确认，不自动重发。
        aggregator.settle();
        if (current()) {
          setViews([...aggregator.messages]);
          // 内容可以保留展示，但没有新版本不能安全发送下一轮。
          setHistoryFailed(true);
          sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, {
            status: 'unconfirmed',
            error: '回复已结束，但会话同步失败，请重新加载后继续',
          });
          if (!isRequestCancelled(syncError)) setError('回复已结束，但会话同步失败，请重新加载后继续');
        }
      }
    } catch (e) {
      aggregator.settle();
      if (current()) setViews([...aggregator.messages]);

      if (current() && (controller.signal.aborted || isRequestCancelled(e))) {
        if (!enabledRef.current) {
          setHistoryFailed(true);
          sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, { status: 'unconfirmed' });
          return;
        }
        // 停止也可能已落盘部分回复；恢复服务端历史与版本后才允许发送下一轮。
        try {
          const history = await syncAfterRun();
          if (current()) {
            revisionRef.current = history.revision;
            const released = reconcilePendingWithHistory(history.messages, submission.messageId, false);
            if (released) {
              adoptHistory(history);
            } else {
              sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, {
                status: 'unconfirmed',
                error: '已停止但保存状态未确认',
              });
              setHistoryFailed(true);
              adoptHistory(history);
            }
          }
        } catch (syncError) {
          if (current()) {
            setHistoryFailed(true);
            sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, { status: 'unconfirmed' });
            if (!isRequestCancelled(syncError)) setError('停止后无法同步会话，请重新加载');
          }
        }
      } else if (preRunRejectOf(e)) {
        // 契约明确的前置拒绝（SSE 开启前返回）：先与权威历史对账/刷新 revision，绝不清空旧历史。
        const message = e instanceof ApiError ? preRunRejectMessage(e) : '服务端拒绝执行，消息未发送';
        sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, { status: 'sending', terminalError: message });
        try {
          if (!current()) throw requestCancelled();
          const history = await syncAfterRun();
          if (current()) {
            revisionRef.current = history.revision;
            // 有原 ID 释放、无原 ID 判 failed；HISTORY_CONFLICT 已由本次回读拿到新 revision 解除，
            // 恢复草稿后可手动重提，绝不自动发送。
            reconcilePendingWithHistory(history.messages, submission.messageId, true, message);
            adoptHistory(history);
            setHistoryFailed(false);
            setError(message);
          }
        } catch (syncError) {
          // 前置拒绝后历史回读失败：保守待确认并锁定发送，后续 reload 可解锁。
          if (current()) {
            setHistoryFailed(true);
            sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, {
              status: 'unconfirmed',
              error: message,
            });
            if (!isRequestCancelled(syncError)) setError(message);
          }
        }
      } else {
        // 网络错误 / 408 / 不明 5xx：保存状态未明，保守待确认并锁定发送，绝不自动重发。
        const errText = e instanceof Error ? e.message : String(e);
        if (current()) {
          setError(errText);
          setHistoryFailed(true);
        }
        if (sessions.isCurrent(spaceId, epoch)) {
          sessions.updatePendingSubmissionStatus(spaceId, epoch, submission.messageId, {
            status: 'unconfirmed',
            error: errText,
          });
        }
      }
    } finally {
      const stale = !sessions.isCurrent(spaceId, epoch);
      if (stale && aliveRef.current) setHistoryFailed(true);
      abortRef.current = null;
      runIdRef.current = null;
      if (aliveRef.current) {
        setRunning(false);
        if (stale && sessions.canWrite(spaceId)) setHistoryVersion((value) => value + 1);
      }
    }
  };

  const send = async (
    raw: string,
    onAccepted?: () => void,
    attachments?: readonly AttachmentDraft[],
  ) => {
    const text = raw.trim();
    if (!enabled || sessions.isDisposed() || !sessions.isCurrent(spaceId, epoch) || loading || historyFailed || abortRef.current || !revisionRef.current) return;
    if (sessions.get(spaceId).pendingSubmission) return; // 上一条未确认提交未处理前，禁止重复发送或覆盖

    const selectedAttachments = attachments ?? sessions.get(spaceId).draftAttachments;
    const validated = validateOutgoingDraftMessage(text, selectedAttachments);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    historyRequest.current?.abort();
    const messageId = nextClientId('u');
    const runId = nextClientId('run');

    // 发送前先暂存完整正文与附件，再清输入框（A01 核心契约：权威历史保存前客户端持有所有权）。
    sessions.setPendingSubmission(spaceId, epoch, {
      messageId,
      runId,
      text: validated.text,
      epoch,
      status: 'sending',
      ...(validated.attachments.length ? { attachments: validated.attachments } : {}),
    });
    onAccepted?.();
    setError(undefined);
    await executeSubmission(sessions.get(spaceId).pendingSubmission!);
  };

  /** 只允许用户显式重试 failed 轮；复用原 ID 与原始附件，避免把失败轮改写成新消息。 */
  const retry = async (): Promise<boolean> => {
    if (!enabled || sessions.isDisposed() || !sessions.isCurrent(spaceId, epoch) || loading || historyFailed || abortRef.current || !revisionRef.current) return false;
    const pending = sessions.get(spaceId).pendingSubmission;
    if (!pending || pending.epoch !== epoch || pending.status !== 'failed') return false;
    if (!sessions.retryPendingSubmission(spaceId, epoch, pending.messageId)) return false;
    setError(undefined);
    await executeSubmission({ ...pending, status: 'sending', error: undefined, terminalError: undefined });
    return true;
  };

  const stop = async () => {
    const controller = abortRef.current;
    const runId = runIdRef.current;
    if (!controller || !runId) return;
    try {
      // 捕获本轮 controller：迟到的停止响应不能中断下一轮；false 也不能伪装停止成功。
      const stopped = await api.stopRun(spaceId, runId);
      if (stopped && abortRef.current === controller) controller.abort();
    } catch (e) {
      if (current() && abortRef.current === controller) {
        setError(`停止失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const reload = () => {
    if (abortRef.current || !sessions.canWrite(spaceId)) return;
    setLoading(true);
    setHistoryVersion((value) => value + 1);
  };

  // 权威视图叠加客户端未确认提交（按原 ID 去重，不重复展示）。
  const displayedViews =
    pendingSubmission && pendingSubmission.epoch === epoch && !views.some((v) => v.id === pendingSubmission.messageId)
      ? [
          ...views,
          {
            id: pendingSubmission.messageId,
            role: 'user' as const,
            text: pendingSubmission.text,
            ...(pendingSubmission.attachments?.length ? { attachments: pendingSubmission.attachments } : {}),
            toolCalls: [],
            feedbackAvailable: false,
          },
        ]
      : views;

  return {
    views: displayedViews,
    sessionId,
    persistedMessageIds,
    running,
    error,
    loading: loading || !enabled,
    historyFailed,
    send,
    retry,
    stop,
    reload,
    pendingSubmission,
  };
}
