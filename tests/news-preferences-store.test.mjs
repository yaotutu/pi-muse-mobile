import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NewsPreferencesStore } from '../src/features/news-preferences-store.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(overrides = {}) {
  const remote = { notes: 'saved', learnedNotes: 'learned' };
  let reads = 0, writes = 0;
  const client = {
    getNewsPreferences: async () => { reads++; return { ...remote }; },
    saveNewsPreferences: async ({ notes }) => { writes++; remote.notes = notes; return { ...remote }; },
    ...overrides,
  };
  return { store: new NewsPreferencesStore(client), client, remote, reads: () => reads, writes: () => writes };
}

test('新闻偏好切页、前后台和回读保留脏草稿，未改草稿才同步服务端明确备注', async () => {
  const f = fixture();
  try {
    f.store.open(); assert.equal(f.reads(), 0);
    f.store.setActive(true); await tick(); assert.equal(f.store.getSnapshot().draftNotes, 'saved');
    f.store.setDraftNotes('unsaved'); f.store.close(); f.remote.notes = 'remote';
    f.store.open(); await tick(); assert.equal(f.store.getSnapshot().draftNotes, 'unsaved');
    assert.equal(f.store.getSnapshot().preferences.notes, 'remote');
    f.store.setActive(false); const before = f.reads(); await tick(); assert.equal(f.reads(), before);
    f.store.setActive(true); await tick(); assert.equal(f.store.getSnapshot().draftNotes, 'unsaved');
    await f.store.reload(); assert.equal(f.store.getSnapshot().draftNotes, 'unsaved');
    f.store.setDraftNotes('remote'); f.remote.notes = 'new'; await f.store.reload();
    assert.equal(f.store.getSnapshot().draftNotes, 'new'); assert.equal(f.writes(), 0);
  } finally { f.store.dispose(); }
});

test('读取失败不清空草稿、已加载备注或学习摘要，恢复读取后继续保留草稿', async () => {
  const f = fixture();
  try {
    await f.store.reload(); f.store.setDraftNotes('draft');
    f.client.getNewsPreferences = async () => { throw Error('offline'); };
    await f.store.reload(); const state = f.store.getSnapshot();
    assert.equal(state.draftNotes, 'draft'); assert.equal(state.preferences.notes, 'saved');
    assert.equal(state.preferences.learnedNotes, 'learned'); assert.match(state.error, /保留草稿/);
    f.client.getNewsPreferences = async () => ({ notes: 'remote', learnedNotes: 'new learning' });
    await f.store.reload(); assert.equal(f.store.getSnapshot().draftNotes, 'draft');
    assert.equal(f.store.getSnapshot().error, undefined);
  } finally { f.store.dispose(); }
});

test('保存前废弃旧读取，迟到结果不能回滚确认状态，保存只提交明确 notes', async () => {
  const f = fixture(); const old = deferred(); let payload;
  try {
    await f.store.reload(); f.client.getNewsPreferences = () => old.promise;
    const read = f.store.reload(); f.store.setDraftNotes('submitted');
    f.client.saveNewsPreferences = async input => { payload = input; return { notes: input.notes, learnedNotes: 'unchanged' }; };
    await f.store.save(); old.resolve({ notes: 'old', learnedNotes: 'old' }); await read;
    assert.deepEqual(payload, { notes: 'submitted' }); assert.equal(f.store.getSnapshot().draftNotes, 'submitted');
    assert.equal(f.store.getSnapshot().preferences.learnedNotes, 'unchanged');
  } finally { f.store.dispose(); }
});

test('保存中离页不丢回执和后续草稿，空字符串可以明确保存清空', async () => {
  const saving = deferred(); const f = fixture({ saveNewsPreferences: () => saving.promise });
  try {
    await f.store.reload(); f.store.setDraftNotes('sent'); const write = f.store.save();
    f.store.close(); f.store.setDraftNotes('new draft');
    saving.resolve({ notes: 'sent', learnedNotes: 'learned' }); await write;
    assert.equal(f.store.getSnapshot().preferences.notes, 'sent');
    assert.equal(f.store.getSnapshot().draftNotes, 'new draft'); assert.match(f.store.getSnapshot().notice, /尚未保存/);
    f.store.setDraftNotes(''); f.client.saveNewsPreferences = async input => ({ ...input, learnedNotes: 'learned' });
    await f.store.save(); assert.equal(f.store.getSnapshot().preferences.notes, '');
    assert.equal(f.store.getSnapshot().draftNotes, ''); assert.equal(f.store.getSnapshot().saving, false);
  } finally { f.store.dispose(); }
});

test('写入结果未明跨页仍锁定，前台与重开不自动解锁或重发，显式核对保留草稿', async () => {
  let calls = 0; const f = fixture({ saveNewsPreferences: async () => { calls++; throw Error('lost response'); } });
  try {
    await f.store.reload(); f.store.setActive(true); f.store.setDraftNotes('draft'); await f.store.save();
    assert.equal(f.store.getSnapshot().needsReadback, true); const before = f.reads();
    f.store.close(); f.store.open(); f.store.setActive(false); f.store.setActive(true); await tick();
    await f.store.save(); assert.equal(calls, 1); assert.equal(f.reads(), before);
    assert.equal(f.store.getSnapshot().needsReadback, true);
    await f.store.reload(); assert.equal(f.store.getSnapshot().needsReadback, false);
    assert.equal(f.store.getSnapshot().draftNotes, 'draft'); assert.equal(calls, 1);
  } finally { f.store.dispose(); }
});

test('离页丢弃迟到 GET，连接销毁取消保存且新连接没有旧草稿或错误', async () => {
  const old = deferred(), saving = deferred(); let readSignal, writeSignal;
  const f = fixture();
  await f.store.reload(); f.store.setDraftNotes('private draft');
  f.client.getNewsPreferences = signal => { readSignal = signal; return old.promise; };
  const read = f.store.reload(); f.store.close(); assert.equal(readSignal.aborted, true);
  old.resolve({ notes: 'late', learnedNotes: '' }); await read;
  assert.equal(f.store.getSnapshot().preferences.notes, 'saved');
  f.client.saveNewsPreferences = (_, signal) => { writeSignal = signal; return saving.promise; };
  const write = f.store.save(); const snapshot = f.store.getSnapshot(); f.store.dispose();
  assert.equal(writeSignal.aborted, true); saving.resolve({ notes: 'late', learnedNotes: '' }); await write;
  assert.equal(f.store.getSnapshot(), snapshot);
  const next = fixture(); assert.equal(next.store.getSnapshot().draftNotes, '');
  assert.equal(next.store.getSnapshot().error, undefined); next.store.dispose();
});

test('唯一偏好所有者位于连接内，页面只订阅草稿，不保存到设备或重复持有 notes', () => {
  const source = p => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
  const root = source('workspace/WorkspaceScreen.tsx'), card = source('features/NewsPreferencesCard.tsx');
  assert.match(root, /useState\(\(\) => new NewsPreferencesStore\(api\)\)/);
  assert.match(root, /newsPreferences\.dispose\(\)/); assert.match(root, /newsPreferences\.setActive/);
  assert.match(card, /store\.open\(\); return \(\) => store\.close\(\)/);
  assert.match(card, /value=\{draftNotes\}/); assert.doesNotMatch(card, /useState|useApi|saveNewsPreferences/);
  assert.doesNotMatch(source('features/news-preferences-store.ts'), /AsyncStorage|SecureStore|setInterval/);
});
