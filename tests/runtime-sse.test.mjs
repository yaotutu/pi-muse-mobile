import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeSseParser, RuntimeSseParseError, decodeRuntimeFrame } from '../src/runtime/sse.ts';

const frame = (event, payload, newline = '\n') => `event: ${event}\ndata: ${JSON.stringify(payload)}${newline}${newline}`;

// 模拟调用方把 rest 原样拼到下个 chunk；不依赖 fetch/decoder/服务端实现。
const parseChunks = (chunks, limits) => {
  const parser = new RuntimeSseParser(limits);
  const all = [];
  for (const chunk of chunks) {
    for (const out of parser.push(chunk)) all.push(out);
  }
  for (const out of parser.end()) all.push(out);
  return all;
};

test('标准 event/data 帧按到达顺序解析，未闭合尾部留给下一段', () => {
  const ready = { instanceId: 'i1', serverTime: 't', agentStatuses: [] };
  const status = { instanceId: 'i1', spaceId: 'a', runId: 'b', revision: 2, source: 'chat', jobId: null, title: 't', status: 'running', phase: 'waiting_model', label: 'l', tools: [], subagents: [], pendingApprovalIds: [], startedAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', endedAt: null };
  const tail = 'event: agent_status_updated\ndata: {"instance';
  const out = new RuntimeSseParser().push(frame('ready', ready) + frame('agent_status_updated', status) + tail);
  assert.equal(out.length, 2);
  assert.equal(out[0].event, 'ready');
  assert.equal(JSON.parse(out[0].data).instanceId, 'i1');
  assert.equal(out[1].event, 'agent_status_updated');
  // 残尾交给下一次 push。
  const rest = new RuntimeSseParser().push(frame('ready', ready) + tail);
  assert.equal(rest.length, 1);
  assert.equal(rest[0].event, 'ready');
  // 把残尾补完，再 push 完整剩余部分。
  const parser = new RuntimeSseParser();
  parser.push(frame('ready', ready) + tail);
  const finished = parser.push('Id":"i1","spaceId":"a","runId":"b","revision":2}\n\n');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].event, 'agent_status_updated');
});

test('CRLF 与 LF 帧尾都能正确闭合', () => {
  const ready = { instanceId: 'i1', serverTime: 't', agentStatuses: [] };
  const crlf = frame('ready', ready, '\r\n');
  assert.deepEqual(new RuntimeSseParser().push(crlf), [{ event: 'ready', data: JSON.stringify(ready) }]);
});

test('每个 chunk 切分位置都不能丢失或重复事件', () => {
  const ready = { instanceId: 'i1', serverTime: 't', agentStatuses: [] };
  const status = { instanceId: 'i1', spaceId: 'a', runId: 'b', revision: 2, source: 'chat', jobId: null, title: 't', status: 'running', phase: 'waiting_model', label: 'l', tools: [], subagents: [], pendingApprovalIds: [], startedAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', endedAt: null };
  const stream = frame('ready', ready, '\r\n') + frame('agent_status_updated', status) + frame('ready', ready);
  for (let split = 0; split <= stream.length; split += 1) {
    assert.equal(parseChunks([stream.slice(0, split), stream.slice(split)]).length, 3, `split=${split}`);
  }
});

test('UTF-8 多字节字符跨 chunk 仍能完整闭合', () => {
  const ready = { instanceId: 'i1', serverTime: '中文时间', agentStatuses: [] };
  const stream = frame('ready', ready);
  // 把 UTF-8 字节流按字节切分，模拟网络层零散到达；TextDecoder 在第二次 decode 时落盘残留字节。
  const bytes = new TextEncoder().encode(stream);
  for (let split = 1; split < bytes.length; split += 1) {
    const decoder = new TextDecoder();
    const a = decoder.decode(bytes.slice(0, split), { stream: true });
    const b = decoder.decode(bytes.slice(split));
    const out = parseChunks([a, b]);
    assert.equal(out.length, 1, `split=${split}`);
    assert.equal(out[0].event, 'ready');
    assert.equal(JSON.parse(out[0].data).serverTime, '中文时间');
  }
});

test('心跳行（: keep-alive）和注释行被忽略', () => {
  const ignored = ': keep-alive\r\n: another comment\r\n\r\n';
  assert.deepEqual(new RuntimeSseParser().push(ignored), []);
});

test('id/retry 元数据不影响解析结果', () => {
  const stream = 'id: 42\nretry: 1000\nevent: ping\ndata: {"v":1}\n\n';
  assert.deepEqual(new RuntimeSseParser().push(stream), [{ event: 'ping', data: '{"v":1}' }]);
});

test('多 data 行按 SSE 规范用 \\n 拼接为单个 JSON 文档', () => {
  const stream = 'event: ready\ndata: {"instanceId":"i1",\ndata: "serverTime":"t","agentStatuses":[]}\n\n';
  const out = new RuntimeSseParser().push(stream);
  assert.equal(out.length, 1);
  assert.equal(out[0].event, 'ready');
  assert.equal(JSON.parse(out[0].data).instanceId, 'i1');
});

test('空 data 行（仅有 event）解析为 data="" 的事件，由上层分派层忽略', () => {
  // SSE 规范：仅有 event: 而没有 data: 的帧视为空数据事件；解析器保留原始结构，
  // 上层 decodeRuntimeFrame 会按 event/data 名称分派并最终跳过未知/空内容。
  const stream = 'event: ping\n\n';
  assert.deepEqual(new RuntimeSseParser().push(stream), [{ event: 'ping', data: '' }]);
});

test('没有 event 字段的纯 data 行：分派层会忽略，解析器原样保留', () => {
  // 解析器职责：输出 {event: '', data: ...}；上层 decodeRuntimeFrame 会丢弃。
  const stream = 'data: {"v":1}\n\n';
  assert.deepEqual(new RuntimeSseParser().push(stream), [{ event: '', data: '{"v":1}' }]);
});

test('ready 帧超过 12MiB 上限抛 RuntimeSseParseError(oversize)', () => {
  const parser = new RuntimeSseParser({ readyBytes: 12 * 1024 * 1024, otherBytes: 8 * 1024 * 1024 });
  const bigData = 'x'.repeat(12 * 1024 * 1024 + 1);
  assert.throws(() => parser.push(`event: ready\ndata: ${bigData}\n\n`), (e) => {
    assert.ok(e instanceof RuntimeSseParseError);
    assert.equal(e.kind, 'oversize');
    return true;
  });
});

test('非 ready 帧超过 8MiB 上限抛 RuntimeSseParseError(oversize)', () => {
  const parser = new RuntimeSseParser({ readyBytes: 12 * 1024 * 1024, otherBytes: 8 * 1024 * 1024 });
  const bigData = 'x'.repeat(8 * 1024 * 1024 + 1);
  assert.throws(() => parser.push(`event: agent_status_updated\ndata: ${bigData}\n\n`), (e) => {
    assert.ok(e instanceof RuntimeSseParseError);
    assert.equal(e.kind, 'oversize');
    return true;
  });
});

test('未闭合帧累计超过 otherBytes 也抛 oversize，避免半截帧积压', () => {
  const parser = new RuntimeSseParser({ readyBytes: 12 * 1024 * 1024, otherBytes: 1024 });
  // 一个永远不闭合的帧；分两段推送，每段都不到 otherBytes，但总长超过。
  const head = 'event: agent_status_updated\ndata: ' + 'a'.repeat(700);
  const tail = 'b'.repeat(700);
  parser.push(head);
  assert.throws(() => parser.push(tail), (e) => {
    assert.ok(e instanceof RuntimeSseParseError);
    assert.equal(e.kind, 'oversize');
    return true;
  });
});

test('end() 丢弃未闭合尾部，不合成事件', () => {
  const parser = new RuntimeSseParser();
  parser.push(frame('ready', { instanceId: 'i1', serverTime: 't', agentStatuses: [] }));
  parser.push('event: agent_status_updated\ndata: {"v":1');
  assert.deepEqual(parser.end(), []);
});

test('decodeRuntimeFrame：ready/agent_status_updated 解码为 RuntimeEvent，未知事件返回 null', () => {
  const readyFrame = { event: 'ready', data: JSON.stringify({ instanceId: 'i1', serverTime: 't', agentStatuses: [] }) };
  const out = decodeRuntimeFrame(readyFrame);
  assert.equal(out.event, 'ready');
  assert.equal(out.data.instanceId, 'i1');
  const unknown = decodeRuntimeFrame({ event: 'future_event', data: '{}' });
  assert.equal(unknown, null);
  // 无 event 字段的事件：分派层直接忽略。
  assert.equal(decodeRuntimeFrame({ event: '', data: '{}' }), null);
});

test('decodeRuntimeFrame：坏 JSON 必须报错并重新同步，不能静默漏状态', () => {
  assert.throws(() => decodeRuntimeFrame({ event: 'ready', data: 'not-json' }), (error) => error.kind === 'invalid_json');
  assert.throws(() => decodeRuntimeFrame({ event: 'agent_status_updated', data: '{]' }), (error) => error.kind === 'invalid_json');
});

test('decodeRuntimeFrame：data 不是对象时拒绝', () => {
  for (const data of ['123', '"a"', '[]', 'null']) {
    assert.throws(() => decodeRuntimeFrame({ event: 'ready', data }), (error) => error.kind === 'invalid_json');
  }
});

test('ready未闭合大帧按ready上限接纳，UTF-8上限使用字节而不是字符', () => {
  const parser = new RuntimeSseParser({ readyBytes: 200, otherBytes: 50 });
  parser.push('event: ready\ndata: ' + 'a'.repeat(60));
  assert.equal(parser.push('\n\n').length, 1);
  const multibyte = new RuntimeSseParser({ readyBytes: 100, otherBytes: 100 });
  assert.throws(() => multibyte.push('event: ready\ndata: ' + '中'.repeat(40) + '\n\n'), (error) => error.kind === 'oversize');
});

test('解析器不预先替换换行符，CRLF/LF/CR 都能在帧内任意位置出现', () => {
  // 手工构造一个内部混用换行符的 frame。
  const stream = 'event: ready\r\ndata: {"a":1}\n\n';
  const out = new RuntimeSseParser().push(stream);
  assert.equal(out.length, 1);
  assert.equal(out[0].event, 'ready');
  assert.deepEqual(JSON.parse(out[0].data), { a: 1 });
});

test('一帧内多个相同字段保留最后一个（event: 行为与规范一致）', () => {
  // SSE 规范要求：相同字段重复出现按"最后一个"处理；这里 event 重写也能解析。
  const stream = 'event: ready\nevent: agent_status_updated\ndata: {"v":1}\n\n';
  const out = new RuntimeSseParser().push(stream);
  assert.equal(out.length, 1);
  assert.equal(out[0].event, 'agent_status_updated');
});
