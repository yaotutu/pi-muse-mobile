import assert from 'node:assert/strict';
import test from 'node:test';
import './helpers/register-conversation-tests.mjs';
import { readFileSync } from 'node:fs';
import { conversationRefreshKey, reconcileConversationOwners } from '../src/workspace/conversation-host-state.ts';

const { AgentStore } = await import('../src/agents/agent-store.ts');
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
  const store = new AgentStore();
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
  const hook = await renderConversationHook('agent-a', api, store);
  await waitFor(() => hook.result.current.views.some((message) => message.id === 'old-message'));

  const sending = hook.result.current.send('streaming');
  await waitFor(() => hook.result.current.running);
  store.setDraft('agent-a', 'draft-after-notification');
  await hook.rerender(1);
  assert.equal(reads.length, 1);

  run.resolve();
  await sending;
  await waitFor(() => hook.result.current.views.some((message) => message.id === 'notification-message'));
  assert.equal(hook.result.current.running, false);
  assert.equal(store.get('agent-a').draft, 'draft-after-notification');
  hook.unmount();
});

test('智能体切换后的历史读取只归属新智能体，不回写旧智能体消息', async () => {
  const store = new AgentStore();
  const reads = [];
  const snapshot = (agentId) => ({
    sessionId: `session-${agentId}`,
    revision: `rev-${agentId}`,
    messages: [{
      id: `message-${agentId}`, role: 'assistant', content: agentId, metadata: {
        createdAt: '2026-10-29T00:00:00.000Z', source: 'chat', runId: 'run-a', jobId: null, notificationId: null, feedbackAvailable: false,
      }, feedback: { reaction: null, comments: [] },
    }],
  });
  const api = createMockApi({
    getConversation: async (agentId) => {
      reads.push(agentId);
      return snapshot(agentId);
    },
  });
  const oldAgent = await renderConversationHook('agent-a', api, store);
  await waitFor(() => oldAgent.result.current.views.some((message) => message.id === 'message-agent-a'));
  oldAgent.unmount();

  const nextAgent = await renderConversationHook('agent-b', api, store);
  await waitFor(() => nextAgent.result.current.views.some((message) => message.id === 'message-agent-b'));
  assert.deepEqual(reads, ['agent-a', 'agent-b']);
  assert.equal(nextAgent.result.current.sessionId, 'session-agent-b');
  nextAgent.unmount();
});

test('已访问智能体切换后保留原 SSE 所有者；删除智能体才释放所有者', () => {
  const first = reconcileConversationOwners(['local-main'], 'side-a', ['local-main', 'side-a']);
  const second = reconcileConversationOwners(first, 'local-main', ['local-main', 'side-a']);
  assert.deepEqual(second, ['local-main', 'side-a']);
  assert.equal(reconcileConversationOwners(second, 'local-main', ['local-main', 'side-a']), second);
  assert.deepEqual(reconcileConversationOwners(second, 'local-main', ['local-main']), ['local-main']);
});

test('每智能体失效只接受自己的 session，未同步时不会消费旧失效版本', () => {
  const runtime = { synchronized: true, conversationSyncVersion: 4, conversationInvalidationVersion: 8, conversationInvalidationSessionId: 'session-a' };
  assert.equal(conversationRefreshKey(2, runtime, 'session-a'), '2:4:8');
  assert.equal(conversationRefreshKey(2, runtime, 'session-b'), '2:4:0');
  assert.equal(conversationRefreshKey(2, { ...runtime, synchronized: false }, 'session-a'), '2:0:0');
  const host = readFileSync('src/workspace/ConversationHost.tsx', 'utf8');
  assert.match(host, /runtime\.conversationInvalidationSessionId !== session\.sessionId\) onBindingMismatch\(\)/);
});
