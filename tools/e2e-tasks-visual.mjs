/**
 * 任务页纯视觉调整的三阶段真实验收入口。
 *
 * prepare 只在专用 tasks-ui-* 空间创建视觉夹具并保留给原生 UI；
 * verify 只读回核对资源和部署；cleanup 只按 context.json 的精确 ID/空间清理。
 * Token 只留在进程内存，证据文件不包含 token、AccessKey 或原始完整模型事件。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import { parseMonitor } from '../src/api/monitor-contracts.ts';

const phase = process.argv[2];
assert.equal(process.argv.length, 3, 'Usage: node tools/e2e-tasks-visual.mjs prepare|verify|cleanup');
assert.ok(['prepare', 'verify', 'cleanup'].includes(phase), 'Phase must be prepare, verify or cleanup');
assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicit confirmed real E2E_API_BASE_URL required');

const parsedBase = new URL(process.env.E2E_API_BASE_URL);
assert.ok(['http:', 'https:'].includes(parsedBase.protocol), 'E2E_API_BASE_URL must be HTTP(S)');
assert.equal(parsedBase.pathname, '/', 'E2E_API_BASE_URL must be a service root');
assert.equal(parsedBase.search, '', 'E2E_API_BASE_URL must not contain a query');
assert.equal(parsedBase.hash, '', 'E2E_API_BASE_URL must not contain a hash');
const base = parsedBase.origin;

assert.ok(process.env.E2E_TASKS_OUTPUT, 'E2E_TASKS_OUTPUT evidence directory required');
const output = resolve(process.env.E2E_TASKS_OUTPUT);
assert.ok(statSync(output, { throwIfNoEntry: false })?.isDirectory(), 'E2E_TASKS_OUTPUT must be an existing directory');
const contextPath = join(output, 'context.json');

let token;
let context;
let failure;
const checks = [];
const api = new HttpApiClient(base, () => token, () => { throw new Error('Real authentication rejected'); });

const writeJson = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const pass = (name, extra = {}) => {
  checks.push({ name, ...extra });
  console.log('PASS', name);
};
const ids = (items) => [...new Set(items.map((item) => item.id))].sort();
const sameIds = (items, expected) => {
  assert.deepEqual(ids(items), [...new Set(expected)].sort());
};

function writeContext() {
  // context 是 cleanup 的唯一授权范围；禁止把模型事件、历史或凭据混入这里。
  writeJson('context.json', {
    phase: context.phase,
    base,
    marker: context.marker,
    spaceId: context.spaceId,
    spaceMayExist: context.spaceMayExist,
    monitorUrl: context.monitorUrl,
    runIds: context.runIds,
    resourceIds: context.resourceIds,
    baselineIds: context.baselineIds,
    serviceVersion: context.serviceVersion,
    openapiHash: context.openapiHash,
    preparedAt: context.preparedAt,
  });
}

if (phase === 'prepare') {
  assert.equal(readdirSync(output).length, 0, 'prepare requires an empty evidence directory');
  const stamp = Date.now().toString(36);
  const marker = `TASKS_UI_${stamp}`;
  context = {
    phase: 'prepare-started',
    marker,
    spaceId: `tasks-ui-${stamp}`,
    spaceMayExist: false,
    monitorUrl: `https://example.com/?${marker}_MONITOR`,
    runIds: [],
    resourceIds: { jobs: [], activities: [], monitors: [] },
    baselineIds: { spaces: [], jobs: [], activities: [], monitors: [] },
    serviceVersion: undefined,
    openapiHash: undefined,
    preparedAt: undefined,
  };
  writeContext();
} else {
  context = JSON.parse(readFileSync(contextPath, 'utf8'));
  assert.equal(context.base, base, 'E2E_API_BASE_URL changed between phases');
  assert.match(context.spaceId, /^tasks-ui-[a-z0-9]+$/);
  assert.match(context.marker, /^TASKS_UI_[a-z0-9]+$/);
  assert.equal(typeof context.spaceMayExist, 'boolean', 'spaceMayExist must be explicit safety metadata');
  assert.ok(Array.isArray(context.runIds));
  for (const key of ['jobs', 'activities', 'monitors']) assert.ok(Array.isArray(context.resourceIds?.[key]));
  for (const key of ['spaces', 'jobs', 'activities', 'monitors']) assert.ok(Array.isArray(context.baselineIds?.[key]));
  assert.ok(context.serviceVersion);
  assert.match(context.openapiHash, /^[a-f0-9]{64}$/);
}

async function collectActivities(spaceId) {
  const activities = [];
  let cursor;
  do {
    const page = await api.listActivities({
      ...(spaceId ? { spaceId } : {}),
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    activities.push(...page.activities);
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor);
  return activities;
}

async function readResources() {
  const [spaces, jobs, monitors, activities] = await Promise.all([
    api.listSpaces(),
    api.listJobs(),
    api.listMonitors(),
    collectActivities(),
  ]);
  return { spaces, jobs, monitors, activities };
}

function baselineFrom(resources) {
  return {
    spaces: ids(resources.spaces),
    jobs: ids(resources.jobs),
    activities: ids(resources.activities),
    monitors: ids(resources.monitors),
  };
}

function writeBaselineEvidence(name, resources) {
  writeJson(name, {
    counts: {
      spaces: resources.spaces.length,
      jobs: resources.jobs.length,
      activities: resources.activities.length,
      monitors: resources.monitors.length,
    },
    baselineIds: baselineFrom(resources),
  });
}

function assertBaselineRetained(resources) {
  const current = baselineFrom(resources);
  const missing = {};
  for (const key of Object.keys(current)) {
    missing[key] = context.baselineIds[key].filter((id) => !current[key].includes(id));
    assert.deepEqual(missing[key], [], `Prepare baseline ${key} must remain untouched`);
  }
  return { current, missing };
}

async function readOwnResources() {
  if (!context.spaceMayExist) return { jobs: [], monitors: [], activities: [] };
  const [jobs, monitors, activities] = await Promise.all([
    api.listJobs({ spaceId: context.spaceId }),
    api.listMonitors({ spaceId: context.spaceId }),
    collectActivities(context.spaceId),
  ]);
  return { jobs, monitors, activities };
}

async function syncOwnResources() {
  const own = await readOwnResources();
  context.resourceIds = {
    jobs: ids(own.jobs),
    activities: ids(own.activities),
    monitors: ids(own.monitors),
  };
  writeContext();
  return own;
}

async function assertNoEscapedMarkerResources() {
  const resources = await readResources();
  const baseline = context.baselineIds;
  const escaped = {
    jobs: resources.jobs.filter((job) => !baseline.jobs.includes(job.id)
      && job.originSpaceId !== context.spaceId && job.prompt.includes(context.marker)),
    activities: resources.activities.filter((activity) => !baseline.activities.includes(activity.id)
      && activity.spaceId !== context.spaceId
      && [activity.title, activity.goal, activity.deliverable, activity.result].some((text) => text?.includes(context.marker))),
    monitors: resources.monitors.filter((monitor) => !baseline.monitors.includes(monitor.id)
      && monitor.originSpaceId !== context.spaceId && monitor.url.includes(context.marker)),
  };
  writeJson('escaped-marker-check.json', {
    counts: Object.fromEntries(Object.entries(escaped).map(([key, value]) => [key, value.length])),
    ids: Object.fromEntries(Object.entries(escaped).map(([key, value]) => [key, ids(value)])),
  });
  for (const [key, value] of Object.entries(escaped)) assert.equal(value.length, 0, `Model created ${key} outside the dedicated space`);
}

async function deployment(name) {
  const [html, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, path);
    return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(html.includes('/openapi.json'), '/docs must expose the authoritative OpenAPI document');
  assert.equal(health.ok, true);
  assert.equal(health.backend, 'pi');
  assert.equal(health.configured, true, 'Real external model backend is required');
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);

  const expectedPaths = {
    '/api/jobs': ['get'],
    '/api/jobs/{id}': ['get', 'patch', 'delete'],
    '/api/jobs/{id}/control': ['post'],
    '/api/monitors': ['get', 'post'],
    '/api/monitors/{id}': ['get', 'delete'],
    '/api/monitors/{id}/control': ['post'],
    '/api/activities': ['get'],
    '/api/activities/{id}': ['get'],
  };
  for (const [path, methods] of Object.entries(expectedPaths)) {
    for (const method of methods) assert.ok(schema.paths[path]?.[method], `${method} ${path}`);
  }
  assert.equal(schema.paths['/api/jobs'].post, undefined, 'Job creation must remain a model-only schedule tool');
  assert.deepEqual(Object.keys(schema.paths['/api/activities']), ['get'], 'Activities must remain read-only over HTTP');
  assert.deepEqual(Object.keys(schema.paths['/api/activities/{id}']), ['get'], 'Activity detail must remain read-only over HTTP');

  const openapiHash = createHash('sha256').update(JSON.stringify(schema)).digest('hex');
  writeJson(`deployment-${name}.json`, {
    serviceVersion: health.serviceVersion,
    openapiHash,
    relevantApi: Object.fromEntries(Object.entries(expectedPaths).map(([path]) => [path, schema.paths[path]])),
  });
  return { serviceVersion: health.serviceVersion, openapiHash, timeZone: health.timeZone };
}

async function authenticate() {
  const auth = await api.createSession(process.env.E2E_ACCESS_KEY);
  assert.equal(auth.mode, 'live', 'Real live model backend is required');
  token = auth.token;
}

async function runModel(label, expectedTool, prompt) {
  const history = await api.getConversation(context.spaceId);
  const runId = `tasks-ui-visual-${label}-${context.marker.slice(-10)}`;
  context.runIds = [...new Set([...context.runIds, runId])];
  writeContext();

  const eventTypes = [];
  const toolStarts = [];
  const toolResults = [];
  let runError;
  await api.runAgent({
    spaceId: context.spaceId,
    runId,
    expectedRevision: history.revision,
    message: { id: `${runId}-message`, content: prompt },
  }, (event) => {
    eventTypes.push(event.type);
    if (event.type === 'TOOL_CALL_START') {
      toolStarts.push({ toolCallId: event.toolCallId, toolCallName: event.toolCallName });
    }
    if (event.type === 'TOOL_CALL_RESULT') {
      toolResults.push({ toolCallId: event.toolCallId, content: event.content });
    }
    if (event.type === 'RUN_ERROR') runError = event.message ?? event.code;
  }, AbortSignal.timeout(300_000));

  assert.equal(runError, undefined, `Real model run failed: ${runError}`);
  assert.ok(eventTypes.includes('RUN_STARTED'));
  assert.ok(eventTypes.includes('RUN_FINISHED'));
  // 工具展示策略可能隐藏工具事件；真实调用以持久化资源和 run 终态验收，
  // 这里只记录实际可见回执，不伪造或强求服务端隐藏的原始投影。
  assert.ok(toolStarts.every((tool) => tool.toolCallName === expectedTool), `Visible tool calls must be ${expectedTool}`);

  const after = await api.getConversation(context.spaceId);
  const userIndex = after.messages.findIndex((message) => message.id === `${runId}-message`);
  assert.ok(userIndex >= 0, 'Persisted history must contain the exact model request');
  const runMessages = after.messages.slice(userIndex);
  const assistant = runMessages.find((message) => message.role === 'assistant' && message.content);
  assert.ok(assistant, 'Persisted history must contain a visible model reply');
  writeJson(`${label}-model-run.json`, {
    runId,
    eventTypes,
    toolStarts,
    toolResults,
    history: {
      user: { id: runMessages[0].id, content: runMessages[0].content },
      assistant: { id: assistant.id, content: assistant.content },
      toolMessages: runMessages.filter((message) => message.role === 'tool')
        .map((message) => ({ id: message.id, toolCallId: message.toolCallId, content: message.content })),
    },
  });
  return { runId, toolResults };
}

async function createJobFixture() {
  const before = await api.listJobs({ spaceId: context.spaceId });
  assert.equal(before.length, 0, 'Dedicated job fixture space must start empty');
  const at = new Date(Date.now() + 7 * 86400_000).toISOString();
  const prompt = `${context.marker} tasks visual scheduled fixture`;
  await runModel('job', 'schedule',
    `Use the schedule tool exactly once now with action="create", prompt="${prompt}", at="${at}", daily=false. `
    + 'This is one new independent one-time task seven days from now. Do not list, cancel, edit, or create any other task. '
    + 'Do not write files or touch any other space or resource. After the tool succeeds, reply briefly.');

  const own = await syncOwnResources();
  if (own.jobs.length !== 1) {
    writeJson('job-creation-failure.json', { expectedAt: at, expectedPrompt: prompt, jobs: own.jobs });
  }
  assert.equal(own.jobs.length, 1, 'Real model must create exactly one dedicated job');
  const job = own.jobs[0];
  assert.equal(job.originSpaceId, context.spaceId);
  assert.equal(job.prompt, prompt);
  assert.equal(job.daily, false);
  assert.equal(job.status, 'scheduled');
  assert.equal(job.enabled, true);
  assert.equal(Date.parse(job.at), Date.parse(at));
  assert.equal(Date.parse(job.nextRunAt), Date.parse(job.at));
  const detail = await api.getJob(job.id);
  assert.equal(detail.job.id, job.id);
  writeJson('job-created.json', { requestedAt: at, detail });
  await assertNoEscapedMarkerResources();
  pass('real external model creates exactly one future one-time job', { id: job.id, at: job.at });
  return job;
}

async function createActivityFixture() {
  const before = await collectActivities(context.spaceId);
  assert.equal(before.length, 0, 'Dedicated activity fixture space must start empty');
  const input = {
    title: `${context.marker} tasks visual activity`,
    goal: `${context.marker} verify real activity history`,
    deliverable: `${context.marker} completed activity record`,
    result: `${context.marker} activity completed`,
  };
  const run = await runModel('activity', 'activity',
    `This is entrusted work in this dedicated space. Call the activity tool exactly twice now: first action="start", title="${input.title}", goal="${input.goal}", deliverable="${input.deliverable}"; then action="complete", result="${input.result}". `
    + 'Do not call any other tool, create a duplicate activity, write files, or touch any other space or resource. '
    + 'After both activity tool calls succeed and the work is delivered, reply briefly.');

  const own = await syncOwnResources();
  if (own.activities.length !== 1) {
    writeJson('activity-creation-failure.json', { expected: input, activities: own.activities });
  }
  assert.equal(own.activities.length, 1, 'Real model must register exactly one dedicated activity');
  const activity = own.activities[0];
  assert.equal(activity.spaceId, context.spaceId);
  // 自然语言字段允许模型补充末尾标点；唯一归属用 marker 和非空内容验收。
  const assertNaturalText = (value) => {
    assert.equal(typeof value, 'string');
    assert.ok(value.trim().length > 0);
    assert.ok(value.includes(context.marker));
  };
  assertNaturalText(activity.title);
  assertNaturalText(activity.goal);
  assertNaturalText(activity.deliverable);
  assert.equal(activity.status, 'completed');
  assertNaturalText(activity.result);
  assert.ok(activity.runIds.includes(run.runId));
  const detail = await api.getActivity(activity.id);
  assert.equal(detail.activity.id, activity.id);
  const stepKinds = new Set(detail.steps.map((step) => step.kind));
  assert.ok(stepKinds.has('execution'));
  assert.ok(stepKinds.has('model'));
  writeJson('activity-created.json', { detail });
  await assertNoEscapedMarkerResources();
  pass('real external model registers and completes one activity', { id: activity.id });
  return activity;
}

async function postMonitor() {
  // 监控创建是权威 REST 契约；这里不走模型，也不为监控发明客户端创建方法。
  const response = await fetch(`${base}/api/monitors`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      url: context.monitorUrl,
      title: `${context.marker}-monitor`,
      condition: 'change',
      intervalMinutes: 30,
      originSpaceId: context.spaceId,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Monitor creation failed with HTTP ${response.status}`);
  const monitor = parseMonitor(await response.json());
  await syncOwnResources();
  return monitor;
}

async function createMonitorFixture() {
  const created = await postMonitor();
  assert.equal(created.url, context.monitorUrl);
  assert.equal(created.condition, 'change');
  assert.equal(created.intervalMinutes, 30);
  assert.equal(created.originSpaceId, context.spaceId);
  assert.equal(created.status, 'active');

  const list = await api.listMonitors({ spaceId: context.spaceId });
  sameIds(list, context.resourceIds.monitors);
  const detail = await api.getMonitor(created.id);
  assert.deepEqual(detail, created);

  const pause = await api.controlMonitor(created.id, 'pause');
  assert.equal(pause.status, 'paused');
  const pausedRead = await api.getMonitor(created.id);
  assert.equal(pausedRead.status, 'paused');
  const resume = await api.controlMonitor(created.id, 'resume');
  assert.equal(resume.status, 'active');
  const activeRead = await api.getMonitor(created.id);
  assert.equal(activeRead.status, 'active');
  const finalPause = await api.controlMonitor(created.id, 'pause');
  assert.equal(finalPause.status, 'paused');
  const finalRead = await api.getMonitor(created.id);
  assert.equal(finalRead.status, 'paused');
  writeJson('monitor-created.json', { created, controls: { pause, pausedRead, resume, activeRead, finalPause, finalRead } });
  await assertNoEscapedMarkerResources();
  pass('authoritative REST creates a real monitor and pause/resume control round-trips', { id: created.id });
  return finalRead;
}

async function verifyJobControl(jobId) {
  const pause = await api.controlJob(jobId, 'pause');
  assert.equal(pause.status, 'paused');
  assert.equal(pause.enabled, false);
  const pausedDetail = await api.getJob(jobId);
  assert.equal(pausedDetail.job.status, 'paused');
  const resume = await api.controlJob(jobId, 'resume');
  assert.equal(resume.status, 'scheduled');
  assert.equal(resume.enabled, true);
  const resumedDetail = await api.getJob(jobId);
  assert.equal(resumedDetail.job.status, 'scheduled');
  writeJson('job-control.json', { pause, pausedDetail, resume, resumedDetail });
  pass('actual client job pause/resume control persists and restores scheduled state', { id: jobId });
  return resumedDetail.job;
}

async function prepare() {
  const deploymentInfo = await deployment('prepare');
  context.serviceVersion = deploymentInfo.serviceVersion;
  context.openapiHash = deploymentInfo.openapiHash;
  writeContext();
  pass('docs OpenAPI and health version identity agree', { serviceVersion: deploymentInfo.serviceVersion });

  await authenticate();
  const baselineResources = await readResources();
  context.baselineIds = baselineFrom(baselineResources);
  writeContext();
  writeBaselineEvidence('baseline-prepare.json', baselineResources);
  assert.equal(baselineResources.spaces.some((space) => space.id === context.spaceId), false, 'Dedicated space must start absent');
  assert.equal(baselineResources.jobs.some((job) => job.originSpaceId === context.spaceId || job.prompt.includes(context.marker)), false);
  assert.equal(baselineResources.activities.some((activity) => activity.spaceId === context.spaceId
    || [activity.title, activity.goal, activity.deliverable, activity.result].some((text) => text?.includes(context.marker))), false);
  assert.equal(baselineResources.monitors.some((monitor) => monitor.originSpaceId === context.spaceId || monitor.url.includes(context.marker)), false);
  pass('dedicated space and marker resources start absent', {
    baselineCounts: {
      spaces: baselineResources.spaces.length,
      jobs: baselineResources.jobs.length,
      activities: baselineResources.activities.length,
      monitors: baselineResources.monitors.length,
    },
  });

  const rules = `Dedicated tasks UI visual acceptance ${context.marker}. Only operate resources in space ${context.spaceId}. `
    + 'When explicitly requested, use only the schedule or activity tool. Never write files or modify workspace data. '
    + 'Never use subagents, memory, goals, monitors, other spaces, or existing resources. Never create duplicates.';
  context.spaceMayExist = true;
  writeContext();
  const saved = await api.saveSpaceInstructions(context.spaceId, rules);
  assert.equal(saved.instructions, rules);
  writeJson('space-instructions.json', { spaceId: context.spaceId, instructions: saved.instructions });

  const job = await createJobFixture();
  await verifyJobControl(job.id);
  await createActivityFixture();
  const monitor = await createMonitorFixture();

  const own = await syncOwnResources();
  assert.equal(own.jobs.length, 1);
  assert.equal(own.activities.length, 1);
  assert.equal(own.monitors.length, 1);
  const [jobDetail, activityDetail] = await Promise.all([
    api.getJob(own.jobs[0].id),
    api.getActivity(own.activities[0].id),
  ]);
  writeJson('prepare-resources.json', {
    jobs: own.jobs,
    activities: own.activities,
    monitors: own.monitors,
    details: { job: jobDetail, activity: activityDetail, monitor },
  });
  assert.equal(jobDetail.job.status, 'scheduled');
  assert.equal(activityDetail.activity.status, 'completed');
  assert.equal(monitor.status, 'paused');

  context.phase = 'prepared';
  context.preparedAt = new Date().toISOString();
  writeContext();
  pass('prepare retains exactly one job, completed activity and paused monitor for native UI');
}

async function verify() {
  assert.ok(['prepared', 'verified'].includes(context.phase), 'verify requires a successful prepare context');
  const deploymentInfo = await deployment('verify');
  assert.deepEqual(deploymentInfo.serviceVersion, context.serviceVersion, 'Service version changed after prepare');
  assert.equal(deploymentInfo.openapiHash, context.openapiHash, 'OpenAPI deployment changed after prepare');
  pass('deployment identity remains unchanged after native visual pass');

  await authenticate();
  const current = await readResources();
  writeBaselineEvidence('baseline-verify.json', current);
  assertBaselineRetained(current);
  pass('all prepare baseline resources remain present');

  const own = await readOwnResources();
  sameIds(own.jobs, context.resourceIds.jobs);
  sameIds(own.activities, context.resourceIds.activities);
  sameIds(own.monitors, context.resourceIds.monitors);
  assert.equal(own.jobs.length, 1);
  assert.equal(own.activities.length, 1);
  assert.equal(own.monitors.length, 1);

  const jobDetail = await api.getJob(context.resourceIds.jobs[0]);
  const job = jobDetail.job;
  assert.equal(job.originSpaceId, context.spaceId);
  assert.equal(job.daily, false);
  assert.equal(job.status, 'scheduled');
  assert.equal(job.enabled, true);
  assert.ok(job.prompt.startsWith(context.marker));
  assert.ok(Date.parse(job.at) >= Date.now() + 6 * 86400_000, 'Job must still be a future one-time fixture');
  assert.ok(Date.parse(job.at) <= Date.parse(context.preparedAt) + 8 * 86400_000);
  assert.equal(Date.parse(job.nextRunAt), Date.parse(job.at));

  const activityDetail = await api.getActivity(context.resourceIds.activities[0]);
  const activity = activityDetail.activity;
  assert.equal(activity.spaceId, context.spaceId);
  assert.equal(activity.status, 'completed');
  assert.ok(activity.title.startsWith(context.marker));
  assert.ok(activity.result?.includes(context.marker));
  assert.ok(activity.runIds.some((runId) => context.runIds.includes(runId)));
  const stepKinds = new Set(activityDetail.steps.map((step) => step.kind));
  assert.ok(stepKinds.has('execution'));
  assert.ok(stepKinds.has('model'));

  const monitor = await api.getMonitor(context.resourceIds.monitors[0]);
  assert.equal(monitor.url, context.monitorUrl);
  assert.equal(monitor.condition, 'change');
  assert.equal(monitor.intervalMinutes, 30);
  assert.equal(monitor.originSpaceId, context.spaceId);
  assert.equal(monitor.status, 'paused');

  writeJson('verify-resources.json', { jobDetail, activityDetail, monitor });
  context.phase = 'verified';
  writeContext();
  pass('read-only verify confirms exact job, completed activity, paused monitor and ownership');
}

async function cleanup() {
  const previousCleanupFailed = context.phase === 'cleanup-failed';
  assert.ok(
    ['prepared', 'verified', 'prepare-failed', 'verify-failed', 'cleanup-failed'].includes(context.phase),
    'cleanup requires a known context',
  );
  const deploymentInfo = await deployment('cleanup');
  assert.deepEqual(deploymentInfo.serviceVersion, context.serviceVersion, 'Service version changed; refuse cleanup');
  assert.equal(deploymentInfo.openapiHash, context.openapiHash, 'OpenAPI changed; refuse cleanup');

  await authenticate();
  const before = await readResources();
  writeBaselineEvidence('baseline-cleanup-before.json', before);
  assertBaselineRetained(before);

  if (!context.spaceMayExist) {
    assert.equal(before.spaces.some((space) => space.id === context.spaceId), false);
    assert.deepEqual(context.resourceIds, { jobs: [], activities: [], monitors: [] });
    writeJson('cleanup-result.json', { deleted: false, reason: 'prepare stopped before space creation' });
    context.phase = 'cleaned';
    writeContext();
    pass('no dedicated space existed; nothing to delete');
    return;
  }

  // cleanup 的授权范围来自 prepare 登记；回读不能把 context 中的原始 ID 覆盖掉。
  const own = await readOwnResources();
  sameIds(own.jobs, context.resourceIds.jobs);
  sameIds(own.activities, context.resourceIds.activities);
  sameIds(own.monitors, context.resourceIds.monitors);
  if (!before.spaces.some((space) => space.id === context.spaceId)) {
    // saveSpaceInstructions 或删除结果未明时，只回读确认；不为了“补删”重发写请求。
    assert.deepEqual([own.jobs, own.activities, own.monitors], [[], [], []]);
    assert.equal(before.jobs.some((job) => context.resourceIds.jobs.includes(job.id)), false);
    assert.equal(before.activities.some((activity) => context.resourceIds.activities.includes(activity.id)), false);
    assert.equal(before.monitors.some((monitor) => context.resourceIds.monitors.includes(monitor.id)), false);
    writeJson('cleanup-result.json', { deleted: false, reason: 'dedicated space already absent and scoped resources are empty' });
    context.phase = 'cleaned';
    writeContext();
    pass('dedicated space already absent; scoped readback is empty');
    return;
  }
  for (const job of own.jobs) {
    assert.equal(job.originSpaceId, context.spaceId);
    assert.ok(job.prompt.includes(context.marker));
  }
  for (const activity of own.activities) {
    assert.equal(activity.spaceId, context.spaceId);
    assert.ok(activity.title.includes(context.marker));
  }
  for (const monitor of own.monitors) {
    assert.equal(monitor.originSpaceId, context.spaceId);
    assert.equal(monitor.url, context.monitorUrl);
  }

  // 上次 cleanup 已失败时不自动重发删除；只有回读证明已经删完才允许收口。
  let deleted;
  if (previousCleanupFailed) {
    const alreadyGone = !before.spaces.some((space) => space.id === context.spaceId)
      && own.jobs.length === 0 && own.activities.length === 0 && own.monitors.length === 0;
    if (!alreadyGone) throw new Error('Previous cleanup failed; inspect evidence and clean manually without replaying the delete');
    deleted = { ok: true, removed: { jobs: 0, monitors: 0 } };
  } else {
    try {
      deleted = await api.deleteSpace(context.spaceId);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
      deleted = { ok: true, removed: { jobs: 0, monitors: 0 } };
    }
  }
  assert.equal(deleted.ok, true);
  assert.equal(deleted.removed.jobs, context.resourceIds.jobs.length);
  assert.equal(deleted.removed.monitors, context.resourceIds.monitors.length);

  const after = await readResources();
  const retained = assertBaselineRetained(after);
  assert.equal(after.spaces.some((space) => space.id === context.spaceId), false);
  assert.equal(after.jobs.some((job) => context.resourceIds.jobs.includes(job.id)), false);
  assert.equal(after.monitors.some((monitor) => context.resourceIds.monitors.includes(monitor.id)), false);
  assert.equal(after.activities.some((activity) => context.resourceIds.activities.includes(activity.id)), false);
  const scopedAfter = await Promise.all([
    api.listJobs({ spaceId: context.spaceId }),
    api.listMonitors({ spaceId: context.spaceId }),
    collectActivities(context.spaceId),
  ]);
  assert.deepEqual(scopedAfter, [[], [], []]);

  writeJson('cleanup-result.json', { deleted: true, removed: deleted.removed, baselineRetained: retained.current });
  context.phase = 'cleaned';
  writeContext();
  pass('cleanup removes only registered dedicated resources and space; baseline retained');
}

try {
  if (phase === 'prepare') await prepare();
  else if (phase === 'verify') await verify();
  else await cleanup();
} catch (error) {
  failure = error;
  if (phase === 'prepare') {
    try {
      if (token) await syncOwnResources();
    } catch (syncError) {
      console.error('FAIL resource sync after prepare error', syncError.message);
    }
  }
  context.phase = `${phase}-failed`;
  writeContext();
  console.error('FAIL', error.stack);
} finally {
  token = undefined;
  writeJson(`${phase}-results.json`, {
    passed: !failure,
    phase,
    base,
    marker: context.marker,
    spaceId: context.spaceId,
    checks,
    error: failure?.message,
    completedAt: new Date().toISOString(),
  });
  console.log('Evidence:', output);
}

if (failure) process.exitCode = 1;
