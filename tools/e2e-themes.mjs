/** 真实 HTTP/SSE 与 Android 界面的主题验收；只在专用空间消费一次实际聊天，结束经 API 清理。 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpApiClient } from '../src/api/http-client.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required for real native chat');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicit confirmed real service URL required');
const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-themes-e2e-run.'));
const stamp = Date.now().toString(36);
const spaceId = `themes-e2e-${stamp}`;
const response = `THEME_${stamp}`;
const draft = `THEME_DRAFT_${stamp}`;
// 用户消息不含拼接后的完整标记，原生断言不能误把用户气泡当成助手回复。
const prompt = `Concatenate the literal prefix THEME_ with the suffix ${stamp}. Reply only with that concatenated string. No tools.`;
const checks = []; const statuses = new Map();
let token; let initialVersion; let baseline; let created = false; let failure; let driver; let driverExit; let stream;
let ready = false;
const streamController = new AbortController();
const api = new HttpApiClient(base, () => token, () => { throw new Error('Real service rejected authentication'); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const pass = (name, extra = {}) => { checks.push({ name, ...extra }); console.log('PASS', name); };
function sourceHashes() {
  const src = new URL('../src/', import.meta.url);
  return Object.fromEntries(readdirSync(src, { recursive: true }).filter((path) => /\.tsx?$/.test(path)).sort()
    .map((path) => [path, createHash('sha256').update(readFileSync(new URL(path, src))).digest('hex')]));
}
const sourceStart = sourceHashes(); write('source-start.json', sourceStart);
async function until(predicate, label, timeout = 150_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    if (driverExit !== undefined && driverExit !== 0) throw new Error('Native driver failed; see native-results.json');
    await sleep(300);
  }
  throw new Error('Timed out: ' + label);
}
async function deployment(suffix) {
  const [html, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const result = await fetch(base + path, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    assert.equal(result.status, 200, path);
    return path === '/docs' ? result.text() : result.json();
  }));
  assert.ok(html.includes('/openapi.json')); assert.equal(health.ok, true);
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  for (const path of ['/api/spaces', '/api/conversation', '/api/conversation/run', '/api/events']) assert.ok(schema.paths[path], path);
  write(`deployment-${suffix}.json`, { serviceVersion: health.serviceVersion, contractVersion: schema.info.version });
  return health.serviceVersion;
}
try {
  const adb = process.env.ADB ?? join(homedir(), 'Library/Android/sdk/platform-tools/adb');
  const target = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : ['-e'];
  assert.equal(execFileSync(adb, [...target, 'get-state'], { encoding: 'utf8' }).trim(), 'device');
  const metro = await fetch('http://127.0.0.1:8082/status', { signal: AbortSignal.timeout(5000) });
  assert.match(await metro.text(), /packager-status:running/);
  pass('Android and final-source Metro preflight');
  initialVersion = await deployment('start'); pass('docs, OpenAPI and real deployment identity match');
  const auth = await api.createSession(process.env.E2E_ACCESS_KEY); assert.equal(auth.mode, 'live'); token = auth.token;
  baseline = (await api.listSpaces()).map((space) => space.id);
  await api.saveSpaceInstructions(spaceId, 'Dedicated mobile theme acceptance. Reply only with the requested literal string. Never use tools or change files, memories, activities, goals, schedules, monitors or other spaces.');
  created = true;
  assert.deepEqual((await api.getConversation(spaceId)).messages, []);
  assert.deepEqual((await api.listActivities({ spaceId })).activities, []);
  stream = api.subscribeRuntime((event) => {
    if (event.event === 'ready') {
      ready = true;
      for (const status of event.data.agentStatuses) if (status.spaceId === spaceId) statuses.set(status.runId, status);
    }
    if (event.event === 'agent_status_updated' && event.data.spaceId === spaceId) statuses.set(event.data.runId, event.data);
  }, streamController.signal).catch((error) => { if (!streamController.signal.aborted) failure ??= error; });
  await until(() => ready || failure, 'actual SSE ready', 20_000); if (failure) throw failure;
  pass('dedicated empty space and actual runtime SSE');
  write('context.json', { base, spaceId, draft, prompt, response });
  driver = spawn('python3', [new URL('./e2e-themes-native.py', import.meta.url).pathname, output], { stdio: 'inherit', env: process.env });
  driver.on('exit', (code) => { driverExit = code ?? 1; });
  driver.on('error', () => { driverExit = 1; });
  await until(() => existsSync(join(output, 'native-chat')), 'native theme selection and real streamed reply', 900_000);
  const history = await api.getConversation(spaceId);
  assert.equal(history.messages.filter((message) => message.role === 'user').length, 1);
  assert.ok(history.messages.some((message) => message.role === 'user' && message.content === prompt));
  assert.ok(history.messages.some((message) => message.role === 'assistant' && message.content?.trim() === response));
  await until(() => [...statuses.values()].some((status) => status.status === 'succeeded'), 'actual native chat successful runtime status');
  write('chat-proof.json', { revision: history.revision, userCount: 1, assistantMatches: true, statuses: [...statuses.values()].map(({ runId, status, source }) => ({ runId, status, source })) });
  pass('actual native chat request, streamed reply, HTTP history and runtime terminal agree');
  await until(() => driverExit === 0, 'all native persistence and narrow-screen checks', 600_000);
  const native = JSON.parse(readFileSync(join(output, 'native-results.json'), 'utf8')); assert.equal(native.passed, true);
  pass('three native themes, preserved draft and panel, modals, cold restore and narrow screen', { checks: native.checks.length });
} catch (error) {
  failure ??= error; console.error('FAIL', error.message);
} finally {
  if (driver && driverExit === undefined) { driver.kill('SIGTERM'); await sleep(500); }
  try {
    for (const status of statuses.values()) if (status.status === 'running') await api.stopRun(spaceId, status.runId);
    if (created) {
      assert.equal((await api.deleteSpace(spaceId)).ok, true);
      const remaining = (await api.listSpaces()).map((space) => space.id);
      assert.ok(!remaining.includes(spaceId));
      assert.ok(baseline.every((id) => remaining.includes(id)), 'preexisting spaces remain');
      pass('API cleanup removes only dedicated test space; existing spaces retained');
    }
    if (initialVersion) { assert.deepEqual(await deployment('end'), initialVersion); pass('deployment unchanged throughout final acceptance'); }
    const sourceEnd = sourceHashes(); write('source-end.json', sourceEnd);
    assert.deepEqual(sourceEnd, sourceStart); pass('all product source hashes unchanged during real acceptance');
  } catch (error) { failure ??= error; console.error('FAIL cleanup/audit', error.message); }
  streamController.abort(); await stream; token = undefined;
  write('results.json', { passed: !failure, base, spaceId, checks, error: failure?.message, completedAt: new Date().toISOString(), unverified: ['iOS, physical device and standalone APK', 'real storage failures (covered by local fault tests)', 'theme switch during an in-flight chat was not asserted'] });
  console.log('Evidence:', output);
}
if (failure) process.exitCode = 1;
