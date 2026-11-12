import './helpers/register-conversation-tests.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatSessionStore } from '../src/sessions/chat-session-store.ts';
import { sameConversationMessages } from '../src/chat/conversation-history-equality.ts';
import { createMockApi, sessionStatusOf } from './helpers/conversation-test-harness.ts';
import { renderConversationHook } from './helpers/hook-runner.ts';

const id = 'main';
const metadata = { createdAt: '2026-11-12T00:00:00Z', source: 'chat', runId: null, jobId: null, notificationId: null, feedbackAvailable: true };
const message = (content = 'hello') => ({ id: 'u', role: 'user', content, metadata, feedback: { reaction: null, comments: [] } });
const snapshot = (messages = [message()]) => ({ sessionId: id, piSessionId: 'binding', revision: 'r', messages });
const local = { piSessionId: 'binding', messages: [message('cached')], draft: 'draft', readingPosition: { messageId: 'u', offset: 5, following: false } };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise((done) => setTimeout(done, 15));
function environment() {
  const state = { connection: 'live', runs: [], presences: [], conversationSyncVersion: 1, conversationInvalidations: [] };
  return { state, value: { runtime: { subscribe: () => () => {}, getSnapshot: () => state }, connection: { enabled: true, snapshot: { status: 'online', refreshVersion: 0 } } } };
}

test('离线缓存只展示，不获得 piSessionId / persisted IDs / feedback / 发送资格或清 pending', async () => {
  let reads = 0; let sends = 0;
  const api = createMockApi({ getConversation: async () => { reads++; return snapshot(); }, runSession: async () => { sends++; } });
  const store = new ChatSessionStore(api, { async load() { return local; }, async save() {}, async remove() {} });
  store.get(id); store.setPendingSubmission(id, 0, { messageId: 'pending', runId: 'run', text: 'not confirmed', epoch: 0, status: 'unconfirmed' });
  const env = environment(); env.value.connection.enabled = false; env.value.connection.snapshot.status = 'offline'; env.state.connection = 'paused';
  const hook = await renderConversationHook(id, api, store, 0, env.value);
  try {
    await tick(); assert.equal(hook.result.current.views[0].text, 'cached'); assert.equal(hook.result.current.views[0].feedbackAvailable, false);
    assert.equal(hook.result.current.persistedMessageIds.size, 0); assert.equal(hook.result.current.piSessionId, null);
    assert.equal(store.get(id).pendingSubmission.status, 'unconfirmed');
    await hook.result.current.send('must not send'); assert.equal(sends, 0); assert.equal(reads, 0);
  } finally { hook.unmount(); store.dispose(); }
});

test('401 状态不新展示受保护缓存；hydrate 晚于网络时不覆盖权威 views', async () => {
  for (const status of ['authentication-required', 'online']) {
    const gate = deferred(); const api = createMockApi({ getConversation: async () => snapshot([message('network')]) });
    const store = new ChatSessionStore(api, { load: () => gate.promise, async save() {}, async remove() {} });
    const env = environment(); env.value.connection.snapshot.status = status;
    if (status === 'authentication-required') { env.value.connection.enabled = false; env.state.connection = 'authentication-required'; }
    const hook = await renderConversationHook(id, api, store, 0, env.value);
    try {
      gate.resolve(local); await tick();
      assert.deepEqual(hook.result.current.views.map((view) => view.text), status === 'online' ? ['network'] : []);
      if (status === 'online') assert.equal(hook.result.current.piSessionId, 'binding');
    } finally { hook.unmount(); store.dispose(); }
  }
});

test('重复恢复合并 in-flight GET；正常刷新不锁已有权威输入、相同内容保留 views 引用', async () => {
  let reads = 0; const gate = deferred(); const env = environment();
  const api = createMockApi({ getConversation: async () => { reads++; if (reads === 2) await gate.promise; return snapshot(); } });
  const store = new ChatSessionStore(api); const hook = await renderConversationHook(id, api, store, '0:1:0', env.value);
  try {
    const views = hook.result.current.views; assert.equal(reads, 1);
    env.state.conversationSyncVersion++; env.value.connection.snapshot.refreshVersion++;
    await hook.rerender('1:2:0'); assert.equal(reads, 2); assert.equal(hook.result.current.loading, false);
    env.value.connection.snapshot.refreshVersion++; await hook.rerender('2:2:0');
    assert.equal(reads, 2, '同波恢复不能取消重开 GET');
    gate.resolve(); await tick(); assert.equal(reads, 2); assert.equal(hook.result.current.views, views);
    // 模拟目录 listSessions 比 ready 晚很多才成功，不靠 debounce 窗口去重。
    await new Promise((done) => setTimeout(done, 300));
    env.value.connection.snapshot.refreshVersion++; await hook.rerender('3:2:0'); await tick();
    assert.equal(reads, 2, 'ready 已核对成功，迟到连接版本不能再读完整历史');
  } finally { hook.unmount(); store.dispose(); }
});

test('失同步只保留旧 views 并锁发送，不在断开时 GET；ready 后只核对一次', async () => {
  let reads = 0; const env = environment();
  const api = createMockApi({ getConversation: async () => { reads++; return snapshot(); } });
  const store = new ChatSessionStore(api); const hook = await renderConversationHook(id, api, store, '0:1:0', env.value);
  try {
    const views = hook.result.current.views;
    env.state.connection = 'reconnecting'; await hook.rerender('0:1:0'); await tick();
    assert.equal(reads, 1); assert.equal(hook.result.current.views, views); assert.equal(hook.result.current.loading, true);
    env.state.connection = 'live'; env.state.conversationSyncVersion++; env.value.connection.snapshot.refreshVersion++;
    await hook.rerender('1:2:0'); await tick(); assert.equal(reads, 2); assert.equal(hook.result.current.views, views);
  } finally { hook.unmount(); store.dispose(); }
});

test('GET 中 conversation_updated 不丢；同 revision 反馈变化仍替换 views', async () => {
  let reads = 0; const gate = deferred(); const env = environment();
  const api = createMockApi({ getConversation: async () => {
    const read = ++reads; if (read === 2) await gate.promise;
    return snapshot(read < 3 ? [message()] : [{ ...message(), feedback: { reaction: 'like', comments: [] } }]);
  } });
  const store = new ChatSessionStore(api); const hook = await renderConversationHook(id, api, store, 0, env.value);
  try {
    const views = hook.result.current.views;
    hook.result.current.reload(); await hook.rerender(); assert.equal(reads, 2);
    env.state.conversationInvalidations = [{ sessionId: id, piSessionId: 'binding', version: 1 }];
    await hook.rerender(2); assert.equal(reads, 2);
    gate.resolve(); await tick(); assert.equal(reads, 3); assert.notEqual(hook.result.current.views, views);
    assert.equal(hook.result.current.views[0].feedback.reaction, 'like');
  } finally { hook.unmount(); store.dispose(); }
});

for (const timing of ['during-final-read', 'after-final-read', 'during-final-read-with-invalidation']) {
  test(`本地终态完整对账后，同一次运行的通知不重复 GET：${timing}`, async () => {
    let reads = 0; let submitted;
    const gate = deferred(); const env = environment();
    const api = createMockApi({
      getConversation: async () => {
        reads++;
        if (reads === 2 && timing.startsWith('during-final-read')) await gate.promise;
        return snapshot(submitted ? [message(), { ...message('sent'), id: submitted.message.id }] : [message()]);
      },
      runSession: async (input, onEvent) => { submitted = input; onEvent({ type: 'RUN_FINISHED' }); },
    });
    const store = new ChatSessionStore(api);
    const hook = await renderConversationHook(id, api, store, 0, env.value);
    try {
      const sending = hook.result.current.send('sent');
      await tick();
      if (timing === 'after-final-read') await sending;
      env.state.runs = [sessionStatusOf(id, submitted.runId, 'completed').status];
      const hasNewBody = timing.endsWith('with-invalidation');
      if (hasNewBody) env.state.conversationInvalidations = [{ sessionId: id, piSessionId: 'binding', version: 1 }];
      await hook.rerender();
      gate.resolve();
      await sending; await tick();
      const expected = hasNewBody ? 3 : 2;
      assert.equal(reads, expected, hasNewBody ? '新正文失效仍须在终态 GET 后再次核对' : '初读 + 一次终态完整对账，不因通知时序多读');
      assert.equal(store.get(id).pendingSubmission, null);
      env.state.runs.push(sessionStatusOf(id, 'independent-remote-run', 'completed').status);
      await hook.rerender(); await tick();
      assert.equal(reads, expected + 1, '其他运行的终态仍需核对');
    } finally { hook.unmount(); store.dispose(); }
  });
}

test('远端 run 终态由 Hook 统一核对，不依赖页面 reload；比较有界且不只看 revision', async () => {
  let reads = 0; const env = environment(); const api = createMockApi({ getConversation: async () => { reads++; return snapshot([message(`read-${reads}`)]); } });
  const store = new ChatSessionStore(api); const hook = await renderConversationHook(id, api, store, 0, env.value);
  try {
    env.state.runs = [sessionStatusOf(id, 'remote-run', 'completed').status];
    await hook.rerender(); await tick(); assert.equal(reads, 2); assert.equal(hook.result.current.views[0].text, 'read-2');
    assert.equal(sameConversationMessages([message()], [message()]), true);
    assert.equal(sameConversationMessages([message()], [{ ...message(), feedback: { reaction: 'like', comments: [] } }]), false);
    assert.equal(sameConversationMessages([message('x'.repeat(3 * 1024 * 1024))], [message('x'.repeat(3 * 1024 * 1024))]), false);
  } finally { hook.unmount(); store.dispose(); }
});
