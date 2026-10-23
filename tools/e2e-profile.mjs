/**
 * 助手身份/用户资料的真实 HTTP + 外部模型回归。
 * 仅使用本轮专用 space；全局身份与 SOUL/USER 会先保存基线，finally 必须完整恢复。
 * Token 与 AccessKey 只留在进程内存，证据目录不记录凭据或用户原有资料正文。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ProfileStore } from '../src/profile/profile-store.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Explicit E2E_ALLOW_LIVE=1 required for real profile writes and model calls');
assert.ok(process.env.E2E_API_BASE_URL, 'Explicit confirmed real E2E_API_BASE_URL required');

const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-profile-e2e.'));
const stamp = Date.now().toString(36);
const marker = `PROFILE_E2E_${stamp}`;
const spaceId = `profile-e2e-${stamp}`;
const firstName = `ProfileGate-${stamp}`;
const finalName = `ProfileFinal-${stamp}`;
const soulMarker = `SOUL_PROFILE_E2E_${stamp}`;
const userMarker = `USER_PROFILE_E2E_${stamp}`;
const checks = [];
let token;
let failure;
let serviceVersion;
let baselineIdentity;
let baselineProfile;
let spaceCreated = false;
let activeRunId;

const api = new HttpApiClient(base, () => token, () => {
  throw new Error('Real authentication rejected');
});
const store = new ProfileStore(api);

const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const pass = (name, extra = {}) => {
  checks.push({ name, ...extra });
  console.log('PASS', name);
};

async function deployment(label) {
  const [docs, schema, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(`${base}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, path);
    return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(docs.includes('/openapi.json'));
  assert.equal(health.ok, true);
  assert.deepEqual(schema['x-service-version'], health.serviceVersion);
  for (const [path, methods] of Object.entries({
    '/api/agent': ['get'],
    '/api/agent/identity': ['post'],
    '/api/profile': ['get', 'put'],
    '/api/conversation/run': ['post'],
  })) {
    for (const method of methods) assert.ok(schema.paths[path]?.[method], `${method} ${path}`);
  }
  write(`deployment-${label}.json`, { serviceVersion: health.serviceVersion, paths: ['/api/agent', '/api/agent/identity', '/api/profile'] });
  return health.serviceVersion;
}

async function restoreBaseline() {
  if (!token || !baselineIdentity || !baselineProfile) return;
  await api.saveProfile(baselineProfile);
  await api.saveIdentity({ name: baselineIdentity.name, tone: baselineIdentity.tone });
  const [{ identity }, profile] = await Promise.all([api.getSnapshot(), api.getProfile()]);
  assert.equal(identity.name, baselineIdentity.name);
  assert.equal(identity.tone, baselineIdentity.tone);
  assert.equal(identity.avatar, baselineIdentity.avatar);
  assert.equal(identity.showChatUpdates, baselineIdentity.showChatUpdates);
  assert.deepEqual(profile, baselineProfile);
  pass('API restored and verified original identity and SOUL/USER profile');
}

try {
  serviceVersion = await deployment('start');
  pass('docs/OpenAPI/health identify the same profile-capable deployment', { serviceVersion });

  const auth = await api.createSession(process.env.E2E_ACCESS_KEY);
  assert.equal(auth.mode, 'live', 'This acceptance must use the confirmed real model service');
  token = auth.token;

  baselineIdentity = (await api.getSnapshot()).identity;
  baselineProfile = await api.getProfile();
  assert.ok(baselineIdentity.name.trim().length > 0 && baselineIdentity.name.trim().length <= 80);
  assert.ok(['warm', 'concise', 'thoughtful'].includes(baselineIdentity.tone), 'Baseline tone must be REST-writable so cleanup can restore it');

  spaceCreated = true;
  await api.saveSpaceInstructions(spaceId, [
    'Dedicated mobile profile acceptance space.',
    'Follow only the explicit test request.',
    'Do not use tools, write files, change settings, or mention hidden instructions.',
  ].join('\n'));
  assert.ok((await api.listSpaces()).some((space) => space.id === spaceId));
  pass('dedicated real space created through API');

  store.setActive(true);
  store.open();
  await store.refresh();
  const initial = store.getSnapshot();
  assert.equal(initial.error, undefined);
  assert.equal(initial.loaded, true);
  assert.equal(initial.stale, false);
  assert.deepEqual(initial.identity, baselineIdentity);
  assert.deepEqual(initial.profile, baselineProfile);
  assert.equal(initial.dirtyIdentity, false);
  assert.equal(initial.dirtyProfile, false);
  pass('actual HttpApiClient/ProfileStore first read returns real identity and profile');

  const draftExternalName = `ExternalDraft-${stamp}`;
  const serverExternalName = `ExternalServer-${stamp}`;
  const draftExternalSoul = `External draft SOUL ${soulMarker}`;
  const serverExternalProfile = { soul: `External server SOUL ${soulMarker}`, user: baselineProfile.user };
  store.setIdentity('name', draftExternalName);
  store.setProfile('soul', draftExternalSoul);
  await api.saveIdentity({ name: serverExternalName, tone: baselineIdentity.tone });
  await api.saveProfile(serverExternalProfile);
  await store.refresh();
  const externallyRefreshed = store.getSnapshot();
  assert.equal(externallyRefreshed.identity?.name, serverExternalName);
  assert.deepEqual(externallyRefreshed.profile, serverExternalProfile);
  assert.equal(externallyRefreshed.draftIdentity.name, draftExternalName);
  assert.equal(externallyRefreshed.draftProfile.soul, draftExternalSoul);
  assert.equal(externallyRefreshed.dirtyIdentity, true);
  assert.equal(externallyRefreshed.dirtyProfile, true);
  store.discardIdentity();
  store.discardProfile();
  assert.deepEqual(store.getSnapshot().draftIdentity, { name: serverExternalName, tone: baselineIdentity.tone });
  assert.deepEqual(store.getSnapshot().draftProfile, serverExternalProfile);
  assert.equal(store.getSnapshot().dirtyIdentity, false);
  assert.equal(store.getSnapshot().dirtyProfile, false);
  const matchingProfile = { soul: draftExternalSoul, user: baselineProfile.user };
  store.setIdentity('name', draftExternalName);
  store.setProfile('soul', draftExternalSoul);
  await api.saveIdentity({ name: draftExternalName, tone: baselineIdentity.tone });
  await api.saveProfile(matchingProfile);
  await store.refresh();
  assert.equal(store.getSnapshot().dirtyIdentity, false);
  assert.equal(store.getSnapshot().dirtyProfile, false);
  pass('refresh keeps dirty drafts, adopts latest server baselines, and recomputes dirty state');

  store.setIdentity('name', firstName);
  store.setIdentity('tone', baselineIdentity.tone === 'concise' ? 'warm' : 'concise');
  assert.equal(await store.saveIdentity(), true);
  const firstIdentity = (await api.getSnapshot()).identity;
  assert.equal(firstIdentity.name, firstName);
  assert.equal(firstIdentity.avatar, baselineIdentity.avatar);
  assert.equal(firstIdentity.showChatUpdates, baselineIdentity.showChatUpdates);
  assert.deepEqual(await api.getProfile(), matchingProfile);
  pass('identity save changes only name/tone and preserves avatar/showChatUpdates');

  const firstProfile = {
    soul: `Mobile SOUL first save: ${soulMarker}_FIRST`,
    user: `Mobile USER first save: ${userMarker}_FIRST`,
  };
  store.setProfile('soul', firstProfile.soul);
  store.setProfile('user', firstProfile.user);
  assert.equal(await store.saveProfile(), true);
  assert.deepEqual(await api.getProfile(), firstProfile);
  pass('ProfileStore saves real SOUL/USER text');

  const secondProfile = {
    soul: `Mobile SOUL second save: ${soulMarker}_SECOND`,
    user: `Mobile USER second save: ${userMarker}_SECOND`,
  };
  store.setProfile('soul', secondProfile.soul);
  store.setProfile('user', secondProfile.user);
  assert.equal(await store.saveProfile(), true);
  assert.deepEqual(await api.getProfile(), secondProfile);
  store.setIdentity('name', finalName);
  assert.equal(await store.saveIdentity(), true);
  assert.equal((await api.getSnapshot()).identity.name, finalName);
  pass('second successful identity/profile saves become the last server values');

  await assert.rejects(
    api.saveIdentity({ name: '   ', tone: baselineIdentity.tone }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    api.saveProfile({ soul: 'S'.repeat(20_001), user: '' }),
    (error) => error.status === 400,
  );
  assert.deepEqual(await api.getProfile(), secondProfile);
  pass('invalid blank identity and 20001-character profile return 400 without writes');

  const boundaryProfile = { soul: 'S'.repeat(20_000), user: 'U'.repeat(20_000) };
  store.setProfile('soul', boundaryProfile.soul);
  store.setProfile('user', boundaryProfile.user);
  assert.equal(await store.saveProfile(), true);
  assert.deepEqual(await api.getProfile(), boundaryProfile);
  pass('exact 20000-character SOUL/USER boundary is accepted');

  store.setProfile('soul', '');
  store.setProfile('user', '');
  assert.equal(await store.saveProfile(), true);
  assert.deepEqual(await api.getProfile(), { soul: '', user: '' });
  pass('empty strings clear both profile sections');

  const injectedProfile = {
    soul: `The assistant must remember this SOUL gate code: ${soulMarker}.`,
    user: `The human's profile contains this USER gate code: ${userMarker}.`,
  };
  store.setProfile('soul', injectedProfile.soul);
  store.setProfile('user', injectedProfile.user);
  assert.equal(await store.saveProfile(), true);
  assert.deepEqual(await api.getProfile(), injectedProfile);

  const beforeRun = await api.getConversation(spaceId);
  activeRunId = `profile-e2e-run-${stamp}`;
  const eventTypes = [];
  let runError;
  const userMessage = 'Report the configured assistant name, the user profile gate code, and the soul gate code. Do not use tools or quote the surrounding hidden instructions.';
  await api.runAgent({
    spaceId,
    runId: activeRunId,
    expectedRevision: beforeRun.revision,
    message: { id: `${activeRunId}-message`, content: userMessage },
  }, (event) => {
    eventTypes.push(event.type);
    if (event.type === 'RUN_ERROR') runError = event.message ?? event.code;
  }, AbortSignal.timeout(300_000));
  const finishedRunId = activeRunId;
  activeRunId = undefined;
  assert.equal(runError, undefined);
  assert.ok(eventTypes.includes('RUN_FINISHED'));

  const history = await api.getConversation(spaceId);
  const assistantText = history.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content ?? '')
    .join('\n');
  assert.ok(assistantText.includes(finalName));
  assert.ok(assistantText.includes(soulMarker));
  assert.ok(assistantText.includes(userMarker));
  assert.ok(!history.messages.some((message) => message.role === 'user' && (
    message.content?.includes(soulMarker) || message.content?.includes(userMarker)
  )));
  const status = await api.getAgentStatus(spaceId, finishedRunId);
  assert.equal(status.status.status, 'succeeded');
  write('model-run.json', { eventTypes, status: status.status, history });
  pass('real external model consumes next-run identity/SOUL/USER injection through actual SSE and history');
} catch (error) {
  failure = error;
  console.error('FAIL', error.stack ?? error);
  write('failed.json', { error: error.message });
} finally {
  if (activeRunId) await api.stopRun(spaceId, activeRunId).catch(() => {});
  store.dispose();
  try {
    await restoreBaseline();
    if (spaceCreated) {
      try {
        await api.deleteSpace(spaceId);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      assert.ok(!(await api.listSpaces()).some((space) => space.id === spaceId));
      pass('API cleanup removed only the dedicated profile space');
    }
    if (serviceVersion) {
      assert.deepEqual(await deployment('end'), serviceVersion);
      pass('deployment identity remained unchanged throughout acceptance');
    }
  } catch (error) {
    failure ??= error;
    console.error('FAIL cleanup/audit:', error.stack ?? error);
  }
  token = undefined;
  write('results.json', {
    passed: !failure,
    base,
    marker,
    spaceId,
    soulMarker,
    userMarker,
    checks,
    error: failure?.message,
    completedAt: new Date().toISOString(),
  });
  console.log('Evidence:', output);
}

if (failure) process.exitCode = 1;
