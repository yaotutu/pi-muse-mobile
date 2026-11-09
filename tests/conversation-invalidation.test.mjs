import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-conversation-tests.mjs';
import { readFileSync } from 'node:fs';
import { conversationRefreshKey } from '../src/workspace/conversation-host-state.ts';

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

test('main 冷启动历史失败明确报错并锁发送，不能因目录空或失败伪装空历史', async () => {
  let sends = 0;
  const api = createMockApi({ getConversation: async () => { throw new Error('主聊天历史读取失败'); }, runSession: async () => { sends++; } });
  api.listSessions = async () => { throw new Error('目录不可用'); };
  const store = new ChatSessionStore(api); store.setDraft('main', '冷启动草稿');
  const hook = await renderConversationHook('main', api, store);
  try {
    await waitFor(() => !hook.result.current.loading && hook.result.current.historyFailed);
    assert.match(hook.result.current.error, /主聊天历史读取失败/);
    await hook.result.current.send('不得发送'); assert.equal(sends, 0);
    assert.equal(store.get('main').draft, '冷启动草稿');
  } finally { hook.unmount(); store.dispose(); }
});

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

test('main 始终持有 SSE 所有者；切 Tab 仅改变可见性，epoch 与连接保持原生命周期', () => {
  const host = readFileSync('src/workspace/ConversationHost.tsx', 'utf8');
  assert.match(host, /return <View style=\{styles.host\}>\s*<SessionConversation sessionId="main" visible=\{chatVisible\}/);
  assert.match(host, /!visible && styles\.hidden/);
  assert.match(host, /<ConversationView key=\{`\$\{sessionId\}:\$\{session\.epoch\}`\}/);
  assert.doesNotMatch(host, /chatVisible && <SessionConversation|sessionIds|setVisited/);
  const workspace = readFileSync('src/workspace/WorkspaceScreen.tsx', 'utf8');
  assert.match(workspace, /display: page === 'news' \? 'none' : 'flex'[^\n]*><ConversationHost/);
  assert.match(workspace, /<ApiProvider client=\{connection\.client\} key=\{connection\.snapshot\.workspaceKey\}/);
});

test('每会话失效只接受自己的 session，未同步时不会消费旧失效版本', () => {
  const runtime = { synchronized: true, conversationSyncVersion: 4, conversationInvalidationVersion: 8, conversationInvalidationPiSessionId: 'session-a' };
  assert.equal(conversationRefreshKey(2, runtime, 'session-a'), '2:4:8');
  assert.equal(conversationRefreshKey(2, runtime, 'session-b'), '2:4:8');
  assert.equal(conversationRefreshKey(2, { ...runtime, synchronized: false }, 'session-a'), '2:0:0');
  const host = readFileSync('src/workspace/ConversationHost.tsx', 'utf8');
  assert.match(host, /runtime\.conversationInvalidationPiSessionId !== session\.piSessionId\) onBindingMismatch\(\)/);
});
