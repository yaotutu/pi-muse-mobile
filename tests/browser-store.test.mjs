import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api/errors.ts';
import { createBrowserStore } from '../src/browser/browser-store.ts';

const tick = () => new Promise(setImmediate);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockBrowserClient() {
  const statusCalls = [];
  const ticketCalls = [];

  return {
    statusCalls,
    ticketCalls,
    getBrowserStatus(signal) {
      const entry = { signal, ...deferred() };
      statusCalls.push(entry);
      return entry.promise;
    },
    createBrowserDesktopTicket(signal) {
      const entry = { signal, ...deferred() };
      ticketCalls.push(entry);
      return entry.promise;
    },
  };
}

test('createBrowserStore 初始状态为 idle', () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');
  assert.deepEqual(store.getSnapshot(), {
    phase: 'idle',
    launchUrl: null,
    error: null,
  });
});

test('open 正常流程：从 status 开始，成功后仅一次 ticket 请求，最终进入 ready 状态', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com/subpath');
  const states = [];
  store.subscribe(() => {
    states.push(store.getSnapshot());
  });

  store.open();
  assert.equal(store.getSnapshot().phase, 'loading');
  assert.equal(client.statusCalls.length, 1);
  assert.equal(client.ticketCalls.length, 0);

  // 服务端返回状态可用
  client.statusCalls[0].resolve({
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable: true,
  });
  await tick();

  // 此时应当发起且仅发起一次 ticket 请求
  assert.equal(client.ticketCalls.length, 1);
  client.ticketCalls[0].resolve({
    launchPath: '/browser/desktop/launch?ticket=safe_token_123',
    expiresAt: '2026-10-30T12:00:00Z',
  });
  await tick();

  assert.deepEqual(store.getSnapshot(), {
    phase: 'ready',
    launchUrl: 'https://example.com/subpath/browser/desktop/launch?ticket=safe_token_123',
    error: null,
  });
});

test('open 遇到 enabled=false 转移至 disabled 状态，且不请求 ticket', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');

  store.open();
  assert.equal(client.statusCalls.length, 1);
  client.statusCalls[0].resolve({
    enabled: false,
    viewerPath: null,
    desktopPath: null,
    desktopAvailable: false,
  });
  await tick();

  assert.deepEqual(store.getSnapshot(), {
    phase: 'disabled',
    launchUrl: null,
    error: null,
  });
  assert.equal(client.ticketCalls.length, 0);
});

test('open 遇到 desktopAvailable=false 转移至 unavailable 状态，且不请求 ticket', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');

  store.open();
  assert.equal(client.statusCalls.length, 1);
  client.statusCalls[0].resolve({
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable: false,
  });
  await tick();

  assert.deepEqual(store.getSnapshot(), {
    phase: 'unavailable',
    launchUrl: null,
    error: null,
  });
  assert.equal(client.ticketCalls.length, 0);
});

test('请求失败展示安全文案，不回显 URL 或 token', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');

  // status 失败
  store.open();
  client.statusCalls[0].reject(new ApiError(500, '服务器内部错误'));
  await tick();

  assert.deepEqual(store.getSnapshot(), {
    phase: 'error',
    launchUrl: null,
    error: '连接远程浏览器失败，请检查网络或服务状态',
  });

  // ticket 失败 (503)
  store.open();
  client.statusCalls[1].resolve({
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable: true,
  });
  await tick();

  client.ticketCalls[0].reject(new ApiError(503, 'Remote desktop is unavailable'));
  await tick();

  assert.deepEqual(store.getSnapshot(), {
    phase: 'error',
    launchUrl: null,
    error: '远程桌面暂不可用，请稍后重试',
  });
  // 错误信息中严禁泄露敏感 launchPath、token
  assert.doesNotMatch(store.getSnapshot().error ?? '', /ticket=/);
});

test('无自动重发，只有用户显式 open 时才重试', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');

  store.open();
  client.statusCalls[0].reject(new Error('Network failure'));
  await tick();

  assert.equal(store.getSnapshot().phase, 'error');
  assert.equal(client.statusCalls.length, 1);

  // 等待一段时间，没有自动重试
  await tick();
  assert.equal(client.statusCalls.length, 1);

  // 用户显式 open 重试
  store.open();
  assert.equal(client.statusCalls.length, 2);
  assert.equal(store.getSnapshot().phase, 'loading');
  client.statusCalls[1].resolve({
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable: true,
  });
  await tick();
  client.ticketCalls[0].resolve({
    launchPath: '/browser/desktop/launch?ticket=retry_token',
    expiresAt: '2026-10-30T12:00:00Z',
  });
  await tick();
  assert.equal(store.getSnapshot().phase, 'ready');
});

test('close 同步 abort 在途请求、清空状态，迟到结果不能污染当前状态', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');

  store.open();
  const inFlightStatus = client.statusCalls[0];
  assert.equal(inFlightStatus.signal.aborted, false);

  // 关闭
  store.close();
  assert.equal(inFlightStatus.signal.aborted, true);
  assert.deepEqual(store.getSnapshot(), {
    phase: 'idle',
    launchUrl: null,
    error: null,
  });

  // 迟到响应返回
  inFlightStatus.resolve({
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable: true,
  });
  await tick();

  // 不应发起 ticket 请求，且快照仍为 idle
  assert.equal(client.ticketCalls.length, 0);
  assert.equal(store.getSnapshot().phase, 'idle');
});

test('快速重新 open 时中止前一次请求，旧请求的迟到结果不能污染新一轮打开', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');

  store.open();
  const firstStatus = client.statusCalls[0];

  // 再次 open
  store.open();
  assert.equal(firstStatus.signal.aborted, true);
  assert.equal(client.statusCalls.length, 2);
  const secondStatus = client.statusCalls[1];

  // 第一次请求迟到返回
  firstStatus.resolve({
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable: true,
  });
  await tick();
  // 第一次不应触发 ticket
  assert.equal(client.ticketCalls.length, 0);

  // 第二次请求正常返回
  secondStatus.resolve({
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable: false,
  });
  await tick();

  assert.equal(store.getSnapshot().phase, 'unavailable');
});

test('dispose 彻底释放 listener 与 abort 信号，后续 open 不再发请求', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');
  let listenerCalled = false;
  store.subscribe(() => {
    listenerCalled = true;
  });

  store.open();
  const inFlight = client.statusCalls[0];
  store.dispose();
  assert.equal(inFlight.signal.aborted, true);
  assert.equal(store.getSnapshot().phase, 'idle');

  listenerCalled = false;
  store.open();
  assert.equal(client.statusCalls.length, 1);
  assert.equal(listenerCalled, false);
});

test('getSnapshot 返回引用稳定的快照对象，状态不变时不产生新引用（防 useSyncExternalStore 无限渲染）', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');

  const s1 = store.getSnapshot();
  const s2 = store.getSnapshot();
  assert.strictEqual(s1, s2, '连续读取 getSnapshot 必须保持严格对象相同');

  store.open();
  const loadingSnapshot1 = store.getSnapshot();
  const loadingSnapshot2 = store.getSnapshot();
  assert.notStrictEqual(loadingSnapshot1, s1, '状态转移必须生成新快照引用');
  assert.strictEqual(loadingSnapshot1, loadingSnapshot2, '同一状态内连续读取必须保持引用相同');

  client.statusCalls[0].resolve({
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable: true,
  });
  await tick();
  client.ticketCalls[0].resolve({
    launchPath: '/browser/desktop/launch?ticket=safe_token',
    expiresAt: '2026-10-30T12:00:00Z',
  });
  await tick();

  const readySnapshot1 = store.getSnapshot();
  const readySnapshot2 = store.getSnapshot();
  assert.strictEqual(readySnapshot1.phase, 'ready');
  assert.strictEqual(readySnapshot1, readySnapshot2, '进入 ready 后的连续读取必须保持引用严格相同');
});

test('安全错误文案：不透传 err.message 原文，含敏感 ticket 与 URL 的 ApiError 映射为分类固定文案', async () => {
  const client = createMockBrowserClient();
  const store = createBrowserStore(client, 'https://example.com');

  // 1. 模拟含敏感 ticket 的 401 错误
  store.open();
  client.statusCalls[0].reject(new ApiError(401, 'Unauthorized leak ticket=sensitive_token_123'));
  await tick();
  assert.equal(store.getSnapshot().phase, 'error');
  assert.equal(store.getSnapshot().error, '认证失效，请重新登录');
  assert.doesNotMatch(store.getSnapshot().error, /ticket|sensitive/);

  // 2. 模拟含敏感 URL 的 503 错误
  store.open();
  client.statusCalls[1].resolve({
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable: true,
  });
  await tick();
  client.ticketCalls[0].reject(new ApiError(503, 'Upstream failed connecting to http://secret-vnc:5900/ws?ticket=abc'));
  await tick();
  assert.equal(store.getSnapshot().phase, 'error');
  assert.equal(store.getSnapshot().error, '远程桌面暂不可用，请稍后重试');
  assert.doesNotMatch(store.getSnapshot().error, /secret-vnc|ticket/);

  // 3. 模拟含敏感路径的 500 / 未知错误
  store.open();
  client.statusCalls[2].reject(new ApiError(500, 'Internal Crash at /browser/desktop/launch?ticket=secret_999'));
  await tick();
  assert.equal(store.getSnapshot().phase, 'error');
  assert.equal(store.getSnapshot().error, '连接远程浏览器失败，请检查网络或服务状态');
  assert.doesNotMatch(store.getSnapshot().error, /launch|ticket/);
});
