/**
 * 真实 HTTP + Android 界面的长期记忆验收。所有写入带本轮唯一标记，仅清理自建条目。
 * 不拦截网络、不注入页面状态，不读取服务端文件或设备凭据；Token 只存在进程内存。
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { HttpApiClient } from '../src/api/http-client.ts';
import { MemoryStore } from '../src/memories/memory-store.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required for dedicated real memory writes');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicit confirmed real E2E_API_BASE_URL required');
const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-memories-e2e-run.'));
const marker = `MEMORY_E2E_${Date.now().toString(36)}`;
const texts = { initial: `${marker} native-created`, edited: `${marker} native-edited`, foreground: `${marker} foreground-updated`, refreshed: `${marker} manually-refreshed` };
const checks = []; const ownIds = new Set();
let token; let baseline; let initialVersion; let failure; let driver; let driverExit; let id;
const api = new HttpApiClient(base, () => token, () => { throw new Error('Real authentication rejected'); });
const store = new MemoryStore(api);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const phase = (phase, extra = {}) => write('context.json', { phase, base, marker, texts, id, ...extra });
const pass = (name, extra = {}) => { checks.push({ name, ...extra }); console.log('PASS', name); };
async function until(predicate, label, timeout = 300_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    if (driverExit !== undefined && driverExit !== 0) throw new Error('Native driver failed; see native-results.json');
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}`);
}
const native = (name) => until(() => existsSync(join(output, `native-${name}`)), name);
async function deployment(suffix) {
  const [html, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    assert.equal(response.status, 200, path); return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(html.includes('/openapi.json')); assert.equal(health.ok, true);
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  for (const path of ['/api/memories', '/api/memories/{id}']) assert.ok(schema.paths[path]);
  write(`deployment-${suffix}.json`, { serviceVersion: health.serviceVersion, memoryApi: Object.fromEntries(Object.entries(schema.paths).filter(([path]) => path.includes('/memories'))) });
  return health.serviceVersion;
}
async function ownMemory(text) {
  const page = await api.listMemories({ q: marker, limit: 10 });
  const found = page.memories.filter((memory) => memory.text === text);
  assert.equal(found.length, 1, 'Native write must create exactly one matching real record');
  ownIds.add(found[0].id); return found[0];
}
try {
  const adb = process.env.ADB ?? join(homedir(), 'Library/Android/sdk/platform-tools/adb');
  const target = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : ['-e'];
  assert.equal(execFileSync(adb, [...target, 'get-state'], { encoding: 'utf8' }).trim(), 'device');
  assert.match(await (await fetch('http://127.0.0.1:8082/status', { signal: AbortSignal.timeout(5000) })).text(), /packager-status:running/);
  initialVersion = await deployment('start'); pass('docs/OpenAPI/health match before writes', { serviceVersion: initialVersion });
  const auth = await api.createSession(process.env.E2E_ACCESS_KEY); assert.equal(auth.mode, 'live'); token = auth.token;
  baseline = (await api.listMemories()).memories;
  assert.ok(baseline.length < 500, 'Memory capacity full; do not remove existing data to make room');
  assert.ok(!baseline.some((memory) => memory.text.includes(marker)));
  store.setActive(true); store.open(); await until(() => !store.getSnapshot().loading, 'actual MemoryStore first read');
  assert.equal(store.getSnapshot().error, undefined); assert.deepEqual(store.getSnapshot().memories, baseline);
  store.search(marker); await until(() => !store.getSnapshot().loading, 'empty dedicated search');
  assert.deepEqual(store.getSnapshot().memories, []); pass('actual client/store list and search do not use workspace snapshot');
  phase('start');
  driver = spawn('python3', [new URL('./e2e-memories-native.py', import.meta.url).pathname, output], { stdio: 'inherit', env: process.env });
  driver.on('exit', (code) => { driverExit = code ?? 1; }); driver.on('error', () => { driverExit = 1; });
  await native('created');
  const created = await ownMemory(texts.initial); id = created.id;
  assert.equal(created.source, 'Mobile UI'); pass('native create stored exact text, timestamps and explicit mobile source', { id }); phase('created');
  await native('edited');
  const edited = await ownMemory(texts.edited); assert.equal(edited.id, id); assert.equal(edited.createdAt, created.createdAt);
  assert.equal(edited.source, created.source); assert.ok(Date.parse(edited.updatedAt) >= Date.parse(created.updatedAt));
  const caseSearch = await api.listMemories({ q: marker.toLowerCase(), limit: 1 }); assert.equal(caseSearch.memories[0].id, id);
  assert.equal((await api.listMemories({ q: `${marker}-absent`, limit: 10 })).memories.length, 0);
  pass('native edit retains identity/source; real search is case-insensitive with limit and empty result'); phase('edited');
  await native('cancelled-delete'); assert.equal((await ownMemory(texts.edited)).id, id);
  pass('cancelled native delete has no server side effect'); phase('cancel-verified');
  await native('background');
  await api.editMemory(id, texts.foreground); phase('foreground');
  await native('foreground'); pass('foreground automatically reloads an external real edit while retaining unsent draft');
  await api.editMemory(id, texts.refreshed); phase('manual-refresh');
  await native('refreshed'); pass('manual refresh consumes actual HTTP change without memory SSE'); phase('delete');
  await native('deleted');
  assert.ok(!(await api.listMemories()).memories.some((memory) => memory.id === id));
  assert.equal((await api.listMemories({ q: marker })).memories.length, 0);
  await assert.rejects(api.editMemory(id, texts.initial), (error) => error.status === 404);
  pass('confirmed native deletion removed only the dedicated memory; later edit returns404'); phase('done');
  await native('done'); await until(() => driverExit === 0, 'native process success', 10_000);
  const result = JSON.parse(readFileSync(join(output, 'native-results.json'), 'utf8')); assert.equal(result.passed, true);
  pass('Android themes, search, draft navigation, foreground, delete and current-process error checks', { checks: result.checks.length });
} catch (error) {
  failure = error; phase('failed', { error: error.message }); console.error('FAIL', error.message);
} finally {
  if (driver && driverExit === undefined) { driver.kill('SIGTERM'); await sleep(500); }
  store.dispose();
  try {
    if (baseline) {
      // 结果未明时也只回读本轮唯一标记；不按模糊关键词删除用户已有记忆。
      const current = (await api.listMemories()).memories;
      for (const memory of current) if (!baseline.some((item) => item.id === memory.id) && memory.text.startsWith(marker+' ')) ownIds.add(memory.id);
      for (const ownId of ownIds) if (current.some((memory) => memory.id === ownId)) await api.forgetMemory(ownId);
      const remaining = (await api.listMemories()).memories;
      for (const memory of baseline) assert.deepEqual(remaining.find((item) => item.id === memory.id), memory, 'Existing memory must remain unchanged');
      assert.ok(!remaining.some((memory) => ownIds.has(memory.id) || memory.text.startsWith(marker+' ')));
      pass('API cleanup removed dedicated records only; baseline memories unchanged', { baselineCount: baseline.length });
    }
    if (initialVersion) { assert.deepEqual(await deployment('end'), initialVersion, 'Deployment changed during acceptance'); pass('deployment unchanged throughout acceptance'); }
  } catch (error) { failure ??= error; console.error('FAIL cleanup/audit:', error.message); }
  token = undefined; write('results.json', { passed: !failure, base, marker, checks, error: failure?.message, completedAt: new Date().toISOString() });
  console.log('Evidence:', output);
}
if (failure) process.exitCode = 1;
