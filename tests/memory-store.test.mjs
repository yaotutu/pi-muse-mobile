import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/memories/memory-store.ts';
import { ApiError } from '../src/api/errors.ts';

const item = (overrides = {}) => ({ id: 'a', text: 'original', source: 'Apps UI', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z', ...overrides });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup() {
  let data = [item()]; const calls = []; const client = {
    async listMemories(query, signal) { calls.push(['list', query, signal]); return { memories: data }; },
    async addMemory(text, source, signal) { calls.push(['add', text, source, signal]); data = [...data, item({ id: 'new', text })]; return data.at(-1); },
    async editMemory(id, text, signal) { calls.push(['edit', id, text, signal]); data = data.map((v) => v.id === id ? { ...v, text } : v); return data.find((v) => v.id === id); },
    async forgetMemory(id, signal) { calls.push(['delete', id, signal]); data = data.filter((v) => v.id !== id); },
  };
  const store = new MemoryStore(client); return { client, calls, store };
}
async function open(f) { f.store.setActive(true); f.store.open(); await tick(); }

test('记忆仅可见且前台时读取，关闭保留草稿，回前台真实回读而非轮询', async () => {
  const f = setup(); f.store.setActive(true); assert.equal(f.calls.length, 0); f.store.open(); await tick();
  f.store.newMemory(); f.store.setText('draft'); f.store.close(); assert.equal(f.store.getSnapshot().editor.text, 'draft');
  f.store.open(); await tick(); f.store.setActive(false); assert.equal(f.store.canWrite(), false); f.store.setActive(true); await tick();
  assert.equal(f.calls.filter((c) => c[0] === 'list').length, 3); assert.equal(f.store.getSnapshot().editor.text, 'draft'); f.store.dispose();
});
test('记忆搜索隔离迟到读取，不把旧关键词结果倒灌为新结果', async () => {
  const f = setup(); const reads = []; f.client.listMemories = (query, signal) => { const d = deferred(); reads.push({ ...d, query, signal }); return d.promise; };
  f.store.setActive(true); f.store.open(); f.store.search('second'); reads[0].resolve({ memories: [item()] }); reads[1].resolve({ memories: [item({ id: 'b', text: 'second' })] }); await tick();
  assert.equal(reads[0].signal.aborted, true); assert.deepEqual(reads[1].query, { q: 'second', limit: 10 }); assert.equal(f.store.getSnapshot().memories[0].id, 'b');
  f.store.search('x'.repeat(201)); assert.equal(reads.length, 2); f.store.dispose();
});
test('记忆读取失败保留同范围最后内容并锁修改，不把网络失败伪装空列表', async () => {
  const f = setup(); await open(f); f.client.listMemories = async () => { throw new ApiError(500, 'read failed'); }; await f.store.refresh();
  assert.equal(f.store.getSnapshot().memories.length, 1); assert.equal(f.store.getSnapshot().stale, true); assert.equal(f.store.canWrite(), false); f.store.dispose();
});
test('记忆新增与编辑提交原文，串行写且成功后独立回读，空白和超长不发请求', async () => {
  const f = setup(); await open(f); f.store.newMemory(); f.store.setText('   '); assert.equal(await f.store.save(), false);
  f.store.setText('x'.repeat(2001)); assert.equal(await f.store.save(), false); assert.equal(f.calls.length, 1);
  f.store.setText(' exact '); assert.equal(await f.store.save(), true); await tick(); assert.equal(f.calls.find((c) => c[0] === 'add')[1], ' exact ');
  assert.equal(f.calls.find((c) => c[0] === 'add')[2], 'Mobile UI');
  f.store.edit('a'); f.store.setText('edited'); const pending = f.store.save(); assert.equal(await f.store.save(), false); await pending; await tick();
  assert.equal(f.calls.filter((c) => c[0] === 'edit').length, 1); assert.equal(f.store.getSnapshot().editor, undefined); assert.equal(f.store.getSnapshot().memories[0].text, 'edited'); f.store.dispose();
});
test('删除必须明确确认，取消不发请求，刷新或后台使旧确认失效', async () => {
  const f = setup(); await open(f); f.store.requestDelete('a'); f.store.cancelDelete(); assert.equal(await f.store.confirmDelete(), false);
  f.store.requestDelete('a'); await f.store.refresh(); assert.equal(await f.store.confirmDelete(), false);
  f.store.requestDelete('a'); assert.equal(await f.store.confirmDelete(), true); await tick(); assert.equal(f.store.getSnapshot().memories.length, 0); assert.equal(f.calls.filter((c) => c[0] === 'delete').length, 1); f.store.dispose();
});
test('提交超时保留草稿并阻止重放；搜索回读不能解除锁，完整回读后仍需人工核对', async () => {
  const f = setup(); await open(f); f.client.addMemory = async () => { f.calls.push(['add']); throw new ApiError(408, 'timeout'); };
  f.store.newMemory(); f.store.setText('uncertain draft'); assert.equal(await f.store.save(), false); assert.equal(f.store.getSnapshot().uncertain, true);
  await f.store.save(); assert.equal(f.calls.filter((c) => c[0] === 'add').length, 1); f.store.search('draft'); await tick(); f.store.acknowledgeReviewed(); assert.equal(f.store.getSnapshot().uncertain, true);
  f.store.search(''); await tick(); assert.equal(f.store.getSnapshot().reviewed, true); f.store.acknowledgeReviewed(); assert.equal(f.store.getSnapshot().uncertain, false); assert.equal(f.store.getSnapshot().editor.text, 'uncertain draft'); f.store.dispose();
});
test('明确 409 拒绝不当作成功或结果未明，仍保留草稿并要求刷新', async () => {
  const f = setup(); await open(f); f.client.addMemory = async () => { throw new ApiError(409, 'capacity'); }; f.store.newMemory(); f.store.setText('keep');
  assert.equal(await f.store.save(), false); assert.equal(f.store.getSnapshot().uncertain, false); assert.equal(f.store.getSnapshot().editor.text, 'keep'); assert.equal(f.store.getSnapshot().error, 'capacity'); f.store.dispose();
});
test('后台中断在途写入，迟到成功不得清草稿或伪造已保存；切连接不串数据', async () => {
  const f = setup(); await open(f); const write = deferred(); let signal; f.client.addMemory = (_text, _source, value) => { signal = value; return write.promise; };
  f.store.newMemory(); f.store.setText('keep'); const pending = f.store.save(); f.store.setActive(false); assert.equal(signal.aborted, true); write.resolve(item()); await pending;
  assert.equal(f.store.getSnapshot().uncertain, true); assert.equal(f.store.getSnapshot().editor.text, 'keep'); assert.equal(f.store.getSnapshot().notice, undefined);
  const other = setup(); assert.equal(other.store.getSnapshot().loaded, false); f.store.dispose(); other.store.dispose();
});
test('离开页面不重放已授权提交，销毁后的旧读取与写入不能复活数据', async () => {
  const f = setup(); await open(f); const write = deferred(); f.client.addMemory = () => write.promise;
  f.store.newMemory(); f.store.setText('once'); const pending = f.store.save(); f.store.close(); write.resolve(item()); await pending;
  assert.equal(f.store.getSnapshot().notice, '记忆已新增'); f.store.dispose(); assert.equal(f.store.getSnapshot().loaded, false); f.store.setActive(true); assert.equal(f.store.canWrite(), false);
});
