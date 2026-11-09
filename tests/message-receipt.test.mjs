import './helpers/register-conversation-tests.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const { ChatSessionStore } = await import('../src/sessions/chat-session-store.ts');
const { createMockApi } = await import('./helpers/conversation-test-harness.ts');
const { renderConversationHook } = await import('./helpers/hook-runner.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const snapshot = (messages, revision = 'rev-0', piSessionId = 'mock-session', sessionId = 'main') => ({ sessionId, piSessionId, revision, messages });

async function fixture(receiptKind = 'saved') {
  const receipt = deferred(), finish = deferred();
  let submitted, emit, reads = 0, phase = 'initial', receiptSignal;
  const api = createMockApi({
    getConversation: async (_id, signal) => {
      reads++;
      if (phase === 'initial') return snapshot([]);
      if (phase === 'new') return snapshot([], 'rev-new', 'new-pi');
      if (phase === 'live') { receiptSignal = signal; return receipt.promise; }
      return snapshot(receiptKind === 'late' ? [] : [{ id: submitted.message.id, role: 'user', content: submitted.message.content }], 'rev-final');
    },
    runSession: async (input, onEvent) => {
      submitted = input; emit = onEvent; phase = 'live';
      onEvent({ type: 'RUN_STARTED', runId: input.runId, sessionId: 'main' });
      await finish.promise; phase = 'finished';
      onEvent({ type: 'TEXT_MESSAGE_END', messageId: 'a-live' });
      onEvent({ type: 'RUN_FINISHED', runId: input.runId, sessionId: 'main' });
    },
  });
  const store = new ChatSessionStore(api), hook = await renderConversationHook('main', api, store);
  const sending = hook.result.current.send('Owned payload');
  await hook.rerender();
  return { api, store, hook, receipt, finish, sending, get submitted() { return submitted; }, get reads() { return reads; }, get receiptSignal() { return receiptSignal; }, setPhase(value) { phase = value; },
    progress() { emit({ type: 'TEXT_MESSAGE_START', messageId: 'a-live' }); emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a-live', delta: 'Live text' }); },
    more() { emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a-live', delta: ' more' }); },
    saved(pi = 'mock-session', id = 'main') { return snapshot([{ id: submitted.message.id, role: 'user', content: 'Owned payload' }, { id: 'snapshot-only', role: 'assistant', content: 'Must not replace live view' }], 'receipt-revision-not-for-next-send', pi, id); },
  };
}

async function close(f) { f.finish.resolve(); f.receipt.resolve(snapshot([])); await f.sending; f.hook.unmount(); }

test('首次进展的保存证据能提前显示勾，但不释放暂存、改写回复或自动重发', async () => {
  const f = await fixture();
  try {
    assert.equal(f.reads, 1, 'RUN_STARTED 不是保存证据，也不触发盲目轮询');
    assert.equal(f.hook.result.current.persistedMessageIds.has(f.submitted.message.id), false);
    f.progress(); f.receipt.resolve(f.saved()); await f.hook.rerender();
    assert.equal(f.hook.result.current.persistedMessageIds.has(f.submitted.message.id), true);
    assert.equal(f.store.get('main').pendingSubmission.text, 'Owned payload');
    assert.equal(f.hook.result.current.running, true);
    assert.equal(f.hook.result.current.views.find(m => m.id === 'a-live').text, 'Live text');
    assert.equal(f.hook.result.current.views.some(m => m.id === 'snapshot-only'), false);
    for (let i = 0; i < 20; i++) f.more();
    await f.hook.rerender(); assert.equal(f.reads, 2, '每轮最多一次保存探测，不随每个 delta 拉取历史');
    f.finish.resolve(); await f.sending;
    assert.equal(f.store.get('main').pendingSubmission, null);
    assert.equal(f.reads, 3, '终态仍独立读取完整权威历史');
  } finally { await close(f); }
});

test('保存探测网络失败不打断正常流、不改失败状态、不重复读回', async () => {
  const f = await fixture();
  try {
    f.progress(); f.receipt.reject(new Error('receipt read failed')); await f.hook.rerender();
    assert.equal(f.hook.result.current.persistedMessageIds.has(f.submitted.message.id), false);
    assert.equal(f.hook.result.current.historyFailed, false);
    assert.equal(f.store.get('main').pendingSubmission.status, 'sending');
    f.more(); await f.hook.rerender(); assert.equal(f.reads, 2);
    f.finish.resolve(); await f.sending;
    assert.equal(f.hook.result.current.persistedMessageIds.has(f.submitted.message.id), true);
    assert.equal(f.store.get('main').pendingSubmission, null);
  } finally { await close(f); }
});

for (const kind of ['missing-user', 'different-pi', 'different-session']) {
  test(`保存标记拒绝 ${kind} 的不匹配快照`, async () => {
    const f = await fixture();
    try {
      f.progress();
      f.receipt.resolve(kind === 'missing-user' ? snapshot([]) : f.saved(kind === 'different-pi' ? 'other-pi' : 'mock-session', kind === 'different-session' ? 'other-session' : 'main'));
      await f.hook.rerender();
      assert.equal(f.hook.result.current.persistedMessageIds.has(f.submitted.message.id), false);
      assert.equal(f.store.get('main').pendingSubmission.status, 'sending');
      assert.equal(f.hook.result.current.historyFailed, false);
    } finally { await close(f); }
  });
}

test('终态之后才抵达的旧保存探测不得复活保存标记或解除未明锁', async () => {
  const f = await fixture('late');
  try {
    f.progress(); const old = f.saved();
    f.finish.resolve(); await f.sending;
    assert.equal(f.receiptSignal.aborted, true);
    assert.equal(f.store.get('main').pendingSubmission.status, 'unconfirmed');
    f.receipt.resolve(old); await f.hook.rerender();
    assert.equal(f.hook.result.current.persistedMessageIds.has(f.submitted.message.id), false);
    assert.equal(f.store.get('main').pendingSubmission.status, 'unconfirmed');
  } finally { await close(f); }
});

test('重置换代后迟到保存回读不能污染新主聊天', async () => {
  const f = await fixture(); let next;
  try {
    f.progress(); const old = f.saved(); f.hook.unmount();
    await f.store.resetSession('main'); f.setPhase('new');
    next = await renderConversationHook('main', f.api, f.store);
    f.receipt.resolve(old); f.finish.resolve(); await f.sending; await next.rerender();
    assert.equal(next.result.current.piSessionId, 'new-pi');
    assert.equal(next.result.current.persistedMessageIds.has(f.submitted.message.id), false);
    assert.deepEqual(next.result.current.views, []);
    assert.equal(f.store.get('main').pendingSubmission, null);
  } finally { next?.unmount(); await close(f); }
});
