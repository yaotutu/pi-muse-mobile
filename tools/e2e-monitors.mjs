/**
 * 真实网页监控 HTTP/状态机验收。专用空间与 URL 标记只清理本轮数据；
 * 不拦截响应、不使用替身，模型创建也走真实 AG-UI SSE 与外部模型。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import { parseMonitor } from '../src/api/monitor-contracts.ts';
import { MonitorStore } from '../src/monitors/monitor-store.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required for dedicated live writes');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicit confirmed real E2E_API_BASE_URL required');
const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-monitors-e2e-run.'));
const stamp = Date.now().toString(36);
const marker = `MONITORS_E2E_${stamp}`;
const spaceId = `monitors-e2e-${stamp}`;
const fixtureUrls = new Set([
  `https://example.com/?${marker}-fixture-a`,
  `https://example.com/?${marker}-fixture-b`,
  `https://example.com/?${marker}-fixture-c`,
]);
const modelUrl = `https://example.com/?${marker}-model`;

let token;
let baselineMonitors;
let baselineIds = new Set();
let spaceMayExist = false;
let activeRun;
let initialVersion;
let failure;
let controlId;
let externalId;
let modelId;
let fixtureA;
let fixtureB;
let fixtureC;
let modelMonitor;
const ownIds = new Set();
const checks = [];

const api = new HttpApiClient(base, () => token, () => { throw new Error('Real authentication rejected'); });
const store = new MonitorStore(api);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const pass = (name, extra = {}) => {
  checks.push({ name, ...extra });
  console.log('PASS', name);
};
const phase = (name, extra = {}) => write('context.json', { phase: name, base, marker, spaceId, controlId, externalId, modelId, ...extra });

async function until(predicate, label, timeout = 300_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}`);
}

async function deployment(suffix) {
  const [html, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, path);
    return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(html.includes('/openapi.json'));
  assert.equal(health.ok, true);
  assert.equal(health.backend, 'pi');
  assert.equal(health.configured, true);
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  for (const [path, methods] of Object.entries({
    '/api/monitors': ['get', 'post'],
    '/api/monitors/{id}': ['get', 'delete'],
    '/api/monitors/{id}/control': ['post'],
  })) {
    for (const method of methods) assert.ok(schema.paths[path]?.[method], `${method} ${path}`);
  }
  write(`deployment-${suffix}.json`, { serviceVersion: health.serviceVersion, monitorsApi: Object.fromEntries(Object.entries(schema.paths).filter(([path]) => path.includes('/monitors'))) });
  return health.serviceVersion;
}

function isOwn(monitor) {
  return !baselineIds.has(monitor.id) && (
    monitor.originSpaceId === spaceId || fixtureUrls.has(monitor.url) || monitor.url === modelUrl
  );
}

async function postFixture(url, title) {
  // ApiClient 有意不暴露创建入口；夹具仅用权威 REST POST，响应仍走生产白名单解析。
  spaceMayExist = true;
  const response = await fetch(`${base}/api/monitors`, {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify({ url, title, condition: 'change', intervalMinutes: 5, originSpaceId: spaceId }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`Fixture creation failed with HTTP ${response.status}`);
  const monitor = parseMonitor(payload);
  ownIds.add(monitor.id);
  return monitor;
}

function assertSorted(list, sort, order) {
  for (let index = 1; index < list.length; index++) {
    const left = list[index - 1];
    const right = list[index];
    const a = left[sort];
    const b = right[sort];
    // 服务端契约把未检查时间固定排在最后；不能按普通 nulls-first/nulls-last 语义猜方向。
    if (a === undefined) {
      assert.equal(b, undefined, `Real ${sort}/${order} order: undefined must be last`);
      continue;
    }
    if (b === undefined) continue;
    const compared = a.localeCompare(b);
    assert.ok(order === 'asc' ? compared <= 0 : compared >= 0, `Real ${sort}/${order} order`);
    if (compared === 0) assert.ok(left.id.localeCompare(right.id) <= 0, 'Real tie-break id order');
  }
}

async function storeLoaded() {
  await until(() => !store.getSnapshot().loading && store.getSnapshot().loaded, 'MonitorStore list load');
  assert.equal(store.getSnapshot().error, undefined);
}

async function storeStatus(id, status) {
  await until(() => {
    const snapshot = store.getSnapshot();
    return !snapshot.loading && snapshot.monitors.some((monitor) => monitor.id === id && monitor.status === status);
  }, `MonitorStore status ${status}`);
}

async function runModelCreate() {
  const before = new Set((await api.listMonitors({ spaceId })).map((monitor) => monitor.id));
  const history = await api.getConversation(spaceId);
  const runId = `monitors-e2e-model-${stamp}`;
  activeRun = runId;
  const eventTypes = [];
  const tools = [];
  const toolResults = [];
  let runError;
  await api.runAgent({
    spaceId,
    runId,
    expectedRevision: history.revision,
    message: {
      id: `${runId}-message`,
      content: `Use the monitor tool exactly once now to create exactly ONE new monitor with action="create", url="${modelUrl}", condition="change", intervalMinutes=5. You may omit title. Do not list, pause, resume, stop, create any other monitor, or change any existing data. After the tool succeeds, reply briefly.`,
    },
  }, (event) => {
    eventTypes.push(event.type);
    if (event.type === 'TOOL_CALL_START') tools.push(event.toolCallName);
    if (event.type === 'TOOL_CALL_RESULT') toolResults.push({ toolCallId: event.toolCallId, content: event.content });
    if (event.type === 'RUN_ERROR') runError = event.message ?? event.code;
  }, AbortSignal.timeout(300_000));
  activeRun = undefined;
  assert.equal(runError, undefined, `Real model run failed: ${runError}`);
  assert.ok(eventTypes.includes('RUN_STARTED'));
  assert.ok(eventTypes.includes('RUN_FINISHED'));

  const created = (await api.listMonitors({ spaceId, sort: 'createdAt', order: 'asc' }))
    .filter((monitor) => !before.has(monitor.id));
  if (created.length !== 1) {
    write('model-creation-failure.json', { eventTypes, tools, toolResults, created, before: [...before] });
  }
  assert.equal(created.length, 1, 'Real model must create exactly one dedicated monitor');
  modelMonitor = created[0];
  modelId = modelMonitor.id;
  ownIds.add(modelId);
  assert.equal(modelMonitor.url, modelUrl);
  assert.equal(modelMonitor.originSpaceId, spaceId);
  assert.equal(modelMonitor.condition, 'change');
  assert.equal(modelMonitor.status, 'active');
  assert.ok(modelMonitor.title.length > 0, 'Server defaults omitted titles to URL; empty title is malformed');
  assert.deepEqual(await api.getMonitor(modelId), modelMonitor);

  const conversation = await api.getConversation(spaceId);
  const userIndex = conversation.messages.findIndex((message) => message.id === `${runId}-message`);
  assert.ok(userIndex >= 0 && conversation.messages[userIndex].content?.includes(modelUrl), 'Persisted history must contain the exact user request');
  const reply = conversation.messages.slice(userIndex + 1).find((message) => message.role === 'assistant' && message.content);
  assert.ok(reply, 'Persisted history must contain the visible model reply');
  // 工具原始参数/结果可能被服务端隐藏策略折叠；这里只保留实际可见事件作证据，不伪造或强求原始投影。
  write('model-run.json', {
    runId,
    eventTypes,
    visibleTools: tools,
    visibleToolResults: toolResults,
    monitor: modelMonitor,
    visibleReply: reply,
  });
  pass('real external model creates exactly one persistent monitor with visible request/reply', { id: modelId, visibleToolEvents: tools.length });
}

try {
  initialVersion = await deployment('start');
  pass('current docs/OpenAPI/health identity agrees', { serviceVersion: initialVersion });

  const auth = await api.createSession(process.env.E2E_ACCESS_KEY);
  assert.equal(auth.mode, 'live', 'Real model backend is required');
  token = auth.token;

  const missingHistory = await api.getConversation(spaceId);
  assert.deepEqual(missingHistory, { messages: [], revision: 'empty' });
  baselineMonitors = await api.listMonitors();
  baselineIds = new Set(baselineMonitors.map((monitor) => monitor.id));
  const baselineSpaces = (await api.listSpaces()).map((space) => space.id);
  assert.ok(!baselineSpaces.includes(spaceId));
  assert.ok(!baselineMonitors.some((monitor) => monitor.originSpaceId === spaceId || monitor.url.includes(marker)));
  pass('dedicated space starts absent with empty revision and no marker data', { baselineCount: baselineMonitors.length });

  phase('fixtures');
  fixtureA = await postFixture([...fixtureUrls][0], `${marker}-fixture-a`);
  await until(async () => (await api.getMonitor(fixtureA.id)).lastCheckedAt !== undefined, 'real monitor scheduler first check', 95_000);
  await sleep(5);
  fixtureB = await postFixture([...fixtureUrls][1], `${marker}-fixture-b`);
  await sleep(5);
  fixtureC = await postFixture([...fixtureUrls][2], `${marker}-fixture-c`);
  controlId = fixtureC.id;
  externalId = fixtureB.id;
  assert.deepEqual(new Set((await api.listMonitors({ spaceId })).map((monitor) => monitor.id)), new Set([fixtureA.id, fixtureB.id, fixtureC.id]));
  pass('real REST fixtures bind one dedicated space and first check persists lastCheckedAt');

  await runModelCreate();
  const scoped = await api.listMonitors({ spaceId });
  assert.deepEqual(new Set(scoped.map((monitor) => monitor.id)), ownIds);
  assert.ok((await api.listMonitors()).some((monitor) => ownIds.has(monitor.id)));
  for (const sort of ['createdAt', 'lastCheckedAt', 'status']) {
    for (const order of ['asc', 'desc']) {
      const sorted = await api.listMonitors({ spaceId, sort, order });
      assert.deepEqual(new Set(sorted.map((monitor) => monitor.id)), ownIds);
      assertSorted(sorted, sort, order);
    }
  }
  const details = await Promise.all([...ownIds].map((id) => api.getMonitor(id)));
  for (const detail of details) assert.deepEqual(detail, scoped.find((monitor) => monitor.id === detail.id));
  pass('actual HttpApiClient consumes nonempty scoped list, details and all six sort directions');

  phase('store');
  store.setActive(true);
  store.setQuery({ spaceId, sort: 'createdAt', order: 'desc' });
  store.open();
  await storeLoaded();
  assert.deepEqual(new Set(store.getSnapshot().monitors.map((monitor) => monitor.id)), ownIds);
  pass('actual MonitorStore loads the real scoped list');

  assert.equal(await store.control(controlId, 'pause'), true);
  await storeStatus(controlId, 'paused');
  assert.equal(await store.control(controlId, 'resume'), true);
  await storeStatus(controlId, 'active');
  assert.equal(await store.control(controlId, 'stop'), true);
  await storeStatus(controlId, 'stopped');
  assert.equal(await store.control(controlId, 'resume'), false);
  await assert.rejects(api.controlMonitor(controlId, 'resume'), (error) => error instanceof ApiError && error.status === 409);
  store.setQuery({ spaceId, sort: 'status', order: 'asc' });
  await storeLoaded();
  assertSorted([...store.getSnapshot().monitors], 'status', 'asc');
  pass('pause/resume/stop persists through store; stopped is terminal and server resume returns409');

  store.requestDelete(controlId);
  assert.equal(store.getSnapshot().deleteTarget?.id, controlId);
  store.cancelDelete();
  assert.equal(store.getSnapshot().deleteTarget, undefined);
  assert.equal((await api.getMonitor(controlId)).status, 'stopped');
  pass('cancelled delete confirmation sends no request and retains real record');

  await api.deleteMonitor(externalId);
  await assert.rejects(api.getMonitor(externalId), (error) => error instanceof ApiError && error.status === 404);
  assert.ok(store.getSnapshot().monitors.some((monitor) => monitor.id === externalId));
  assert.equal(store.getSnapshot().stale, false);
  store.invalidate();
  await storeLoaded();
  assert.ok(!store.getSnapshot().monitors.some((monitor) => monitor.id === externalId));
  pass('real detail404 retains old store data until explicit refresh');

  store.requestDelete(controlId);
  assert.equal(await store.confirmDelete(), true);
  await until(() => !store.getSnapshot().loading && !store.getSnapshot().monitors.some((monitor) => monitor.id === controlId), 'confirmed delete refresh');
  await assert.rejects(api.getMonitor(controlId), (error) => error instanceof ApiError && error.status === 404);
  pass('confirmed store deletion removes only the selected real monitor');

  phase('lifecycle');
  const retained = new Set(store.getSnapshot().monitors.map((monitor) => monitor.id));
  store.setActive(false);
  assert.equal(store.getSnapshot().loading, false);
  assert.equal(store.getSnapshot().stale, true);
  assert.deepEqual(new Set(store.getSnapshot().monitors.map((monitor) => monitor.id)), retained);
  store.setActive(true);
  await storeLoaded();
  store.close();
  assert.equal(store.getSnapshot().loading, false);
  assert.equal(store.getSnapshot().stale, true);
  assert.deepEqual(new Set(store.getSnapshot().monitors.map((monitor) => monitor.id)), retained);
  store.open();
  await storeLoaded();
  pass('background/close retain real data and mark stale; foreground/open refresh without polling');

  phase('done');
  pass('real monitor management chain completed');
} catch (error) {
  failure = error;
  phase('failed', { error: error.message });
  console.error('FAIL', error.stack);
} finally {
  store.dispose();
  try {
    if (activeRun) await api.stopRun(spaceId, activeRun).catch(() => undefined);
    if (baselineMonitors) {
      const current = await api.listMonitors();
      const own = current.filter(isOwn);
      for (const monitor of own) {
        if (monitor.title.startsWith('monitors-native-')) throw new Error('Refusing cleanup of monitors-native fixture');
        await api.deleteMonitor(monitor.id).catch((error) => {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        });
      }
      if (spaceMayExist) {
        await api.deleteSpace(spaceId).catch((error) => {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        });
      }
      const remaining = await api.listMonitors();
      assert.ok(!remaining.some(isOwn));
      write('cleanup.json', { baselineCount: baselineMonitors.length, removedCount: own.length, remainingCount: remaining.length });
      pass('cleanup removes only dedicated monitors/space; baseline data untouched by cleanup');
    }
    if (initialVersion) {
      assert.deepEqual(await deployment('end'), initialVersion);
      pass('deployment identity unchanged throughout real acceptance');
    }
  } catch (error) {
    failure ??= error;
    console.error('FAIL cleanup/audit', error.message);
  }
  token = undefined;
  write('results.json', {
    passed: !failure,
    base,
    marker,
    spaceId,
    checks,
    error: failure?.message,
    completedAt: new Date().toISOString(),
  });
  console.log('Evidence:', output);
}

if (failure) process.exitCode = 1;
