/**
 * 空间/会话迁移的真实 HTTP + SSE 验收；可选以 ADB 操作实际 Android 客户端。
 * 仅操作本轮新建空间：审批正文严格核对后才批准，监控立即暂停，finally 走 API 清理。
 * 不读取设备凭据、不拦截请求、不改服务端存储；结果不包含 Token。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { HttpApiClient } from '../src/api/http-client.ts';
import { SpaceStore } from '../src/spaces/space-store.ts';
import { RuntimeStore } from '../src/runtime/runtime-store.ts';
import { ApprovalStore } from '../src/approvals/approval-store.ts';
import { ActivityStore } from '../src/activities/activity-store.ts';
import { StreamAggregator, projectHistory } from '../src/chat/chat-state.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Set E2E_ALLOW_LIVE=1 to authorize real model calls and temporary test data');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicitly select the confirmed real service');
const scope = process.env.E2E_SCOPE ?? 'full';
assert.ok(scope === 'full' || scope === 'reset-ui', 'E2E_SCOPE must be full or reset-ui');
assert.ok(scope !== 'reset-ui' || process.env.E2E_NATIVE === '1', 'reset-ui scope requires the actual Android client');
const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-spaces-e2e.'));
const stamp = Date.now().toString(36); const spaceId = `spaces-e2e-${stamp}`;
const firstMarker = `SPACE_UI_${stamp}`; const fileMarker = `SPACE_FILE_${stamp}`; const filename = 'migration-acceptance.txt';
const checks = []; const runs = []; let token; let cleanupRequired = false; let failure; let baseline = []; let version; let driver; let driverExit;
const api = new HttpApiClient(base, () => token, () => { throw new Error('Real authentication failed'); });
const spaces = new SpaceStore(api); const approvals = new ApprovalStore(api); const activities = new ActivityStore(api);
const runtime = new RuntimeStore(api, { onEvent: (event) => { approvals.receive(event); activities.receive(event); }, onConnection: (connection) => { approvals.setConnection(connection); activities.setConnection(connection); } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const pass = (name, data = {}) => { checks.push({ name, ...data }); console.log('PASS', name); };
async function until(test, label, timeout = 150_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    if (driverExit !== undefined && driverExit !== 0) throw new Error('Native driver failed; see native-results.json');
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}
async function deployment(label) {
  const [html, spec, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    assert.equal(response.status, 200); return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(html.includes('/openapi.json')); assert.equal(health.ok, true);
  assert.deepEqual(spec['x-service-version'], health.serviceVersion);
  assert.ok(spec.paths['/api/spaces']?.get && spec.paths['/api/spaces/{spaceId}/reset']?.post);
  assert.equal(spec.paths['/api/threads'], undefined);
  write(`deployment-${label}.json`, health.serviceVersion); return health.serviceVersion;
}
async function binding() {
  const entry = (await api.listSpaces()).find((entry) => entry.id === spaceId); assert.ok(entry); return entry.sessionId;
}
async function configuration(instructions, skills) {
  assert.equal((await api.getSpaceInstructions(spaceId)).instructions, instructions);
  assert.deepEqual((await api.getSpaceSkills(spaceId)).skills, skills);
}
async function begin(content) {
  const history = await api.getConversation(spaceId); const runId = `spaces-run-${stamp}-${runs.length + 1}`;
  const item = { runId, settled: false, events: [], controller: new AbortController(), aggregator: new StreamAggregator(projectHistory(history.messages)) };
  runs.push(item);
  item.promise = api.runAgent({ spaceId, runId, expectedRevision: history.revision, message: { id: `msg-${runId}`, content } }, (event) => {
    item.events.push(event.type); item.aggregator.push(event);
    if (event.type === 'RUN_ERROR') item.error = event.code ?? event.message;
  }, item.controller.signal).catch((error) => { item.transportError = error.message; }).finally(() => { item.settled = true; });
  return item;
}
async function finished(item, success = true) {
  await until(() => item.settled, 'chat stream ends');
  if (success) { assert.equal(item.error, undefined); assert.equal(item.transportError, undefined); assert.ok(item.events.includes('RUN_FINISHED')); }
  return api.getConversation(spaceId);
}
async function pending(item, path, content, before) {
  let approval;
  await until(() => { approval = Object.values(approvals.getSnapshot().records).find((a) => a.spaceId === spaceId && a.runId === item.runId && a.status === 'pending'); return !!approval || item.settled; }, 'real file approval');
  if (!approval) write(`missing-approval-${item.runId}.json`, await api.getConversation(spaceId));
  assert.ok(approval, `Run ended without requested approval: ${item.error ?? item.transportError ?? ''}`);
  assert.equal(approval.preview.scope, 'space'); assert.equal(approval.preview.ownerSpaceId, spaceId);
  assert.equal(approval.workspaceSpaceId, spaceId); assert.equal(approval.preview.path, path);
  assert.equal(approval.preview.after.trim(), content); assert.equal(approval.preview.beforeExists, before !== undefined);
  assert.equal(approval.preview.before, before ?? '');
  return approval;
}
try {
  version = await deployment('start'); pass('docs/OpenAPI/health identify the same space-capable deployment', { serviceVersion: version });
  const auth = await api.createSession(process.env.E2E_ACCESS_KEY); assert.equal(auth.mode, 'live'); token = auth.token;
  baseline = (await api.listSpaces()).map((entry) => entry.id); assert.ok(!baseline.includes(spaceId));
  // 从第一次写入尝试起就承担清理责任：即使响应丢失，也不能把远端可能已创建的数据遗留。
  cleanupRequired = true;
  const instructions = (await api.saveSpaceInstructions(spaceId, 'Dedicated mobile space/session migration acceptance. Follow only explicit test requests. Never touch shared files, other spaces, goals, memories, subagents, schedules or monitors. Only use write/read on the exact private filenames explicitly requested below. For plain reply requests do not use tools.')).instructions;
  await spaces.loadSettings(spaceId);
  const catalog = (await api.getSpaceSkills(spaceId)).skills;
  const overrides = Object.fromEntries(catalog.map((s) => [s.name, s.name === 'memory' ? false : s.enabled]));
  const savedSkills = (await api.saveSpaceSkills(spaceId, overrides)).skills;
  write('dedicated-space-skills.json', savedSkills);
  const originalSession = await binding(); spaces.bindSession(spaceId, originalSession);
  approvals.setActive(true); activities.setActive(true); runtime.setActive(true);
  await until(() => runtime.getSnapshot().connection === 'live' && approvals.getSnapshot().synchronized, 'single shared SSE ready', 20_000);
  activities.open({ spaceId }); await until(() => activities.getSnapshot().loaded, 'space-filtered activity list');
  assert.equal(activities.getSnapshot().error, undefined); assert.deepEqual(activities.getSnapshot().activities, []);
  assert.equal((await api.listApprovals({ spaceId })).approvals.length, 0);
  pass('canonical space list/configuration/activity/approval consumers and shared notification stream');

  // 仅为验收重置选项准备一个归属明确且暂停的监控，不借此接入尚未实现的监控管理 UI。
  const response = await fetch(`${base}/api/agent/monitors`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com', condition: 'contains', value: fileMarker, title: `Migration acceptance ${stamp}`, intervalMinutes: 1440, originSpaceId: spaceId }) });
  assert.equal(response.status, 200); const monitor = await response.json(); assert.equal(monitor.originSpaceId, spaceId);
  await api.controlMonitor(monitor.id, 'pause');

  if (process.env.E2E_NATIVE === '1') {
    write('context.json', { base, spaceId, firstMarker });
    driver = spawn('python3', [new URL('./e2e-spaces-native.py', import.meta.url).pathname, output], { stdio: 'inherit' });
    driver.on('exit', (code) => { driverExit = code ?? 1; }); driver.on('error', () => { driverExit = 1; });
    await until(() => existsSync(join(output, 'native-cancelled')), 'native send, recovery, and cancelled reset', 240_000);
    const history = await api.getConversation(spaceId);
    assert.ok(history.messages.some((m) => m.role === 'assistant' && m.content?.includes(firstMarker)));
    assert.equal(await binding(), originalSession); write('api-cancel-verified', true);
    await until(() => existsSync(join(output, 'native-reset-default')), 'native default reset', 120_000);
    const afterDefault = await binding(); assert.notEqual(afterDefault, originalSession);
    assert.deepEqual(await api.getConversation(spaceId), { revision: 'empty', messages: [] });
    await configuration(instructions, savedSkills);
    assert.ok((await api.getSnapshot()).monitors.some((m) => m.id === monitor.id)); write('api-default-verified', true);
    await until(() => existsSync(join(output, 'native-reset-cleared')), 'native opt-in cascade reset', 120_000);
    assert.notEqual(await binding(), afterDefault); assert.deepEqual(await api.getConversation(spaceId), { revision: 'empty', messages: [] });
    assert.equal((await api.getSnapshot()).monitors.some((m) => m.id === monitor.id), false);
    await configuration(instructions, savedSkills); write('api-clear-verified', true);
    await until(() => driverExit === 0, 'native driver exits', 60_000);
    assert.equal(JSON.parse(readFileSync(join(output, 'native-results.json'), 'utf8')).passed, true);
    pass('Android sends real chat, reloads history, cancels reset, then verifies both reset options against actual HTTP');
  } else {
    const first = await begin(`Reply with exactly ${firstMarker}. Do not use tools.`); await finished(first);
    const reset = await spaces.resetSpace(spaceId); assert.notEqual(reset.sessionId, originalSession);
    assert.deepEqual(await api.getConversation(spaceId), { revision: 'empty', messages: [] });
    assert.equal(reset.removed.monitors, 0); assert.ok((await api.getSnapshot()).monitors.some((m) => m.id === monitor.id));
    const cascade = await spaces.resetSpace(spaceId, true); assert.equal(cascade.removed.monitors, 1);
    assert.equal((await api.getSnapshot()).monitors.some((m) => m.id === monitor.id), false);
    await configuration(instructions, savedSkills); pass('default reset preserves monitor; explicit cascade removes exactly the owned monitor');
  }

  if (scope === 'full') {
    const writeRun = await begin(`Use write to create the PRIVATE relative file ${filename}. The exact file content is the JSON string ${JSON.stringify(fileMarker)} (without quotation marks or extra punctuation). Do not use a shared path or any other file. Wait for the real approval, then report success.`);
    const approval = await pending(writeRun, filename, fileMarker);
    write('approved-file-preview.json', approval);
    assert.equal(await approvals.decide(approval.id, 'approve'), true); await finished(writeRun);
    await until(() => approvals.getSnapshot().records[approval.id]?.execution?.status === 'succeeded', 'actual file commit receipt', 15_000);
    write('approved-file-receipt.json', await api.getApproval(approval.id));
    pass('new space preview ownership and genuine approved private-file commit');

    const pendingRun = await begin(`Use write to create the PRIVATE relative file cancelled-by-reset.txt. The exact file content is the JSON string ${JSON.stringify(`${fileMarker}_CANCELLED`)} (without quotation marks or extra punctuation). Do not touch any other path. Wait for approval.`);
    const cancelled = await pending(pendingRun, 'cancelled-by-reset.txt', `${fileMarker}_CANCELLED`);
    const preReset = await binding(); spaces.bindSession(spaceId, preReset);
    const beforeReset = await api.getApproval(cancelled.id);
    assert.equal(beforeReset.status, 'pending');
    write('active-reset-before.json', { observedAt: new Date().toISOString(), sessionId: preReset, approval: beforeReset });
    const reset = await spaces.resetSpace(spaceId);
    runtime.forgetSpace(spaceId); await finished(pendingRun, false);
    const afterReset = await api.getApproval(cancelled.id);
    write('active-reset-after.json', { observedAt: new Date().toISOString(), response: reset, approval: afterReset,
      history: await api.getConversation(spaceId), pending: (await api.getPendingApprovals()).filter((a) => a.spaceId === spaceId) });
    assert.notEqual(reset.sessionId, preReset);
    assert.deepEqual(await api.getConversation(spaceId), { revision: 'empty', messages: [] });
    assert.equal(afterReset.status, 'cancelled');
    assert.equal((await api.getPendingApprovals()).some((a) => a.id === cancelled.id), false);
    // 文档定义本次重置作废的数量，不能把关闭运行期间已撤销的这一项静默漏计。
    assert.equal(reset.cancelledApprovals, 1, 'Reset cancelled the observed pending approval but reported an inconsistent cancelledApprovals count');
    await configuration(instructions, savedSkills);
    await until(() => approvals.getSnapshot().synchronized && !approvals.getSnapshot().pendingIds.includes(cancelled.id), 'reconnected ready cancels stale approval', 20_000);
    pass('reset cancels the active real run and pending approval; new session starts with empty authoritative history');

    const readRun = await begin(`Use read to read the PRIVATE relative file ${filename}. Report its exact content. Do not write or use any other tool.`);
    const readHistory = await finished(readRun);
    write('read-after-reset.json', readHistory);
    assert.ok(projectHistory(readHistory.messages).some((m) => m.role === 'assistant' && m.text.includes(fileMarker)));
    const status = await api.getAgentStatus(spaceId, readRun.runId); assert.equal(status.status.spaceId, spaceId); assert.equal(status.status.status, 'succeeded');
    // 工具展示可为 hidden，不能要求历史含工具正文；用服务端固定的 before 证明文件实际保留，随后拒绝探测写入。
    const probeRun = await begin(`Use write exactly once to replace the PRIVATE relative file ${filename}. The exact replacement content is the JSON string ${JSON.stringify(`${fileMarker}_PROBE`)} without quotation marks or extra punctuation. Wait for human approval. If denied, do not retry; finish briefly. Do not touch any other path.`);
    const preserved = await pending(probeRun, filename, `${fileMarker}_PROBE`, approval.preview.after);
    write('preserved-file-preview.json', preserved);
    assert.equal(await approvals.decide(preserved.id, 'deny'), true); await finished(probeRun);
    const denied = await api.getApproval(preserved.id); assert.equal(denied.status, 'denied'); assert.equal(denied.execution, null);
    pass('new-session read and immutable approval before-image prove private-file persistence without requiring visible tool projections');

    const stopped = await begin('Do not use any tools. Output the numbers 1 through 3000, one per line, without omissions or shortcuts.');
    await until(() => stopped.events.includes('TEXT_MESSAGE_CONTENT') || stopped.settled, 'real text streaming starts');
    assert.equal(stopped.settled, false, 'need a running stream for precise stop acceptance');
    assert.equal(await api.stopRun(spaceId, pendingRun.runId), false, 'late stop from the previous session must not stop the new run');
    assert.equal(await api.stopRun(spaceId, stopped.runId), true); await finished(stopped, false);
    const stoppedStatus = await api.getAgentStatus(spaceId, stopped.runId); assert.equal(stoppedStatus.status.status, 'cancelled');
    const resumed = await begin(`Reply with exactly AFTER_STOP_${stamp}. Do not use tools.`);
    const finalHistory = await finished(resumed); assert.ok(finalHistory.messages.some((m) => m.role === 'assistant' && m.content?.includes(`AFTER_STOP_${stamp}`)));
    pass('precise new-session Stop, safe late old-session Stop, authoritative recovery and next chat run');
  }
} catch (error) {
  failure = error; console.error('FAIL', error.stack ?? error); write('failed', { error: error.message });
} finally {
  if (driver && driverExit === undefined) driver.kill('SIGTERM');
  for (const item of runs) if (!item.settled) { await api.stopRun(spaceId, item.runId).catch(() => {}); item.controller.abort(); await item.promise; }
  runtime.dispose(); approvals.dispose(); activities.dispose(); spaces.dispose();
  try {
    if (cleanupRequired) {
      try { await api.deleteSpace(spaceId); } catch (error) { if (error.status !== 404) throw error; }
      const after = (await api.listSpaces()).map((s) => s.id);
      assert.equal(after.includes(spaceId), false); assert.ok(baseline.every((id) => after.includes(id)));
      assert.equal((await api.getPendingApprovals()).some((a) => a.spaceId === spaceId), false);
      assert.deepEqual((await api.listActivities({ spaceId })).activities, []);
      assert.equal((await api.getSnapshot()).monitors.some((m) => m.originSpaceId === spaceId), false);
      pass('DELETE cleanup removes only this test space, its file/approvals/monitor; existing spaces remain');
    }
    if (version) { assert.deepEqual(await deployment('end'), version); pass('deployment identity remains unchanged throughout acceptance'); }
  } catch (error) { failure ??= error; console.error('FAIL cleanup:', error); }
  token = undefined;
  write('results.json', { passed: !failure, scope,
    unverified: scope === 'reset-ui' ? ['file approval and active-run reset', 'private file persistence after reset', 'precise Stop and subsequent chat']
      : failure ? ['Remaining scenarios after the failed assertion; inspect checks and error'] : [],
    base, spaceId, checks, runs: runs.map(({ runId, events, error, transportError }) => ({ runId, events, error, transportError })), error: failure?.message });
  console.log('Evidence:', output);
}
if (failure) process.exitCode = 1;
