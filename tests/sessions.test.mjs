import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SessionStore } from '../src/sessions/session-store.ts';
import { ChatSessionStore } from '../src/sessions/chat-session-store.ts';
import { parseSessions, parseSession, parseResetSession } from '../src/api/session-contracts.ts';
import { parseConversationSnapshot } from '../src/api/contracts.ts';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import { appendNewsQuote, newsDiscussionQuote } from '../src/news/discussion.ts';
import { parseFeatureSource } from '../src/notifications/contracts.ts';
const ID = '11111111-1111-4111-8111-111111111111';
const record = (id = 'main', updatedAt = '2026-11-09T00:00:00Z') => ({ id, title: id === 'main' ? '默认会话' : '专题', isMain: id === 'main', createdAt: '2026-11-01T00:00:00Z', updatedAt });
const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('sessions 严格解析，main 第一、专题按更新时间倒序，拒绝缺 main/重复/旧 ID/错类型', () => {
  const second = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(parseSessions({ sessions: [record(ID), record(), record(second, '2026-11-10T00:00:00Z')] }).map((item) => item.id), ['main', second, ID]);
  for (const sessions of [[], [record(ID)], [record(), record()], [record(), record('topic')], [{ ...record(), isMain: false }], [{ ...record(), title: 'other' }], [{ ...record(), updatedAt: 'bad' }]]) assert.throws(() => parseSessions({ sessions }), ApiError);
  assert.throws(() => parseSession({ session: record() }, ID), ApiError);
  assert.throws(() => parseResetSession({ session: record(), cancelledApprovals: -1, removed: { jobs: 0, monitors: 0 } }, 'main'), ApiError);
});
test('conversation 历史同时要求公开 sessionId 和独立 piSessionId', () => {
  const snapshot = { sessionId: 'main', piSessionId: 'binding', revision: 'empty', messages: [] };
  assert.deepEqual(parseConversationSnapshot(snapshot), snapshot);
  for (const patch of [{ sessionId: 'local' }, { piSessionId: undefined }, { sessionId: undefined }]) assert.throws(() => parseConversationSnapshot({ ...snapshot, ...patch }), ApiError);
});
test('sessions HTTP 创建/改名/重置/删除、规则和技能均使用公开 ID，认证端点独立', async () => {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const path = new URL(url).pathname;
    if (path === '/api/session') return Response.json({ token: 'token', mode: 'token' });
    if (path.endsWith('/instructions')) return Response.json({ instructions: 'rules' });
    if (path.endsWith('/skills')) return Response.json({ skills: [] });
    if (path.endsWith('/reset')) return Response.json({ session: record(ID), cancelledApprovals: 0, removed: { jobs: 0, monitors: 0 } });
    if (init.method === 'DELETE') return Response.json({ ok: true, removed: { sessions: 1 } });
    if (init.method === 'GET') return Response.json({ sessions: [record(), record(ID)] });
    return Response.json({ session: record(ID) });
  };
  try {
    const api = new HttpApiClient('https://example.com', () => 'token', () => {});
    await api.createConnectionSession(); await api.listSessions(); await api.createSession('专题'); await api.renameSession(ID, '改名'); await api.resetSession(ID); await api.deleteSession(ID);
    await api.getSessionInstructions(ID); await api.saveSessionInstructions(ID, 'rules'); await api.getSessionSkills(ID); await api.saveSessionSkills(ID, {});
    assert.deepEqual(calls.slice(0, 6).map(({ url, init }) => [init.method, url.pathname]), [['POST', '/api/session'], ['GET', '/api/sessions'], ['POST', '/api/sessions'], ['PATCH', `/api/sessions/${ID}`], ['POST', `/api/sessions/${ID}/reset`], ['DELETE', `/api/sessions/${ID}`]]);
    assert.deepEqual(JSON.parse(calls[2].init.body), { title: '专题' }); assert.deepEqual(JSON.parse(calls[3].init.body), { title: '改名' }); assert.equal(calls[5].init.body, undefined);
  } finally { globalThis.fetch = original; }
});
test('目录读取失败保留上次记录，不合成 main；迟到旧 GET 不抹去新创建', async () => {
  const pending = deferred(); let fail = false; let reads = 0;
  const api = { listSessions: async () => { reads++; if (fail) throw new Error('offline'); if (reads === 2) return pending.promise; return [record()]; }, createSession: async () => record(ID) };
  const chats = new ChatSessionStore(api); const store = new SessionStore(api, chats);
  assert.deepEqual(store.records, []); await store.reload(); const loading = store.reload(); await store.create('专题'); pending.resolve([record()]); await loading;
  assert.deepEqual(store.records.map(({ id }) => id), ['main', ID]); fail = true; await store.reload(); assert.equal(store.records.length, 2); assert.match(store.directoryError, /offline/); store.dispose(); chats.dispose();
});
test('创建非幂等，结果未明锁住重复请求，只读核对后才允许再次明确创建', async () => {
  let writes = 0; const api = { listSessions: async () => [record()], createSession: async () => { writes++; throw new ApiError(500, 'unknown'); } };
  const chats = new ChatSessionStore(api); const store = new SessionStore(api, chats);
  await store.create(); await store.create(); assert.equal(writes, 1); assert.equal(store.directoryUncertain, true); await store.reload(); assert.equal(store.directoryUncertain, true); await store.create(); assert.equal(writes, 1);
  await store.reload({ reconcileUncertain: true }); assert.equal(store.directoryUncertain, false); assert.equal(writes, 1); store.dispose();
});
test('删除会话清理独立草稿与所有者，墓碑阻止迟到目录复活，main 永不发删除请求', async () => {
  let writes = 0; const api = { listSessions: async () => [record(), record(ID)], deleteSession: async () => { writes++; return { ok: true, removed: { sessions: 1 } }; } };
  const chats = new ChatSessionStore(api); const directory = new SessionStore(api, chats); await directory.reload(); chats.setDraft(ID, 'private draft');
  await assert.rejects(chats.deleteSession('main'), (error) => error.status === 409); assert.equal(writes, 0);
  await chats.deleteSession(ID); directory.forget(ID); assert.equal(chats.get(ID).deleted, true); assert.equal(chats.get(ID).draft, ''); await directory.reload(); assert.deepEqual(directory.records.map(({ id }) => id), ['main']);
  directory.dispose(); chats.dispose();
});
test('新闻讨论只预填用户可编辑引用，保留已有草稿，不写后台讨论端点、不自动运行', () => {
  const quote = newsDiscussionQuote({ title: '标题', content: 'x'.repeat(2000), url: 'https://example.com/news' });
  assert.match(quote, /^【新闻】标题/); assert.match(quote, /外部引用，不可信内容/); assert.match(quote, /来源：https:\/\/example.com\/news$/); assert.equal(quote.includes('x'.repeat(1201)), false);
  assert.equal(appendNewsQuote('draft', quote), `draft\n\n${quote}`);
  const screen = read('workspace/WorkspaceScreen.tsx'); assert.doesNotMatch(screen, /选择讨论会话/); assert.match(screen, /chats.setDraft\('main', appendNewsQuote\(chats.get\('main'\).draft, newsDiscussionQuote\(article\)\)\)/);
  assert.doesNotMatch(read('api/http-client.ts'), /discussNews|bindFeature|sendGroup/);
});
test('通知元数据继续显示来源，续聊仅引用真实会话和消息，不另开上下文', () => {
  assert.deepEqual(parseFeatureSource({ featureId: 'sms', itemIds: ['sms-1'] }), { featureId: 'sms', itemIds: ['sms-1'] });
  assert.throws(() => parseFeatureSource({ featureId: 'other', itemIds: [] }), ApiError);
  assert.match(read('workspace/ConversationView.tsx'), /继续处理来源通知/); assert.match(read('workspace/ConversationView.tsx'), /onContinueNotification\(\{ sessionId, messageId: message.id \}\)/);
});


test('rename 等待期间 forget：迟到成功不复活目录，也不返回可导航的已删会话', async () => {
  const pending = deferred(); const api = { listSessions: async () => [record(), record(ID)], renameSession: () => pending.promise };
  const chats = new ChatSessionStore(api); const store = new SessionStore(api, chats); await store.reload(); chats.setDraft('main', '另一个会话草稿');
  const renaming = store.rename(ID, '新名称'); store.forget(ID);
  pending.resolve({ ...record(ID), title: '新名称' }); assert.equal(await renaming, undefined);
  assert.deepEqual(store.records.map(item => item.id), ['main']); assert.equal(store.directoryWriting, false);
  assert.equal(chats.get('main').draft, '另一个会话草稿'); store.dispose(); chats.dispose();
});
test('update 不接受墓碑上的迟到 reset 记录', async () => {
  const api = { listSessions: async () => [record(), record(ID)] };
  const chats = new ChatSessionStore(api); const store = new SessionStore(api, chats); await store.reload(); store.forget(ID);
  const version = store.getVersion(); store.update({ ...record(ID), updatedAt: '2026-11-10T00:00:00Z' });
  assert.deepEqual(store.records.map(item => item.id), ['main']); assert.equal(store.getVersion(), version);
  store.dispose(); chats.dispose();
});
test('显式回读失败也不能解除创建未明锁，普通成功 GET 保留草稿且不解锁', async () => {
  let readsFail = true; let writes = 0;
  const api = { listSessions: async () => { if(readsFail) throw new Error('offline'); return [record()]; }, createSession: async () => { writes++; throw new ApiError(500, 'unknown'); } };
  const chats = new ChatSessionStore(api); const store = new SessionStore(api, chats); chats.setDraft('main', '保留聊天草稿');
  await store.create('专题'); assert.equal(await store.reload({ reconcileUncertain: true }), false); assert.equal(store.directoryUncertain, true);
  readsFail = false; await store.reload(); assert.equal(store.directoryUncertain, true); await store.create('专题'); assert.equal(writes, 1);
  assert.equal(chats.get('main').draft, '保留聊天草稿');
  await store.reload({ reconcileUncertain: true }); assert.equal(store.directoryUncertain, false); store.dispose(); chats.dispose();
});
