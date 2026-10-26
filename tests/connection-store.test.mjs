import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeServerAddress } from '../src/connection/server-address.ts';
import { CONNECTION_KEY, createConnectionStore } from '../src/connection/connection-store.ts';

function memoryStore(initial = []) {
  const values = new Map(initial);
  const actions = [];
  const adapter = {
    getItem: async (key) => { actions.push(['get', key]); return values.get(key) ?? null; },
    setItem: async (key, value) => { actions.push(['set', key]); values.set(key, value); },
    removeItem: async (key) => { actions.push(['remove', key]); values.delete(key); },
  };
  return { values, actions, adapter, store: createConnectionStore(adapter) };
}

for (const [value, expected] of [
  [' https://EXAMPLE.com:443/ ', 'https://example.com'],
  ['http://EXAMPLE.com:80/', 'http://example.com'],
  ['https://example.com/pi-muse///', 'https://example.com/pi-muse'],
  ['http://[::1]:8788/', 'http://[::1]:8788'],
  ['https://example.com/代理/', 'https://example.com/%E4%BB%A3%E7%90%86'],
]) test(`地址规范化：${value}`, () => assert.equal(normalizeServerAddress(value), expected));

for (const value of ['', 'example.com', 'ftp://example.com', 'file:///tmp/a', 'javascript:alert(1)', 'https://user:password@example.com', 'https://user@example.com', 'https://example.com?token=secret', 'https://example.com?', 'https://example.com#', 'https://example.com#section', 'https://example.com:99999']) {
  test(`非法基础地址不允许连接：${value}`, () => assert.throws(() => normalizeServerAddress(value)));
}

test('连接记录绑定地址与永久Token，保存时丢弃Key和其他非契约字段', async () => {
  const { store, values } = memoryStore();
  await store.save({ serverUrl: 'https://EXAMPLE.com:443/', token: 'permanent-token', accessKey: 'never-store-me', expiresAt: 1 });
  assert.deepEqual(JSON.parse(values.get(CONNECTION_KEY)), { serverUrl: 'https://example.com', token: 'permanent-token' });
  assert.deepEqual(await store.load(), { serverUrl: 'https://example.com', token: 'permanent-token' });
  assert.equal([...values.values()].some((value) => value.includes('never-store-me')), false);
});

test('浏览器地址与旧连接记录均可往返，查询参数和路径保留', async () => {
  const { store, values } = memoryStore();
  assert.deepEqual(await store.load(), undefined);
  await store.save({ serverUrl: 'https://api.example', token: 'token-a', browserUrl: ' https://GUI.example:443/vnc.html?autoconnect=1 ' });
  assert.deepEqual(JSON.parse(values.get(CONNECTION_KEY)), { serverUrl: 'https://api.example', token: 'token-a', browserUrl: 'https://gui.example/vnc.html?autoconnect=1' });
  assert.deepEqual(await store.load(), { serverUrl: 'https://api.example', token: 'token-a', browserUrl: 'https://gui.example/vnc.html?autoconnect=1' });
  const old = memoryStore([[CONNECTION_KEY, JSON.stringify({ serverUrl: 'https://api.example', token: 'old-token' })]]);
  assert.deepEqual(await old.store.load(), { serverUrl: 'https://api.example', token: 'old-token' });
});

test('损坏或含凭据的浏览器地址拒绝读写且保留原记录', async () => {
  for (const browserUrl of [null, 123, '', 'https://user@example.com']) {
    const raw = JSON.stringify({ serverUrl: 'https://api.example', browserUrl });
    const { store, values } = memoryStore([[CONNECTION_KEY, raw]]);
    await assert.rejects(store.load());
    assert.equal(values.get(CONNECTION_KEY), raw);
    await assert.rejects(store.save({ serverUrl: 'https://api.example', browserUrl }));
    assert.equal(values.get(CONNECTION_KEY), raw);
  }
});

test('未配置连接时 load 返回 undefined', async () => {
  const { store, values, actions } = memoryStore();
  assert.equal(await store.load(), undefined);
  assert.equal(values.has(CONNECTION_KEY), false);
  assert.equal(actions.some(([kind]) => kind === 'set'), false);
});

test('离线地址可没有Token，清理日志随连接记录持久化', async () => {
  const { store } = memoryStore();
  await store.save({ serverUrl: 'http://192.0.2.1:8788', resetPending: true });
  assert.deepEqual(await store.load(), { serverUrl: 'http://192.0.2.1:8788', resetPending: true });
});

test('损坏或类型不正确的存储不会悄悄变成默认连接或删除原记录', async () => {
  for (const raw of ['broken JSON', '{}', '{"serverUrl":1}', '{"serverUrl":"https://example.com","token":{}}', '{"serverUrl":"https://example.com","token":""}', '{"serverUrl":"https://example.com","resetPending":"yes"}']) {
    const { store, values, actions } = memoryStore([[CONNECTION_KEY, raw]]);
    await assert.rejects(store.load());
    assert.equal(values.get(CONNECTION_KEY), raw);
    assert.equal(actions.some(([kind]) => kind === 'set' || kind === 'remove'), false);
  }
});

test('读写串行化，迟到的旧写入不能覆盖较新的地址或被提前读取', async () => {
  const { adapter, values } = memoryStore();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let writes = 0;
  const store = createConnectionStore({ ...adapter, setItem: async (key, value) => { writes++; if (writes === 1) await gate; values.set(key, value); } });
  const first = store.save({ serverUrl: 'https://a.example', token: 'token-a' });
  const second = store.save({ serverUrl: 'https://b.example', token: 'token-b' });
  const read = store.load();
  await new Promise(setImmediate);
  assert.equal(writes, 1);
  release(); await Promise.all([first, second]);
  assert.deepEqual(await read, { serverUrl: 'https://b.example', token: 'token-b' });
});

test('保存失败保留现有记录，失败不会毒化后续存储队列', async () => {
  const old = JSON.stringify({ serverUrl: 'https://a.example', token: 'token-a' });
  const { adapter, values } = memoryStore([[CONNECTION_KEY, old]]);
  let fail = true;
  const store = createConnectionStore({ ...adapter, setItem: async (key, value) => { if (fail) throw new Error('quota'); values.set(key, value); } });
  await assert.rejects(store.save({ serverUrl: 'https://b.example', token: 'token-b' }));
  assert.equal(values.get(CONNECTION_KEY), old);
  fail = false;
  await store.save({ serverUrl: 'https://b.example', token: 'token-b' });
  assert.equal((await store.load()).serverUrl, 'https://b.example');
});

test('底层读取失败不删除凭据或伪造未配置状态', async () => {
  let removes = 0;
  const store = createConnectionStore({ getItem: async () => { throw new Error('storage unavailable'); }, setItem: async () => {}, removeItem: async () => removes++ });
  await assert.rejects(store.load(), /storage unavailable/);
  assert.equal(removes, 0);
});
