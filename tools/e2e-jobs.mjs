/**
 * 真实 Jobs HTTP/SSE + Android UI 端到端验收。只在本轮专用空间按阶段创建任务。
 * 正常系统输入驱动页面；独立 HTTP 核对落盘。Token 仅在内存，不读取设备凭据。
 * 通过真实停止自建任务制造失败再重试，不篡改服务端存储/配置或绕过审批。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { HttpApiClient } from '../src/api/http-client.ts';
import { RuntimeStore } from '../src/runtime/runtime-store.ts';
import { JobStore } from '../src/jobs/job-store.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required for dedicated live writes');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicit confirmed real E2E_API_BASE_URL required');
const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-jobs-e2e-run.'));
const stamp = Date.now().toString(36);
const marker = `JOBS_E2E_${stamp}`; const spaceId = `jobs-e2e-${stamp}`;
const texts = { initial: `${marker} only reply ${marker}; no tools or data changes.`, edited: `${marker} edited`, draft: `${marker} unsent-draft`, foreground: `${marker} foreground-observed` };
const future = new Date(Date.now() + 7 * 86400_000).toISOString();
const onceDate = new Date(Date.now() + 8 * 86400_000).toISOString().slice(0, 10);
const checks = []; const ownIds = new Set(); const runtimeEvents = [];
function sources() {
  const entries = readdirSync('src', { recursive: true }).filter((name) => /\.tsx?$/.test(name)).map((name) => `src/${name}`);
  entries.push('tools/e2e-jobs.mjs', 'tools/e2e-jobs-native.py');
  return Object.fromEntries(entries.sort().map((name) => [name, createHash('sha256').update(readFileSync(name)).digest('hex')]));
}
const initialSources = sources();
let token, initialVersion, baselineJobs, baselineSpaces, id, failure, driver, driverExit, activeRun, stopJobId, stopPromise;
let spaceMayExist = false;
let createCount = 0;
const api = new HttpApiClient(base, () => token, () => { throw new Error('Real authentication rejected'); });
const store = new JobStore(api);
const runtime = new RuntimeStore(api, { onEvent: (event) => {
  store.receive(event);
  if (event.event === 'agent_status_updated' && event.data.spaceId === spaceId && event.data.source === 'job') {
    runtimeEvents.push(event.data);
    if (event.data.status === 'running' && event.data.jobId === stopJobId) {
      stopJobId = undefined;
      stopPromise = api.stopRun(spaceId, event.data.runId);
      // 回调不能遗留未处理拒绝；主流程仍会 await 原 Promise 并断言成功停止。
      void stopPromise.catch(() => {});
    }
  }
} });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const phase = (phase, extra = {}) => write('context.json', { phase, base, marker, spaceId, texts, onceDate, id, ...extra });
const pass = (name, extra = {}) => { checks.push({ name, ...extra }); console.log('PASS', name); };
async function until(predicate, label, timeout = 900_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    if (driverExit !== undefined && driverExit !== 0) throw new Error('Native driver failed; see native-results.json');
    await sleep(350);
  }
  throw new Error(`Timed out: ${label}`);
}
const native = (name) => until(() => existsSync(join(output, `native-${name}`)), name);
async function deployment(suffix) {
  const [html, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200, path); return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(html.includes('/openapi.json')); assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  for (const [path, methods] of Object.entries({ '/api/jobs': ['get'], '/api/jobs/{id}': ['get', 'patch', 'delete'], '/api/jobs/{id}/control': ['post'] })) for (const method of methods) assert.ok(schema.paths[path]?.[method]);
  assert.equal(schema.paths['/api/jobs'].post, undefined, 'No invented REST creation route');
  write(`deployment-${suffix}.json`, { serviceVersion: health.serviceVersion, timeZone: health.timeZone });
  return health.serviceVersion;
}
async function sameDeployment() {
  assert.deepEqual((await (await fetch(base + '/api/health', { signal: AbortSignal.timeout(15000) })).json()).serviceVersion, initialVersion, 'Deployment changed before write');
}
function tagged(job) { return job.prompt.startsWith(marker) && !baselineJobs.some((item) => item.id === job.id); }
function owned(job) { return job.originSpaceId === spaceId && tagged(job); }
function cleanupOwned(job) { return tagged(job) || (job.originSpaceId === spaceId && !baselineJobs.some((item) => item.id === job.id)); }
async function detail(name) { const result = await api.getJob(id); assert.ok(owned(result.job)); write(`${name}.json`, result); return result; }
async function createJob(label) {
  await sameDeployment();
  const before = new Set((await api.listJobs()).map((job) => job.id));
  const history = await api.getConversation(spaceId); activeRun = `jobs-e2e-create-${stamp}-${++createCount}`;
  // 三个夹具是不同工作，独立名称和远期时刻避免被模型当成重复提醒；不重放失败的创建请求。
  const fixturePrompt = `${texts.initial} Fixture ${label}.`;
  const fixtureAt = new Date(Date.parse(future) + createCount * 60000).toISOString();
  const events = []; let runError;
  await api.runAgent({ spaceId, runId: activeRun, expectedRevision: history.revision, message: { id: `${activeRun}-message`, content: `Use your scheduling tool now to create exactly ONE NEW independent one-time task named fixture-${label}, daily=false, at=${fixtureAt}. This is separate from the other fixtures, not a duplicate or replacement. The prompt must be exactly: ${fixturePrompt}\nDeliver the result only to source space ${spaceId}. Do not modify existing tasks, execute now or create anything else; after the scheduling tool succeeds end this turn.` } }, (event) => { events.push(event.type); if (event.type === 'RUN_ERROR') runError = event.message ?? event.code; }, AbortSignal.timeout(150000));
  activeRun = undefined; assert.equal(runError, undefined); assert.ok(events.includes('RUN_FINISHED'));
  const own = (await api.listJobs()).filter((job) => cleanupOwned(job) && !before.has(job.id));
  for (const job of own) ownIds.add(job.id);
  if (own.length !== 1 || own[0].originSpaceId !== spaceId || own[0].prompt !== fixturePrompt) {
    write(`creation-${label}-failure.json`, { events, expected: { fixtureAt, fixturePrompt, spaceId }, jobs: own, conversation: await api.getConversation(spaceId) });
  }
  assert.equal(own.length, 1, `Exactly one new ${label} fixture required; inspect creation diagnostics`); assert.equal(own[0].originSpaceId, spaceId); assert.equal(own[0].prompt, fixturePrompt);
  id = own[0].id; assert.equal(own[0].daily, false); assert.equal(own[0].status, 'scheduled'); assert.equal(own[0].enabled, true);
  assert.equal(Date.parse(own[0].at), Date.parse(fixtureAt)); await detail(`created-${label}`);
  pass('real chat/SSE creates exactly one new correctly scoped future fixture', { label, id });
  return id;
}
async function prepareRun(stop) {
  await sameDeployment(); const at = new Date(Date.now() + 20000).toISOString();
  if (stop) stopJobId = id;
  const updated = await api.updateJob(id, { daily: false, at, prompt: texts.initial, originSpaceId: spaceId });
  assert.equal(updated.enabled, true); assert.equal(updated.status, 'scheduled');
  pass(stop ? 'rearmed owned task for real stop/failure fixture' : 'scheduled real near-future execution', { at });
}
async function finished(status, eventStart, name) {
  await until(() => runtimeEvents.slice(eventStart).some((item) => item.jobId === id && item.status !== 'running'), name + ' terminal runtime', 150000);
  const terminal = runtimeEvents.slice(eventStart).findLast((item) => item.jobId === id && item.status !== 'running');
  assert.equal(terminal.status, status === 'failed' ? 'cancelled' : 'succeeded');
  const statusResponse = await api.getAgentStatus(spaceId, terminal.runId);
  assert.equal(statusResponse.status.jobId, id); assert.equal(statusResponse.status.status, terminal.status);
  await until(async () => (await api.getJob(id)).job.status === status, name + ' persistent job status', 30000);
  const result = await detail(name);
  assert.ok(result.job.lastRunAt); if (status === 'succeeded') assert.ok(result.job.lastResult?.includes(marker));
  write(`${name}-status.json`, statusResponse); write('runtime-events.json', runtimeEvents);
  return terminal;
}

try {
  const adb = process.env.ADB ?? join(homedir(), 'Library/Android/sdk/platform-tools/adb');
  const target = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : ['-e'];
  assert.equal(execFileSync(adb, [...target, 'get-state'], { encoding: 'utf8' }).trim(), 'device');
  assert.match(await (await fetch('http://127.0.0.1:8082/status', { signal: AbortSignal.timeout(5000) })).text(), /packager-status:running/);
  const bundle = await fetch('http://127.0.0.1:8082/index.bundle?platform=android&dev=true&minify=false', { signal: AbortSignal.timeout(120000) });
  assert.equal(bundle.status, 200, 'Metro cannot resolve current source; restart it with --clear before acceptance');
  assert.ok((await bundle.text()).includes('AT THE RIGHT TIME'), 'Metro serves an old bundle without Jobs UI');
  initialVersion = await deployment('start'); pass('current docs/OpenAPI/health identity agrees', { serviceVersion: initialVersion });
  const auth = await api.createSession(process.env.E2E_ACCESS_KEY); assert.equal(auth.mode, 'live'); token = auth.token;
  baselineJobs = await api.listJobs(); baselineSpaces = (await api.listSpaces()).map((space) => space.id);
  assert.ok(!baselineSpaces.includes(spaceId)); assert.ok(!baselineJobs.some((job) => job.prompt.startsWith(marker) || job.originSpaceId === spaceId));
  const rules = `Dedicated mobile Jobs acceptance ${marker}. Create exactly one new reminder per explicit test request, with exact source ${spaceId}; never edit existing tasks through chat. No other jobs, activities, subagents, files, goals, monitors, memory or profile changes. Scheduled execution only replies with the marker; no tools or writes.`;
  spaceMayExist = true; await api.saveSpaceInstructions(spaceId, rules);
  const managedId = await createJob('management');
  for (const sort of ['nextRunAt', 'updatedAt', 'createdAt']) for (const order of ['asc', 'desc']) {
    const list = await api.listJobs({ spaceId, sort, order }); assert.equal(list.length, 1); assert.equal(list[0].id, id);
  }
  store.setActive(true); store.open(); await until(() => !store.getSnapshot().loading, 'actual client/store loaded');
  store.setQuery({ spaceId, sort: 'nextRunAt', order: 'asc' }); await until(() => !store.getSnapshot().loading, 'actual scoped store'); assert.equal(store.getSnapshot().jobs[0].id, id);
  store.select(id); await until(() => !store.getSnapshot().loading, 'actual detail store'); assert.equal(store.getSnapshot().detail.job.id, id);
  const timeZone = store.getSnapshot().timeZone; assert.ok(timeZone);
  pass('actual JobStore consumes nonempty list/detail and all six declared sort directions', { timeZone });
  // 模拟器的合法本地时间由系统报告，不读取用户凭据或注入 JS 状态。
  const deviceZone = execFileSync(adb, [...target, 'shell', 'getprop', 'persist.sys.timezone'], { encoding: 'utf8' }).trim();
  assert.ok(deviceZone); new Intl.DateTimeFormat('en', { timeZone: deviceZone }).format();
  // 在耗时的原生流程前先确认全部真实夹具就绪；任一创建异常立即失败并清理，不拼凑后半轮。
  const automaticId = await createJob('automatic'); const retryId = await createJob('retry');
  id = managedId;
  phase('start');
  driver = spawn('python3', [new URL('./e2e-jobs-native.py', import.meta.url).pathname, output], { stdio: 'inherit', env: process.env });
  driver.on('exit', (code) => { driverExit = code ?? 1; }); driver.on('error', () => { driverExit = 1; });
  await native('daily');
  const daily = (await detail('native-daily')).job; assert.equal(daily.daily, true); assert.equal(daily.at, '09:00'); assert.equal(daily.prompt, texts.edited);
  assert.match(daily.nextRunAt, /Z$/);
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(daily.nextRunAt)), '09:00');
  pass('native daily edit sends HH:mm unchanged; nextRunAt is UTC and server-zone 09:00'); phase('daily');
  await native('once'); const once = (await detail('native-once')).job;
  assert.equal(once.daily, false); assert.match(once.at, new RegExp(`^${onceDate}T09:30:00[+-]\\d{2}:\\d{2}$`)); assert.equal(Date.parse(once.nextRunAt), Date.parse(once.at));
  assert.match(once.nextRunAt, /Z$/);
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: deviceZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(once.at)), '09:30');
  pass('native one-time edit emits complete offset ISO, nextRunAt local display matches selection', { at: once.at, deviceZone }); phase('once');
  for (const [name, status, enabled] of [['paused', 'paused', false], ['resumed', 'scheduled', true], ['cancelled', 'cancelled', false]]) {
    await native(name); const current = (await detail(`native-${name}`)).job; assert.equal(current.status, status); assert.equal(current.enabled, enabled); pass(`native confirmed ${name} persisted exact status/enabled`); phase(name);
  }
  await native('background'); await sameDeployment(); await api.updateJob(id, { prompt: texts.foreground }); phase('foreground');
  await native('foreground'); assert.equal((await detail('foreground')).job.prompt, texts.foreground); pass('native draft navigation/foreground reload/theme retention consumes external real update'); phase('foreground-verified');
  // cancelled/succeeded 都不能 resume；使用先前分别经真实聊天准备的独立任务。
  id = automaticId;
  for (const sort of ['nextRunAt', 'updatedAt', 'createdAt']) for (const order of ['asc', 'desc']) {
    const sorted = await api.listJobs({ spaceId, sort, order });
    assert.deepEqual(new Set(sorted.map((job) => job.id)), new Set([managedId, automaticId, retryId]));
    const dated = sorted.filter((job) => job[sort] !== undefined);
    assert.ok(dated.length >= 2, 'At least two actual timestamps required to verify sort direction');
    for (let index = 1; index < dated.length; index++) {
      const delta = Date.parse(dated[index][sort]) - Date.parse(dated[index-1][sort]);
      assert.ok(order === 'asc' ? delta >= 0 : delta <= 0);
    }
  }
  pass('three real records retain scope/membership across six queries; all three timestamp sort directions verified');
  runtime.setActive(true); await until(() => runtime.getSnapshot().connection === 'live', 'unique real SSE connected', 20000);
  const before = new Set((await api.getConversation(spaceId)).messages.map((message) => message.id));
  // UIAutomator 的真实输入/层级采样较慢；先让原生页确认远期任务，再启动近时调度，避免验收竞速。
  phase('trigger'); await native('trigger-visible');
  let eventStart = runtimeEvents.length; await prepareRun(false);
  await finished('succeeded', eventStart, 'automatic-success');
  const delivered = (await api.getConversation(spaceId)).messages.filter((message) => !before.has(message.id) && message.role === 'assistant' && message.content?.includes(marker)); assert.ok(delivered.length > 0);
  assert.ok(!(await api.getConversation('local-main')).messages.some((message) => message.content?.includes(marker)));
  write('delivery.json', { spaceId, messages: delivered }); pass('actual automatic firing succeeds with source=job SSE, persisted result and source-only chat delivery'); phase('delivered');
  await native('delivered');
  for (const completedId of [managedId, automaticId]) {
    assert.ok(owned((await api.getJob(completedId)).job));
    await api.deleteJob(completedId);
  }
  id = retryId; eventStart = runtimeEvents.length; await prepareRun(true);
  await finished('failed', eventStart, 'actual-stopped-failure'); assert.equal(await stopPromise, true);
  assert.ok((await detail('failed-fixture')).job.error); pass('real exact-run stop produces legitimate own failed job; no data/config manipulation'); phase('retry-ready');
  await native('retry-cancelled'); assert.equal((await api.getJob(id)).job.status, 'failed'); pass('cancelled retry confirmation does not start real execution');
  eventStart = runtimeEvents.length; phase('retry-confirm'); await native('retried'); await finished('succeeded', eventStart, 'native-retry-success');
  pass('native confirmed retry starts exactly one real job run and persists success'); phase('retry-done');
  assert.equal(new Set(runtimeEvents.map((event) => event.runId)).size, 3, 'Exactly automatic, stopped and explicitly retried runs');
  await native('delete-cancelled'); assert.equal((await api.getJob(id)).job.id, id); pass('native cancelled deletion retains real record'); phase('delete-confirm');
  await native('deleted'); await assert.rejects(api.getJob(id), (error) => error.status === 404); assert.deepEqual(await api.listJobs({ spaceId }), []); pass('native deletion removes exact task; actual detail404 and scoped list empty'); phase('done');
  await native('done'); await until(() => driverExit === 0, 'native driver completed', 15000);
  assert.equal(JSON.parse(readFileSync(join(output, 'native-results.json'), 'utf8')).passed, true);
} catch (error) {
  failure = error; phase('failed', { error: error.message }); console.error('FAIL', error.stack);
} finally {
  if (driver && driverExit === undefined) { driver.kill('SIGTERM'); await sleep(500); }
  runtime.dispose(); store.dispose();
  try {
    if (activeRun) await api.stopRun(spaceId, activeRun);
    if (baselineJobs) {
      const jobs = await api.listJobs();
      for (const job of jobs.filter(cleanupOwned)) {
        ownIds.add(job.id);
        // 清理前通过公开状态确认本轮正在执行的精确 run；不停止用户已有运行。
        const ownRuns = runtimeEvents.filter((event) => event.jobId === job.id && event.status === 'running');
        for (const run of ownRuns) await api.stopRun(spaceId, run.runId);
        await api.deleteJob(job.id);
      }
      if (spaceMayExist && (await api.listSpaces()).some((space) => space.id === spaceId)) await api.deleteSpace(spaceId);
      const remaining = await api.listJobs(); const spaces = (await api.listSpaces()).map((space) => space.id);
      assert.ok(!remaining.some((job) => ownIds.has(job.id) || cleanupOwned(job))); assert.ok(!spaces.includes(spaceId));
      for (const original of baselineJobs) assert.ok(remaining.some((job) => job.id === original.id), 'Original job retained');
      for (const original of baselineSpaces) assert.ok(spaces.includes(original), 'Original space retained');
      pass('API cleanup removes only dedicated task/space; all original records retained');
    }
    if (initialVersion) { assert.deepEqual(await deployment('end'), initialVersion); pass('same deployment identity throughout final real/native acceptance'); }
    const finalSources = sources(); write('sources.json', { start: initialSources, end: finalSources });
    assert.deepEqual(finalSources, initialSources, 'Client source changed during final acceptance'); pass('client source and native driver unchanged throughout acceptance');
  } catch (error) { failure ??= error; console.error('FAIL cleanup/audit', error.message); }
  token = undefined;
  write('results.json', { passed: !failure, base, marker, spaceId, checks, error: failure?.message, completedAt: new Date().toISOString() });
  console.log('Evidence:', output);
}
if (failure) process.exitCode = 1;
