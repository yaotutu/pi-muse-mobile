import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { HttpApiClient } from '../src/api/http-client.ts';
import { parseMemoryItem, parseMemoryPage, parseMemoryRemoval } from '../src/memories/contracts.ts';

const item = (overrides = {}) => ({ id: 'memory-a', text: '纯文本 <script> 不执行', source: 'Apps UI', createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:01:00.000Z', ...overrides });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
async function transport(fetcher, action) { const original = globalThis.fetch; globalThis.fetch = fetcher; try { await action(new HttpApiClient('https://real.example', () => 'token', () => {})); } finally { globalThis.fetch = original; } }

test('记忆只白名单公开文本字段，完整保留正文与来源，不执行或透传载荷', () => {
  assert.deepEqual(parseMemoryItem({ ...item(), secret: 'never cache' }), item());
  assert.equal(parseMemoryItem(item({ source: '' })).source, '');
  assert.equal(parseMemoryItem(item({ createdAt: '2026-10-20T08:00:00+08:00' })).createdAt, '2026-10-20T08:00:00+08:00');
  assert.deepEqual(parseMemoryPage({ memories: [item()], other: true }), { memories: [item()] });
});
test('记忆缺字段、错类型、非法时间、重复 ID 与越域编辑不能伪装成功', () => {
  for (const value of [null, {}, item({ id: '' }), item({ text: 1 }), item({ source: null }), item({ createdAt: 'yesterday' }), item({ updatedAt: '2026-02-30T00:00:00Z' })]) assert.throws(() => parseMemoryItem(value), (e) => e.status === 502);
  assert.throws(() => parseMemoryItem(item(), 'other'), (e) => e.status === 502);
  for (const value of [{}, { memories: null }, { memories: [item(), item()] }]) assert.throws(() => parseMemoryPage(value), (e) => e.status === 502);
  for (const value of [null, {}, { ok: false }, { ok: 'true' }, { ok: true, id: 'bad' }]) assert.throws(() => parseMemoryRemoval(value, 'expected'), (e) => e.status === 502);
  assert.equal(parseMemoryRemoval({ ok: true }), undefined);
  assert.equal(parseMemoryRemoval({ ok: true, id: 'mem-1' }, 'mem-1'), undefined);
});
test('记忆独立查询只编码声明参数，完整列表不强加搜索上限，沿用真实鉴权', async () => {
  const calls = [];
  await transport(async (url, init) => { calls.push({ url, init }); return json({ memories: [item()] }); }, async (api) => {
    await api.listMemories(); await api.listMemories({ q: '中文 +&', limit: 3, sort: 'updatedAt', order: 'desc', ignored: 'never' });
  });
  assert.equal(calls[0].url, 'https://real.example/api/memories');
  const query = new URL(calls[1].url).searchParams;
  assert.deepEqual([...query], [['q', '中文 +&'], ['limit', '3'], ['sort', 'updatedAt'], ['order', 'desc']]);
  assert.equal(calls[0].init.headers.authorization, 'Bearer token'); assert.equal(calls[0].init.redirect, 'error');
});
test('记忆单条详情查询编码 ID 并校验响应归属', async () => {
  const calls = [];
  await transport(async (url, init) => { calls.push({ url, init }); return json(item({ id: 'id/中文' })); }, async (api) => {
    const res = await api.getMemory('id/中文');
    assert.equal(res.id, 'id/中文');
  });
  assert.equal(calls[0].url, 'https://real.example/api/memories/id%2F%E4%B8%AD%E6%96%87');
  assert.equal(calls[0].init.method, 'GET');
});
test('记忆写入按 ID 编码且不改正文，响应归属与删除回执必须校验', async () => {
  const calls = [];
  await transport(async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return json(init.method === 'DELETE' ? { ok: true, id: 'id/中文' } : item({ id: 'id/中文', text: '  exact  ' }));
  }, async (api) => {
    await api.addMemory('  exact  ', 'test'); await api.editMemory('id/中文', '  exact  '); await api.forgetMemory('id/中文'); await api.addMemory('  exact  ', '');
  });
  assert.equal(calls[0].url, 'https://real.example/api/memories');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { text: '  exact  ', source: 'test' });
  assert.equal(calls[1].url, 'https://real.example/api/memories/id%2F%E4%B8%AD%E6%96%87');
  assert.equal(calls[1].method, 'PATCH');
  assert.deepEqual(calls[1].body, { text: '  exact  ' });
  assert.equal(calls[2].url, 'https://real.example/api/memories/id%2F%E4%B8%AD%E6%96%87');
  assert.equal(calls[2].method, 'DELETE');
  assert.equal(calls[2].body, undefined);
  assert.equal(calls[3].url, 'https://real.example/api/memories');
  assert.equal(calls[3].method, 'POST');
  assert.deepEqual(calls[3].body, { text: '  exact  ', source: '' });
  await transport(async () => json(item({ id: 'other' })), async (api) => { await assert.rejects(api.editMemory('expected', 'text'), (e) => e.status === 502); });
  await transport(async () => json({ ok: false }), async (api) => { await assert.rejects(api.forgetMemory('a'), (e) => e.status === 502); });
});
test('记忆 400/401/404/409/500 保留 HTTP 错误且不自动重试', async () => {
  for (const status of [400, 401, 404, 409, 500]) {
    let calls = 0;
    await transport(async () => { calls++; return json({ error: 'real failure' }, status); }, async (api) => { await assert.rejects(api.editMemory('a', 'b'), (e) => e.status === status); });
    assert.equal(calls, 1);
  }
});
test('取消记忆读取和写入只中断本地消费，迟到响应不触发 Stop 或写回', async () => {
  for (const operation of [(api, signal) => api.listMemories({}, signal), (api, signal) => api.addMemory('text', 'Mobile UI', signal), (api, signal) => api.editMemory('a', 'text', signal), (api, signal) => api.forgetMemory('a', signal)]) {
    let finish; const requests = [];
    await transport((url) => { requests.push(url); return new Promise((resolve) => { finish = resolve; }); }, async (api) => {
      const controller = new AbortController(); const pending = operation(api, controller.signal); controller.abort(); finish(json({ memories: [] }));
      await assert.rejects(pending, (e) => e.name === 'AbortError');
    });
    assert.equal(requests.length, 1); assert.ok(requests[0].startsWith('https://real.example/api/memories'));
  }
});
test('应用页真实挂载记忆入口，不用工作区快照、模拟数据或新通知流', () => {
  const panel = readFileSync(new URL('../src/workspace/MemoryPanel.tsx', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../src/workspace/WorkspaceScreen.tsx', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../src/memories/memory-store.ts', import.meta.url), 'utf8');
  assert.match(screen, /打开长期记忆/); assert.match(screen, /<MemoryPanel/);
  assert.match(screen, /memoryOpen && memoryAvailable/); assert.match(screen, /disabled=\{!memoryAvailable\}/);
  assert.match(panel, /所有空间共用/); assert.match(panel, /确认删除记忆/); assert.match(panel, /提交结果未明/);
  assert.doesNotMatch(store, /client\.(getSnapshot|subscribeRuntime)|setInterval\(/);
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|Linking\.openURL|sample|demoWorkspace/);
});
