/**
 * 真实服务 + 已连接 Android 模拟器的活动主线验收，不拦截 HTTP/SSE，不直接写活动。
 * 模型只在本轮专用会话内登记工作；finally 通过 DELETE 清理，Token 永不落盘。
 * 运行前启动最终源码的 Metro8082，并让 Expo Go 连接同一个真实服务。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ActivityStore } from '../src/activities/activity-store.ts';
import { RuntimeStore } from '../src/runtime/runtime-store.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Set E2E_ALLOW_LIVE=1 to authorize real model calls in a dedicated, automatically deleted session');
assert.ok(process.env.E2E_API_BASE_URL, 'E2E_API_BASE_URL must explicitly select the confirmed real server');
const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-activity-e2e-run.'));
const stamp = Date.now().toString(36);
const spaceId = `activity-e2e-${stamp}`;
const title = `ACTIVITY_E2E_${stamp}`;
const secondTitle = `ACTIVITY_SECOND_${stamp}`;
const delivery = `DELIVERED_${stamp}`;
const checks = []; const runs = []; const ownActivityIds = [];
let token; let created = false; let baseline = []; let initialVersion; let failure; let driver; let driverExit;
const api = new HttpApiClient(base, () => token, () => { throw new Error('Real service rejected authentication'); });
const activities = new ActivityStore(api);
const runtime = new RuntimeStore(api, { onEvent: activities.receive, onConnection: activities.setConnection });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (name, data = {}) => { checks.push({ name, ...data }); console.log('PASS', name); };
function write(name, data) { writeFileSync(join(output, name), JSON.stringify(data, null, 2)); }
function phase(name, data = {}) { write('context.json', { phase: name, base, spaceId, title, secondTitle, delivery, ...data }); }
async function until(predicate, label, timeout = 120_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; if (driverExit !== undefined && driverExit !== 0) throw new Error('Native driver failed; see native-results.json'); await sleep(200); }
  throw new Error(`Timed out: ${label}`);
}
async function docs(suffix) {
  const [html, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    assert.equal(response.status, 200, path); return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(html.includes('/openapi.json')); assert.equal(health.ok, true);
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  assert.ok(schema.paths['/api/activities']?.get && schema.paths['/api/activities/{id}']?.get);
  write(`deployment-${suffix}.json`, { serviceVersion: health.serviceVersion, activityApi: schema.paths['/api/activities'], detailApi: schema.paths['/api/activities/{id}'] });
  return health.serviceVersion;
}
async function run(message) {
  const history = await api.getConversation(spaceId); const runId = `activity-run-${stamp}-${runs.length + 1}`;
  const item = { runId, eventTypes: [], tools: [], settled: false }; runs.push(item);
  item.promise = api.runAgent({ spaceId, runId, expectedRevision: history.revision, message: { id: `message-${runId}`, content: message } }, (event) => {
    item.eventTypes.push(event.type);
    if (event.type === 'TOOL_CALL_START') item.tools.push(event.toolCallName);
    if (event.type === 'RUN_ERROR') item.error = event.message ?? event.code ?? 'RUN_ERROR';
  }).catch((e) => { item.error = e.message; }).finally(() => { item.settled = true; });
  await until(() => item.settled, 'real chat run finishes', 150_000);
  assert.equal(item.error, undefined, `Real model run failed: ${item.error}`);
  assert.ok(item.eventTypes.includes('RUN_FINISHED')); return item;
}
async function storeList() {
  activities.refresh(); await until(() => !activities.getSnapshot().loading, 'real activity list read');
  assert.equal(activities.getSnapshot().error, undefined); return activities.getSnapshot().activities;
}
async function detail(id) {
  activities.select(id); await until(() => !activities.getSnapshot().detailLoading, 'real activity detail read');
  assert.equal(activities.getSnapshot().detailError, undefined); return activities.getSnapshot().detail;
}
try {
  const adb = process.env.ADB ?? join(homedir(), 'Library/Android/sdk/platform-tools/adb');
  const target = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : ['-e'];
  assert.equal(execFileSync(adb, [...target, 'get-state'], { encoding: 'utf8' }).trim(), 'device', 'A dedicated Android emulator must already be connected');
  execFileSync('python3', ['-c', 'import xml.etree.ElementTree']);
  const metro = await fetch('http://127.0.0.1:8082/status', { signal: AbortSignal.timeout(5000) });
  assert.match(await metro.text(), /packager-status:running/); record('Android, Python and Metro preflight before real model calls');
  initialVersion = await docs('start'); record('docs, OpenAPI and deployment identity match', { serviceVersion: initialVersion });
  const auth = await api.createSession(process.env.E2E_ACCESS_KEY); assert.equal(auth.mode, 'live'); token = auth.token;
  baseline = (await api.listSpaces()).map((t) => t.id);
  // 此 API 创建专用会话；不动设备凭据、不改用户已有规则和会话。
  await api.saveSpaceInstructions(spaceId, 'Dedicated mobile activity history acceptance only. Register only the explicitly requested activities. Only use the activity lifecycle tool and currentTime. Never use files, shared workspaces, subagents, jobs, monitors, goals or memories. Stage one must leave work unfinished until an explicit continuation. Never call a completion tool before actually delivering the requested final summary.'); created = true;
  activities.setActive(true); runtime.setActive(true);
  await until(() => runtime.getSnapshot().connection === 'live', 'shared workspace SSE ready', 20_000);
  activities.open({ spaceId }); assert.deepEqual(await storeList(), []); record('dedicated empty list is actual HTTP data');
  const first = await run(`Begin a TWO-STAGE work item titled exactly ${title}. Explicitly register it with your activity lifecycle tool now, with goal "Verify two-stage execution history" and deliverable "A final summary containing ${delivery}". In this first stage call currentTime exactly once, report the observed time, and END THIS TURN with the work still unfinished. Do not complete the activity, do not ask for missing information or mark waiting_user. Wait for my explicit continuation before the second stage and final delivery.`);
  let list = await storeList(); assert.equal(list.length, 1, 'model must explicitly register exactly one activity');
  const id = list[0].id; ownActivityIds.push(id);
  assert.equal(list[0].title, title); assert.equal(list[0].status, 'awaiting_continuation'); assert.deepEqual(list[0].runIds, [first.runId]);
  const incomplete = await detail(id); assert.ok(incomplete.steps.some((s) => s.kind === 'execution')); assert.ok(incomplete.steps.some((s) => s.kind === 'tool')); assert.ok(incomplete.steps.some((s) => s.kind === 'model'));
  assert.equal(incomplete.activity.result, null); write('incomplete.json', incomplete);
  record('real tool/model/execution steps; run success does not complete work', { activityId: id, runId: first.runId });

  // 原生驱动读取实际 UI；上下文不含 Token，失败截图不包含聊天原始载荷。
  phase('incomplete', { id });
  driver = spawn('python3', [new URL('./e2e-activity-native.py', import.meta.url).pathname, output], { stdio: 'inherit', env: process.env });
  driver.on('exit', (code) => { driverExit = code ?? 1; });
  driver.on('error', () => { driverExit = 1; });
  await until(() => existsSync(join(output, 'native-background')), 'native list/detail and background verified', 120_000);
  const continued = await run(`I explicitly ask you to CONTINUE the SAME work item ${title}, activity id ${id}. Bind this run to that existing activity; do not register a new one. Call currentTime once for stage two, then deliver a brief final summary that includes ${delivery}. After delivering it, explicitly mark this original activity completed with that delivered summary as result.`);
  list = await storeList(); assert.equal(list.length, 1); assert.equal(list[0].id, id); assert.equal(list[0].status, 'completed');
  const complete = await detail(id); assert.deepEqual(complete.activity.runIds, [first.runId, continued.runId]); assert.ok(complete.activity.result?.includes(delivery));
  assert.ok(complete.steps.some((s) => s.runId === continued.runId)); write('completed.json', complete);
  phase('completed', { id }); record('explicit continuation appends run to same activity and delivered result completes it');
  await until(() => existsSync(join(output, 'native-completed')), 'native foreground consumes completed result', 180_000);

  const second = await run(`Start a NEW independent work item titled exactly ${secondTitle}. Explicitly register a new activity, goal "Check pagination", deliverable "A current-time summary". Call currentTime once, deliver its time as a summary, then explicitly mark this NEW activity completed with the delivered summary as result. Do not change the earlier completed activity.`);
  list = await storeList(); assert.equal(list.length, 2); const secondId = list.find((a) => a.id !== id)?.id; assert.ok(secondId); ownActivityIds.push(secondId);
  assert.equal(list[0].id, secondId); assert.equal(list[0].title, secondTitle); assert.equal(list[0].status, 'completed'); assert.deepEqual(list[0].runIds, [second.runId]);
  const page1 = await api.listActivities({ spaceId, status: 'completed', limit: 1 }); assert.equal(page1.hasMore, true); assert.equal(page1.activities[0].id, secondId);
  const page2 = await api.listActivities({ spaceId, status: 'completed', limit: 1, cursor: page1.nextCursor }); assert.equal(page2.activities[0].id, id); assert.equal(page2.hasMore, false);
  assert.equal((await api.listActivities({ spaceId, status: 'awaiting_continuation' })).activities.length, 0);
  await assert.rejects(api.getActivity(`missing-${stamp}`), (e) => e.status === 404);
  write('pagination.json', { page1, page2 }); record('real nonempty pagination, opaque cursor, status/thread filters and missing detail');
  phase('second', { id, secondId, expectedIds: list.map((a) => a.id) });
  await until(() => existsSync(join(output, 'native-done')), 'native filters, task entry and final screenshots', 180_000);
  await until(() => driverExit === 0, 'native driver exits', 10_000);
  const native = JSON.parse(readFileSync(join(output, 'native-results.json'), 'utf8')); assert.equal(native.passed, true);
  record('Android native list/detail, filters, foreground recovery, themes and task entry', { checks: native.checks.length });
} catch (e) {
  failure = e; phase('failed', { error: e.message }); console.error('FAIL', e.message);
} finally {
  if (driver && driverExit === undefined) { driver.kill('SIGTERM'); await sleep(500); }
  activities.dispose(); runtime.dispose();
  try {
    for (const item of runs) if (!item.settled) { await api.stopRun(spaceId, item.runId); await item.promise; }
    if (created) {
      const removed = await api.deleteSpace(spaceId); assert.equal(removed.ok, true);
      assert.equal((await api.listActivities({ spaceId })).activities.length, 0);
      for (const id of ownActivityIds) await assert.rejects(api.getActivity(id), (e) => e.status === 404);
      const remaining = (await api.listSpaces()).map((t) => t.id);
      assert.ok(!remaining.includes(spaceId)); assert.ok(baseline.every((id) => remaining.includes(id)), 'preexisting sessions must remain');
      assert.equal((await api.getPendingApprovals()).filter((a) => a.spaceId === spaceId).length, 0);
      record('API cleanup removes only dedicated session/activities; existing sessions retained');
    }
    if (initialVersion) {
      const finalVersion = await docs('end'); assert.deepEqual(finalVersion, initialVersion, 'Deployment changed during acceptance'); record('deployment unchanged throughout acceptance');
    }
  } catch (e) { failure ??= e; console.error('FAIL cleanup/audit:', e.message); }
  token = undefined;
  write('results.json', { passed: !failure, base, spaceId, checks, runs: runs.map(({ promise: _, ...item }) => item), error: failure?.message, completedAt: new Date().toISOString() });
  console.log('Evidence:', output);
}
if (failure) process.exitCode = 1;
