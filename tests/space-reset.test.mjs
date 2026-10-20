import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SpaceStore } from '../src/spaces/space-store.ts';
import { ApiError } from '../src/api/errors.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const result = (id = 'a') => ({ ok: true, spaceId: id, sessionId: 'new-session', cancelledApprovals: 0, removed: { jobs: 0, monitors: 0 } });
test('重置仅清聊天草稿/绑定，保留空间规则技能与未保存的设置，主空间也可重置', async () => {
  const calls = [];
  const store = new SpaceStore({ resetSpace: async (...args) => { calls.push(args); return result(args[0]); } });
  store.bindSession('local-main', 'old-session'); store.setDraft('local-main', '旧消息草稿'); store.setInstructions('local-main', '未保存的规则');
  const entry = store.get('local-main'); const rules = entry.instructions; const skills = entry.skills; const epoch = entry.epoch;
  skills.draft = { web: false };
  await store.resetSpace('local-main');
  assert.deepEqual(calls, [['local-main', { clearSchedules: false }]]);
  assert.equal(store.get('local-main').sessionId, 'new-session'); assert.equal(entry.draft, '');
  assert.equal(entry.instructions, rules); assert.equal(entry.skills, skills); assert.equal(rules.draft, '未保存的规则'); assert.deepEqual(skills.draft, { web: false });
  assert.equal(store.isCurrent('local-main', epoch), false); assert.equal(store.canWrite('local-main'), true); assert.equal(entry.deleted, false);
});
test('重置互斥锁禁止重复请求、删除、设置写入；可显式选择级联清理', async () => {
  const pending = deferred(); const calls = [];
  const store = new SpaceStore({ resetSpace: (...args) => { calls.push(args); return pending.promise; } });
  store.get('a').instructions.loaded = true;
  const task = store.resetSpace('a', true);
  assert.equal(store.get('a').resetting, true); assert.equal(store.canWrite('a'), false);
  assert.equal(await store.resetSpace('a'), undefined); assert.equal(await store.deleteSpace('a'), undefined); assert.equal(await store.saveInstructions('a'), false);
  pending.resolve(result()); await task; assert.deepEqual(calls, [['a', { clearSchedules: true }]]);
});
test('设置提交中或连接暂停不允许重置，删除空间仍禁止删除主空间', async () => {
  let calls = 0; const store = new SpaceStore({ resetSpace: async () => { calls++; return result(); } });
  store.get('a').skills.saving = true; assert.equal(await store.resetSpace('a'), undefined);
  store.get('a').skills.saving = false; store.setEnabled(false); assert.equal(await store.resetSpace('a'), undefined); assert.equal(calls, 0);
  await assert.rejects(store.deleteSpace('local-main'), (e) => e.status === 409);
});
test('重置取消旧设置读取，忽略无视signal的迟到响应，不让旧epoch复活', async () => {
  const late = deferred(); let signal;
  const store = new SpaceStore({ getSpaceInstructions: (_id, s) => { signal = s; return late.promise; }, resetSpace: async () => result() });
  const read = store.loadInstructions('a'); const epoch = store.get('a').epoch;
  await store.resetSpace('a'); late.resolve({ instructions: '旧结果' }); await read;
  assert.equal(signal.aborted, true); assert.equal(store.isCurrent('a', epoch), false); assert.equal(store.get('a').instructions.saved, '');
});
test('明确4xx不伪装成功也不清草稿，网络结果不明禁止重发直至观察到新session', async () => {
  for (const status of [409, 0, 408, 500]) {
    let calls = 0; const store = new SpaceStore({ resetSpace: async () => { calls++; throw new ApiError(status, 'failed'); } });
    store.bindSession('a', 'old-session'); store.setDraft('a', '旧草稿'); store.setInstructions('a', '规则草稿'); const epoch = store.get('a').epoch;
    await assert.rejects(store.resetSpace('a'), (e) => e.status === status);
    assert.equal(calls, 1); assert.equal(store.get('a').draft, '旧草稿'); assert.equal(store.get('a').instructions.draft, '规则草稿');
    assert.equal(store.get('a').resetting, false); assert.equal(store.isCurrent('a', epoch), false);
    if (status !== 409) {
      assert.equal(store.canWrite('a'), false); assert.equal(await store.resetSpace('a'), undefined);
      store.bindSession('a', 'old-session'); assert.equal(store.canWrite('a'), false);
      store.bindSession('a', 'observed-new-session'); assert.equal(store.canWrite('a'), true); assert.equal(store.get('a').draft, '');
    } else assert.equal(store.canWrite('a'), true);
  }
});
test('外部设备重置更换sessionId使聊天失效，但初次绑定/相同session刷新不重建上下文', () => {
  const store = new SpaceStore({}); store.setDraft('a', '草稿'); store.setInstructions('a', '空间设置');
  store.bindSession('a', 'first'); const epoch = store.get('a').epoch;
  assert.equal(store.get('a').draft, '草稿'); store.bindSession('a', 'first'); assert.equal(store.get('a').epoch, epoch);
  store.bindSession('a', 'second'); assert.equal(store.isCurrent('a', epoch), false); assert.equal(store.get('a').draft, ''); assert.equal(store.get('a').instructions.draft, '空间设置');
});
