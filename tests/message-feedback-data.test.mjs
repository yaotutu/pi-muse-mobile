/** 消息反馈非 UI 数据链：严格契约、HTTP 方法、Hook 状态与已落盘边界。 */

import './helpers/register-conversation-tests.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { HttpApiClient } = await import('../src/api/http-client.ts');
const { ApiError } = await import('../src/api/errors.ts');
const {
  parseConversationSnapshot,
  parseMessageFeedback,
  parseMessageFeedbackEvents,
  parseMessagesSnapshotEvent,
} = await import('../src/api/contracts.ts');
const { SpaceStore } = await import('../src/spaces/space-store.ts');
const { createMockApi } = await import('./helpers/conversation-test-harness.ts');
const { renderConversationHook } = await import('./helpers/hook-runner.ts');
const { renderMessageFeedbackHook } = await import('./helpers/message-feedback-hook-runner.ts');

const COMMENT_ID = '123e4567-e89b-42d3-a456-426614174000';
const EVENT_ID = '223e4567-e89b-42d3-a456-426614174000';
const missingCommentId = '323e4567-e89b-42d3-a456-426614174000';
const feedback = { reaction: null, comments: [] };
const metadata = (feedbackAvailable = true) => ({
  createdAt: '2026-10-28T00:00:00.000Z',
  source: 'chat',
  runId: 'run-1',
  jobId: null,
  notificationId: null,
  feedbackAvailable,
});
const userMessage = (id, content, available = true) => ({
  id, role: 'user', content, metadata: metadata(available), feedback,
});
const assistantMessage = (id, content, available = true) => ({
  id, role: 'assistant', content, metadata: metadata(available), feedback,
});
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out: ${label}`);
};

test('会话历史与反馈事件严格校验必要字段，工具消息只保留执行投影', () => {
  const comment = {
    id: COMMENT_ID, text: '反馈', createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:01.000Z',
  };
  const snapshot = {
    sessionId: 'session-1',
    revision: 'rev-1',
    messages: [
      { ...userMessage('u1', '问题'), feedback: { reaction: 'like', comments: [comment] } },
      assistantMessage('a1', '回答'),
      { id: 't1', role: 'tool', toolCallId: 'call-1', content: '失败', isError: true },
    ],
  };
  const parsed = parseConversationSnapshot(snapshot);
  assert.equal(parsed.sessionId, 'session-1');
  assert.deepEqual(parsed.messages[0].feedback.comments, [comment]);
  assert.equal(parsed.messages[1].metadata.feedbackAvailable, true);
  assert.equal(parsed.messages[2].isError, true);
  assert.equal('metadata' in parsed.messages[2], false);

  for (const invalid of [
    { ...snapshot, sessionId: undefined },
    { ...snapshot, messages: [{ id: 'u1', role: 'user', content: '缺 metadata/feedback' }] },
    { ...snapshot, messages: [assistantMessage('a1', '缺 feedback', false), { ...assistantMessage('a2', 'x') }].map((message, index) => {
      if (index === 1) delete message.feedback;
      return message;
    }) },
    { ...snapshot, messages: [{ id: 't1', role: 'tool', metadata: metadata(), feedback }] },
    { ...snapshot, messages: [{ ...assistantMessage('a1', 'x'), feedback: { reaction: 'neutral', comments: [] } }] },
    { ...snapshot, messages: [{ ...assistantMessage('a1', 'x'), feedback: { reaction: null, comments: [{ ...comment, id: 'not-a-uuid' }] } }] },
  ]) {
    assert.throws(() => parseConversationSnapshot(invalid), /会话历史格式不正确/);
  }

  assert.deepEqual(parseMessageFeedback({ reaction: 'dislike', comments: [comment] }), {
    reaction: 'dislike', comments: [comment],
  });
  assert.throws(() => parseMessageFeedback({ reaction: null }), /会话历史格式不正确/);

  const events = {
    events: [
      { id: EVENT_ID, type: 'reaction_changed', messageId: 'u1', role: 'user', from: null, to: 'like', at: comment.createdAt },
      { id: EVENT_ID, type: 'comment_added', messageId: 'u1', role: 'user', commentId: COMMENT_ID, text: '反馈', at: comment.createdAt },
      { id: EVENT_ID, type: 'comment_edited', messageId: 'u1', role: 'user', commentId: COMMENT_ID, fromText: '反馈', toText: '新反馈', at: comment.updatedAt },
      { id: EVENT_ID, type: 'comment_deleted', messageId: 'u1', role: 'user', commentId: COMMENT_ID, text: '新反馈', at: comment.updatedAt },
    ],
  };
  assert.deepEqual(parseMessageFeedbackEvents(events), events);
  assert.throws(() => parseMessageFeedbackEvents({
    events: [{ ...events.events[0], type: 'unknown' }],
  }), /会话历史格式不正确/);

  const snapshotEvent = parseMessagesSnapshotEvent({
    type: 'MESSAGES_SNAPSHOT', messages: [assistantMessage('a1', '快照')],
  });
  assert.equal(snapshotEvent.messages[0].metadata.feedbackAvailable, true);
});

test('HttpApiClient 使用真实反馈路径、完整响应解析与本地输入门禁', async () => {
  const fullFeedback = {
    reaction: 'like',
    comments: [{
      id: COMMENT_ID, text: '已保存', createdAt: '2026-10-28T00:00:00.000Z',
      updatedAt: '2026-10-28T00:00:01.000Z',
    }],
  };
  const events = {
    events: [{
      id: EVENT_ID, type: 'reaction_changed', messageId: 'message-1', role: 'assistant',
      from: null, to: 'like', at: '2026-10-28T00:00:00.000Z',
    }],
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.includes('/feedback/events')) return jsonResponse(events);
    return jsonResponse(fullFeedback);
  };
  try {
    const client = new HttpApiClient('https://api.example', () => 'secret', () => {});
    assert.deepEqual(await client.getMessageFeedback('space-1', 'message-1', 'session-1'), fullFeedback);
    assert.deepEqual(await client.setMessageReaction('space-1', 'message-1', 'session-1', 'like'), fullFeedback);
    assert.deepEqual(await client.addMessageComment('space-1', 'message-1', 'session-1', '  已保存  '), fullFeedback);
    assert.deepEqual(await client.editMessageComment(
      'space-1', 'message-1', COMMENT_ID, 'session-1', ' 新文本 ',
    ), fullFeedback);
    assert.deepEqual(await client.deleteMessageComment(
      'space-1', 'message-1', COMMENT_ID, 'session-1',
    ), fullFeedback);
    assert.deepEqual(await client.getMessageFeedbackEvents('space-1', 'message-1', 'session-1'), events);

    assert.equal(calls[0].url, 'https://api.example/api/spaces/space-1/messages/message-1/feedback?sessionId=session-1');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].url, 'https://api.example/api/spaces/space-1/messages/message-1/feedback/reaction');
    assert.equal(calls[1].method, 'PUT');
    assert.deepEqual(calls[1].body, { sessionId: 'session-1', reaction: 'like' });
    assert.deepEqual(calls[2].body, { sessionId: 'session-1', text: '已保存' });
    assert.equal(calls[3].method, 'PATCH');
    assert.deepEqual(calls[3].body, { sessionId: 'session-1', text: '新文本' });
    assert.equal(calls[4].method, 'DELETE');
    assert.equal(calls[4].url, `https://api.example/api/spaces/space-1/messages/message-1/feedback/comments/${COMMENT_ID}?sessionId=session-1`);
    assert.equal(calls[5].url, 'https://api.example/api/spaces/space-1/messages/message-1/feedback/events?sessionId=session-1');

    const beforeInvalid = calls.length;
    await assert.rejects(
      client.addMessageComment('space-1', 'message-1', 'session-1', '   '),
      (error) => error instanceof ApiError && error.status === 400,
    );
    assert.equal(calls.length, beforeInvalid, '非法评论不得发送 HTTP');
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => jsonResponse({ reaction: 'like' });
  try {
    const client = new HttpApiClient('https://api.example', () => 'secret', () => {});
    await assert.rejects(
      client.getMessageFeedback('space-1', 'message-1', 'session-1'),
      (error) => error instanceof ApiError && error.status === 502,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('useConversation 只从权威历史或 MESSAGES_SNAPSHOT 公布 sessionId 与已落盘 ID', async () => {
  const persisted = [userMessage('u-existing', '已有历史')];
  let finalMessages = persisted;
  const run = deferred();
  let onEvent;
  const api = createMockApi({
    getConversation: async () => ({
      sessionId: 'session-authority',
      revision: finalMessages === persisted ? 'rev-1' : 'rev-2',
      messages: finalMessages,
    }),
    runAgent: async (input, emit) => {
      onEvent = emit;
      finalMessages = [
        ...persisted,
        userMessage(input.message.id, input.message.content, false),
        assistantMessage('a-new', '回答', false),
      ];
      await run.promise;
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    assert.equal(hook.result.current.sessionId, 'session-authority');
    assert.deepEqual([...hook.result.current.persistedMessageIds], ['u-existing']);

    store.setDraft('space-1', '新问题');
    const sending = hook.result.current.send('新问题', () => store.setDraft('space-1', ''));
    await waitFor(() => onEvent !== undefined, 'run callback');
    const optimisticId = store.get('space-1').pendingSubmission.messageId;
    assert.equal(hook.result.current.persistedMessageIds.has(optimisticId), false);

    onEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [persisted[0], userMessage(optimisticId, '新问题', false), assistantMessage('a-new', '回答', false)],
    });
    await waitFor(() => hook.result.current.persistedMessageIds.has(optimisticId), 'snapshot persisted ids');
    run.resolve();
    await sending;
    assert.equal(hook.result.current.sessionId, 'session-authority');
    assert.equal(hook.result.current.persistedMessageIds.has('a-new'), true);
  } finally {
    hook.unmount();
  }
});

test('useMessageFeedback 挂载不 GET，写入未明锁定且只由完整刷新解除', async () => {
  const initial = { reaction: null, comments: [] };
  const like = { reaction: 'like', comments: [] };
  let getCalls = 0;
  let reactionCalls = 0;
  const write = deferred();
  const api = {
    getMessageFeedback: async () => {
      getCalls++;
      return { reaction: 'dislike', comments: [{ id: COMMENT_ID, text: '服务端', createdAt: metadata().createdAt, updatedAt: metadata().createdAt }] };
    },
    setMessageReaction: async () => {
      reactionCalls++;
      return write.promise;
    },
    addMessageComment: async () => initial,
    editMessageComment: async () => initial,
    deleteMessageComment: async () => initial,
  };
  const hook = await renderMessageFeedbackHook(api, {
    spaceId: 'space-1', sessionId: 'session-1', messageId: 'message-1', initialFeedback: initial,
  });
  try {
    assert.equal(getCalls, 0, '每条消息挂载不得产生 N+1 GET');
    const pendingWrite = hook.result.current.setReaction('like');
    await waitFor(() => hook.result.current.busy, 'busy write');

    // 写入中到达的旧初值不能覆盖本轮结果。
    await hook.update({
      spaceId: 'space-1', sessionId: 'session-1', messageId: 'message-1',
      initialFeedback: { reaction: 'dislike', comments: [] },
    });
    write.resolve(like);
    assert.equal(await pendingWrite, true);
    await waitFor(() => !hook.result.current.busy, 'write settled');
    assert.deepEqual(hook.result.current.feedback, like);

    api.setMessageReaction = async () => {
      reactionCalls++;
      throw new Error('network down');
    };
    assert.equal(await hook.result.current.setReaction('dislike'), false);
    await waitFor(() => hook.result.current.uncertain, 'uncertain write');
    assert.deepEqual(hook.result.current.feedback, like, '未明写入保留旧反馈');
    const callsWhileLocked = reactionCalls;
    assert.equal(await hook.result.current.setReaction('like'), false);
    assert.equal(reactionCalls, callsWhileLocked, '未明状态不得重发写入');

    await hook.result.current.refresh();
    await waitFor(() => !hook.result.current.loading, 'refresh settled');
    assert.equal(getCalls, 1);
    assert.equal(hook.result.current.uncertain, false);
    assert.equal(hook.result.current.feedback.reaction, 'dislike');

    await hook.update({
      spaceId: 'space-1', sessionId: 'session-1', messageId: 'message-1', initialFeedback: initial,
    });
    assert.equal(hook.result.current.feedback.reaction, null, '空闲时同步新的权威初值');
  } finally {
    hook.unmount();
  }
});

test('反馈读取失败保留旧值，切换消息后迟到结果不污染新目标', async () => {
  const initial = { reaction: 'like', comments: [] };
  const oldRead = deferred();
  let readMessageId = '';
  const api = {
    getMessageFeedback: async (_spaceId, messageId) => {
      readMessageId = messageId;
      return oldRead.promise;
    },
    setMessageReaction: async () => initial,
    addMessageComment: async () => initial,
    editMessageComment: async () => initial,
    deleteMessageComment: async () => initial,
  };
  const hook = await renderMessageFeedbackHook(api, {
    spaceId: 'space-1', sessionId: 'session-1', messageId: 'message-old', initialFeedback: initial,
  });
  try {
    const reading = hook.result.current.refresh();
    await waitFor(() => readMessageId === 'message-old', 'old read started');
    await hook.update({
      spaceId: 'space-1', sessionId: 'session-1', messageId: 'message-new',
      initialFeedback: { reaction: null, comments: [] },
    });
    oldRead.resolve({ reaction: 'dislike', comments: [] });
    await reading;
    assert.deepEqual(hook.result.current.feedback, { reaction: null, comments: [] });
  } finally {
    hook.unmount();
  }

  const failing = {
    ...api,
    getMessageFeedback: async () => { throw new ApiError(500, '读取失败'); },
  };
  const second = await renderMessageFeedbackHook(failing, {
    spaceId: 'space-1', sessionId: 'session-1', messageId: 'message-1', initialFeedback: initial,
  });
  try {
    await second.result.current.refresh();
    assert.deepEqual(second.result.current.feedback, initial);
    assert.match(second.result.current.error, /读取失败/);
  } finally {
    second.unmount();
  }
});
