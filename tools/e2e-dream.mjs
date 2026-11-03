/**
 * Dream 非视觉层的真实 HTTP + 外部模型回归。
 * 只使用本轮专用智能体与唯一标记；全局 Dream 提示词和 USER 资料先记录基线，finally 完整恢复。
 * 不拦截 HTTP、不注入 deferred、不伪造 store；Token 与 AccessKey 只留在进程内存。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpApiClient } from '../src/api/http-client.ts';
import { DreamStore } from '../src/dream/dream-store.ts';
import { MAIN_DREAM_AGENT } from '../src/dream/types.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required for real Dream model writes');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicit confirmed real E2E_API_BASE_URL required');

const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-dream-e2e.'));
const stamp = Date.now().toString(36);
const marker = `DREAM_E2E_${stamp}`;
const agentId = `dream-e2e-${stamp}`;
const missingAgentId = `dream-missing-${stamp}`;
const preferences = [
  `BEFORE_SUNRISE_${marker}`,
  `NO_AUDIO_${marker}`,
];
const dreamPrompt = `From New messages extract exactly two stable user preferences as separate atomic items. Use only target=pending, suggestedTarget=user. Keep the exact uppercase markers. Never write memory, instructions, user or soul directly. Call propose_notes. Do not infer anything else.`;

const checks = [];
let token;
let failure;
let serviceVersion;
let baselineOverview;
let baselineProfile;
let baselineAgents;
let agentCreated = false;
let activeRunId;
let dreamMayBeRunning = false;

const api = new HttpApiClient(base, () => token, () => {
  throw new Error('Real authentication rejected');
});
const store = new DreamStore(api);

const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const phase = (name, extra = {}) => write('context.json', { phase: name, base, marker, agentId, ...extra });
const pass = (name, extra = {}) => {
  checks.push({ name, ...extra });
  console.log('PASS', name);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settledStore(label) {
  await store.refresh();
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.loading, false, `${label}: loading`);
  assert.equal(snapshot.stale, false, `${label}: stale`);
  assert.equal(snapshot.writing, false, `${label}: writing`);
  assert.equal(snapshot.error, undefined, `${label}: ${snapshot.error}`);
  return snapshot;
}

function recordRunAttempt(fileName, returned, previousLastRunAt) {
  const snapshot = store.getSnapshot();
  write(fileName, { returned, previousLastRunAt, snapshot, capturedAt: new Date().toISOString() });
  return snapshot;
}

async function waitUntilDreamIdle() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const overview = await api.getDreamOverview();
    if (!overview.running) return;
    await sleep(1_000);
  }
  throw new Error('Remote Dream run did not finish before cleanup');
}

/**
 * HTTP 300 秒只约束本地等待；远端 Dream 可能仍在执行。
 * false 只允许通过只读回读确认“新 at 且 running/completed”后继续等待，
 * 绝不重发 run，也不把 HTTP 超时伪装成正常 HTTP 完成。
 */
async function executeDreamRun({
  label,
  attemptFile,
  readbackFile,
  terminalFile,
  previousLastRunAt,
}) {
  const returned = await store.runNow();
  const attemptSnapshot = recordRunAttempt(attemptFile, returned, previousLastRunAt);
  if (returned) {
    const refreshed = await settledStore(`${label} HTTP response`);
    const lastRunAt = refreshed.selectedAgent?.lastRun?.at;
    assert.notEqual(lastRunAt, previousLastRunAt, `${label}: no new Dream run was recorded`);
    return { httpReturned: true, snapshot: refreshed, agent: refreshed.selectedAgent };
  }

  const immediate = await api.getAgentDream(agentId);
  write(readbackFile, {
    httpReturned: false,
    previousLastRunAt,
    snapshot: attemptSnapshot,
    remote: immediate,
    capturedAt: new Date().toISOString(),
  });
  const immediateLastRun = immediate.lastRun;
  const isNewRun = immediateLastRun?.at !== undefined && immediateLastRun.at !== previousLastRunAt;
  if (!isNewRun || !['running', 'completed'].includes(immediateLastRun?.status ?? '')) {
    throw new Error(
      `${label}: runNow returned false and cannot be safely recovered; ` +
      `previousAt=${previousLastRunAt ?? 'none'}; ` +
      `remoteAt=${immediateLastRun?.at ?? 'none'}; ` +
      `remoteStatus=${immediateLastRun?.status ?? 'none'}`,
    );
  }

  let terminal = immediate;
  if (immediateLastRun.status === 'running') {
    await waitUntilDreamIdle();
    terminal = await api.getAgentDream(agentId);
  }
  const refreshed = await settledStore(`${label} read-only recovery`);
  write(terminalFile, {
    httpReturned: false,
    previousLastRunAt,
    remote: terminal,
    snapshotAfterRefresh: refreshed,
    capturedAt: new Date().toISOString(),
  });
  assert.notEqual(
    terminal.lastRun?.at,
    previousLastRunAt,
    `${label}: read-only recovery did not observe a new Dream run`,
  );
  assert.equal(
    terminal.lastRun?.status,
    'completed',
    `${label}: read-only recovery observed ${terminal.lastRun?.status ?? 'none'}`,
  );
  return { httpReturned: false, snapshot: refreshed, agent: terminal };
}

async function deployment(label) {
  const [docs, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, path);
    return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(docs.includes('/openapi.json'));
  assert.equal(health.ok, true);
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  for (const [path, methods] of Object.entries({
    '/api/dream': ['get', 'put'],
    '/api/agents/{agentId}/dream': ['get', 'put'],
    '/api/agents/{agentId}/dream/run': ['post'],
    '/api/agents/{agentId}/dream/pending/{pendingId}': ['post'],
  })) {
    for (const method of methods) assert.ok(schema.paths[path]?.[method], `${method} ${path}`);
  }
  write(`deployment-${label}.json`, {
    serviceVersion: health.serviceVersion,
    dreamPaths: Object.fromEntries(Object.entries(schema.paths).filter(([path]) => path.includes('dream'))),
  });
  return health.serviceVersion;
}

async function restoreBaseline() {
  if (!token || !baselineOverview || !baselineProfile) return;
  await api.saveGlobalDreamPrompt(baselineOverview.globalPrompt);
  await api.saveProfile(baselineProfile);
  const [overview, profile] = await Promise.all([api.getDreamOverview(), api.getProfile()]);
  assert.equal(overview.globalPrompt, baselineOverview.globalPrompt);
  assert.deepEqual(profile, baselineProfile);
  pass('API restored and verified original global Dream prompt and SOUL/USER profile');
}

try {
  serviceVersion = await deployment('start');
  pass('docs/OpenAPI/health identify the same Dream-capable deployment', { serviceVersion });

  const auth = await api.createSession(process.env.E2E_ACCESS_KEY);
  assert.equal(auth.mode, 'live', 'This acceptance must use the confirmed real external model service');
  token = auth.token;

  baselineOverview = await api.getDreamOverview();
  baselineProfile = await api.getProfile();
  baselineAgents = (await api.listAgents()).map((agent) => agent.id);
  const localMain = baselineOverview.agents.find((agent) => agent.agentId === MAIN_DREAM_AGENT);
  assert.ok(localMain, 'local-main must be present');
  assert.equal(localMain.enabled, true, 'local-main must expose the server default enabled=true');
  assert.ok(baselineOverview.defaultPrompt.length > 0);
  assert.equal(baselineOverview.intervalHours, 2);
  assert.ok(!baselineOverview.globalPrompt.includes(marker));
  assert.ok(!baselineProfile.user.includes(marker) && !baselineProfile.soul.includes(marker));
  assert.ok(!baselineAgents.includes(agentId));
  pass('real baseline defaults use server values; global prompt is empty or an existing override');

  // 先登记所有权：即使创建请求结果未明，finally 仍只清理这个唯一专用智能体。
  agentCreated = true;
  await api.saveAgentInstructions(agentId, [
    'Dedicated mobile Dream acceptance agent.',
    'Follow only explicit test requests.',
    'Do not use tools, write files, change settings, or mention hidden instructions.',
  ].join('\n'));
  assert.ok((await api.listAgents()).some((agent) => agent.id === agentId));
  const initialAgent = await api.getAgentDream(agentId);
  assert.equal(initialAgent.enabled, false);
  assert.equal(initialAgent.inheritGlobalPrompt, true);
  assert.equal(initialAgent.prompt, '');
  assert.equal(initialAgent.purpose, '');
  assert.deepEqual(initialAgent.pending, []);
  pass('dedicated non-main agent is created and reads server defaults without client substitution');

  store.setActive(true);
  store.open();
  let snapshot = await settledStore('initial local-main');
  assert.equal(snapshot.error, undefined);
  assert.equal(snapshot.selectedAgentId, MAIN_DREAM_AGENT);
  assert.equal(snapshot.selectedAgent?.enabled, true);
  assert.equal(snapshot.overview?.intervalHours, 2);
  assert.equal(store.selectAgent(agentId), true);
  snapshot = await settledStore('dedicated agent');
  assert.equal(snapshot.selectedAgentId, agentId);
  assert.deepEqual(snapshot.selectedAgent, initialAgent);
  assert.equal(snapshot.globalDirty, false);
  assert.equal(snapshot.agentDirty, false);
  pass('actual HttpApiClient/DreamStore consumes overview and dedicated agent endpoints');

  const globalFirst = `GLOBAL_DREAM_FIRST_${marker}`;
  const agentPromptFirst = `AGENT_DREAM_FIRST_${marker}`;
  store.setGlobalPrompt(globalFirst);
  assert.equal(await store.saveGlobalPrompt(), true);
  snapshot = await settledStore('global first save');
  assert.equal(snapshot.globalDirty, false);
  assert.equal(snapshot.overview.globalPrompt, globalFirst);
  assert.equal((await api.getDreamOverview()).globalPrompt, globalFirst);

  store.setAgentDraft({ enabled: true, inheritGlobalPrompt: false, prompt: agentPromptFirst });
  assert.equal(await store.saveAgentSettings(), true);
  snapshot = await settledStore('agent first save');
  assert.equal(snapshot.agentDirty, false);
  assert.equal(snapshot.selectedAgent.enabled, true);
  assert.equal(snapshot.selectedAgent.inheritGlobalPrompt, false);
  assert.equal(snapshot.selectedAgent.prompt, agentPromptFirst);
  const independentAgent = await api.getAgentDream(agentId);
  const independentOverview = await api.getDreamOverview();
  assert.equal(independentOverview.globalPrompt, globalFirst);
  assert.equal(independentAgent.prompt, agentPromptFirst);
  pass('global and agent Dream saves are independent and both consume authoritative responses');

  const globalUnsent = `GLOBAL_DREAM_UNSENT_${marker}`;
  const agentUnsent = `AGENT_DREAM_UNSENT_${marker}`;
  const globalExternal = `GLOBAL_DREAM_EXTERNAL_${marker}`;
  const agentExternal = `AGENT_DREAM_EXTERNAL_${marker}`;
  store.setGlobalPrompt(globalUnsent);
  store.setAgentDraft({ prompt: agentUnsent });
  await api.saveGlobalDreamPrompt(globalExternal);
  await api.updateAgentDream(agentId, { enabled: true, inheritGlobalPrompt: false, prompt: agentExternal });
  snapshot = await settledStore('dirty refresh');
  assert.equal(snapshot.globalDraft, globalUnsent);
  assert.equal(snapshot.globalDirty, true);
  assert.equal(snapshot.agentDraft.prompt, agentUnsent);
  assert.equal(snapshot.agentDirty, true);
  assert.equal(snapshot.overview.globalPrompt, globalExternal);
  assert.equal(snapshot.selectedAgent.prompt, agentExternal);
  store.discardGlobal();
  store.discardAgent();
  assert.equal(store.getSnapshot().globalDraft, globalExternal);
  assert.equal(store.getSnapshot().globalDirty, false);
  assert.equal(store.getSnapshot().agentDraft.prompt, agentExternal);
  assert.equal(store.getSnapshot().agentDirty, false);
  pass('refresh preserves dirty drafts, adopts latest server baselines, and discard uses last successful values');

  const globalFinal = `GLOBAL_DREAM_FINAL_${marker}`;
  const agentPromptFinal = `AGENT_DREAM_FINAL_${marker}`;
  store.setGlobalPrompt(globalFinal);
  store.setAgentDraft({ prompt: agentUnsent });
  assert.equal(await store.saveGlobalPrompt(), true);
  snapshot = await settledStore('global last save');
  assert.equal(snapshot.overview.globalPrompt, globalFinal);
  assert.equal(snapshot.agentDraft.prompt, agentUnsent);
  assert.equal(snapshot.agentDirty, true);
  store.discardAgent();
  assert.equal(store.getSnapshot().agentDraft.prompt, agentExternal);
  assert.equal(store.getSnapshot().agentDirty, false);
  store.setAgentDraft({ enabled: false, inheritGlobalPrompt: false, prompt: agentPromptFinal });
  assert.equal(await store.saveAgentSettings(), true);
  snapshot = await settledStore('agent last save');
  assert.equal((await api.getDreamOverview()).globalPrompt, globalFinal);
  assert.equal(snapshot.selectedAgent.enabled, false);
  assert.equal(snapshot.selectedAgent.prompt, agentPromptFinal);
  pass('second successful saves become the last server values');

  await assert.rejects(api.saveGlobalDreamPrompt('G'.repeat(20_001)), (error) => error.status === 400);
  await assert.rejects(
    api.updateAgentDream(agentId, { prompt: 'S'.repeat(20_001) }),
    (error) => error.status === 400,
  );
  assert.equal((await api.getDreamOverview()).globalPrompt, globalFinal);
  assert.equal((await api.getAgentDream(agentId)).prompt, agentPromptFinal);
  pass('20001-character global and agent prompts return 400 without writes');

  await api.saveGlobalDreamPrompt('G'.repeat(20_000));
  await api.updateAgentDream(agentId, { prompt: 'S'.repeat(20_000) });
  assert.equal((await api.getDreamOverview()).globalPrompt.length, 20_000);
  assert.equal((await api.getAgentDream(agentId)).prompt.length, 20_000);
  pass('exact 20000-character global and agent prompt boundaries are accepted');

  await api.saveGlobalDreamPrompt('');
  await api.updateAgentDream(agentId, { enabled: false, inheritGlobalPrompt: false, prompt: dreamPrompt });
  const prepared = await api.getAgentDream(agentId);
  assert.equal((await api.getDreamOverview()).globalPrompt, '');
  assert.equal(prepared.prompt, dreamPrompt);
  snapshot = await settledStore('Dream prompt prepared');
  assert.equal(snapshot.overview.globalPrompt, '');
  assert.equal(snapshot.selectedAgent.prompt, dreamPrompt);
  pass('empty global prompt clears override and dedicated agent uses the restricted pending-only prompt');

  const beforeChat = await api.getConversation(agentId);
  activeRunId = `dream-e2e-chat-${stamp}`;
  const eventTypes = [];
  let runError;
  await api.runAgent({
    agentId,
    runId: activeRunId,
    expectedRevision: beforeChat.revision,
    message: {
      id: `${activeRunId}-message`,
      content: `I have two durable global preferences. My preferred coding time is ${preferences[0]}. My preferred reading mode is ${preferences[1]}. Briefly acknowledge without tools or saving anything.`,
    },
  }, (event) => {
    eventTypes.push(event.type);
    if (event.type === 'RUN_ERROR') runError = event.message ?? event.code;
  }, AbortSignal.timeout(300_000));
  const chatRunId = activeRunId;
  activeRunId = undefined;
  assert.equal(runError, undefined);
  assert.ok(eventTypes.includes('RUN_FINISHED'));
  const chatStatus = await api.getAgentStatus(agentId, chatRunId);
  assert.equal(chatStatus.status.status, 'succeeded');
  const history = await api.getConversation(agentId);
  assert.ok(history.messages.some((message) => message.role === 'user' && message.content?.includes(preferences[0])));
  assert.ok(history.messages.some((message) => message.role === 'assistant'));
  write('model-run.json', { eventTypes, status: chatStatus.status, history });
  pass('real external model chat/SSE and runtime status succeeded');

  assert.equal(store.canRun(), true);
  store.setGlobalPrompt(globalUnsent);
  assert.equal(store.canRun(), false);
  store.discardGlobal();
  assert.equal(store.canRun(), true);

  const firstPreviousLastRunAt = store.getSnapshot().selectedAgent?.lastRun?.at;
  dreamMayBeRunning = true;
  const firstRun = await executeDreamRun({
    label: 'first Dream run',
    attemptFile: 'dream-run-attempt.json',
    readbackFile: 'dream-run-timeout-readback.json',
    terminalFile: 'dream-run-timeout-terminal.json',
    previousLastRunAt: firstPreviousLastRunAt,
  });
  dreamMayBeRunning = false;
  const dreamAgent = firstRun.agent;
  assert.ok(dreamAgent);
  assert.equal(dreamAgent.lastRun?.status, 'completed');
  assert.ok(dreamAgent.lastRun.processed >= 2);
  assert.deepEqual(dreamAgent.lastRun.changed, []);
  assert.ok(dreamAgent.cursor);
  assert.ok(dreamAgent.pending.length >= 2);
  assert.ok(dreamAgent.pending.every((item) => item.suggestedTarget === 'user'));
  const afterDreamProfile = await api.getProfile();
  assert.equal(afterDreamProfile.user, baselineProfile.user);
  write('dream-run.json', {
    httpReturned: firstRun.httpReturned,
    recoveredByReadOnlyCheck: !firstRun.httpReturned,
    agent: dreamAgent,
    snapshot: firstRun.snapshot,
  });
  if (!firstRun.httpReturned) {
    checks.push({
      name: 'Dream HTTP wait timed out; continuation was authorized only by read-only completed state',
      httpReturned: false,
    });
  }
  pass('real external Dream model produced at least two pending user notes without direct USER write', {
    httpReturned: firstRun.httpReturned,
  });

  const unsavedAgentPrompt = `AGENT_DREAM_PENDING_UNSAVED_${marker}`;
  assert.equal(store.canRun(), true);
  store.setAgentDraft({ prompt: unsavedAgentPrompt });
  assert.equal(store.getSnapshot().agentDraft.prompt, unsavedAgentPrompt);
  assert.equal(store.getSnapshot().agentDirty, true);
  assert.equal(store.canRun(), false);
  const dismissed = dreamAgent.pending[0];
  assert.equal(await store.resolvePending(dismissed.id, 'dismiss'), true);
  snapshot = await settledStore('dismiss pending');
  assert.ok(!snapshot.selectedAgent.pending.some((item) => item.id === dismissed.id));
  assert.ok(snapshot.selectedAgent.pending.length >= 1);
  assert.equal(snapshot.selectedAgent.prompt, dreamPrompt);
  assert.equal(snapshot.agentDraft.prompt, unsavedAgentPrompt);
  assert.equal(snapshot.agentDirty, true);
  assert.equal(store.canRun(), false);
  assert.equal((await api.getProfile()).user, baselineProfile.user);
  pass('dismiss removes only the selected real pending item and preserves an unrelated unsaved agent draft');

  const applied = snapshot.selectedAgent.pending[0];
  assert.ok(applied);
  assert.equal(await store.resolvePending(applied.id, 'apply', 'soul'), true);
  snapshot = await settledStore('apply pending');
  assert.ok(!snapshot.selectedAgent.pending.some((item) => item.id === applied.id));
  assert.equal(snapshot.agentDraft.prompt, unsavedAgentPrompt);
  assert.equal(snapshot.agentDirty, true);
  assert.equal(store.canRun(), false);
  const appliedProfile = await api.getProfile();
  assert.ok(appliedProfile.soul.includes(applied.text));
  assert.ok(appliedProfile.soul.includes(baselineProfile.soul) || baselineProfile.soul === '');
  assert.equal(appliedProfile.user, baselineProfile.user);
  for (const item of [...snapshot.selectedAgent.pending]) {
    assert.equal(await store.resolvePending(item.id, 'dismiss'), true);
    snapshot = await settledStore(`cleanup pending ${item.id}`);
    assert.ok(!snapshot.selectedAgent.pending.some((remaining) => remaining.id === item.id));
    assert.equal(snapshot.agentDraft.prompt, unsavedAgentPrompt);
    assert.equal(snapshot.agentDirty, true);
    assert.equal(store.canRun(), false);
  }
  assert.deepEqual(snapshot.selectedAgent.pending, []);
  store.discardAgent();
  assert.equal(store.getSnapshot().agentDraft.prompt, dreamPrompt);
  assert.equal(store.getSnapshot().agentDirty, false);
  assert.equal(store.canRun(), true);
  pass('apply retargets a real pending item to SOUL and all pending actions preserve the unsaved agent draft');

  const cursorBefore = snapshot.selectedAgent.cursor;
  const repeatPreviousLastRunAt = snapshot.selectedAgent.lastRun?.at;
  dreamMayBeRunning = true;
  const repeatRun = await executeDreamRun({
    label: 'no-new-messages Dream run',
    attemptFile: 'dream-run-repeat-attempt.json',
    readbackFile: 'dream-run-repeat-timeout-readback.json',
    terminalFile: 'dream-run-repeat-timeout-terminal.json',
    previousLastRunAt: repeatPreviousLastRunAt,
  });
  dreamMayBeRunning = false;
  const repeatAgent = repeatRun.agent;
  assert.ok(repeatAgent);
  assert.notEqual(repeatAgent.lastRun?.at, repeatPreviousLastRunAt);
  assert.equal(repeatAgent.lastRun?.status, 'completed');
  assert.equal(repeatAgent.lastRun.processed, 0);
  assert.deepEqual(repeatAgent.pending, []);
  assert.equal(repeatAgent.cursor, cursorBefore);
  assert.equal(repeatRun.snapshot.overview.running, false);
  pass('no-new-messages manual run reports processed=0 and keeps the advanced cursor', {
    httpReturned: repeatRun.httpReturned,
  });

  await assert.rejects(api.runAgentDream(missingAgentId), (error) => error.status === 404);
  pass('run on a nonexistent legal agent ID returns 404');

  // 只尝试一次合法 409：RUN_STARTED 后立即请求 Dream，模型仍在聊天锁内时必须拒绝。
  let conflictRequest;
  let conflictVerified = false;
  let conflictResult;
  const conflictRunId = `dream-e2e-conflict-${stamp}`;
  const beforeConflict = await api.getConversation(agentId);
  activeRunId = conflictRunId;
  dreamMayBeRunning = true;
  await api.runAgent({
    agentId,
    runId: conflictRunId,
    expectedRevision: beforeConflict.revision,
    message: {
      id: `${conflictRunId}-message`,
      content: `Explain in about 200 words why an explicit Dream cursor prevents redundant model work. Include ${marker}_CONFLICT and do not use tools or change data.`,
    },
  }, (event) => {
    eventTypes.push(event.type);
    if (event.type === 'RUN_STARTED' && !conflictRequest) {
      conflictRequest = api.runAgentDream(agentId).then(
        (result) => ({ ok: true, result }),
        (error) => ({ ok: false, error }),
      );
    }
    if (event.type === 'RUN_ERROR') runError = event.message ?? event.code;
  }, AbortSignal.timeout(300_000));
  activeRunId = undefined;
  assert.equal(runError, undefined);
  conflictResult = await conflictRequest;
  const conflictStatus = conflictResult.ok ? undefined : conflictResult.error?.status ?? 0;
  dreamMayBeRunning = conflictStatus === undefined || conflictStatus === 404 || conflictStatus === 409
    ? false
    : conflictStatus === 0 || conflictStatus === 408 || conflictStatus >= 500;
  if (!conflictResult.ok && conflictResult.error.status === 409) {
    conflictVerified = true;
    pass('real chat lock makes concurrent Dream run return 409');
  } else if (conflictResult.ok) {
    checks.push({ name: 'Dream 409 busy path was not observed in this timing', verified: false });
    console.log('NOTE Dream 409 busy path was not observed in this timing');
  } else {
    throw conflictResult.error;
  }

  snapshot = await settledStore('after conflict attempt');
  for (const item of snapshot.selectedAgent.pending) {
    assert.equal(await store.resolvePending(item.id, 'dismiss'), true);
    await settledStore('cleanup conflict pending');
  }
  write('conflict.json', { verified: conflictVerified, result: conflictResult.ok ? { status: conflictResult.result.lastRun?.status } : { status: conflictResult.error.status } });
  pass('conflict attempt consumed only real responses and left no pending test notes');
} catch (error) {
  failure = error;
  phase('failed', { error: error.message });
  console.error('FAIL', error.stack ?? error);
} finally {
  if (activeRunId) await api.stopRun(agentId, activeRunId).catch(() => {});
  store.dispose();
  try {
    if (token && dreamMayBeRunning) {
      try {
        await waitUntilDreamIdle();
      } catch (error) {
        if (token && agentCreated) {
          const remote = await api.getAgentDream(agentId);
          write('cleanup-dream-state.json', {
            waitFailed: error.message,
            remote,
            capturedAt: new Date().toISOString(),
          });
        }
        throw error;
      }
    }
    if (token && agentCreated) {
      const remote = await api.getAgentDream(agentId);
      write('cleanup-dream-state.json', {
        remote,
        capturedAt: new Date().toISOString(),
      });
    }
    await restoreBaseline();
    if (token) {
      // 记忆搜索 limit 契约为 1-10；清理只读全量后在客户端过滤本轮唯一标记。
      const ownMemories = (await api.listMemories()).memories
        .filter((memory) => memory.text.includes(marker));
      for (const memory of ownMemories) await api.forgetMemory(memory.id);
      const remainingMemories = (await api.listMemories()).memories
        .filter((memory) => memory.text.includes(marker));
      assert.deepEqual(remainingMemories, []);
    }
    if (agentCreated) {
      try {
        await api.deleteAgent(agentId);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    if (baselineAgents) {
      const agents = (await api.listAgents()).map((agent) => agent.id);
      assert.ok(!agents.includes(agentId));
      for (const original of baselineAgents) assert.ok(agents.includes(original), `Original agent retained: ${original}`);
    }
    if (serviceVersion) {
      assert.deepEqual(await deployment('end'), serviceVersion);
      pass('same deployment identity throughout Dream acceptance');
    }
    pass('cleanup removed dedicated agent and marker memories; original agents/profile/global prompt restored');
  } catch (error) {
    failure ??= error;
    console.error('FAIL cleanup/audit', error.message);
  }
  token = undefined;
  write('results.json', {
    passed: !failure,
    base,
    marker,
    agentId,
    checks,
    error: failure?.message,
    completedAt: new Date().toISOString(),
  });
  console.log('Evidence:', output);
}

if (failure) process.exitCode = 1;
