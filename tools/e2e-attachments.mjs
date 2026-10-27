/**
 * 附件真实链路 E2E：真实 HTTP/SSE + 真实外部模型 + 专属空间数据清理。
 *
 * 安全边界：
 * - 不 mock、不拦截响应、不使用本地假模型；
 * - 随机图片验证码只存在于图片字节，文本 marker 只存在于文本附件原始 UTF-8；
 * - 证据文件只记录元数据，不落盘完整 Base64 或附件正文。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import { SpaceStore } from '../src/spaces/space-store.ts';
import { projectHistory } from '../src/chat/chat-state.ts';
import {
  MAX_TOTAL_ATTACHMENT_BYTES,
  attachmentUploadOf,
  createAttachmentDraftsFromBytes,
  imageMimeOf,
} from '../src/attachments/validation.ts';

assert.equal(process.env.E2E_ALLOW_LIVE, '1', 'Set E2E_ALLOW_LIVE=1 to authorize real model calls');
assert.ok(process.env.E2E_API_BASE_URL, 'E2E_API_BASE_URL is required');

const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-attachments-e2e.'));
const stamp = Date.now().toString(36);
const spaceA = `attachments-e2e-a-${stamp}`;
const spaceB = `attachments-e2e-b-${stamp}`;
const textMarker = `ATTACHMENT_E2E_${stamp}`;

const resolveInputPath = (value, fallback) => {
  if (!value) return fileURLToPath(fallback);
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
};
const visionPath = resolveInputPath(
  process.env.E2E_VISION_PROBE_PATH,
  new URL('../../audit-archives/integration-audit/attachments/vision-probe.png', import.meta.url),
);
const expectedPath = resolveInputPath(
  process.env.E2E_VISION_PROBE_EXPECTED_PATH,
  new URL('../../audit-archives/integration-audit/attachments/vision-probe-expected.json', import.meta.url),
);

const visionBytes = readFileSync(visionPath);
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
assert.match(expected.code, /^\d{8}$/, 'vision-probe-expected.json must contain an 8-digit code');
assert.equal(imageMimeOf(visionBytes), 'image/png', 'vision probe must be a real PNG');
assert.equal(basename(visionPath).includes(expected.code), false, 'expected code must not be in the image filename');

let token;
let cleanupRequired = false;
let failure;
let serviceVersion;
let baselineSpaces;
const checks = [];
const api = new HttpApiClient(base, () => token, () => {
  throw new Error('Real authentication rejected');
});

const pass = (name, data = {}) => {
  checks.push({ name, ...data });
  console.log('PASS', name);
};
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const attachmentSummary = (attachment) => {
  if (!attachment) return undefined;
  const { id, name, kind, mimeType, size, sha256: digest } = attachment;
  return { id, name, kind, mimeType, size, sha256: digest, hasImage: Boolean(attachment.image) };
};
const historySummary = (history) => ({
  revision: history.revision,
  messages: history.messages.map((message) => ({
    id: message.id,
    role: message.role,
    contentLength: message.content?.length ?? 0,
    attachments: message.attachments?.map(attachmentSummary),
  })),
});

function makeTextAttachment(id, name, content) {
  const bytes = Buffer.from(content, 'utf8');
  const result = createAttachmentDraftsFromBytes([{ id, name, mimeType: 'text/plain', data: bytes }]);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  return result.attachments[0];
}

const imageDraft = createAttachmentDraftsFromBytes([{
  id: 'image-probe-1',
  name: 'probe.png',
  mimeType: 'image/png',
  data: visionBytes,
}]).attachments[0];
const mixedTextDraft = makeTextAttachment(
  'text-probe-1',
  'notes.txt',
  `The text marker is ${textMarker}. Return this exact marker when asked for the text attachment marker.`,
);
const mixedPrompt = [
  'Use the attached image and attached text attachment.',
  'Report the exact 8-digit code visible in the image, then the exact marker from the text attachment.',
  'Put both values on one line separated by one space. Do not use tools.',
].join(' ');
assert.equal(mixedPrompt.includes(expected.code), false, 'Expected image code must not appear in user text');
assert.equal(mixedPrompt.includes(textMarker), false, 'Text marker must not appear in user text');
assert.equal(imageDraft.name.includes(textMarker), false);
assert.equal(mixedTextDraft.name.includes(textMarker), false);

async function deployment(label) {
  const [html, spec, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(`${base}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, `${path} must return 200`);
    return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(html.includes('/openapi.json'));
  assert.equal(health.ok, true);
  assert.equal(health.backend, 'pi');
  assert.equal(health.configured, true, 'This E2E requires a real configured external model');
  assert.deepEqual(spec['x-service-version'], health.serviceVersion);
  for (const [path, methods] of Object.entries({
    '/api/conversation': ['get'],
    '/api/conversation/run': ['post'],
    '/api/spaces': ['get'],
    '/api/spaces/{spaceId}': ['delete'],
    '/api/spaces/{spaceId}/instructions': ['get', 'put'],
  })) {
    for (const method of methods) assert.ok(spec.paths[path]?.[method], `${method} ${path} must exist`);
  }
  write(`deployment-${label}.json`, { serviceVersion: health.serviceVersion });
  return health.serviceVersion;
}

async function runReal(input) {
  const events = [];
  await api.runAgent(input, (event) => events.push(event), AbortSignal.timeout(240_000));
  const runError = events.find((event) => event.type === 'RUN_ERROR');
  assert.equal(runError, undefined, runError ? `${runError.code}: ${runError.message}` : undefined);
  assert.ok(events.some((event) => event.type === 'RUN_STARTED'));
  assert.ok(events.some((event) => event.type === 'RUN_FINISHED'));
  return events;
}

const assistantTextOf = (events) => events
  .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
  .map((event) => event.delta ?? '')
  .join('');

async function rejectBeforeRun(attachments, pattern) {
  const runId = `attachments-boundary-${stamp}-${checks.length}`;
  try {
    await api.runAgent({
      spaceId: spaceA,
      runId,
      expectedRevision: 'empty',
      message: { id: `${runId}-message`, content: 'boundary', attachments },
    }, () => {});
  } catch (error) {
    assert.ok(error instanceof ApiError, 'Local pre-run rejection must be an ApiError');
    assert.equal(error.status, 400);
    assert.match(error.message, pattern);
    return;
  }
  assert.fail(`Expected local pre-run rejection matching ${pattern}`);
}

async function assertConflict(input, code) {
  try {
    await api.runAgent(input, () => {}, AbortSignal.timeout(15_000));
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`Expected HTTP 409 ${code}`);
}

try {
  serviceVersion = await deployment('start');
  const auth = await api.createSession(process.env.E2E_ACCESS_KEY);
  assert.equal(auth.mode, 'live');
  token = auth.token;
  pass('real deployment and live authentication', { serviceVersion });

  baselineSpaces = (await api.listSpaces()).map((space) => space.id);
  assert.equal(baselineSpaces.includes(spaceA), false);
  assert.equal(baselineSpaces.includes(spaceB), false);
  await api.saveSpaceInstructions(
    spaceA,
    'Dedicated attachment E2E space A. Answer directly from attachments. Never use tools, write files, or create memories, reminders, goals, monitors, or subagents.',
  );
  cleanupRequired = true;
  pass('dedicated space A created');

  const initialA = await api.getConversation(spaceA);
  assert.deepEqual(initialA, { revision: 'empty', messages: [] });

  // 这些失败都应由 HttpApiClient 在真实网络前拒绝；不把坏载荷交给服务端或模型。
  const pngBase64 = visionBytes.toString('base64');
  const oversizedImage = Buffer.alloc(MAX_TOTAL_ATTACHMENT_BYTES + 1);
  oversizedImage.set(visionBytes.subarray(0, 8));
  const largeText = Buffer.from('x'.repeat(100_001), 'utf8');
  await rejectBeforeRun([{ ...attachmentUploadOf(imageDraft), dataBase64: `${pngBase64}!` }], /Base64/);
  await rejectBeforeRun([{ ...attachmentUploadOf(imageDraft), mimeType: 'image/jpeg' }], /图片 MIME/);
  await rejectBeforeRun([{ ...attachmentUploadOf(imageDraft), dataBase64: Buffer.from('%PDF-1.4').toString('base64') }], /图片 MIME/);
  await rejectBeforeRun([{ id: 'utf8-1', name: 'bad.txt', mimeType: 'text/plain', dataBase64: Buffer.from([0xc0, 0xaf]).toString('base64') }], /UTF-8/);
  await rejectBeforeRun([{ id: 'zero-1', name: 'empty.txt', mimeType: 'text/plain', dataBase64: '' }], /Base64|空文件/);
  await rejectBeforeRun(Array.from({ length: 5 }, (_, index) => ({
    id: `count-${index}`, name: `count-${index}.txt`, mimeType: 'text/plain', dataBase64: Buffer.from('x').toString('base64'),
  })), /最多/);
  await rejectBeforeRun([{ id: 'text-total-1', name: 'large.txt', mimeType: 'text/plain', dataBase64: largeText.toString('base64') }], /文本附件合计/);
  await rejectBeforeRun([{ id: 'total-1', name: 'oversize.png', mimeType: 'image/png', dataBase64: oversizedImage.toString('base64') }], /附件总大小|图片/);
  assert.deepEqual(await api.getConversation(spaceA), initialA);
  pass('invalid Base64, MIME, bytes, UTF-8, zero, count and size limits reject before run');

  const mixedRunId = `attachments-mixed-run-${stamp}`;
  const mixedMessageId = `${mixedRunId}-message`;
  const mixedEvents = await runReal({
    spaceId: spaceA,
    runId: mixedRunId,
    expectedRevision: initialA.revision,
    message: {
      id: mixedMessageId,
      content: mixedPrompt,
      attachments: [imageDraft, mixedTextDraft],
    },
  });
  const mixedReply = assistantTextOf(mixedEvents);
  assert.ok(mixedReply.includes(expected.code), 'Real model must read the code from image pixels');
  assert.ok(mixedReply.includes(textMarker), 'Real model must read the marker from the text attachment');
  assert.equal(mixedEvents.some((event) => event.type === 'MESSAGES_SNAPSHOT'), false, 'Normal run must not be asserted as replay snapshot');
  pass('real model reads mixed image and UTF-8 text attachments');

  const historyA = await api.getConversation(spaceA);
  const mixedUser = historyA.messages.find((message) => message.id === mixedMessageId);
  assert.ok(mixedUser);
  assert.equal(mixedUser.role, 'user');
  assert.equal(mixedUser.content, mixedPrompt);
  assert.equal(mixedUser.attachments?.length, 2);
  const historyImage = mixedUser.attachments?.[0];
  const historyText = mixedUser.attachments?.[1];
  assert.equal(historyImage?.kind, 'image');
  assert.equal(historyImage?.mimeType, imageDraft.mimeType);
  assert.equal(historyImage?.size, visionBytes.length);
  assert.equal(historyImage?.sha256, sha256(visionBytes));
  assert.equal(historyImage?.image?.mimeType, imageDraft.mimeType);
  assert.ok(historyImage?.image?.dataBase64 === imageDraft.dataBase64, 'History image preview must own the server-projected image bytes');
  assert.equal(historyText?.kind, 'text');
  assert.equal(historyText?.size, mixedTextDraft.size);
  assert.equal(historyText?.sha256, sha256(Buffer.from(mixedTextDraft.dataBase64, 'base64')));
  assert.equal('image' in (historyText ?? {}), false);
  assert.equal('dataBase64' in (historyText ?? {}), false, 'History must not return text attachment content');
  const projected = projectHistory(historyA.messages).find((view) => view.id === mixedMessageId);
  assert.equal(projected?.attachments?.length, 2);
  write('space-a-history-summary.json', historySummary(historyA));
  pass('GET history preserves metadata, image ownership, and hides text content');

  const beforeReplay = await api.getConversation(spaceA);
  const replayEvents = await runReal({
    spaceId: spaceA,
    runId: mixedRunId,
    expectedRevision: beforeReplay.revision,
    message: {
      id: mixedMessageId,
      content: mixedPrompt,
      attachments: [imageDraft, mixedTextDraft],
    },
  });
  const snapshot = replayEvents.find((event) => event.type === 'MESSAGES_SNAPSHOT');
  assert.ok(snapshot, 'Completed replay must emit MESSAGES_SNAPSHOT');
  const snapshotUser = snapshot.messages?.find((message) => message.id === mixedMessageId);
  assert.ok(snapshotUser);
  assert.equal(snapshotUser.attachments?.length, 2);
  assert.equal(snapshotUser.attachments?.[0].image?.dataBase64 === imageDraft.dataBase64, true);
  assert.equal(replayEvents.some((event) => event.type === 'TEXT_MESSAGE_CONTENT'), false, 'Legal replay must not call the model again');
  const afterReplay = await api.getConversation(spaceA);
  assert.equal(afterReplay.revision, beforeReplay.revision);
  assert.equal(afterReplay.messages.length, beforeReplay.messages.length);
  pass('legal completed replay returns snapshot without a second model call');

  const changedText = makeTextAttachment('text-probe-1', 'changed.txt', 'changed attachment identity');
  await assertConflict({
    spaceId: spaceA,
    runId: mixedRunId,
    expectedRevision: afterReplay.revision,
    message: { id: mixedMessageId, content: mixedPrompt, attachments: [imageDraft, changedText] },
  }, 'RUN_ID_CONFLICT');
  await assertConflict({
    spaceId: spaceA,
    runId: `attachments-message-conflict-${stamp}`,
    expectedRevision: afterReplay.revision,
    message: { id: mixedMessageId, content: mixedPrompt, attachments: [imageDraft, changedText] },
  }, 'MESSAGE_ID_CONFLICT');
  const afterConflicts = await api.getConversation(spaceA);
  assert.equal(afterConflicts.revision, afterReplay.revision);
  assert.deepEqual(historySummary(afterConflicts), historySummary(afterReplay));
  pass('run and message identity conflicts reject changed attachment payloads');

  await api.saveSpaceInstructions(
    spaceB,
    'Dedicated attachment E2E space B. Follow the sole text attachment instruction. Never use tools, write files, or create memories, reminders, goals, monitors, or subagents.',
  );
  const initialB = await api.getConversation(spaceB);
  assert.deepEqual(initialB, { revision: 'empty', messages: [] });
  const pureRunId = `attachments-pure-run-${stamp}`;
  const pureMessageId = `${pureRunId}-message`;
  const pureTextDraft = makeTextAttachment(
    'pure-text-1',
    'note.txt',
    `The text marker is ${textMarker}. Reply with exactly this marker and nothing else.`,
  );
  const pureEvents = await runReal({
    spaceId: spaceB,
    runId: pureRunId,
    expectedRevision: initialB.revision,
    message: { id: pureMessageId, content: '', attachments: [pureTextDraft] },
  });
  const pureReply = assistantTextOf(pureEvents);
  assert.ok(pureReply.includes(textMarker), 'Pure attachment run must read the marker from UTF-8 bytes');
  const historyB = await api.getConversation(spaceB);
  const pureUser = historyB.messages.find((message) => message.id === pureMessageId);
  assert.ok(pureUser);
  assert.equal(pureUser.content, '', 'Pure attachment message content must remain empty');
  assert.equal(pureUser.attachments?.length, 1);
  assert.equal(pureUser.attachments?.[0].kind, 'text');
  assert.equal('image' in (pureUser.attachments?.[0] ?? {}), false);
  assert.equal(historyB.messages.some((message) => message.content?.includes(expected.code)), false, 'Space B must not inherit space A image data');
  const isolatedA = await api.getConversation(spaceA);
  assert.equal(isolatedA.revision, afterReplay.revision);
  assert.deepEqual(historySummary(isolatedA), historySummary(afterReplay));
  write('space-b-history-summary.json', historySummary(historyB));
  pass('pure attachment run and per-space isolation');

  const store = new SpaceStore(api);
  const storeEpoch = store.get(spaceA).epoch;
  store.setEnabled(false);
  assert.equal(store.appendDraftAttachments(spaceA, storeEpoch, [imageDraft, mixedTextDraft]).ok, true);
  assert.deepEqual(store.get(spaceA).draftAttachments.map(({ id }) => id), [imageDraft.id, mixedTextDraft.id]);
  store.setEnabled(true);
  store.setPendingSubmission(spaceA, storeEpoch, {
    messageId: `${mixedMessageId}-restore`,
    runId: `${mixedRunId}-restore`,
    text: mixedPrompt,
    epoch: storeEpoch,
    status: 'failed',
    error: 'controlled failure',
    attachments: [imageDraft, mixedTextDraft],
  });
  assert.equal(store.restorePendingSubmissionToDraft(spaceA), false, 'Existing drafts must not be overwritten by restore');
  assert.equal(store.clearDraftAttachments(spaceA, storeEpoch), true);
  assert.equal(store.restorePendingSubmissionToDraft(spaceA), true);
  const restored = store.get(spaceA).draftAttachments;
  assert.equal(restored[0].dataBase64 === imageDraft.dataBase64, true);
  assert.equal(restored[1].dataBase64 === mixedTextDraft.dataBase64, true);
  assert.equal(restored[0].image?.dataBase64 === imageDraft.image?.dataBase64, true);
  assert.equal(store.get(spaceA).pendingSubmission, null);
  store.dispose();
  pass('SpaceStore preserves complete original payload through failed restore');

  assert.deepEqual((await deployment('end')), serviceVersion);
} catch (error) {
  failure = error;
  console.error('FAIL', error instanceof Error ? error.message : String(error));
} finally {
  try {
    if (cleanupRequired) {
      for (const spaceId of [spaceA, spaceB]) {
        try {
          await api.deleteSpace(spaceId);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      const remaining = (await api.listSpaces()).map((space) => space.id);
      assert.equal(remaining.includes(spaceA), false);
      assert.equal(remaining.includes(spaceB), false);
      assert.ok(baselineSpaces.every((id) => remaining.includes(id)), 'Baseline spaces must remain');
      pass('dedicated spaces cleaned up and baseline preserved');
    }
  } catch (error) {
    failure ??= error;
    console.error('FAIL cleanup:', error instanceof Error ? error.message : String(error));
  }

  token = undefined;
  write('results.json', {
    passed: !failure,
    base,
    serviceVersion,
    spaces: [spaceA, spaceB],
    checks,
    probe: {
      bytes: visionBytes.length,
      sha256: sha256(visionBytes),
      imagePreview: Boolean(imageDraft.image),
      textBytes: mixedTextDraft.size,
    },
    error: failure?.message,
    unverified: failure ? ['Remaining scenarios after the failed assertion; inspect checks and error'] : [],
  });
  console.log('Evidence:', output);
}

if (failure) process.exitCode = 1;
