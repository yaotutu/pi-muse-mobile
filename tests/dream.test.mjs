import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDreamOverview } from '../src/dream/contracts.ts';
import { DreamStore } from '../src/dream/dream-store.ts';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
const overview = (patch = {}) => ({ enabled: true, cursors: { main: 'message-1' }, pending: [], globalPrompt: 'saved', defaultPrompt: 'default', intervalHours: 24, running: false, ...patch });
const pending = { id: 'pending-1', text: '完整建议', suggestedTarget: 'instructions', reason: 'ambiguous', createdAt: '2026-11-09T00:00:00Z', sourceSessionId: 'main' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('Dream 严格解析全局状态、逐会话游标和待决项来源，不接受配置列表', () => {
 assert.deepEqual(parseDreamOverview(overview({ pending: [pending] })), overview({ pending: [pending] }));
 for (const patch of [{ enabled: 'yes' }, { cursors: { unknown: 'x' } }, { pending: [{ ...pending, sourceSessionId: 'invalid' }] }, { pending: [{ ...pending, reason: 'other' }] }, { intervalHours: -1 }, { sessions: [] }]) assert.throws(() => parseDreamOverview(overview(patch)), ApiError);
});
test('Dream HTTP 全局端点和提交形状固定，run 无 body，不带当前会话', async () => {
 const original = globalThis.fetch; const calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json(overview()); };
 try {
  const api = new HttpApiClient('https://example.com', () => 'token', () => {});
  await api.getDreamOverview(); await api.saveDreamSettings({ enabled: false, prompt: '' }); await api.runDream(); await api.resolveDreamPending('a/b', { action: 'dismiss' });
  assert.deepEqual(calls.map(({url})=>new URL(url).pathname), ['/api/dream', '/api/dream', '/api/dream/run', '/api/dream/pending/a%2Fb']);
  assert.deepEqual(JSON.parse(calls[1].init.body), { enabled: false, prompt: '' }); assert.equal(calls[2].init.body, undefined);
  assert.deepEqual(JSON.parse(calls[3].init.body), { action: 'dismiss' });
 } finally { globalThis.fetch = original; }
});
test('Dream 读取失败保留已读数据与未保存草稿', async () => {
 let fail = false; const store = new DreamStore({ getDreamOverview: async () => { if(fail) throw new Error('offline'); return overview(); } }); store.setActive(true); store.open(); await tick();
 store.setDraft({ prompt: 'draft' }); fail = true; await store.refresh(); assert.equal(store.getSnapshot().overview.globalPrompt, 'saved'); assert.equal(store.getSnapshot().prompt, 'draft'); assert.equal(store.canWrite(), false); store.dispose();
});
test('Dream 写入未明不自动重发，回读后需用户明确解锁', async () => {
 let writes = 0; const store = new DreamStore({ getDreamOverview: async () => overview(), saveDreamSettings: async () => { writes++; throw new ApiError(500, 'failed'); } }); store.setActive(true); store.open(); await tick();
 store.setDraft({ prompt: 'draft' }); assert.equal(await store.save(), false); assert.equal(writes, 1); assert.equal(store.getSnapshot().uncertain, true); await store.refresh(); assert.equal(store.canWrite(), false); assert.equal(await store.save(), false); store.acknowledgeReviewed(); assert.equal(store.canWrite(), true); assert.equal(store.getSnapshot().prompt, 'draft'); store.dispose();
});
test('Dream 待决项仅处理当前权威条目，run 不使用未保存草稿', async () => {
 let writes = 0; const store = new DreamStore({ getDreamOverview: async () => overview({pending:[pending]}), resolveDreamPending: async(id, decision) => { writes++; assert.equal(id,pending.id); assert.deepEqual(decision,{action:'apply',target:'memory'}); return overview(); } }); store.setActive(true); store.open(); await tick();
 store.setDraft({prompt:'draft'}); assert.equal(store.canRun(),false); assert.equal(await store.resolvePending('unknown','apply','memory'),false); assert.equal(await store.resolvePending(pending.id,'apply','memory'),true); assert.equal(writes,1); assert.equal(store.getSnapshot().prompt,'draft'); store.dispose();
});
test('Dream 后台中断与 dispose 不接受迟到结果', async () => {
 let finish; const store = new DreamStore({getDreamOverview:()=>new Promise(resolve=>finish=resolve)}); store.setActive(true); store.open(); store.dispose(); finish(overview()); await tick(); assert.equal(store.getSnapshot().overview,undefined);
});
