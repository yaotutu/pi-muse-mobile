/** 目标页视觉调整的 prepare|verify|cleanup 真实验收入口。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';

const phase = process.argv[2];
assert.equal(process.argv.length, 3, 'Usage: node --import ./tests/register-source.mjs tools/e2e-goals-visual.mjs prepare|verify|cleanup');
assert.ok(['prepare', 'verify', 'cleanup'].includes(phase), 'Phase must be prepare, verify or cleanup');
assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required');
assert.ok(process.env.E2E_API_BASE_URL && process.env.E2E_GOALS_OUTPUT, 'Real API and evidence directory required');
const parsedBase = new URL(process.env.E2E_API_BASE_URL);
assert.ok(['http:', 'https:'].includes(parsedBase.protocol) && parsedBase.pathname === '/', 'E2E_API_BASE_URL must be an HTTP(S) service root');
const base = parsedBase.origin;
const output = resolve(process.env.E2E_GOALS_OUTPUT);
assert.ok(statSync(output, { throwIfNoEntry: false })?.isDirectory(), 'E2E_GOALS_OUTPUT must be an existing directory');
const contextPath = join(output, 'context.json');
let token, context, failure;
const checks = [];
const api = new HttpApiClient(base, () => token, () => { throw new Error('Real authentication rejected'); });
const writeJson = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const writeContext = () => writeJson('context.json', context);
const pass = (name, extra = {}) => { checks.push({ name, ...extra }); console.log('PASS', name); };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const ids = (items) => [...new Set(items.map((item) => item.id))].sort();
const sameIds = (items, expected) => assert.deepEqual(ids(items), [...new Set(expected)].sort());
const markerGoals = (goals) => goals.filter((goal) => !context.baselineIds.goals.includes(goal.id)
  && [goal.title, goal.description, goal.category].some((value) => value.includes(context.marker)));

if (phase === 'prepare') {
  assert.equal(statSync(contextPath, { throwIfNoEntry: false }), undefined, 'prepare requires no existing context.json');
  const stamp = Date.now().toString(36), marker = `GOALS_UI_${stamp}`;
  context = { phase: 'prepare-started', base, marker, spaceId: `goals-ui-${stamp}`, spaceTitle: marker,
    resourceIds: { goals: [] }, baselineIds: { goals: [], spaces: [] }, modelProof: null };
} else {
  context = JSON.parse(readFileSync(contextPath, 'utf8'));
  assert.equal(context.base, base, 'E2E_API_BASE_URL changed between phases');
  assert.match(context.marker, /^GOALS_UI_[a-z0-9]+$/);
  assert.match(context.spaceId, /^goals-ui-[a-z0-9]+$/);
  assert.equal(context.spaceTitle, context.marker);
  assert.ok(context.resourceIds?.goals instanceof Array && context.baselineIds?.goals instanceof Array && context.baselineIds?.spaces instanceof Array);
  assert.match(context.openapiHash, /^[a-f0-9]{64}$/);
  assert.ok(context.serviceVersion);
}

async function deployment(name) {
  const [html, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, path);
    return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(html.includes('/openapi.json'), '/docs must expose OpenAPI');
  assert.equal(health.ok && health.backend === 'pi' && health.configured, true, 'Configured real pi backend required');
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  const expected = { '/api/goals': ['get', 'post'], '/api/goals/{id}': ['get', 'patch', 'delete'],
    '/api/goals/{id}/milestones/{mid}/toggle': ['post'] };
  for (const [path, methods] of Object.entries(expected)) for (const method of methods) assert.ok(schema.paths[path]?.[method], `${method} ${path}`);
  const result = { serviceVersion: health.serviceVersion, openapiHash: digest(JSON.stringify(schema)) };
  writeJson(`deployment-${name}.json`, { ...result, relevantApi: expected });
  return result;
}

async function authenticate() {
  const auth = await api.createSession(process.env.E2E_ACCESS_KEY);
  assert.equal(auth.mode, 'live', 'Real live model backend is required');
  token = auth.token;
}

async function readResources() {
  const [goals, spaces] = await Promise.all([api.listGoals(), api.listSpaces()]);
  return { goals, spaces };
}

function assertBaselineRetained(resources) {
  const current = { goals: ids(resources.goals), spaces: ids(resources.spaces) };
  for (const kind of ['goals', 'spaces']) assert.deepEqual(context.baselineIds[kind].filter((id) => !current[kind].includes(id)), [], `Baseline ${kind} retained`);
  return current;
}

async function runModel() {
  const history = await api.getConversation(context.spaceId), runId = `goals-ui-${context.marker.slice(-10)}`;
  const eventTypes = {}, toolCalls = [];
  let runError;
  await api.runAgent({ spaceId: context.spaceId, runId, expectedRevision: history.revision,
    message: { id: `${runId}-message`, content: `${context.marker} reply with this marker once and do not call tools.` } },
  (event) => {
    eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
    if (event.type === 'TOOL_CALL_START') toolCalls.push(event.toolCallName);
    if (event.type === 'RUN_ERROR') runError = event.message ?? event.code;
  }, AbortSignal.timeout(300_000));
  assert.equal(runError, undefined, `Real model run failed: ${runError}`);
  assert.ok(eventTypes.RUN_STARTED && eventTypes.RUN_FINISHED);
  assert.deepEqual(toolCalls, [], 'Model proof must not mutate resources');
  const after = await api.getConversation(context.spaceId);
  const start = after.messages.findIndex((message) => message.id === `${runId}-message`);
  const assistant = after.messages.slice(start).find((message) => message.role === 'assistant' && message.content);
  assert.ok(start >= 0 && assistant?.content?.includes(context.marker), 'Persisted model reply must contain marker');
  context.modelProof = { runId, eventTypes, assistantLength: assistant.content.length, assistantSha256: digest(assistant.content) };
  writeJson('model-run.json', context.modelProof);
  pass('real external model responds through HttpApiClient SSE', { runId });
}

function register(goal) {
  context.resourceIds.goals = [...new Set([...context.resourceIds.goals, goal.id])];
  writeContext();
  return goal;
}

async function verifyGoalApi() {
  const active = register(await api.createGoal({ title: `${context.marker} visual active`, category: context.marker,
    description: 'Keep this goal for Android visual and interaction acceptance.', milestones: ['first milestone', 'second milestone'] }));
  const paused = register(await api.createGoal({ title: `${context.marker} visual paused`, category: context.marker,
    description: 'A second status for filtering and sorting checks.' }));
  const temporary = register(await api.createGoal({ title: `${context.marker} temporary delete`, category: context.marker,
    description: 'Delete this goal during prepare.' }));
  assert.equal(Object.hasOwn(active, 'spaceId'), false, 'Goals are global resources');
  assert.deepEqual([active.status, active.milestones.length, paused.milestones.length, temporary.status], ['active', 2, 0, 'active']);
  const pausedGoal = await api.setGoalStatus(paused.id, 'paused');
  assert.equal((await api.getGoal(paused.id)).status, 'paused');
  assert.equal((await api.setGoalStatus(active.id, 'paused')).status, 'paused');
  assert.equal((await api.setGoalStatus(active.id, 'active')).status, 'active');
  const milestone = active.milestones[0];
  const done = await api.toggleMilestone(active.id, milestone.id);
  assert.equal(done.milestones.find((item) => item.id === milestone.id).done, true);
  const undone = await api.toggleMilestone(active.id, milestone.id);
  assert.equal(undone.milestones.find((item) => item.id === milestone.id).done, false);
  sameIds(await api.listGoals({ status: 'active', category: context.marker }), [active.id, temporary.id]);
  sameIds(await api.listGoals({ status: 'paused', category: context.marker }), [paused.id]);
  const ascending = await api.listGoals({ category: context.marker, sort: 'createdAt', order: 'asc' });
  const descending = await api.listGoals({ category: context.marker, sort: 'createdAt', order: 'desc' });
  assert.deepEqual(ascending.map((goal) => goal.id), [active.id, paused.id, temporary.id]);
  assert.deepEqual(descending.map((goal) => goal.id), [...ascending.map((goal) => goal.id)].reverse());
  assert.deepEqual(await api.removeGoal(temporary.id), { ok: true, id: temporary.id });
  sameIds(await api.listGoals({ category: context.marker }), [active.id, paused.id]);
  writeJson('prepare-resources.json', { active, paused: pausedGoal, milestoneRoundTrip: { done, undone } });
  pass('real goal read filter sort status milestone delete APIs round-trip', { activeId: active.id, pausedId: paused.id });
}

async function prepare() {
  Object.assign(context, await deployment('prepare'));
  await authenticate();
  const before = await readResources();
  context.baselineIds = { goals: ids(before.goals), spaces: ids(before.spaces) };
  assert.equal(before.spaces.some((space) => space.id === context.spaceId), false);
  assert.equal(markerGoals(before.goals).length, 0);
  writeContext();
  writeJson('baseline-prepare.json', { counts: { goals: before.goals.length, spaces: before.spaces.length }, baselineIds: context.baselineIds });
  pass('docs OpenAPI health version and clean baseline verified');
  const rules = `Dedicated goals UI acceptance ${context.marker}. Do not call tools unless explicitly requested. Never write files or modify goals, memories, schedules, monitors, other spaces or existing resources.`;
  await api.saveSpaceInstructions(context.spaceId, rules);
  await runModel();
  await verifyGoalApi();
  context.phase = 'prepared';
  context.preparedAt = new Date().toISOString();
  writeContext();
  pass('prepare retains two marker goals and dedicated model space for native UI');
}

async function verify() {
  assert.ok(['prepared', 'verified'].includes(context.phase), 'verify requires successful prepare');
  assert.deepEqual(await deployment('verify'), { serviceVersion: context.serviceVersion, openapiHash: context.openapiHash });
  await authenticate();
  const current = await readResources(), baseline = assertBaselineRetained(current);
  const expected = context.resourceIds.goals.slice(0, 2), actual = current.goals.filter((goal) => expected.includes(goal.id));
  sameIds(actual, expected);
  assert.deepEqual(actual.sort((a, b) => expected.indexOf(a.id) - expected.indexOf(b.id)).map((goal) => goal.milestones.length), [2, 0]);
  for (const goal of actual) assert.equal(goal.title.startsWith(context.marker) && goal.category === context.marker && !Object.hasOwn(goal, 'spaceId'), true);
  writeJson('verify-resources.json', { goals: actual, baseline });
  context.phase = 'verified';
  writeContext();
  pass('verify records native UI status and milestone changes without constraining them');
}

async function cleanup() {
  assert.ok(['prepared', 'verified', 'prepare-failed', 'verify-failed', 'cleanup-failed'].includes(context.phase));
  assert.deepEqual(await deployment('cleanup'), { serviceVersion: context.serviceVersion, openapiHash: context.openapiHash });
  await authenticate();
  const before = await readResources();
  assertBaselineRetained(before);
  const targets = before.goals.filter((goal) => context.resourceIds.goals.includes(goal.id) || markerGoals([goal]).length);
  for (const goal of targets) assert.deepEqual(await api.removeGoal(goal.id), { ok: true, id: goal.id });
  if (before.spaces.some((space) => space.id === context.spaceId)) {
    try { await api.deleteSpace(context.spaceId); } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
  }
  const after = await readResources(), baseline = assertBaselineRetained(after);
  assert.equal(markerGoals(after.goals).length, 0);
  assert.equal(after.goals.some((goal) => context.resourceIds.goals.includes(goal.id)), false);
  assert.equal(after.spaces.some((space) => space.id === context.spaceId), false);
  writeJson('cleanup-result.json', { deletedGoalIds: ids(targets), deletedSpaceId: context.spaceId, baseline });
  context.phase = 'cleaned';
  writeContext();
  pass('cleanup removes only registered marker goals and dedicated space; baseline retained');
}

try {
  if (phase === 'prepare') await prepare();
  else if (phase === 'verify') await verify();
  else await cleanup();
} catch (error) {
  failure = error;
  if (context) {
    if (phase === 'prepare' && token) {
      try { context.resourceIds.goals = ids(markerGoals(await api.listGoals())); } catch { /* 失败时不虚构资源。 */ }
    }
    context.phase = `${phase}-failed`;
    writeContext();
  }
  console.error('FAIL', error.stack);
} finally {
  token = undefined;
  if (context) {
    writeJson(`${phase}-results.json`, { passed: !failure, phase, base, marker: context.marker,
      spaceId: context.spaceId, spaceTitle: context.spaceTitle, checks, error: failure?.message, completedAt: new Date().toISOString() });
    console.log('Evidence:', output);
  }
}
if (failure) process.exitCode = 1;
