import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { useThreadSessionStore } from '../threads/ThreadSessionProvider';
import { isRequestCancelled, requestCancelled } from '../api/errors';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { StreamAggregator, projectHistory, type MessageView } from './chat-state';

/** 单次挂载仅服务一个 thread；父级以 threadId 为 key 隔离旧流与历史。 */
export function useConversation(threadId: string, refreshKey = 0) {
  const api = useApi();
  const sessions = useThreadSessionStore();
  const epoch = sessions.get(threadId).epoch;
  const writable = sessions.canWrite(threadId);
  const connection = useServiceConnection();
  const enabled = connection?.enabled ?? true;
  const refreshVersion = connection?.snapshot.refreshVersion ?? 0;
  const enabledRef = useRef(enabled);
  const [views, setViews] = useState<MessageView[]>([]);
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
  const current = () => aliveRef.current && sessions.isCurrent(threadId, epoch);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active' && !abortRef.current) setHistoryVersion((value) => value + 1);
      previous = next;
    });
    return () => subscription.remove();
  }, []);

  // 父级以 threadId 为 key：卸载时取消旧流，且所有异步回写都检查生命周期。
  // 不保挂载多个会话，也不让旧请求污染新会话或已退出登录的界面。
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      historyRequest.current?.abort();
      if (abortRef.current) {
        abortRef.current.abort();
        if (runIdRef.current) void api.stopRun(threadId, runIdRef.current).catch(() => {});
      }
    };
  }, [api, threadId]);

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
        const history = await api.getConversation(threadId, controller.signal);
        if (alive && sessions.isCurrent(threadId, epoch)) {
          revisionRef.current = history.revision;
          setViews(projectHistory(history.messages));
          setHistoryFailed(false);
          setError(undefined);
        }
      } catch (e) {
        if (alive && sessions.isCurrent(threadId, epoch) && !isRequestCancelled(e)) {
          setHistoryFailed(true);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (alive && sessions.isCurrent(threadId, epoch)) setLoading(false);
      }
    })();
    return () => { alive = false; controller.abort(); if (historyRequest.current === controller) historyRequest.current = null; };
  }, [api, threadId, historyVersion, enabled, refreshVersion, refreshKey, epoch, sessions, writable]);

  useEffect(() => {
    if (!writable) {
      historyRequest.current?.abort();
      revisionRef.current = null;
    }
  }, [sessions, threadId, epoch, writable]);

  const syncAfterRun = async () => {
    if (!current()) throw requestCancelled();
    const controller = new AbortController();
    historyRequest.current?.abort();
    historyRequest.current = controller;
    try { return await api.getConversation(threadId, controller.signal); }
    finally { if (historyRequest.current === controller) historyRequest.current = null; }
  };

  const send = async (raw: string, onAccepted: () => void, onFailure: (text: string) => void) => {
    const text = raw.trim();
    if (!enabled || !sessions.isCurrent(threadId, epoch) || !text || loading || historyFailed || abortRef.current || !revisionRef.current) return;
    historyRequest.current?.abort();
    onAccepted();
    setError(undefined);
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = `run-${Date.now()}`;
    runIdRef.current = runId;

    // 历史是服务端事实；客户端只发送新消息和读取历史时的版本，不再复制用户序列。
    const expectedRevision = revisionRef.current;
    const userView: MessageView = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      toolCalls: [],
    };
    const aggregator = new StreamAggregator([...views, userView]);
    setViews([...aggregator.messages]);
    setRunning(true);
    try {
      await api.runAgent(
        {
          threadId,
          runId,
          expectedRevision,
          message: { id: userView.id, content: text },
        },
        (event) => {
          if (!current() || controller.signal.aborted) return;
          aggregator.push(event);
          if (event.type === 'RUN_ERROR') setError(event.message ?? '助手运行失败，请重试');
          setViews([...aggregator.messages]);
        },
        controller.signal,
      );
      if (!current()) return;
      try {
        if (!enabledRef.current) {
          aggregator.settle();
          if (current()) { setViews([...aggregator.messages]); setHistoryFailed(true); }
          return;
        }
        const history = await syncAfterRun();
        if (current()) {
          revisionRef.current = history.revision;
          setViews(projectHistory(history.messages));
        }
      } catch (syncError) {
        // 权威历史拉取失败：保留聚合视图（已验证的降级路径）
        aggregator.settle();
        if (current()) {
          setViews([...aggregator.messages]);
          // 内容可以保留展示，但没有新版本不能安全发送下一轮。
          setHistoryFailed(true);
          if (!isRequestCancelled(syncError)) setError('回复已结束，但会话同步失败，请重新加载后继续');
        }
      }
    } catch (e) {
      aggregator.settle();
      if (current()) setViews([...aggregator.messages]);
      if (current() && (controller.signal.aborted || isRequestCancelled(e))) {
        if (!enabledRef.current) { setHistoryFailed(true); return; }
        // 停止也可能已落盘部分回复；恢复服务端历史与版本后才允许发送下一轮。
        try {
          const history = await syncAfterRun();
          if (current()) {
            revisionRef.current = history.revision;
            setViews(projectHistory(history.messages));
          }
        } catch (syncError) {
          if (current()) {
            setHistoryFailed(true);
            if (!isRequestCancelled(syncError)) setError('停止后无法同步会话，请重新加载');
          }
        }
      } else if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        // 失败后保留待发送文本，但不覆盖用户在流式期间另写的新草稿。
        onFailure(text);
        // 请求可能已落盘，也可能因版本冲突被拒绝；先恢复权威历史再允许发送。
        setHistoryFailed(true);
      }
    } finally {
      const stale = !sessions.isCurrent(threadId, epoch);
      if (stale && aliveRef.current) setHistoryFailed(true);
      abortRef.current = null;
      runIdRef.current = null;
      if (aliveRef.current) {
        setRunning(false);
        if (stale && sessions.canWrite(threadId)) setHistoryVersion((value) => value + 1);
      }
    }
  };

  const stop = async () => {
    const controller = abortRef.current;
    const runId = runIdRef.current;
    if (!controller || !runId) return;
    try {
      // 捕获本轮 controller：迟到的停止响应不能中断下一轮；false 也不能伪装停止成功。
      const stopped = await api.stopRun(threadId, runId);
      if (stopped && abortRef.current === controller) controller.abort();
    } catch (e) {
      if (current() && abortRef.current === controller) {
        setError(`停止失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const reload = () => {
    if (abortRef.current || !sessions.canWrite(threadId)) return;
    setLoading(true);
    setHistoryVersion((value) => value + 1);
  };
  return { views, running, error, loading: loading || !enabled, historyFailed, send, stop, reload };
}
