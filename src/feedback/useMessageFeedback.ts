/**
 * 单条已落盘消息的反馈读写。初值来自权威历史，挂载时不额外 GET，避免消息列表 N+1；
 * 评论面板打开、前台历史刷新和结果未明后的核对由父级/用户显式触发。
 *
 * 写入结果未明时保留旧反馈并锁住后续写入，只有一次成功的完整回读才能解除；
 * 不自动重发。所有迟到响应都按连接/空间/会话/消息代次与卸载状态丢弃。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/ApiProvider';
import type { ApiClient } from '../api/contracts';
import { ApiError, isRequestCancelled } from '../api/errors';
import type { MessageFeedback, MessageReaction } from './types';

export type MessageFeedbackInput = {
  spaceId: string;
  sessionId: string;
  messageId: string;
  initialFeedback: MessageFeedback;
};

type FeedbackState = {
  api: ApiClient;
  spaceId: string;
  sessionId: string;
  messageId: string;
  feedback: MessageFeedback;
  /** 本轮本地状态的初值身份；父级初值变化且空闲时直接采用新 props。 */
  sourceInitial: MessageFeedback;
  loading: boolean;
  busy: boolean;
  error: string | null;
  uncertain: boolean;
};

const copyFeedback = (feedback: MessageFeedback): MessageFeedback => ({
  reaction: feedback.reaction,
  comments: feedback.comments.map((comment) => ({ ...comment })),
});

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const uncertainWrite = (error: unknown) =>
  isRequestCancelled(error) ||
  !(error instanceof ApiError) ||
  error.status === 0 ||
  error.status === 408 ||
  error.status >= 500;

const UNCERTAIN_MESSAGE = '反馈提交结果未明；请完整刷新核对后再修改，不会自动重试。';

export function useMessageFeedback({ spaceId, sessionId, messageId, initialFeedback }: MessageFeedbackInput) {
  const api = useApi();
  const [state, setState] = useState<FeedbackState | null>(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const uncertainRef = useRef(false);
  const latestInitialRef = useRef(initialFeedback);

  useEffect(() => {
    latestInitialRef.current = initialFeedback;
  }, [initialFeedback]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  // 连接、空间、会话或消息切换后，旧请求不得写回新目标；新目标直接使用自己的权威初值。
  useEffect(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    busyRef.current = false;
    uncertainRef.current = false;
  }, [api, spaceId, sessionId, messageId]);

  const local = state && state.api === api && state.spaceId === spaceId &&
    state.sessionId === sessionId && state.messageId === messageId ? state : null;
  // 写入中/结果未明时，本地结果优先；空闲时父级的新权威初值立即覆盖旧本地值。
  const feedback = local && (local.busy || local.uncertain || local.sourceInitial === initialFeedback)
    ? local.feedback
    : initialFeedback;
  const loading = local?.loading ?? false;
  const busy = local?.busy ?? false;
  const error = local?.error ?? null;
  const uncertain = local?.uncertain ?? false;

  const publish = useCallback((patch: Partial<FeedbackState>) => {
    setState({
      api,
      spaceId,
      sessionId,
      messageId,
      feedback,
      sourceInitial: initialFeedback,
      loading,
      busy,
      error,
      uncertain,
      ...patch,
    });
  }, [
    api, busy, error, feedback, initialFeedback, loading, messageId, sessionId, spaceId, uncertain,
  ]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!mountedRef.current || requestRef.current || busyRef.current) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    const startFeedback = feedback;
    const startInitial = initialFeedback;
    requestRef.current = controller;
    publish({ feedback: startFeedback, sourceInitial: startInitial, loading: true, error: null });
    try {
      const next = await api.getMessageFeedback(spaceId, messageId, sessionId, controller.signal);
      if (!mountedRef.current || generation !== generationRef.current || requestRef.current !== controller) return;
      uncertainRef.current = false;
      publish({
        feedback: copyFeedback(next),
        sourceInitial: latestInitialRef.current,
        loading: false,
        error: null,
        uncertain: false,
      });
    } catch (caught) {
      if (!mountedRef.current || generation !== generationRef.current || requestRef.current !== controller) return;
      // 读取失败保留旧反馈；若原本处于未明状态，继续保持锁定。
      publish({
        feedback: startFeedback,
        sourceInitial: startInitial,
        loading: false,
        error: messageOf(caught, '读取反馈失败'),
      });
    } finally {
      if (mountedRef.current && generation === generationRef.current && requestRef.current === controller) {
        requestRef.current = null;
      }
    }
  }, [api, feedback, initialFeedback, messageId, publish, sessionId, spaceId]);

  const write = useCallback(async (
    operation: (signal: AbortSignal) => Promise<MessageFeedback>,
  ): Promise<boolean> => {
    if (!mountedRef.current || requestRef.current || busyRef.current || uncertainRef.current) return false;
    const generation = generationRef.current;
    const controller = new AbortController();
    const startFeedback = feedback;
    const startInitial = initialFeedback;
    requestRef.current = controller;
    busyRef.current = true;
    publish({
      feedback: startFeedback,
      sourceInitial: startInitial,
      loading: false,
      busy: true,
      error: null,
    });
    try {
      const next = await operation(controller.signal);
      if (!mountedRef.current || generation !== generationRef.current || requestRef.current !== controller) return false;
      uncertainRef.current = false;
      publish({
        feedback: copyFeedback(next),
        sourceInitial: latestInitialRef.current,
        busy: false,
        error: null,
        uncertain: false,
      });
      return true;
    } catch (caught) {
      if (!mountedRef.current || generation !== generationRef.current || requestRef.current !== controller) return false;
      if (uncertainWrite(caught)) {
        uncertainRef.current = true;
        publish({
          feedback: startFeedback,
          sourceInitial: latestInitialRef.current,
          busy: false,
          error: UNCERTAIN_MESSAGE,
          uncertain: true,
        });
      } else {
        publish({
          feedback: startFeedback,
          sourceInitial: startInitial,
          busy: false,
          error: messageOf(caught, '反馈操作失败'),
        });
      }
      return false;
    } finally {
      if (mountedRef.current && generation === generationRef.current && requestRef.current === controller) {
        requestRef.current = null;
        busyRef.current = false;
      }
    }
  }, [feedback, initialFeedback, publish]);

  const rejectText = useCallback((text: string): boolean => {
    if (text.trim() && text.trim().length <= 4000) return false;
    publish({ error: '评论去除首尾空白后必须为 1 到 4000 字' });
    return true;
  }, [publish]);

  const setReaction = useCallback((reaction: MessageReaction | null) =>
    write((signal) => api.setMessageReaction(spaceId, messageId, sessionId, reaction, signal)),
  [api, messageId, sessionId, spaceId, write]);

  const addComment = useCallback((raw: string) => {
    if (!mountedRef.current || rejectText(raw)) return Promise.resolve(false);
    const text = raw.trim();
    return write((signal) => api.addMessageComment(spaceId, messageId, sessionId, text, signal));
  }, [api, messageId, rejectText, sessionId, spaceId, write]);

  const editComment = useCallback((id: string, raw: string) => {
    if (!mountedRef.current || rejectText(raw)) return Promise.resolve(false);
    const text = raw.trim();
    return write((signal) => api.editMessageComment(spaceId, messageId, id, sessionId, text, signal));
  }, [api, messageId, rejectText, sessionId, spaceId, write]);

  const deleteComment = useCallback((id: string) =>
    write((signal) => api.deleteMessageComment(spaceId, messageId, id, sessionId, signal)),
  [api, messageId, sessionId, spaceId, write]);

  return {
    feedback,
    loading,
    busy,
    error,
    uncertain,
    refresh,
    setReaction,
    addComment,
    editComment,
    deleteComment,
  };
}
