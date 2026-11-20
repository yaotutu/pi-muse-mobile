import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatLocalRepository, CHAT_LOCAL_MAX_BYTES, boundChatLocalData } from '../src/chat/chat-local-data.ts';
import { ChatSessionStore } from '../src/sessions/chat-session-store.ts';
import { ApiError } from '../src/api/errors.ts';
import { selectReadingAnchor } from '../src/workspace/conversation-scroll.ts';

const metadata = { createdAt: '2026-11-12T00:00:00Z', source: 'chat', runId: null, jobId: null, notificationId: null, domainId: null, feedbackAvailable: true };
const message = (id, content = 'confirmed') => ({ id, role: 'user', content, metadata, feedback: { reaction: null, comments: [] } });
const position = { messageId: 'u', offset: 27, following: false };
const data = (patch = {}) => ({ piSessionId: 'binding', messages: [message('u')], draft: 'saved draft', readingPosition: position, ...patch });
const memory = (initial = null) => {
  let text = initial;
  return { async read() { return text; }, async write(value) { text = value; }, async clear() { text = null; }, value: () => text };
};
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise((done) => setTimeout(done, 10));
const waitLoaded = async (store) => { for (let i = 0; i < 50 && !store.get('main').localLoaded; i++) await tick(); assert.equal(store.get('main').localLoaded, true); };

test('本地缓存严格按规范化服务器和会话隔离，不含 revision/token/pending，保存/读取命中', async () => {
  const storage = memory(); const repository = new ChatLocalRepository(storage);
  const local = repository.forServer('https://example.test/');
  await local.save('main', data());
  assert.deepEqual(await repository.forServer('https://example.test').load('main'), data());
  assert.equal(await repository.forServer('https://other.test').load('main'), null);
  assert.equal(await local.load('other'), null);
  assert.doesNotMatch(storage.value(), /revision|token|pendingSubmission|draftAttachments/);
});

test('长消息滚到中间的负偏移可经 Store 和本地仓库完整恢复', async () => {
  const storage = memory();
  const local = new ChatLocalRepository(storage).forServer('https://example.test');
  const store = new ChatSessionStore({}, local);
  const entry = store.get('main');
  await waitLoaded(store);
  store.bindSession('main', 'binding');
  store.cacheConfirmedHistory('main', entry.epoch, { sessionId: 'main', piSessionId: 'binding', revision: 'network', messages: [message('u')] });
  const anchor = selectReadingAnchor(['u'], new Map([['u', { y: 120, height: 3000 }]]), 1520);
  assert.deepEqual(anchor, { messageId: 'u', offset: -1400, following: false });
  store.setReadingPosition('main', entry.epoch, anchor);
  store.flushLocal();
  await tick();
  const restored = await local.load('main');
  assert.deepEqual(restored.readingPosition, anchor);
  assert.equal(entry.localError, undefined);
  store.dispose();
});

test('损坏、未知字段和超大文件拒绝 hydrate，不以缓存损坏伪装空权威历史', async () => {
  for (const text of ['{', JSON.stringify({ schema: 2, entries: [] }), JSON.stringify({ schema: 1, entries: [], token: 'bad' }), 'x'.repeat(CHAT_LOCAL_MAX_BYTES + 1)]) {
    const local = new ChatLocalRepository(memory(text)).forServer('https://example.test');
    await assert.rejects(local.load('main'));
    const store = new ChatSessionStore({}, local);
    await waitLoaded(store);
    assert.equal(store.get('main').cachedMessages, null);
    assert.match(store.get('main').localError, /本机/);
    store.dispose();
  }
});

test('最近 200 条、总 4MiB、工具结果截断，图片只落元数据而不落 base64', async () => {
  const storage = memory(); const local = new ChatLocalRepository(storage).forServer('https://example.test');
  const messages = Array.from({ length: 250 }, (_, i) => ({ id: `tool-${i}`, role: 'tool', content: '工具结果'.repeat(50_000) }));
  messages.push({ ...message('image'), attachments: [{ id: 'img', name: 'photo.png', kind: 'image', mimeType: 'image/png', size: 3, sha256: 'a'.repeat(64), image: { mimeType: 'image/png', dataBase64: 'YWJj' } }] });
  await local.save('main', data({ messages }));
  const loaded = await local.load('main');
  assert.ok(loaded.messages.length <= 200 && loaded.messages.length > 0);
  assert.ok(new TextEncoder().encode(storage.value()).length <= CHAT_LOCAL_MAX_BYTES);
  assert.doesNotMatch(storage.value(), /dataBase64|YWJj/);
  assert.equal(loaded.messages.at(-1).attachments[0].name, 'photo.png');
  assert.ok(loaded.messages.filter((item) => item.role === 'tool').every((item) => item.content.length <= 65536));
  assert.throws(() => boundChatLocalData(data({ readingPosition: { ...position, offset: NaN } })));
});

test('串行旧写、clear 与旧 scope 后续写竞态不会复活旧服务器缓存', async () => {
  const gate = deferred(); const began = deferred(); const storage = memory();
  let first = true;
  const repository = new ChatLocalRepository({ ...storage, async write(value) { if (first) { first = false; began.resolve(); await gate.promise; } await storage.write(value); } });
  const old = repository.forServer('https://example.test');
  const write = old.save('main', data()); await began.promise;
  const clear = repository.clear();
  const stale = old.save('main', data({ draft: 'must not return' }));
  gate.resolve(); await Promise.all([write, clear, stale]);
  assert.equal(storage.value(), null);
  assert.equal(await old.load('main'), null);
  const fresh = repository.forServer('https://new.test'); await fresh.save('main', data({ draft: 'fresh' }));
  assert.equal((await fresh.load('main')).draft, 'fresh');
});

test('clear 期间的迟到读取不返回旧缓存；401 期间迟到 hydrate 不丢 A01 或新显示缓存', async () => {
  const base = memory(); const repository = new ChatLocalRepository(base); await repository.forServer('https://example.test').save('main', data());
  const gate = deferred(); const began = deferred();
  const isolated = new ChatLocalRepository({ ...base, async read() { began.resolve(); await gate.promise; return base.read(); } });
  const read = isolated.forServer('https://example.test').load('main'); await began.promise;
  const clear = isolated.clear(); gate.resolve(); assert.equal(await read, null); await clear;
  const hydrate = deferred(); const store = new ChatSessionStore({}, { load: () => hydrate.promise, async save() {}, async remove() {} });
  const entry = store.get('main'); store.setPendingSubmission('main', 0, { messageId: 'p', runId: 'r', text: 'protected pending', epoch: 0, status: 'unconfirmed' });
  store.setLocalRestoreAllowed(false); store.setEnabled(false); hydrate.resolve(data()); await waitLoaded(store);
  assert.equal(entry.cachedMessages, null); assert.equal(entry.draft, ''); assert.equal(entry.pendingSubmission.text, 'protected pending'); store.dispose();
});

test('首次同绑定网络先到时，迟到 hydrate 仍保留草稿和阅读位置但不能覆盖新历史', async () => {
  const gate = deferred(); const store = new ChatSessionStore({}, { load: () => gate.promise, async save() {}, async remove() {} });
  const entry = store.get('main'); store.bindSession('main', 'binding');
  store.cacheConfirmedHistory('main', 0, { sessionId: 'main', piSessionId: 'binding', revision: 'network-only', messages: [message('new')] });
  gate.resolve(data()); await waitLoaded(store);
  assert.equal(entry.cachedMessages[0].id, 'new'); assert.equal(entry.draft, 'saved draft'); assert.deepEqual(entry.readingPosition, position); assert.equal(entry.epoch, 0); store.dispose();
});

test('hydrate 迟到不覆盖新输入；同绑定初次权威绑定保留缓存阅读位置和草稿', async () => {
  const gate = deferred(); const saves = [];
  const store = new ChatSessionStore({}, { load: () => gate.promise, async save(id, value) { saves.push(value); }, async remove() {} });
  const entry = store.get('main'); assert.equal(entry.localLoaded, false);
  store.setDraft('main', 'typed now');
  gate.resolve(data()); await waitLoaded(store);
  assert.equal(entry.draft, 'typed now'); assert.deepEqual(entry.readingPosition, position);
  assert.equal(entry.piSessionId, null, '展示缓存不建立权威绑定');
  store.bindSession('main', 'binding');
  assert.equal(entry.epoch, 0); assert.deepEqual(entry.readingPosition, position); assert.equal(entry.draft, 'typed now');
  store.flushLocal(); await tick();
  assert.equal(saves.at(-1).draft, 'typed now'); store.dispose();
});

test('迟到 hydrate 不覆盖已经成功网络读取的新历史或新绑定草稿', async () => {
  const gate = deferred(); const store = new ChatSessionStore({}, { load: () => gate.promise, async save() {}, async remove() {} });
  const entry = store.get('main');
  store.bindSession('main', 'new-binding');
  store.cacheConfirmedHistory('main', 0, { sessionId: 'main', piSessionId: 'new-binding', revision: 'network-only', messages: [message('new')] });
  store.setDraft('main', 'new context');
  gate.resolve(data()); await waitLoaded(store);
  assert.equal(entry.cachedMessages[0].id, 'new'); assert.equal(entry.draft, 'new context'); assert.equal(entry.readingPosition, null);
  store.dispose();
});

test('空主聊天首次获得 PI 身份不当作重置，不丢首轮发送期间的新草稿或暂存', async () => {
  const local = new ChatLocalRepository(memory()).forServer('https://example.test');
  const store = new ChatSessionStore({}, local);
  const entry = store.get('main');
  await waitLoaded(store);
  store.bindSession('main', null);
  store.setDraft('main', '下一句还没发送');
  store.setPendingSubmission('main', entry.epoch, { messageId: 'first', runId: 'run-first', text: '首轮正文', epoch: entry.epoch, status: 'unconfirmed' });
  store.bindSession('main', 'first-real-pi-binding');
  assert.equal(entry.epoch, 0);
  assert.equal(entry.draft, '下一句还没发送');
  assert.equal(entry.pendingSubmission.messageId, 'first');
  assert.equal(entry.piSessionId, 'first-real-pi-binding');
  store.dispose();
});

test('真正换绑定清草稿/位置/缓存/pending；setReadingPosition 按 epoch 隔离', async () => {
  const storage = memory(); const local = new ChatLocalRepository(storage).forServer('https://example.test'); await local.save('main', data());
  const store = new ChatSessionStore({}, local); const entry = store.get('main'); await waitLoaded(store);
  store.bindSession('main', 'binding'); store.setPendingSubmission('main', 0, { messageId: 'p', runId: 'r', text: 'pending', epoch: 0, status: 'unconfirmed' });
  store.bindSession('main', 'next'); await tick();
  assert.equal(entry.epoch, 1); assert.equal(entry.draft, ''); assert.equal(entry.readingPosition, null); assert.equal(entry.pendingSubmission, null);
  assert.equal(await local.load('main'), null);
  store.setReadingPosition('main', 0, position); assert.equal(entry.readingPosition, null);
  store.setReadingPosition('main', 1, position); assert.deepEqual(entry.readingPosition, position); store.dispose();
});

test('reset 未明保留本地记录与锁，同绑定核对不解除；成功 reset 才删除旧本地缓存', async () => {
  const storage = memory(); const local = new ChatLocalRepository(storage).forServer('https://example.test'); await local.save('main', data());
  let fail = true; let resets = 0;
  const store = new ChatSessionStore({ async resetSession() { resets++; if (fail) throw new ApiError(0, 'offline'); return { ok: true }; }, async getConversation() { return { sessionId: 'main', piSessionId: 'binding', revision: 'r', messages: [] }; } }, local);
  const entry = store.get('main'); await waitLoaded(store); store.bindSession('main', 'binding');
  await assert.rejects(store.resetSession('main')); assert.equal(entry.resetUncertain, true);
  assert.equal((await local.load('main')).draft, 'saved draft'); assert.deepEqual(entry.readingPosition, position);
  await store.verifyReset('main'); assert.equal(entry.resetUncertain, true); assert.equal(resets, 1);
  store.acknowledgeReset('main'); fail = false; await store.resetSession('main'); await tick();
  assert.equal(entry.draft, ''); assert.equal(entry.readingPosition, null); assert.equal(await local.load('main'), null); store.dispose();
});

test('成功历史缓存写失败仅提示，不改变 pending、权威绑定或发送结果', async () => {
  const store = new ChatSessionStore({}, { async load() { return null; }, async save() { throw new Error('disk full'); }, async remove() {} });
  const entry = store.get('main'); await waitLoaded(store); store.bindSession('main', 'binding');
  store.cacheConfirmedHistory('main', 0, { sessionId: 'main', piSessionId: 'binding', revision: 'r', messages: [message('u')] });
  store.flushLocal(); await tick(); assert.match(entry.localError, /服务端消息不受影响/);
  assert.equal(entry.piSessionId, 'binding'); assert.equal(entry.pendingSubmission, null); assert.equal(entry.cachedMessages[0].id, 'u'); store.dispose();
});
