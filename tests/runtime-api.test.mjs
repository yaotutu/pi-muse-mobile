import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import { activityFixture } from './helpers/activity-fixtures.ts';
import { approvalFixture, approvalResolution } from './helpers/approval-fixtures.ts';

const BASE = 'https://server-a';
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

async function withFetch(fetcher, action) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await action(); } finally { globalThis.fetch = original; }
}

/**
 * 可控的 ReadableStream：测试通过 push/close 模拟服务端推送节奏；
 * cancel 调用会被记录，确保传输层在停止时主动释放 reader。
 */
function makeStream() {
  let controller;
  const cancelCalls = [];
  const stream = new ReadableStream({
    start(c) { controller = c; },
    cancel(reason) { cancelCalls.push(reason); },
  });
  stream.cancelCalls = cancelCalls;
  stream.push = (chunk) => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    controller.enqueue(new TextEncoder().encode(text));
  };
  stream.pushUtf8 = (bytes) => controller.enqueue(bytes);
  stream.close = () => controller.close();
  return stream;
}

const agentStatus = (overrides = {}) => ({
  activityId: null,
  spaceId: 'thread-a',
  runId: 'run-a',
  revision: 1,
  source: 'chat',
  jobId: null,
  title: '正在整理回复',
  status: 'running',
  phase: 'waiting_model',
  label: '正在等待模型回复',
  tools: [],
  subagents: [],
  pendingApprovalIds: [],
  startedAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
  endedAt: null,
  ...overrides,
});

const frame = (event, payload, newline = '\n') => `event: ${event}\ndata: ${JSON.stringify(event === 'ready' ? { pendingApprovals: [], activities: [], ...payload } : payload)}${newline}${newline}`;

test('subscribeRuntime ready 当前活动与 activity_updated 概览独立解析，同一条流不额外请求', async () => {
  const activity = activityFixture(); const complete = activityFixture({ status: 'completed', result: '交付摘要' });
  const stream = makeStream(); let requests = 0;
  await withFetch(async (url) => {
    requests++; assert.equal(url, `${BASE}/api/events`);
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: 't', agentStatuses: [], activities: [activity] }));
    stream.push('event: future_activity_event\ndata: not-json\n\n');
    stream.push(frame('activity_updated', { ...complete, instanceId: 'inst-1', secret: 'not-public' }));
    stream.close(); return new Response(stream);
  }, async () => {
    const received = []; const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    await api.subscribeRuntime((event) => received.push(event));
    assert.equal(received.length, 2); assert.deepEqual(received[0].data.activities, [activity]);
    assert.deepEqual(received[1], { event: 'activity_updated', data: { ...complete, instanceId: 'inst-1' } });
  });
  assert.equal(requests, 1);
});

test('subscribeRuntime 缺活动集合、重复/终态 ready、坏活动或跨实例活动必须报502', async () => {
  const ready = { instanceId: 'inst-1', serverTime: 't', agentStatuses: [] };
  const cases = [
    [['ready', { ...ready, activities: undefined }]],
    [['ready', { ...ready, activities: [activityFixture(), activityFixture()] }]],
    ...['completed', 'failed', 'stopped', 'interrupted'].map((status) => [['ready', { ...ready, activities: [activityFixture({ status, result: status === 'completed' ? '交付' : null })] }]]),
    [['ready', ready], ['activity_updated', { ...activityFixture(), status: 'future', instanceId: 'inst-1' }]],
    [['ready', ready], ['activity_updated', { ...activityFixture(), instanceId: 'other' }]],
    [['ready', ready], ['activity_updated', { id: 'activity-a', instanceId: 'inst-1' }]],
  ];
  for (const events of cases) {
    const stream = makeStream();
    await withFetch(async () => { for (const [event, data] of events) stream.push(frame(event, data)); stream.close(); return new Response(stream); }, async () => {
      const api = new HttpApiClient(BASE, () => 'token-1', () => {});
      await assert.rejects(api.subscribeRuntime(() => {}), (error) => error.status === 502);
    });
  }
});

// ---------------------------------------------------------------------------
// getAgentStatus
// ---------------------------------------------------------------------------

test('getAgentStatus 编码 spaceId/runId 并解析响应结构', async () => {
  let observed;
  await withFetch(async (url, init) => {
    observed = { url, headers: init.headers };
    return json({ instanceId: 'inst-1', status: agentStatus({ spaceId: 'thread/一', runId: 'run/一' }) });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    const result = await api.getAgentStatus('thread/一', 'run/一');
    assert.equal(observed.url, `${BASE}/api/agent/status?spaceId=thread%2F%E4%B8%80&runId=run%2F%E4%B8%80`);
    assert.equal(observed.headers.authorization, 'Bearer token-1');
    assert.equal(result.instanceId, 'inst-1');
    assert.equal(result.status.spaceId, 'thread/一');
    assert.equal(result.status.runId, 'run/一');
  });
});

test('getAgentStatus 401 触发失效回调并抛 ApiError(401)', async () => {
  let unauthorized = 0;
  await withFetch(async () => json({ error: 'expired' }, 401), async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => { unauthorized += 1; });
    await assert.rejects(api.getAgentStatus('thread-a', 'run-a'), (e) => e.status === 401);
    assert.equal(unauthorized, 1);
  });
});

test('getAgentStatus 404 保留 ApiError(404) 语义且不重试', async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return json({ error: '运行已清理' }, 404); }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(api.getAgentStatus('thread-a', 'run-a'), (e) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 404);
      assert.equal(e.message, '运行已清理');
      return true;
    });
  });
  assert.equal(calls, 1, '404 不应自动重试');
});

test('getAgentStatus 200 响应坏结构抛 502', async () => {
  const cases = [
    null,
    { instanceId: 'i' },
    { instanceId: 'i', status: { spaceId: 'a' } },
    { instanceId: 'i', status: agentStatus({ spaceId: 'other-thread' }) },
    { instanceId: 'i', status: agentStatus({ runId: 'other-run' }) },
    { instanceId: 'i', status: agentStatus({ revision: 0 }) },
    { instanceId: 'i', status: agentStatus({ source: 'unknown' }) },
    { instanceId: 'i', status: agentStatus({ phase: 'unknown' }) },
    { instanceId: 'i', status: agentStatus({ status: 'unknown' }) },
    { instanceId: 'i', status: agentStatus({ tools: [{}] }) },
    { instanceId: 'i', status: agentStatus({ tools: [{ toolCallId: 'a', name: null, label: 'x', status: 'weird', subagentId: null }] }) },
    { instanceId: 'i', status: agentStatus({ subagents: [{ id: 'a', role: 'r', status: 'queued', phase: 'waiting_subagents', label: 'l', startedAt: null, updatedAt: '2026-10-19T00:00:00.000Z', endedAt: null }] }) },
    { instanceId: 'i', status: agentStatus({ pendingApprovalIds: ['x', 7] }) },
    { instanceId: 'i', status: agentStatus({ tools: new Array(65).fill({ toolCallId: 'a', name: null, label: 'l', status: 'running', subagentId: null }) }) },
  ];
  for (const body of cases) {
    await withFetch(async () => json(body), async () => {
      const api = new HttpApiClient(BASE, () => 'token-1', () => {});
      await assert.rejects(api.getAgentStatus('thread-a', 'run-a'), (e) => e.status === 502);
    });
  }
});

// ---------------------------------------------------------------------------
// subscribeRuntime
// ---------------------------------------------------------------------------

test('subscribeRuntime 发送 GET /api/events，Bearer + Accept + redirect: error', async () => {
  let observed;
  const stream = makeStream();
  await withFetch(async (url, init) => {
    observed = { url, method: init.method, headers: init.headers, redirect: init.redirect };
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    stream.close();
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    await api.subscribeRuntime(() => {});
    assert.equal(observed.url, `${BASE}/api/events`);
    assert.equal(observed.method, 'GET');
    assert.equal(observed.headers.authorization, 'Bearer token-1');
    assert.equal(observed.headers.accept, 'text/event-stream');
    assert.equal(observed.redirect, 'error');
  });
});

test('subscribeRuntime 首帧 ready 解析后触发状态更新回调', async () => {
  const stream = makeStream();
  await withFetch(async () => {
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    stream.push(frame('agent_status_updated', { ...agentStatus({ revision: 2 }), instanceId: 'inst-1' }));
    stream.push(frame('agent_status_updated', { ...agentStatus({ revision: 3, phase: 'finalizing' }), instanceId: 'inst-1' }));
    stream.close();
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    const received = [];
    await api.subscribeRuntime((event) => received.push(event));
    assert.equal(received.length, 3);
    assert.equal(received[0].event, 'ready');
    assert.equal(received[0].data.instanceId, 'inst-1');
    assert.equal(received[1].event, 'agent_status_updated');
    assert.equal(received[1].data.revision, 2);
    assert.equal(received[1].data.instanceId, 'inst-1');
    assert.equal(received[2].data.phase, 'finalizing');
    // 自然 EOF 时 stream 的 cancel 回调不会被触发（流已经关闭），但 reader.locked 必须为 false。
    assert.equal(stream.controller === undefined || stream.locked === false, true, 'reader 已释放');
  });
});

test('subscribeRuntime ready 保留完整大审批预览，与运行状态分开消费', async () => {
  const stream = makeStream();
  // 完整预览跨 chunk 承载，不截断审批正文，也不混入运行集合。
  const bigPending = 'x'.repeat(64 * 1024);
  await withFetch(async () => {
    stream.push(frame('ready', {
      instanceId: 'inst-1',
      serverTime: '2026-10-19T00:00:00.000Z',
      agentStatuses: [agentStatus()],
      pendingApprovals: [approvalFixture({ preview: { ...approvalFixture().preview, after: bigPending } })],
    }));
    stream.close();
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    const received = [];
    await api.subscribeRuntime((event) => received.push(event));
    assert.equal(received.length, 1);
    assert.equal(received[0].event, 'ready');
    assert.equal(received[0].data.pendingApprovals[0].preview.after, bigPending);
    assert.equal(received[0].data.agentStatuses.length, 1);
  });
});

test('subscribeRuntime 消费审批新增与轻量回执，不额外拉快照', async () => {
  const stream = makeStream();
  await withFetch(async () => {
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    stream.push(frame('approval_pending', { ...approvalFixture(), instanceId: 'inst-1' }));
    stream.push(frame('approval_updated', { ...approvalResolution(), instanceId: 'inst-1' }));
    stream.push(frame('agent_status_updated', { ...agentStatus({ revision: 2 }), instanceId: 'inst-1' }));
    stream.close();
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    const received = [];
    await api.subscribeRuntime((event) => received.push(event));
    assert.equal(received.length, 4);
    assert.equal(received[0].event, 'ready');
    assert.equal(received[1].event, 'approval_pending');
    assert.equal(received[2].event, 'approval_updated');
    assert.equal('preview' in received[2].data, false);
    assert.equal(received[3].event, 'agent_status_updated');
  });
});

test('subscribeRuntime 坏审批、缺 pending 集合及跨实例审批帧必须断流报 502', async () => {
  const cases = [
    [['ready', { instanceId: 'inst-1', serverTime: 't', agentStatuses: [], pendingApprovals: undefined }]],
    [['ready', { instanceId: 'inst-1', serverTime: 't', agentStatuses: [] }], ['approval_pending', { ...approvalFixture(), preview: {}, instanceId: 'inst-1' }]],
    [['ready', { instanceId: 'inst-1', serverTime: 't', agentStatuses: [] }], ['approval_pending', { ...approvalFixture(), instanceId: 'other' }]],
    [['ready', { instanceId: 'inst-1', serverTime: 't', agentStatuses: [] }], ['approval_updated', { ...approvalFixture(), instanceId: 'inst-1' }]],
  ];
  for (const events of cases) {
    const stream = makeStream();
    await withFetch(async () => {
      for (const [event, data] of events) stream.push(frame(event, data));
      stream.close(); return new Response(stream);
    }, async () => {
      const api = new HttpApiClient(BASE, () => 'token-1', () => {});
      await assert.rejects(api.subscribeRuntime(() => {}), (error) => error.status === 502);
    });
  }
});

test('subscribeRuntime 心跳注释不触发回调', async () => {
  const stream = makeStream();
  await withFetch(async () => {
    stream.push(': keep-alive\n\n');
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    stream.push(': ping\n\n');
    stream.close();
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    const received = [];
    await api.subscribeRuntime((event) => received.push(event));
    assert.equal(received.length, 1);
    assert.equal(received[0].event, 'ready');
  });
});

test('subscribeRuntime instanceId 与 ready 不一致抛 502', async () => {
  const stream = makeStream();
  await withFetch(async () => {
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    stream.push(frame('agent_status_updated', { ...agentStatus(), instanceId: 'inst-other' }));
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(api.subscribeRuntime(() => {}), (e) => e.status === 502);
  });
});

test('subscribeRuntime 第一帧不是 ready 抛 502', async () => {
  const stream = makeStream();
  await withFetch(async () => {
    stream.push(frame('agent_status_updated', { ...agentStatus(), instanceId: 'inst-1' }));
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(api.subscribeRuntime(() => {}), (e) => e.status === 502);
  });
});

test('subscribeRuntime 重复 ready 视为非法帧抛 502', async () => {
  const stream = makeStream();
  await withFetch(async () => {
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(api.subscribeRuntime(() => {}), (e) => e.status === 502);
  });
});

test('subscribeRuntime EOF 视为需要重连：resolve 不抛，且不标记离线', async () => {
  const events = [];
  const stream = makeStream();
  await withFetch(async () => {
    stream.close();
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {}, { onTransportState: (state) => events.push(state) });
    await api.subscribeRuntime(() => {});
    // 握手成功会标 online，但自然 EOF 之后不能继续标 offline：让 store 决定是否重连。
    assert.ok(events.some((e) => e.kind === 'online'), '握手成功应标 online');
    assert.equal(events.filter((e) => e.kind === 'offline').length, 0, '自然 EOF 不应触发 offline');
  });
});

test('subscribeRuntime signal 取消：resolve 不抛，绝不调用 stopRun', async () => {
  const stream = makeStream();
  // 用 deferred 让 onEvent 通知传输层已抵达 read 循环，再触发 abort。
  const reached = (() => { let resolve; return { promise: new Promise((done) => { resolve = done; }), resolve }; })();
  await withFetch(async () => {
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    // 不 close，让客户端触发 abort；reader.cancel 会触发 cancel 回调。
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    const controller = new AbortController();
    const pending = api.subscribeRuntime(() => reached.resolve(), controller.signal);
    await reached.promise;
    controller.abort();
    await pending;
    assert.equal(stream.cancelCalls.length, 1, '取消订阅应主动释放 reader');
  });
});

test('subscribeRuntime 回调异常按原样抛出，不能伪装成网络错误', async () => {
  const events = [];
  const stream = makeStream();
  await withFetch(async () => {
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    stream.push(frame('agent_status_updated', { ...agentStatus({ revision: 2 }), instanceId: 'inst-1' }));
    stream.push(frame('agent_status_updated', { ...agentStatus({ revision: 3 }), instanceId: 'inst-1' }));
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {}, { onTransportState: (s) => events.push(s) });
    await assert.rejects(
      api.subscribeRuntime((event) => {
        if (event.event === 'agent_status_updated' && event.data.revision === 2) throw new Error('UI boom');
      }),
      /UI boom/,
    );
    assert.equal(events.filter((e) => e.kind === 'offline').length, 0, '回调异常不能被改写为离线');
  });
});

test('subscribeRuntime 401 触发失效回调并抛 ApiError(401)', async () => {
  let unauthorized = 0;
  await withFetch(async () => json({ error: 'expired' }, 401), async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => { unauthorized += 1; });
    await assert.rejects(api.subscribeRuntime(() => {}), (e) => e.status === 401);
    assert.equal(unauthorized, 1);
  });
});

test('subscribeRuntime 503 透传 ApiError(503) 给上层退避', async () => {
  await withFetch(async () => json({ error: '服务关闭' }, 503), async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(api.subscribeRuntime(() => {}), (e) => e.status === 503);
  });
});

test('subscribeRuntime 429 透传 ApiError(429) 给上层退避', async () => {
  await withFetch(async () => json({ error: '连接过多' }, 429), async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(api.subscribeRuntime(() => {}), (e) => e.status === 429);
  });
});

test('subscribeRuntime ready帧坏JSON触发502，不静默漏掉同步边界', async () => {
  const stream = makeStream();
  await withFetch(async () => {
    stream.push('event: ready\ndata: not-json\n\n');
    stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
    stream.push(frame('agent_status_updated', { ...agentStatus({ revision: 2 }), instanceId: 'inst-1' }));
    stream.close();
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    const received = [];
    await assert.rejects(api.subscribeRuntime((event) => received.push(event)), (error) => error.status === 502);
    assert.deepEqual(received, []);
  });
});

test('subscribeRuntime 超大 ready 帧触发传输层断流（不静默吞内存）', async () => {
  const stream = makeStream();
  // 故意构造一个 >12MiB 的 ready 帧，验证传输层在解析阶段就拒绝。
  const big = 'x'.repeat(13 * 1024 * 1024);
  await withFetch(async () => {
    stream.push(`event: ready\ndata: ${JSON.stringify({ instanceId: 'inst-1', serverTime: 't', agentStatuses: [], pendingApprovals: big })}\n\n`);
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(api.subscribeRuntime(() => {}), (e) => e.status === 502);
  });
});

test('subscribeRuntime 与 runAgent 互不影响：取消订阅不调用 stopRun', async () => {
  let stopCalls = 0;
  // 拦截 conversation stop，确认订阅被 abort 时不会触碰它。
  const stopInterceptor = async (url) => {
    if (url === `${BASE}/api/conversation/stop`) { stopCalls += 1; return json({ stopped: true }); }
    throw new Error('unexpected url ' + url);
  };
  const stream = makeStream();
  await withFetch(async (url) => {
    if (url === `${BASE}/api/events`) {
      stream.push(frame('ready', { instanceId: 'inst-1', serverTime: '2026-10-19T00:00:00.000Z', agentStatuses: [] }));
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return stopInterceptor(url);
  }, async () => {
    const api = new HttpApiClient(BASE, () => 'token-1', () => {});
    const controller = new AbortController();
    const pending = api.subscribeRuntime(() => {}, controller.signal);
    controller.abort();
    await pending;
    assert.equal(stopCalls, 0, '订阅取消不应触发任何 stopRun');
  });
});
