import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectionManager } from '../src/connection/connection-manager.ts';
import { CONNECTION_KEY, createConnectionStore } from '../src/connection/connection-store.ts';
import { ApiError } from '../src/api/errors.ts';

const A = 'https://a.example'; const B = 'https://b.example';
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture(record) {
  const values = new Map(record ? [[CONNECTION_KEY, JSON.stringify(record)]] : []);
  const events = []; const clients = []; const calls = [];
  const control = { failWrite: false, failFinal: false, failClear: false, clearGate: undefined, session: undefined, spaces: undefined, cache: 'old-business-cache' };
  const store = createConnectionStore({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, raw) => {
      const value = JSON.parse(raw);
      if (control.failWrite || (control.failFinal && value.serverUrl === B && !value.resetPending)) throw new Error('disk error');
      events.push(['save', clone(value)]); values.set(key, raw);
    },
    removeItem: async (key) => { values.delete(key); },
  });
  const clearWorkspaceData = async () => {
    events.push(['clear']);
    if (control.failClear) throw new Error('cache cleanup failed');
    if (control.clearGate) await control.clearGate.promise;
    control.cache = undefined;
  };
  const createClient = (url, getToken, onUnauthorized, options) => {
    const client = {
      url, getToken, onUnauthorized, options, paused: false, retired: false,
      createSession: async (key) => {
        calls.push({ type: 'session', url, key });
        if (control.session) return control.session(client, key);
        return { token: url === B ? 'token-b' : 'token-a', mode: 'live' };
      },
      listSpaces: async () => {
        calls.push({ type: 'spaces', url, token: getToken() });
        if (control.spaces) return control.spaces(client);
        return [{ id: 'local-main', updatedAt: '2026-10-17T00:00:00Z' }];
      },
      cancelPending: () => { events.push(['cancel', url]); },
      suspend: () => { client.paused = true; events.push(['suspend', url]); },
      resume: () => { if (!client.retired) client.paused = false; },
      retire: () => { client.retired = true; events.push(['retire', url]); },
    };
    clients.push(client); return client;
  };
  const makeManager = () => new ConnectionManager({ store, clearWorkspaceData, createClient });
  const manager = makeManager();
  return {
    manager, makeManager, values, events, clients, calls, control,
    record: () => values.has(CONNECTION_KEY) ? JSON.parse(values.get(CONNECTION_KEY)) : undefined,
    clearCount: () => events.filter(([kind]) => kind === 'clear').length,
    writes: () => events.filter(([kind]) => kind === 'save'),
    boot: async () => { manager.setActive(true); await manager.start(); return manager; },
  };
}

test('首次未配置没有网络请求，不自动选择编译期地址', async () => {
  const f = fixture(); await f.boot();
  assert.equal(f.manager.getSnapshot().status, 'unconfigured');
  assert.equal(f.manager.getClient(), undefined);
  assert.deepEqual(f.calls, []);
  assert.equal(f.clearCount(), 0);
});

test('旧浏览器字段不进入快照，重新认证时也不会写回存储', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a', browserUrl: 'https://obsolete.example/vnc.html' }); await f.boot();
  assert.equal(f.manager.getSnapshot().serverUrl, A);
  assert.equal('browserUrl' in f.manager.getSnapshot(), false);
  f.manager.getClient().onUnauthorized('token-a'); await flush();
  assert.deepEqual(f.record(), { serverUrl: A });
  await f.manager.connect(A, 'new-key');
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(JSON.stringify(f.record()).includes('obsolete.example'), false);
});

test('首次连接只保存当前地址和永久Token，不持久化Key或清业务缓存', async () => {
  const f = fixture(); await f.boot();
  await f.manager.connect(A, 'private-input-key');
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.manager.getSnapshot().status, 'online');
  assert.equal(f.manager.getSnapshot().workspaceReady, true);
  assert.equal(f.clearCount(), 0);
  assert.equal(JSON.stringify(f.record()).includes('private-input-key'), false);
});

test('恢复已有永久Token只做只读探测，不交换Key或解析过期时间', async () => {
  const f = fixture({ serverUrl: A, token: 'opaque-token-with-no-expiry' }); await f.boot();
  assert.equal(f.manager.getSnapshot().status, 'online');
  assert.equal(f.calls.some((call) => call.type === 'session'), false);
  assert.equal(f.calls[0].token, 'opaque-token-with-no-expiry');
  assert.equal(f.writes().length, 0);
  assert.equal(f.clearCount(), 0);
});

test('原址断网或5xx保留Token、业务数据域和缓存，重试恢复不重放写请求', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot();
  const key = f.manager.getSnapshot().workspaceKey; const client = f.manager.getClient();
  f.control.spaces = async () => { throw new ApiError(503, 'service down'); };
  await f.manager.retry();
  assert.equal(f.manager.getSnapshot().status, 'offline');
  assert.equal(f.manager.getSnapshot().hasToken, true);
  assert.equal(f.manager.getSnapshot().workspaceReady, true);
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
  assert.equal(f.manager.getClient(), client);
  assert.equal(f.record().token, 'token-a');
  assert.equal(f.control.cache, 'old-business-cache');
  assert.equal(f.clearCount(), 0);
  f.control.spaces = undefined; await f.manager.retry();
  assert.equal(f.manager.getSnapshot().status, 'online');
  assert.equal(f.calls.every((call) => call.type === 'spaces'), true);
  assert.equal(f.writes().length, 0);
});

test('网络事件与明确401分开，401不更改URL、不清业务数据域', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot();
  const client = f.manager.getClient(); const key = f.manager.getSnapshot().workspaceKey;
  client.options.onTransportState({ kind: 'offline', token: 'token-a', error: 'network down' });
  assert.equal(f.manager.getSnapshot().hasToken, true);
  client.onUnauthorized('token-a'); await flush();
  assert.equal(f.manager.getSnapshot().status, 'authentication-required');
  assert.equal(f.manager.getSnapshot().serverUrl, A);
  assert.equal(f.manager.getSnapshot().hasToken, false);
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
  assert.equal(f.manager.getSnapshot().workspaceReady, true);
  assert.equal(f.record().token, undefined);
  assert.equal(f.control.cache, 'old-business-cache');
  assert.equal(f.clearCount(), 0);
  assert.equal(client.paused, true);
});

test('原服务器重新认证保留数据域，旧Token迟到401不能清新Token', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot();
  const client = f.manager.getClient(); const key = f.manager.getSnapshot().workspaceKey;
  client.onUnauthorized('token-a'); await flush();
  f.control.session = async () => ({ token: 'token-a-new', mode: 'live' });
  await f.manager.connect(A, 'new-key');
  client.onUnauthorized('token-a'); await flush();
  assert.equal(f.record().token, 'token-a-new');
  assert.equal(f.manager.getSnapshot().hasToken, true);
  assert.equal(f.manager.getSnapshot().status, 'online');
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
  assert.equal(f.manager.getClient(), client);
  assert.equal(f.clearCount(), 0);
});

test('规范化后同址保存不写配置、不清缓存、不换数据域', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot();
  const key = f.manager.getSnapshot().workspaceKey;
  await f.manager.saveServer('https://A.example:443/', '');
  assert.equal(f.clearCount(), 0);
  assert.equal(f.writes().length, 0);
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
});

test('测试新地址不能携带旧Token，测试成功也不自动覆盖当前连接', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot();
  f.manager.setActive(false);
  const proof = await f.manager.testConnection(B, 'key-b');
  const call = f.calls.find((call) => call.type === 'session' && call.url === B);
  assert.equal(call.key, 'key-b');
  assert.equal(f.calls.some((call) => call.url === B && call.token === 'token-a'), false);
  assert.equal(proof.serverUrl, B);
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.manager.getSnapshot().serverUrl, A);
  assert.equal(f.clearCount(), 0);
});

test('新地址测试失败或取消不写配置，迟到探测不能成为有效证明', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  f.control.session = async () => { throw new ApiError(401, 'wrong key'); };
  await assert.rejects(f.manager.testConnection(B, 'bad'));
  assert.equal(f.manager.getSnapshot().hasToken, true);
  assert.equal(f.writes().length, 0);
  const gate = deferred(); f.control.session = () => gate.promise;
  const pending = f.manager.testConnection(B, 'key-b');
  const rejected = assert.rejects(pending, (e) => e.name === 'AbortError');
  f.manager.cancelTest(); gate.resolve({ token: 'token-b', mode: 'live' }); await rejected;
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.clearCount(), 0);
});

test('旧登录晚到不能覆盖用户后来保存的服务器', async () => {
  const f = fixture(); await f.boot();
  const gate = deferred(); f.control.session = () => gate.promise;
  const old = f.manager.connect(A, 'key-a');
  const rejected = assert.rejects(old, (e) => e.name === 'AbortError');
  f.manager.setActive(false);
  await f.manager.saveServer(B, '');
  gate.resolve({ token: 'token-a', mode: 'live' }); await rejected;
  assert.deepEqual(f.record(), { serverUrl: B });
  assert.equal(f.manager.getSnapshot().serverUrl, B);
  assert.equal(f.manager.getSnapshot().hasToken, false);
  assert.equal(f.clearCount(), 0);
});

test('测试结果不能跨URL或Key套用保存', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  const proof = await f.manager.testConnection(B, 'key-b');
  await assert.rejects(f.manager.saveServer('https://c.example', 'key-b', proof), /重新测试/);
  await assert.rejects(f.manager.saveServer(B, 'different-key', proof), /重新测试/);
  assert.equal(f.record().serverUrl, A);
  assert.equal(f.clearCount(), 0);
});

test('地址变更先写journal再清理，旧客户端回调不能影响新连接', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot();
  const old = f.manager.getClient(); const key = f.manager.getSnapshot().workspaceKey;
  f.manager.setActive(false);
  const proof = await f.manager.testConnection(B, 'key-b');
  await f.manager.saveServer(B, 'key-b', proof);
  f.manager.setActive(true); await flush();
  old.onUnauthorized('token-a'); old.options.onTransportState({ kind: 'offline', token: 'token-a', error: 'late old failure' }); await flush();
  assert.deepEqual(f.record(), { serverUrl: B, token: 'token-b' });
  assert.equal(f.manager.getSnapshot().workspaceKey, key + 1);
  assert.equal(f.manager.getSnapshot().workspaceReady, true);
  assert.equal(f.clearCount(), 1);
  assert.equal(f.control.cache, undefined);
  const journal = f.events.findIndex(([kind, record]) => kind === 'save' && record.resetPending === true);
  const clear = f.events.findIndex(([kind]) => kind === 'clear');
  const finish = f.events.findIndex(([kind, record]) => kind === 'save' && record.serverUrl === B && !record.resetPending);
  assert.ok(journal < clear && clear < finish);
  assert.equal(old.retired, true);
  assert.equal(old.getToken(), 'token-a');
  assert.equal(f.manager.getClient().getToken(), 'token-b');
  assert.equal(f.manager.getSnapshot().status, 'online');
});

test('写入新地址失败不清缓存且保留原Token与业务数据域', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  const key = f.manager.getSnapshot().workspaceKey; f.control.failWrite = true;
  await assert.rejects(f.manager.saveServer(B, ''), /无法保存/);
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.manager.getSnapshot().serverUrl, A);
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
  assert.equal(f.clearCount(), 0);
  assert.equal(f.control.cache, 'old-business-cache');
});

test('清理失败保持journal且不启用新工作区，启动恢复失败仍是清理错误', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  f.control.failClear = true;
  await f.manager.saveServer(B, 'typed-key');
  assert.equal(f.record().resetPending, true);
  assert.equal(f.manager.getSnapshot().status, 'reset-error');
  assert.equal(f.manager.getSnapshot().workspaceReady, false);
  assert.equal(f.manager.getSnapshot().busy, false);
  f.manager.dispose();
  const restored = f.makeManager(); restored.setActive(true); await restored.start();
  assert.equal(restored.getSnapshot().status, 'reset-error');
  assert.equal(restored.getSnapshot().workspaceReady, false);
  assert.equal(restored.getPendingKey(), '');
  f.control.failClear = false; await restored.retryReset();
  assert.deepEqual(f.record(), { serverUrl: B });
  assert.equal(restored.getSnapshot().status, 'authentication-required');
  assert.equal(f.control.cache, undefined);
});

test('清理后写回标记失败也不能放行，新启动必须重新完成幂等清理', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  const proof = await f.manager.testConnection(B, 'key-b'); f.control.failFinal = true;
  await f.manager.saveServer(B, 'key-b', proof);
  assert.equal(f.manager.getSnapshot().status, 'reset-error');
  assert.equal(f.manager.getSnapshot().workspaceReady, false);
  assert.equal(f.record().resetPending, true);
  assert.equal(f.clearCount(), 1);
  f.manager.dispose(); f.control.failFinal = false;
  const restored = f.makeManager(); restored.setActive(true); await restored.start();
  assert.equal(restored.getSnapshot().workspaceReady, true);
  assert.equal(f.record().resetPending, undefined);
  assert.equal(f.clearCount(), 2);
});

test('未完成清理时同址保存不能绕过清理门禁', async () => {
  const f = fixture({ serverUrl: B, token: 'token-b', resetPending: true }); f.control.failClear = true;
  await f.boot();
  await f.manager.saveServer(B, '');
  assert.equal(f.manager.getSnapshot().status, 'reset-error');
  assert.equal(f.manager.getSnapshot().workspaceReady, false);
  assert.equal(f.record().resetPending, true);
});

test('保存不可达地址保留地址但绝不复用旧Token，新Key只在内存', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  await f.manager.saveServer(B, 'temporary-key');
  assert.deepEqual(f.record(), { serverUrl: B });
  assert.equal(f.manager.getSnapshot().status, 'authentication-required');
  assert.equal(f.manager.getSnapshot().workspaceReady, false);
  assert.equal(f.manager.getPendingKey(), 'temporary-key');
  assert.equal(f.calls.some((call) => call.url === B), false);
  assert.equal(f.clearCount(), 1);
});

test('进入编辑或演示只暂停IO，恢复仍用原连接，不清缓存和Key数据域', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot();
  const client = f.manager.getClient(); const key = f.manager.getSnapshot().workspaceKey;
  f.manager.setActive(false);
  client.onUnauthorized('token-a');
  assert.equal(f.record().token, 'token-a');
  assert.equal(client.paused, true);
  f.manager.setActive(true); await flush();
  assert.equal(f.manager.getClient(), client);
  assert.equal(client.paused, false);
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
  assert.equal(f.clearCount(), 0);
});

test('重复确认受操作锁保护，不能并发清理两次', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  f.control.clearGate = deferred();
  const first = f.manager.saveServer(B, '');
  await flush();
  await assert.rejects(f.manager.saveServer(B, ''), /正在处理/);
  assert.equal(f.clearCount(), 1);
  f.control.clearGate.resolve(); await first;
  assert.equal(f.clearCount(), 1);
});
