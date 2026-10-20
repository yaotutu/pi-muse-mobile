import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../src/api/http-client.ts';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const input = { spaceId: 'thread-a', runId: 'run-a', expectedRevision: 'v1', message: { id: 'user-a', content: 'hello' } };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function withFetch(fetcher, action) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await action(); } finally { globalThis.fetch = original; }
}
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

test('会话交换始终匿名，即使活动客户端已有Token也不发送旧凭证', async () => {
  let unauthorized = 0;
  await withFetch(async (url, init) => {
    assert.equal(url, 'https://server-a/api/session');
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { accessKey: 'new-key' });
    return json({ token: 'permanent-token', mode: 'live' });
  }, async () => {
    const api = new HttpApiClient('https://server-a', () => 'old-token', () => unauthorized++);
    assert.equal((await api.createSession('new-key')).token, 'permanent-token');
    assert.equal(unauthorized, 0);
  });
});

test('测试Key被拒绝不触发活动连接的401失效回调', async () => {
  let unauthorized = 0;
  await withFetch(async () => json({ error: 'wrong key' }, 401), async () => {
    const api = new HttpApiClient('https://server-a', () => 'active-token', () => unauthorized++);
    await assert.rejects(api.createSession('wrong-key'), (e) => e.status === 401);
    assert.equal(unauthorized, 0);
  });
});

test('JSON超时只报告连接失败，不清Token且不自动重试写操作', async () => {
  const events = []; let unauthorized = 0; let calls = 0;
  await withFetch((url, init) => {
    calls++;
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(abortError()), { once: true }));
  }, async () => {
    const api = new HttpApiClient('https://server-a', () => 'kept-token', () => unauthorized++, { timeoutMs: 5, onTransportState: (e) => events.push(e) });
    await assert.rejects(api.createGoal({ title: 'one write only' }), (e) => e.status === 408);
    assert.equal(calls, 1);
    assert.equal(unauthorized, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'offline');
    assert.equal(events[0].token, 'kept-token');
  });
});

test('5xx及断网与401分开，业务4xx不误判Token失效', async () => {
  const events = []; let unauthorized = 0;
  const api = new HttpApiClient('https://server-a', () => 'token-a', () => unauthorized++, { onTransportState: (e) => events.push(e) });
  await withFetch(async () => json({ error: 'unavailable' }, 503), async () => assert.rejects(api.getTask('a'), (e) => e.status === 503));
  await withFetch(async () => { throw new TypeError('network down'); }, async () => assert.rejects(api.getTask('a'), (e) => e.status === 0));
  assert.deepEqual(events.map((e) => e.kind), ['offline', 'offline']);
  await withFetch(async () => json({ error: 'forbidden' }, 403), async () => assert.rejects(api.getTask('a'), (e) => e.status === 403));
  assert.equal(events.length, 2);
  assert.equal(unauthorized, 0);
});

test('取消后的迟到401不能触发失效或变成网络失败', async () => {
  const response = deferred(); const events = []; let unauthorized = 0;
  await withFetch(() => response.promise, async () => {
    const api = new HttpApiClient('https://server-a', () => 'old-token', () => unauthorized++, { onTransportState: (e) => events.push(e) });
    const pending = api.getConversation('main');
    api.cancelPending();
    response.resolve(json({ error: 'late unauthorized' }, 401));
    await assert.rejects(pending, (e) => e.name === 'AbortError');
    assert.equal(unauthorized, 0);
    assert.deepEqual(events, []);
  });
});

test('取消后的迟到JSON成功不能标记连接在线', async () => {
  const body = deferred(); const events = [];
  await withFetch(async () => ({ ok: true, status: 200, json: () => body.promise }), async () => {
    const api = new HttpApiClient('https://server-a', () => 'token-a', () => {}, { onTransportState: (e) => events.push(e) });
    const pending = api.getTask('a');
    await new Promise(setImmediate);
    api.cancelPending();
    body.resolve({ task: { id: 'a' }, events: [] });
    await assert.rejects(pending, (e) => e.name === 'AbortError');
    assert.deepEqual(events, []);
  });
});

test('401回调携带请求发送时的Token，而不是后来替换的Token', async () => {
  const response = deferred(); const unauthorized = []; let token = 'token-a';
  await withFetch((url, init) => { assert.equal(init.headers.authorization, 'Bearer token-a'); return response.promise; }, async () => {
    const api = new HttpApiClient('https://server-a', () => token, (sent) => unauthorized.push(sent));
    const pending = api.getTask('a'); token = 'token-b';
    response.resolve(json({ error: 'old token rejected' }, 401));
    await assert.rejects(pending, (e) => e.status === 401);
    assert.deepEqual(unauthorized, ['token-a']);
  });
});

test('暂停阻止新后台请求，恢复可继续；退役客户端不能重新启用', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json({ task: { id: 'a' }, events: [] }); }, async () => {
    const api = new HttpApiClient('https://server-a', () => 'token-a', () => {});
    api.suspend();
    await assert.rejects(api.getTask('a'), (e) => e.name === 'AbortError');
    assert.equal(calls, 0);
    api.resume(); await api.getTask('a'); assert.equal(calls, 1);
    api.retire(); api.resume();
    await assert.rejects(api.getTask('a'), (e) => e.name === 'AbortError');
    assert.equal(calls, 1);
  });
});

test('外部取消的只读请求不会报告离线', async () => {
  const controller = new AbortController(); const events = [];
  await withFetch((url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(abortError()), { once: true })), async () => {
    const api = new HttpApiClient('https://server-a', () => 'token-a', () => {}, { onTransportState: (e) => events.push(e) });
    const pending = api.listSpaces(controller.signal); controller.abort();
    await assert.rejects(pending, (e) => e.name === 'AbortError');
    assert.deepEqual(events, []);
  });
});

test('SSE只限制响应头等待，不中止已经建立的长流', async () => {
  let streamController;
  const body = new ReadableStream({ start(controller) { streamController = controller; } });
  await withFetch(async (url, init) => { assert.equal(init.redirect, 'error'); return new Response(body); }, async () => {
    const api = new HttpApiClient('https://server-a', () => 'token-a', () => {}, { headerTimeoutMs: 5 });
    const events = [];
    const pending = api.runAgent(input, (e) => events.push(e));
    await new Promise((resolve) => setTimeout(resolve, 20));
    streamController.enqueue(new TextEncoder().encode('data: {"type":"RUN_FINISHED"}\n\n'));
    streamController.close(); await pending;
    assert.equal(events[0].type, 'RUN_FINISHED');
    assert.equal(body.locked, false);
  });
});

test('SSE等待响应头超时会报告离线，但不撤销凭证', async () => {
  let unauthorized = 0; const events = [];
  await withFetch((url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(abortError()), { once: true })), async () => {
    const api = new HttpApiClient('https://server-a', () => 'token-a', () => unauthorized++, { headerTimeoutMs: 5, onTransportState: (e) => events.push(e) });
    await assert.rejects(api.runAgent(input, () => {}), (e) => e.status === 408);
    assert.equal(unauthorized, 0);
    assert.equal(events.at(-1).kind, 'offline');
  });
});

test('SSE回调异常归还reader，但不能伪装成网络断连', async () => {
  let cancelled = false; const events = [];
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"RUN_STARTED"}\n\n')); }, cancel() { cancelled = true; } });
  await withFetch(async () => new Response(body), async () => {
    const api = new HttpApiClient('https://server-a', () => 'token-a', () => {}, { onTransportState: (e) => events.push(e) });
    await assert.rejects(api.runAgent(input, () => { throw new Error('UI callback failed'); }), /UI callback failed/);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
    assert.equal(events.filter((e) => e.kind === 'offline').length, 0);
  });
});

test('错误服务/畸形会话和会话列表不能被当成连接成功', async () => {
  const api = new HttpApiClient('https://server-a', () => undefined, () => {});
  for (const payload of [{ token: '', mode: 'live' }, { token: 'bad\r\ntoken', mode: 'live' }, { token: 'token' }]) {
    await withFetch(async () => json(payload), async () => assert.rejects(api.createSession(), (e) => e.status === 502));
  }
  await withFetch(async () => new Response('<html>not Pi Muse</html>'), async () => assert.rejects(api.createSession(), (e) => e.status === 502));
  await withFetch(async () => json({ spaces: [{ id: 'a' }] }), async () => assert.rejects(api.listSpaces(), (e) => e.status === 502));
});
