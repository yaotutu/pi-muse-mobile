import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-conversation-tests.mjs';
import { readFileSync } from 'node:fs';
import { conversationRefreshKey, reconcileConversationOwners } from '../src/workspace/conversation-host-state.ts';

const { ChatSessionStore } = await import('../src/sessions/chat-session-store.ts');
const { createMockApi } = await import('./helpers/conversation-test-harness.ts');
const { renderConversationHook } = await import('./helpers/hook-runner.ts');

const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await wait();
  }
  assert.fail('condition did not settle');
};

test('conversation_updated 触发的权威历史刷新保留草稿，流式运行结束后不漏刷新', async () => {
  const store = new ChatSessionStore();
  const reads = [];
  const run = (() => {
    let resolveRun;
    const promise = new Promise((resolve) => { resolveRun = resolve; });
    return { promise, resolve: resolveRun };
  })();
  const snapshot = (id) => ({
    sessionId: '22222222-2222-4222-8222-222222222222', piSessionId: 'session-a',
    revision: `rev-${id}`,
    messages: [{
      id, role: 'assistant', content: id, metadata: {
        createdAt: '2026-10-29T00:00:00.000Z', source: 'chat', runId: 'run-a', jobId: null, notificationId: null, feedbackAvailable: false,
      }, feedback: { reaction: null, comments: [] },
    }],
  });
  const api = createMockApi({
    getConversation: async () => {
      reads.push(reads.length);
      return snapshot(reads.length === 1 ? 'old-message' : 'notification-message');
    },
    runSession: () => run.promise,
  });
  const hook = await renderConversationHook('22222222-2222-4222-8222-222222222222', api, store);
  await waitFor(() => hook.result.current.views.some((message) => message.id === 'old-message'));

  const sending = hook.result.current.send('streaming');
  await waitFor(() => hook.result.current.running);
  store.setDraft('22222222-2222-4222-8222-222222222222', 'draft-after-notification');
  await hook.rerender(1);
  assert.equal(reads.length, 1);

  run.resolve();
  await sending;
  await waitFor(() => hook.result.current.views.some((message) => message.id === 'notification-message'));
  assert.equal(hook.result.current.running, false);
  assert.equal(store.get('22222222-2222-4222-8222-222222222222').draft, 'draft-after-notification');
  hook.unmount();
});

test('会话切换后的历史读取只归属新会话，不回写旧会话消息', async () => {
  const store = new ChatSessionStore();
  const reads = [];
  const snapshot = (sessionId) => ({
    sessionId, piSessionId: `session-${sessionId}`,
    revision: `rev-${sessionId}`,
    messages: [{
      id: `message-${sessionId}`, role: 'assistant', content: sessionId, metadata: {
        createdAt: '2026-10-29T00:00:00.000Z', source: 'chat', runId: 'run-a', jobId: null, notificationId: null, feedbackAvailable: false,
      }, feedback: { reaction: null, comments: [] },
    }],
  });
  const api = createMockApi({
    getConversation: async (sessionId) => {
      reads.push(sessionId);
      return snapshot(sessionId);
    },
  });
  const oldSession = await renderConversationHook('22222222-2222-4222-8222-222222222222', api, store);
  await waitFor(() => oldSession.result.current.views.some((message) => message.id === 'message-22222222-2222-4222-8222-222222222222'));
  oldSession.unmount();

  const nextSession = await renderConversationHook('33333333-3333-4333-8333-333333333333', api, store);
  await waitFor(() => nextSession.result.current.views.some((message) => message.id === 'message-33333333-3333-4333-8333-333333333333'));
  assert.deepEqual(reads, ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']);
  assert.equal(nextSession.result.current.piSessionId, 'session-33333333-3333-4333-8333-333333333333');
  nextSession.unmount();
});

test('已访问会话切换后保留原 SSE 所有者；删除会话才释放所有者', () => {
  const first = reconcileConversationOwners(['main'], 'side-a', ['main', 'side-a']);
  const second = reconcileConversationOwners(first, 'main', ['main', 'side-a']);
  assert.deepEqual(second, ['main', 'side-a']);
  assert.equal(reconcileConversationOwners(second, 'main', ['main', 'side-a']), second);
  assert.deepEqual(reconcileConversationOwners(second, 'main', ['main']), ['main']);
});

test('每会话失效只接受自己的 session，未同步时不会消费旧失效版本', () => {
  const runtime = { synchronized: true, conversationSyncVersion: 4, conversationInvalidationVersion: 8, conversationInvalidationPiSessionId: 'session-a' };
  assert.equal(conversationRefreshKey(2, runtime, 'session-a'), '2:4:8');
  assert.equal(conversationRefreshKey(2, runtime, 'session-b'), '2:4:8');
  assert.equal(conversationRefreshKey(2, { ...runtime, synchronized: false }, 'session-a'), '2:0:0');
  const host = readFileSync('src/workspace/ConversationHost.tsx', 'utf8');
  assert.match(host, /runtime\.conversationInvalidationPiSessionId !== session\.piSessionId\) onBindingMismatch\(\)/);
});
