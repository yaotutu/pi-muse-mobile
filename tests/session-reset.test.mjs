import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatSessionStore } from '../src/sessions/chat-session-store.ts';
import { ApiError } from '../src/api/errors.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const result = (id = 'a') => ({ session: { id, title: id === 'main' ? '默认会话' : '会话', isMain: id === 'main', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }, cancelledApprovals: 0, removed: { jobs: 0, monitors: 0 } });
test('重置仅清聊天草稿/绑定，保留会话规则技能与未保存的设置，主会话也可重置', async () => {
  const calls = [];
  const store = new ChatSessionStore({ resetSession: async (...args) => { calls.push(args); return result(args[0]); } });
  store.bindSession('main', 'old-session'); store.setDraft('main', '旧消息草稿'); store.setInstructions('main', '未保存的规则');
  const entry = store.get('main'); const rules = entry.instructions; const skills = entry.skills; const epoch = entry.epoch;
  skills.draft = { web: false };
  await store.resetSession('main');
  assert.deepEqual(calls, [['main', { clearSchedules: false }]]);
  assert.equal(store.get('main').piSessionId, null); assert.equal(entry.draft, '');
  assert.equal(entry.instructions, rules); assert.equal(entry.skills, skills); assert.equal(rules.draft, '未保存的规则'); assert.deepEqual(skills.draft, { web: false });
  assert.equal(store.isCurrent('main', epoch), false); assert.equal(store.canWrite('main'), true); assert.equal(entry.deleted, false);
});
test('重置互斥锁禁止重复请求、删除、设置写入；可显式选择级联清理', async () => {
  const pending = deferred(); const calls = [];
  const store = new ChatSessionStore({ resetSession: (...args) => { calls.push(args); return pending.promise; } });
  store.get('a').instructions.loaded = true;
  const task = store.resetSession('a', true);
  assert.equal(store.get('a').resetting, true); assert.equal(store.canWrite('a'), false);
  assert.equal(await store.resetSession('a'), undefined); assert.equal(await store.deleteSession('a'), undefined); assert.equal(await store.saveInstructions('a'), false);
  pending.resolve(result()); await task; assert.deepEqual(calls, [['a', { clearSchedules: true }]]);
});
test('设置提交中或连接暂停不允许重置，删除会话仍禁止删除主会话', async () => {
  let calls = 0; const store = new ChatSessionStore({ resetSession: async () => { calls++; return result(); } });
  store.get('a').skills.saving = true; assert.equal(await store.resetSession('a'), undefined);
  store.get('a').skills.saving = false; store.setEnabled(false); assert.equal(await store.resetSession('a'), undefined); assert.equal(calls, 0);
  await assert.rejects(store.deleteSession('main'), (e) => e.status === 409);
});
test('重置取消旧设置读取，忽略无视signal的迟到响应，不让旧epoch复活', async () => {
  const late = deferred(); let signal;
  const store = new ChatSessionStore({ getSessionInstructions: (_id, s) => { signal = s; return late.promise; }, resetSession: async () => result() });
  const read = store.loadInstructions('a'); const epoch = store.get('a').epoch;
  await store.resetSession('a'); late.resolve({ instructions: '旧结果' }); await read;
  assert.equal(signal.aborted, true); assert.equal(store.isCurrent('a', epoch), false); assert.equal(store.get('a').instructions.saved, '');
});
test('明确4xx不伪装成功也不清草稿，网络结果不明禁止重发直至观察到新session', async () => {
  for (const status of [409, 0, 408, 500]) {
    let calls = 0; const store = new ChatSessionStore({ resetSession: async () => { calls++; throw new ApiError(status, 'failed'); } });
    store.bindSession('a', 'old-session'); store.setDraft('a', '旧草稿'); store.setInstructions('a', '规则草稿'); const epoch = store.get('a').epoch;
    await assert.rejects(store.resetSession('a'), (e) => e.status === status);
    assert.equal(calls, 1); assert.equal(store.get('a').draft, '旧草稿'); assert.equal(store.get('a').instructions.draft, '规则草稿');
    assert.equal(store.get('a').resetting, false); assert.equal(store.isCurrent('a', epoch), false);
    if (status !== 409) {
      assert.equal(store.canWrite('a'), false); assert.equal(await store.resetSession('a'), undefined);
      store.bindSession('a', 'old-session'); assert.equal(store.canWrite('a'), false);
      store.bindSession('a', 'observed-new-session'); assert.equal(store.canWrite('a'), true); assert.equal(store.get('a').draft, '');
    } else assert.equal(store.canWrite('a'), true);
  }
});
test('外部设备重置更换piSessionId使聊天失效，但初次绑定/相同session刷新不重建上下文', () => {
  const store = new ChatSessionStore({}); store.setDraft('a', '草稿'); store.setInstructions('a', '会话设置');
  store.bindSession('a', 'first'); const epoch = store.get('a').epoch;
  assert.equal(store.get('a').draft, '草稿'); store.bindSession('a', 'first'); assert.equal(store.get('a').epoch, epoch);
  store.bindSession('a', 'second'); assert.equal(store.isCurrent('a', epoch), false); assert.equal(store.get('a').draft, ''); assert.equal(store.get('a').instructions.draft, '会话设置');
});


const resetAttachment = { id: 'reset-attachment', name: 'notes.txt', kind: 'text', mimeType: 'text/plain', size: 3, dataBase64: 'YWJj' };
function resetFixture() {
  const request = deferred(); let calls = 0;
  const store = new ChatSessionStore({ resetSession: () => { calls++; return request.promise; } });
  store.bindSession('a', 'old-binding'); store.setDraft('a', '附件草稿正文');
  const epoch = store.get('a').epoch;
  assert.equal(store.appendDraftAttachments('a', epoch, [resetAttachment]).ok, true);
  store.setPendingSubmission('a', epoch, { messageId: 'pending-message', runId: 'pending-run', text: '暂存消息', epoch, status: 'failed', error: '原始错误', attachments: [resetAttachment] });
  return { store, request, epoch, calls: () => calls };
}
for (const status of [400, 409, 0, 500]) {
  test(`重置 ${status} 保留完整草稿附件与 pending，旧 epoch 回调无权清除`, async () => {
    const f = resetFixture(); const task = f.store.resetSession('a'); const entry = f.store.get('a');
    assert.equal(entry.epoch, f.epoch + 1); assert.equal(entry.draft, '附件草稿正文');
    assert.deepEqual(entry.draftAttachments, [resetAttachment]); assert.equal(entry.pendingSubmission.epoch, entry.epoch);
    f.store.clearPendingSubmission('a', f.epoch, 'pending-message');
    f.store.updatePendingSubmissionStatus('a', f.epoch, 'pending-message', { status: 'unconfirmed' });
    assert.equal(entry.pendingSubmission.status, 'failed');
    f.request.reject(new ApiError(status, 'reset rejected'));
    await assert.rejects(task, error => error.status === status);
    assert.equal(entry.draft, '附件草稿正文'); assert.deepEqual(entry.draftAttachments, [resetAttachment]);
    assert.equal(entry.pendingSubmission.text, '暂存消息'); assert.equal(entry.pendingSubmission.error, '原始错误');
    assert.deepEqual(entry.pendingSubmission.attachments, [resetAttachment]); assert.equal(f.calls(), 1);
    if (status >= 400 && status < 500) {
      assert.equal(f.store.canWrite('a'), true);
      f.store.setDraft('a', ''); assert.equal(f.store.clearDraftAttachments('a', entry.epoch), true);
      assert.equal(f.store.restorePendingSubmissionToDraft('a'), true);
      assert.equal(entry.draft, '暂存消息'); assert.deepEqual(entry.draftAttachments, [resetAttachment]);
    } else {
      assert.equal(entry.resetUncertain, true); assert.equal(f.store.canWrite('a'), false);
      assert.equal(f.store.restorePendingSubmissionToDraft('a'), false); assert.equal(await f.store.resetSession('a'), undefined);
      assert.equal(f.calls(), 1);
    }
    f.store.dispose();
  });
}
test('重置成功后才清正文、完整附件与 pending', async () => {
  const f = resetFixture(); const task = f.store.resetSession('a');
  assert.deepEqual(f.store.get('a').draftAttachments, [resetAttachment]);
  f.request.resolve(result()); await task;
  assert.equal(f.store.get('a').draft, ''); assert.deepEqual(f.store.get('a').draftAttachments, []);
  assert.equal(f.store.get('a').pendingSubmission, null); f.store.dispose();
});
test('重置未明保留 sending 载荷并转待确认，权威绑定变化才清理', async () => {
  const f = resetFixture(); const entry = f.store.get('a'); entry.pendingSubmission.status = 'sending';
  const task = f.store.resetSession('a'); assert.equal(entry.pendingSubmission.status, 'unconfirmed');
  f.request.reject(new ApiError(500, 'unknown')); await assert.rejects(task);
  f.store.bindSession('a', 'old-binding'); assert.deepEqual(entry.draftAttachments, [resetAttachment]); assert.ok(entry.pendingSubmission);
  f.store.bindSession('a', 'new-binding'); assert.equal(entry.draft, ''); assert.deepEqual(entry.draftAttachments, []);
  assert.equal(entry.pendingSubmission, null); assert.equal(entry.resetUncertain, false); f.store.dispose();
});
