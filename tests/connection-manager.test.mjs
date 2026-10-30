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
    getItem: async (key) => {
      if (control.failRead) throw new Error('read error');
      return values.get(key) ?? null;
    },
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

test('直接保存先认证核对，成功后只落盘地址与Token', async () => {
  const f = fixture(); await f.boot();
  await f.manager.saveConnection(A, 'private-input-key');
  assert.deepEqual(f.calls.map(({ type, url, key, token }) => ({ type, url, key, token })), [
    { type: 'session', url: A, key: 'private-input-key', token: undefined },
    { type: 'spaces', url: A, key: undefined, token: 'token-a' },
  ]);
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.manager.getSnapshot().status, 'online');
  assert.equal(f.manager.getSnapshot().workspaceReady, true);
  assert.equal(f.clearCount(), 0);
  assert.equal(JSON.stringify(f.record()).includes('private-input-key'), false);
});

test('同址空Key保存沿用当前Token，但必须实际listSpaces核对', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot();
  f.manager.setActive(false);
  await f.manager.saveConnection('https://A.example:443/', '');
  assert.deepEqual(f.calls, [
    { type: 'spaces', url: A, token: 'token-a' },
    { type: 'spaces', url: 'https://a.example', token: 'token-a' },
  ]);
  assert.deepEqual(f.record(), { serverUrl: 'https://a.example', token: 'token-a' });
  assert.equal(f.clearCount(), 0);
  assert.equal(f.manager.getSnapshot().status, 'online');
});

test('仅测试不保存，证明也不能跨URL或Key使用', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot();
  f.manager.setActive(false);
  const proof = await f.manager.testConnection(B, 'key-b');
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.manager.getSnapshot().serverUrl, A);
  assert.equal(f.clearCount(), 0);
  await assert.rejects(f.manager.saveConnection('https://c.example', 'key-b', { test: proof, confirmChange: true }), /重新测试/);
  await assert.rejects(f.manager.saveConnection(B, 'different-key', { test: proof, confirmChange: true }), /重新测试/);
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.clearCount(), 0);
});

test('新Key必须重新交换Token，旧proof不能保存新输入', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  const proof = await f.manager.testConnection(A, 'new-key');
  await assert.rejects(f.manager.saveConnection(A, 'changed-key', { test: proof }), /重新测试/);
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });

  f.control.session = async () => ({ token: 'token-a-new', mode: 'live' });
  await f.manager.saveConnection(A, 'new-key');
  assert.deepEqual(f.calls.at(-2), { type: 'session', url: A, key: 'new-key' });
  assert.deepEqual(f.calls.at(-1), { type: 'spaces', url: A, token: 'token-a-new' });
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a-new' });
  assert.equal(f.clearCount(), 0);
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
  await f.manager.saveConnection(A, 'new-key');
  client.onUnauthorized('token-a'); await flush();
  assert.equal(f.record().token, 'token-a-new');
  assert.equal(f.manager.getSnapshot().hasToken, true);
  assert.equal(f.manager.getSnapshot().status, 'online');
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
  assert.equal(f.manager.getClient(), client);
  assert.equal(f.clearCount(), 0);
});

test('错误Key或初次失败不保存地址，也不破坏有效连接', async () => {
  const first = fixture(); await first.boot();
  first.control.session = async () => { throw new ApiError(401, 'wrong key'); };
  await assert.rejects(first.manager.saveConnection(A, 'bad-key'), (error) => error.status === 401);
  assert.equal(first.record(), undefined);
  assert.equal(first.manager.getSnapshot().status, 'unconfigured');
  assert.equal(first.manager.getSnapshot().error, 'wrong key');

  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  const client = f.manager.getClient(); const key = f.manager.getSnapshot().workspaceKey;
  f.control.session = async () => { throw new ApiError(401, 'wrong key'); };
  await assert.rejects(f.manager.saveConnection(A, 'wrong-key'), (error) => error.status === 401);
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.manager.getSnapshot().status, 'online');
  assert.equal(f.manager.getSnapshot().hasToken, true);
  assert.equal(f.manager.getClient(), client);
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
  assert.equal(f.control.cache, 'old-business-cache');
  assert.equal(f.clearCount(), 0);
  assert.equal(f.manager.getSnapshot().error.includes('存储'), false);

  f.control.session = async () => ({ token: 'token-a-new', mode: 'live' });
  await f.manager.testConnection(A, 'correct-key');
  assert.equal(f.manager.getSnapshot().error, undefined);
  assert.equal(f.manager.getSnapshot().status, 'online');
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.manager.getClient(), client);
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
  assert.equal(f.control.cache, 'old-business-cache');
  assert.equal(f.clearCount(), 0);
});

test('取消直接保存后，迟到认证结果不能写盘或清理', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  const gate = deferred(); f.control.session = () => gate.promise;
  const pending = f.manager.saveConnection(B, 'key-b', { confirmChange: true });
  const rejected = assert.rejects(pending, (error) => error.name === 'AbortError');
  f.manager.cancelTest();
  gate.resolve({ token: 'token-b', mode: 'live' });
  await rejected;
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.calls.some((call) => call.url === B && call.type === 'spaces'), false);
  assert.equal(f.clearCount(), 0);
});

test('未确认换服不发请求不清理，确认后先验证再写journal与清理', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  await assert.rejects(f.manager.saveConnection(B, 'key-b'), /请先确认/);
  assert.equal(f.calls.some((call) => call.url === B), false);
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.clearCount(), 0);

  const old = f.manager.getClient(); const key = f.manager.getSnapshot().workspaceKey;
  const proof = await f.manager.testConnection(B, 'key-b');
  await f.manager.saveConnection(B, 'key-b', { test: proof, confirmChange: true });
  await assert.rejects(f.manager.saveConnection(B, 'key-b', { test: proof, confirmChange: true }), /重新测试/);
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
  assert.equal(f.manager.getClient().getToken(), 'token-b');
});

test('写入新地址失败不清缓存且保留原Token与业务数据域', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  const key = f.manager.getSnapshot().workspaceKey; f.control.failWrite = true;
  const proof = await f.manager.testConnection(B, 'key-b'); f.control.failWrite = true;
  await assert.rejects(f.manager.saveConnection(B, 'key-b', { test: proof, confirmChange: true }), /无法保存/);
  assert.deepEqual(f.record(), { serverUrl: A, token: 'token-a' });
  assert.equal(f.manager.getSnapshot().serverUrl, A);
  assert.equal(f.manager.getSnapshot().workspaceKey, key);
  assert.equal(f.clearCount(), 0);
  assert.equal(f.control.cache, 'old-business-cache');
});

test('清理失败保持journal且不启用新工作区，重启恢复与重试保持门禁', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  f.control.failClear = true;
  const proof = await f.manager.testConnection(B, 'key-b');
  await f.manager.saveConnection(B, 'key-b', { test: proof, confirmChange: true });
  assert.deepEqual(f.record(), { serverUrl: B, token: 'token-b', resetPending: true });
  assert.equal(f.manager.getSnapshot().status, 'reset-error');
  assert.equal(f.manager.getSnapshot().workspaceReady, false);
  assert.equal(f.manager.getSnapshot().busy, false);
  f.manager.dispose();
  const restored = f.makeManager(); restored.setActive(true); await restored.start();
  assert.equal(restored.getSnapshot().status, 'reset-error');
  assert.equal(restored.getSnapshot().workspaceReady, false);
  f.control.failClear = false; await restored.retryReset();
  assert.deepEqual(f.record(), { serverUrl: B, token: 'token-b' });
  await flush();
  assert.equal(restored.getSnapshot().status, 'online');
  assert.equal(restored.getSnapshot().workspaceReady, true);
  assert.equal(f.control.cache, undefined);
});

test('清理后写回标记失败也不能放行，新启动必须重新完成幂等清理', async () => {
  const f = fixture({ serverUrl: A, token: 'token-a' }); await f.boot(); f.manager.setActive(false);
  const proof = await f.manager.testConnection(B, 'key-b'); f.control.failFinal = true;
  await f.manager.saveConnection(B, 'key-b', { test: proof, confirmChange: true });
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
  await f.manager.saveConnection(B, '');
  assert.equal(f.manager.getSnapshot().status, 'reset-error');
  assert.equal(f.manager.getSnapshot().workspaceReady, false);
  assert.equal(f.record().resetPending, true);
});

test('未知存储配置也必须确认，验证成功后才进入清理', async () => {
  const f = fixture(); f.control.failRead = true;
  f.manager.setActive(true); await f.manager.start();
  assert.equal(f.manager.getSnapshot().status, 'storage-error');
  await assert.rejects(f.manager.saveConnection(B, 'key-b'), /请先确认/);
  assert.deepEqual(f.calls, []);
  assert.equal(f.clearCount(), 0);
  await f.manager.saveConnection(B, 'key-b', { confirmChange: true });
  assert.deepEqual(f.record(), { serverUrl: B, token: 'token-b' });
  assert.equal(f.clearCount(), 1);
  assert.equal(f.manager.getSnapshot().status, 'connecting');
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
  const first = f.manager.saveConnection(B, 'key-b', { confirmChange: true });
  await flush();
  await assert.rejects(f.manager.saveConnection(B, 'key-b', { confirmChange: true }), /正在处理/);
  assert.equal(f.clearCount(), 1);
  f.control.clearGate.resolve(); await first;
  assert.equal(f.clearCount(), 1);
});
