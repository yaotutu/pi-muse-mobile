import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { COMPANION_STATES, MAX_COMPANION_ASSET_BYTES, assertCompanionPng, parseCompanion, parseCompanionPack, parseCompanions } from '../src/api/companion-contracts.ts';
import { HttpApiClient } from '../src/api/http-client.ts';
import { AtomicCompanionCache, createNativeCompanionCacheBackend, getCompanionCache, clearCompanionCache } from '../src/companion/companion-cache.ts';
import { Platform } from 'react-native';
import { CompanionStore } from '../src/companion/companion-store.ts';

const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const pack = (id = 'plumber', version = 'a'.repeat(64)) => ({ id, name: '测试形象', description: '完整八状态', states: [...COMPANION_STATES], version, updatedAt: '2026-11-10T00:00:00.000Z' });
// 契约内版本是 64 位小写十六进制；不同字符区分不同版本。
const versionOf = (char) => char.repeat(64);
const images = (uri) => Object.fromEntries(COMPANION_STATES.map((state) => [state, { uri: `${uri}/${state}.png` }]));
const builtin = { key: 'builtin:penguin', name: '冰蓝企鹅', description: '默认内置助手形象', images: images('builtin') };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function backend() {
  const ready = new Map(); const stages = [];
  const key = (scope, id, version) => JSON.stringify([scope, id, version]);
  return {
    ready, stages,
    async read(scope, id, version) {
      if (version) return ready.get(key(scope, id, version));
      return [...ready.entries()].find(([entry]) => { const parts = JSON.parse(entry); return parts[0] === scope && parts[1] === id; })?.[1];
    },
    async stage(scope, summary) {
      const stage = { states: [], discarded: false, committed: false }; stages.push(stage);
      return {
        async write(state, bytes) { assertCompanionPng(bytes); stage.states.push(state); },
        async commit(active) {
          active(); assert.deepEqual(stage.states, COMPANION_STATES);
          stage.committed = true;
          const cached = { summary, images: images(`${scope}/${summary.id}/${summary.version}`) };
          ready.set(key(scope, summary.id, summary.version), cached); return cached;
        },
        async discard() { stage.discarded = true; },
      };
    },
    async clear() { ready.clear(); },
  };
}
function setup({ selected = 'builtin:penguin', packs = [pack()], cache, scope = 'https://one.example', connected = true, client } = {}) {
  const storage = { value: selected, writes: [], async read() { return this.value; }, async write(value) { this.value = value; this.writes.push(value); } };
  const disk = backend(); const realCache = cache ?? new AtomicCompanionCache(disk);
  const api = client ?? { async listCompanions() { return { companions: packs, diagnostics: [] }; }, async getCompanion(id) { return packs.find((item) => item.id === id); }, async fetchCompanionAsset() { return png(); } };
  const store = new CompanionStore(builtin, storage, realCache); store.connect(scope, api, connected);
  return { store, storage, disk, cache: realCache, api, packs };
}

test('形象契约只接受完整八状态、唯一 ID、严格包裹、64 位十六进制版本和有效 ISO 时间', () => {
  assert.deepEqual(parseCompanion({ companion: pack() }, 'plumber'), pack());
  assert.equal(parseCompanionPack({ ...pack(), version: versionOf('9') }).version, versionOf('9'));
  assert.equal(parseCompanions({ companions: [pack()], diagnostics: [{ id: 'bad-folder', message: '缺少 working' }] }).diagnostics.length, 1);
  const invalid = [null, [], {}, { ...pack(), extra: 1 }, { ...pack(), id: '../outside' }, { ...pack(), id: 'bad/id' },
    { ...pack(), states: COMPANION_STATES.slice(1) }, { ...pack(), states: [...COMPANION_STATES, 'unknown'] },
    { ...pack(), states: COMPANION_STATES.map(() => 'idle') }, { ...pack(), version: ' ' }, { ...pack(), name: '' },
    { ...pack(), version: 'v1' }, { ...pack(), version: versionOf('A') }, { ...pack(), version: 'a'.repeat(63) },
    { ...pack(), version: '测试/'.repeat(30) },
    { ...pack(), updatedAt: '2026-02-30T00:00:00Z' }, { ...pack(), updatedAt: '2026-11-10' }, { ...pack(), updatedAt: 'bad' }];
  for (const value of invalid) assert.throws(() => parseCompanionPack(value), /形象响应格式/);
  for (const value of [ { companion: pack(), extra: 1 }, { companion: pack('other') } ]) assert.throws(() => parseCompanion(value, 'plumber'));
  for (const value of [{ companions: [pack(), pack()], diagnostics: [] }, { companions: [pack()], diagnostics: [], other: true },
    { companions: [], diagnostics: [{ id: 'bad', message: '' }] }, { companions: [], diagnostics: [{ id: 'bad', message: 'bad', extra: 1 }] }]) assert.throws(() => parseCompanions(value));
});

test('PNG 魔数与 786432 字节上限在边界上严格校验', () => {
  assert.doesNotThrow(() => assertCompanionPng(png()));
  const max = new Uint8Array(MAX_COMPANION_ASSET_BYTES); max.set(png()); assert.doesNotThrow(() => assertCompanionPng(max));
  for (const bytes of [new Uint8Array(), new TextEncoder().encode('<html>no</html>'), new Uint8Array(MAX_COMPANION_ASSET_BYTES + 1)]) assert.throws(() => assertCompanionPng(bytes));
});

test('HTTP 列表、详情严格解析，资源 Bearer 只进 header，不进 URL，拒绝非2xx/超大/非PNG', async () => {
  const previous = globalThis.fetch; const calls = []; let response;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return response; };
  const client = new HttpApiClient('https://one.example', () => 'test-session', () => {});
  try {
    response = Response.json({ companions: [pack()], diagnostics: [] }); assert.equal((await client.listCompanions()).companions.length, 1);
    response = Response.json({ companion: pack() }); assert.equal((await client.getCompanion('plumber')).id, 'plumber');
    response = new Response(png()); assert.deepEqual(await client.fetchCompanionAsset('plumber', 'idle'), png());
    assert.equal(calls.at(-1).init.headers.authorization, 'Bearer test-session');
    assert.equal(calls.at(-1).url, 'https://one.example/api/companions/plumber/assets/idle');
    assert.equal(calls.at(-1).init.redirect, 'error');
    for (const result of [new Response(png(), { status: 403 }), new Response('<html>bad</html>'),
      new Response(png(), { headers: { 'content-length': String(MAX_COMPANION_ASSET_BYTES + 1) } }),
      new Response(new Uint8Array(MAX_COMPANION_ASSET_BYTES + 1))]) {
      response = result; await assert.rejects(client.fetchCompanionAsset('plumber', 'idle'));
    }
    const count = calls.length;
    await assert.rejects(client.fetchCompanionAsset('../outside', 'idle')); await assert.rejects(client.getCompanion('../outside'));
    assert.equal(calls.length, count);
  } finally { globalThis.fetch = previous; client.retire(); }
});

test('HTTP 资源401走认证失效，外部取消和退役阻止迟到字节', async () => {
  const previous = globalThis.fetch; let unauthorized;
  const client = new HttpApiClient('https://one.example', () => 'test-session', (token) => { unauthorized = token; });
  try {
    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(client.fetchCompanionAsset('plumber', 'idle')); assert.equal(unauthorized, 'test-session');
    const gate = deferred(); globalThis.fetch = async () => gate.promise;
    const controller = new AbortController(); const task = client.fetchCompanionAsset('plumber', 'idle', controller.signal);
    controller.abort(); gate.resolve(new Response(png())); await assert.rejects(task);
    client.retire(); await assert.rejects(client.fetchCompanionAsset('plumber', 'idle'));
  } finally { globalThis.fetch = previous; }
});

test('完整八状态才原子发布，失败/取消清临时文件，保留旧版缓存', async () => {
  const disk = backend(); const cache = new AtomicCompanionCache(disk); const controller = new AbortController();
  const old = await cache.prepare('one', pack(), async () => png(), controller.signal);
  assert.equal(disk.ready.size, 1); assert.deepEqual(disk.stages[0].states, COMPANION_STATES);
  const gate = deferred(); let count = 0;
  const task = cache.prepare('one', pack('plumber', versionOf('b')), async () => { if (++count === 8) await gate.promise; return png(); }, controller.signal);
  await tick(); assert.equal(disk.ready.size, 1); assert.equal(disk.stages[1].committed, false);
  controller.abort(); gate.resolve(); await assert.rejects(task, { name: 'AbortError' });
  assert.equal(disk.stages[1].discarded, true); assert.equal(disk.ready.size, 1);
  assert.deepEqual(await cache.read('one', 'plumber', new AbortController().signal), old);
  await assert.rejects(cache.prepare('one', pack('plumber', versionOf('c')), async () => new Uint8Array([0]), new AbortController().signal));
  assert.equal(disk.stages[2].discarded, true); assert.equal(disk.ready.size, 1);
});

test('清理缓存增加代次，拒绝未遵守 signal 的晚到下载跨服落盘', async () => {
  const disk = backend(); const cache = new AtomicCompanionCache(disk); const gate = deferred();
  const task = cache.prepare('one', pack(), async () => { await gate.promise; return png(); }, new AbortController().signal);
  await tick(); await cache.clear(); gate.resolve(); await assert.rejects(task, { name: 'AbortError' });
  assert.equal(disk.ready.size, 0); assert.equal(disk.stages[0].discarded, true);
});

test('内置形象无需连接；冷启动读取连接之前不会误删服务器偏好', async () => {
  const { store } = setup({ connected: false }); await store.load(); assert.equal(store.getSnapshot().activePack.key, 'builtin:penguin'); store.dispose();
  const delayed = setup({ selected: 'server:plumber', connected: false });
  delayed.store.connect(undefined, undefined, false, false); await delayed.store.load();
  assert.equal(delayed.store.getSnapshot().selectedKey, 'server:plumber');
  delayed.store.connect(undefined, undefined, false, true); await tick();
  assert.equal(delayed.store.getSnapshot().selectedKey, 'builtin:penguin'); assert.match(delayed.store.getSnapshot().notice, /缓存/); delayed.store.dispose();
});

test('同服断线恢复完整本地缓存，没有缓存安全回退内置并提示', async () => {
  const disk = backend(); const cache = new AtomicCompanionCache(disk);
  await cache.prepare('https://one.example', pack(), async () => png(), new AbortController().signal);
  const cached = setup({ selected: 'server:plumber', connected: false, cache }); await cached.store.load();
  assert.equal(cached.store.getSnapshot().activePack.key, 'server:plumber'); assert.equal(cached.store.getSnapshot().notice, undefined); cached.store.dispose();
  const missing = setup({ selected: 'server:plumber', connected: false }); await missing.store.load();
  assert.equal(missing.store.getSnapshot().activePack.key, 'builtin:penguin'); assert.match(missing.store.getSnapshot().notice, /缓存不可用/); missing.store.dispose();
});

test('已连接选中包被删除/不完整时自动回退，diagnostics 不隐藏', async () => {
  const { store, api } = setup(); await store.load(); await store.select('server:plumber');
  assert.equal(store.getSnapshot().activePack.key, 'server:plumber');
  api.listCompanions = async () => ({ companions: [], diagnostics: [{ id: 'plumber', message: '缺少 working' }] });
  await store.refresh(); assert.equal(store.getSnapshot().selectedKey, 'builtin:penguin');
  assert.equal(store.getSnapshot().activePack.key, 'builtin:penguin'); assert.equal(store.getSnapshot().diagnostics.length, 1); assert.match(store.getSnapshot().notice, /删除或不完整/); store.dispose();
});

test('新版八图下载前保持当前形象，完成后无缝替换；失败保留旧版', async () => {
  const value = setup(); await value.store.load(); await value.store.select('server:plumber');
  const old = value.store.getSnapshot().activePack.images; const gate = deferred();
  value.packs[0] = pack('plumber', versionOf('b')); value.api.fetchCompanionAsset = async () => { await gate.promise; return png(); };
  const refreshing = value.store.refresh(); await tick(); assert.equal(value.store.getSnapshot().activePack.images, old);
  gate.resolve(); await refreshing; assert.notEqual(value.store.getSnapshot().activePack.images, old);
  const current = value.store.getSnapshot().activePack.images;
  value.packs[0] = pack('plumber', versionOf('c')); value.api.fetchCompanionAsset = async () => { throw new Error('offline'); };
  await value.store.refresh(); assert.equal(value.store.getSnapshot().activePack.images, current); assert.match(value.store.getSnapshot().error, /下载失败/); value.store.dispose();
});

test('下载途中服务端版本变化拒绝激活混合图包', async () => {
  const value = setup(); await value.store.load(); value.api.getCompanion = async () => pack('plumber', versionOf('9'));
  await value.store.select('server:plumber'); assert.equal(value.store.getSnapshot().activePack.key, 'builtin:penguin'); assert.equal(value.disk.ready.size, 0); value.store.dispose();
});

test('新选择、换服与销毁均阻止迟到下载覆盖当前形象', async () => {
  for (const action of ['selection', 'server', 'dispose']) {
    const gate = deferred(); const cache = {
      async read() { return undefined; }, async prepare(_scope, summary) { await gate.promise; return { summary, images: images('late') }; },
    };
    const value = setup({ cache }); await value.store.load(); const download = value.store.select('server:plumber'); await tick();
    if (action === 'selection') await value.store.select('builtin:penguin');
    if (action === 'server') value.store.connect('https://two.example', value.api, false);
    if (action === 'dispose') value.store.dispose();
    gate.resolve(); await download;
    assert.equal(value.store.getSnapshot().activePack.key, 'builtin:penguin', action);
    if (action !== 'dispose') assert.equal(value.store.getSnapshot().downloadingKey, undefined, action);
    value.store.dispose();
  }
});

test('原生文件适配器夹具：目录原子移动后保持八图，重启可读，坏缓存与取消不伪装就绪', async () => {
  // 仅验证 v58 文件接口适配和生命周期；不声称执行了 Android 文件系统。
  const entries = new Map([['file:///cache', null]]);
  const join = (parts) => parts.map((part) => typeof part === 'string' ? part : part.uri).join('/').replace(/\/$/, '');
  const parent = (uri) => uri.slice(0, uri.lastIndexOf('/'));
  class Directory {
    constructor(...parts) { this.uri = join(parts); }
    get exists() { return entries.has(this.uri) && entries.get(this.uri) === null; }
    get name() { return this.uri.slice(this.uri.lastIndexOf('/') + 1); }
    create() { let uri = this.uri; while (uri.startsWith('file:///cache')) { if (!entries.has(uri)) entries.set(uri, null); uri = parent(uri); } }
    list() { assert.ok(this.exists); return [...entries].filter(([uri]) => parent(uri) === this.uri).map(([uri, value]) => value === null ? new Directory(uri) : new File(uri)); }
    delete() { for (const uri of entries.keys()) if (uri === this.uri || uri.startsWith(this.uri + '/')) entries.delete(uri); }
    // 真异步的原生调用：调用方不等待时，移动会晚于清理，缓存目录必然残缺。
    async move(destination) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.ok(entries.has(parent(destination.uri))); assert.equal(destination.exists, false);
      const source = this.uri;
      for (const [uri, value] of [...entries]) if (uri === source || uri.startsWith(source + '/')) { entries.set(destination.uri + uri.slice(source.length), value); entries.delete(uri); }
      this.uri = destination.uri;
    }
  }
  class File {
    constructor(...parts) { this.uri = join(parts); }
    get exists() { return entries.has(this.uri) && entries.get(this.uri) !== null; }
    get size() { return entries.get(this.uri)?.byteLength; }
    async write(value) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.ok(entries.has(parent(this.uri))); entries.set(this.uri, typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value));
    }
    async bytes() { assert.ok(this.exists); return entries.get(this.uri); }
    async text() { return new TextDecoder().decode(await this.bytes()); }
  }
  globalThis.__companionTestFilesystem = { Directory, File, Paths: { cache: new Directory('file:///cache') } };
  try {
    const native = createNativeCompanionCacheBackend(); const cache = new AtomicCompanionCache(native);
    const signal = new AbortController().signal; const scope = 'https://one.example/' + 'path'.repeat(50);
    const cached = await cache.prepare(scope, pack('plumber', versionOf('d')), async () => png(), signal);
    for (const state of COMPANION_STATES) assert.ok(entries.has(cached.images[state].uri));
    assert.equal([...entries.keys()].some((uri) => uri.includes('/pending.')), false);
    const restarted = new AtomicCompanionCache(createNativeCompanionCacheBackend());
    assert.equal((await restarted.read(scope, 'plumber', signal)).summary.version, versionOf('d'));
    await restarted.prepare(scope, pack('plumber', versionOf('d')), async () => assert.fail('完整缓存不重下'), signal);
    const newer = { ...pack('plumber', versionOf('e')), updatedAt: '2026-11-10T01:00:00.000Z' };
    const second = await cache.prepare(scope, newer, async () => png(), signal);
    assert.equal((await restarted.read(scope, 'plumber', signal)).summary.version, newer.version);
    // 版本目录是契约内 64 位十六进制的单层名字，不再有多段编码。
    const relative = second.images.idle.uri.slice(second.images.idle.uri.indexOf('/packs/')).split('/');
    assert.ok(relative.includes('plumber') && relative.includes(newer.version) && relative.length === 5, relative.join('/'));
    entries.set(second.images.working.uri, new Uint8Array([0]));
    assert.equal((await restarted.read(scope, 'plumber', signal)).summary.version, versionOf('d'));
    const controller = new AbortController(); let downloaded = 0;
    await assert.rejects(cache.prepare(scope, pack('plumber', versionOf('f')), async () => { if (++downloaded === 4) controller.abort(); return png(); }, controller.signal));
    assert.equal([...entries.keys()].some((uri) => uri.includes('/pending.')), false);
    await cache.clear(); assert.equal(entries.has('file:///cache/companions'), false);
  } finally { delete globalThis.__companionTestFilesystem; }
});

test('Web 使用 Blob URI 缓存并在清理/失败时释放已提交和临时 URL，不加载原生文件模块', async () => {
  const oldPlatform = Platform.OS; Platform.OS = 'web';
  const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
  const created = []; const revoked = [];
  URL.createObjectURL = () => { const uri = `blob:test-${created.length}`; created.push(uri); return uri; };
  URL.revokeObjectURL = (uri) => { revoked.push(uri); };
  try {
    const cache = await getCompanionCache();
    const cached = await cache.prepare('web-one', pack(), async () => png(), new AbortController().signal);
    assert.equal(cached.images.idle.uri, 'blob:test-0'); assert.equal(created.length, 8);
    assert.equal(await cache.read('web-two', 'plumber', new AbortController().signal), undefined);
    let count = 0;
    await assert.rejects(cache.prepare('web-one', pack('plumber', versionOf('b')), async () => ++count === 3 ? new Uint8Array([0]) : png(), new AbortController().signal));
    assert.deepEqual(revoked, ['blob:test-8', 'blob:test-9']);
    const gate = deferred(); count = 0;
    const task = cache.prepare('web-one', pack('plumber', versionOf('c')), async () => { if (++count === 2) await gate.promise; return png(); }, new AbortController().signal);
    await tick(); await clearCompanionCache(); assert.ok(revoked.includes('blob:test-10'));
    gate.resolve(); await assert.rejects(task); assert.equal(new Set(revoked).size, created.length);
    assert.equal(await cache.read('web-one', 'plumber', new AbortController().signal), undefined);
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; Platform.OS = oldPlatform; }
});

test('换服清缓存并重设独立偏好，渲染切换不改聊天 key、不停 SSE', () => {
  const reset = read('src/connection/cache-reset.ts'); assert.match(reset, /await clearCompanionCache\(\)/); assert.match(reset, /write\('builtin:penguin'\)/);
  const workspace = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(workspace, /CompanionProvider key=\{connection\.snapshot\.workspaceKey\}/);
  assert.equal((workspace.match(/<ConversationHost\b/g) ?? []).length, 1);
  assert.doesNotMatch(workspace, /<ConversationHost[^>]*(?:key=|activePack|selectedKey)/);
  assert.equal((workspace.match(/<MuseCompanion[^>]*images=\{activePack\.images\}/g) ?? []).length, 1);
  // 接线锚点在 primary-nav；这里只钉形象包独有约束：不重建聊天、图片流经两处形象渲染。
  assert.doesNotMatch(workspace, /<FloatingCompanion[^>]*key=/);
  assert.match(read('src/workspace/FloatingCompanion.tsx'), /<MuseCompanion state=\{state\} size=\{AVATAR_SIZE\} offline=\{offline\} images=\{images\}/);
  const store = read('src/companion/companion-store.ts'); assert.doesNotMatch(store, /cancelPending|\.retire\(|\.suspend\(|chatSession|resetSession|stopRun/);
  const preferences = read('src/companion/device-preferences.ts'); assert.match(preferences, /pi-muse-mobile-companion-v1/); assert.doesNotMatch(preferences, /serverUrl|accessKey|token|deviceConnection/);
  const cache = read('src/companion/companion-cache.ts'); assert.match(cache, /Platform\.OS === 'web'/); assert.match(cache, /URL\.revokeObjectURL/); assert.match(cache, /new Directory\(Paths\.cache, 'companions'\)/);
  // 静态引入原生文件模块：Metro 解析不到动态 import 的带 exports 包。
  assert.match(cache, /^import \{ Directory, File, Paths \} from 'expo-file-system';$/m);
  assert.doesNotMatch(cache, /await import\('expo-file-system'\)/);
});
