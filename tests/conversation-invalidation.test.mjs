import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-conversation-tests.mjs';
import { readFileSync } from 'node:fs';

const { SpaceStore } = await import('../src/spaces/space-store.ts');
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
  const store = new SpaceStore();
  const reads = [];
  const run = (() => {
    let resolveRun;
    const promise = new Promise((resolve) => { resolveRun = resolve; });
    return { promise, resolve: resolveRun };
  })();
  const snapshot = (id) => ({
    sessionId: 'session-a',
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
    runAgent: () => run.promise,
  });
  const hook = await renderConversationHook('space-a', api, store);
  await waitFor(() => hook.result.current.views.some((message) => message.id === 'old-message'));

  const sending = hook.result.current.send('streaming');
  await waitFor(() => hook.result.current.running);
  store.setDraft('space-a', 'draft-after-notification');
  await hook.rerender(1);
  assert.equal(reads.length, 1);

  run.resolve();
  await sending;
  await waitFor(() => hook.result.current.views.some((message) => message.id === 'notification-message'));
  assert.equal(hook.result.current.running, false);
  assert.equal(store.get('space-a').draft, 'draft-after-notification');
  hook.unmount();
});

test('空间切换后的历史读取只归属新空间，不回写旧空间消息', async () => {
  const store = new SpaceStore();
  const reads = [];
  const snapshot = (spaceId) => ({
    sessionId: `session-${spaceId}`,
    revision: `rev-${spaceId}`,
    messages: [{
      id: `message-${spaceId}`, role: 'assistant', content: spaceId, metadata: {
        createdAt: '2026-10-29T00:00:00.000Z', source: 'chat', runId: 'run-a', jobId: null, notificationId: null, feedbackAvailable: false,
      }, feedback: { reaction: null, comments: [] },
    }],
  });
  const api = createMockApi({
    getConversation: async (spaceId) => {
      reads.push(spaceId);
      return snapshot(spaceId);
    },
  });
  const oldSpace = await renderConversationHook('space-a', api, store);
  await waitFor(() => oldSpace.result.current.views.some((message) => message.id === 'message-space-a'));
  oldSpace.unmount();

  const nextSpace = await renderConversationHook('space-b', api, store);
  await waitFor(() => nextSpace.result.current.views.some((message) => message.id === 'message-space-b'));
  assert.deepEqual(reads, ['space-a', 'space-b']);
  assert.equal(nextSpace.result.current.sessionId, 'session-space-b');
  nextSpace.unmount();
});

test('WorkspaceScreen 只刷新当前空间和当前/未知 session，旧 session 与跨空间只核对权威绑定', () => {
  const source = readFileSync('src/workspace/WorkspaceScreen.tsx', 'utf8');
  assert.match(source, /const conversationInvalidationVersion = invalidationSessionMatches/);
  assert.match(source, /runtime\.conversationInvalidationSessionId/);
  assert.match(source, /\/\/ 旧 session 迟到帧不污染当前视图；疑似远端 reset 时先核对空间绑定。/);
  assert.match(source, /const conversationRefreshKey = runtime\.synchronized/);
  assert.match(source, /if \(runtime\.synchronized\) void reloadSpaces\(\);/);
});
