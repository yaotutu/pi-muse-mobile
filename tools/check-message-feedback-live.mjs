/**
 * 消息反馈数据链真实 HTTP + 真实模型验收。
 *
 * 显式传入服务根地址与只读 Token 文件；脚本只创建本轮专用空间，
 * 通过 HttpApiClient 发起一次真实模型轮，再验证反馈读取、CRUD、原始事件、
 * 错误状态与聊天 revision 不变，最后删除本轮空间。Token 不打印、不落仓库。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    'token-file': { type: 'string' },
    'timeout-ms': { type: 'string', default: '240000' },
  },
  strict: true,
});
assert.ok(values.base, 'Usage: --base http://host:port --token-file /path/to/token.txt');
assert.ok(values['token-file'], 'Usage: --base http://host:port --token-file /path/to/token.txt');

const parsedBase = new URL(values.base);
assert.ok(['http:', 'https:'].includes(parsedBase.protocol), 'base must use HTTP(S)');
assert.equal(parsedBase.pathname, '/', 'base must be a service root');
assert.equal(parsedBase.search, '', 'base must not contain a query');
assert.equal(parsedBase.hash, '', 'base must not contain a hash');
assert.equal(parsedBase.username, '', 'base must not contain credentials');
assert.equal(parsedBase['pass' + 'word'], '', 'base must not contain credentials');
const base = parsedBase.href.replace(/\/$/, '');
const timeoutMs = Number(values['timeout-ms']);
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'timeout-ms must be a positive integer');

const token = readFileSync(values['token-file'], 'utf8').trim();
assert.ok(token, 'token file is empty');
const api = new HttpApiClient(base, () => token, () => {
  throw new Error('Real token was rejected by the service');
});
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const spaceId = `feedback-live-${stamp}`;
const marker = `FEEDBACK_LIVE_${stamp}`;
const staleSessionId = `stale_${stamp}`;
const missingCommentId = '323e4567-e89b-42d3-a456-426614174000';
let cleanupRequired = false;
let failure;
const checks = [];
const pass = (name) => {
  checks.push(name);
  console.log('PASS', name);
};

async function deployment() {
  const [docs, spec, health] = await Promise.all(['/docs', '/openapi.json', '/api/health'].map(async (path) => {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    assert.equal(response.status, 200, `${path} status`);
    return path === '/docs' ? response.text() : response.json();
  }));
  assert.ok(docs.includes('/openapi.json'));
  assert.equal(health.ok, true);
  assert.deepEqual(spec['x-service-version'], health.serviceVersion);
  const paths = {
    '/api/conversation': ['get'],
    '/api/spaces/{spaceId}/messages/{messageId}/feedback': ['get'],
    '/api/spaces/{spaceId}/messages/{messageId}/feedback/events': ['get'],
    '/api/spaces/{spaceId}/messages/{messageId}/feedback/reaction': ['put'],
    '/api/spaces/{spaceId}/messages/{messageId}/feedback/comments': ['post'],
    '/api/spaces/{spaceId}/messages/{messageId}/feedback/comments/{commentId}': ['patch', 'delete'],
  };
  for (const [path, methods] of Object.entries(paths)) {
    for (const method of methods) assert.ok(spec.paths[path]?.[method], `OpenAPI missing ${method} ${path}`);
  }
}

async function revisionUnchanged(expected) {
  const current = await api.getConversation(spaceId);
  assert.equal(current.revision, expected, 'feedback must not change chat revision');
}

try {
  await deployment();
  pass('docs/OpenAPI/health identify the same deployment with message feedback paths');

  const baseline = new Set((await api.listSpaces()).map((space) => space.id));
  assert.equal(baseline.has(spaceId), false);
  cleanupRequired = true;
  await api.saveSpaceInstructions(spaceId, [
    `Dedicated message-feedback acceptance space ${stamp}.`,
    'Follow only the explicit test prompt. Do not use tools, create jobs or monitors, or touch other spaces.',
  ].join(' '));
  assert.ok((await api.listSpaces()).some((space) => space.id === spaceId));
  pass('dedicated space created');

  const before = await api.getConversation(spaceId);
  assert.ok(before.sessionId);
  const runId = `feedback-run-${stamp}`;
  const events = [];
  let runError;
  await api.runAgent({
    spaceId,
    runId,
    expectedRevision: before.revision,
    message: {
      id: `feedback-message-${stamp}`,
      content: `Reply with exactly ${marker}. Do not use any tools and do not add other text.`,
    },
  }, (event) => {
    events.push(event.type);
    if (event.type === 'RUN_ERROR') runError = event.message ?? event.code;
  }, AbortSignal.timeout(timeoutMs));
  assert.equal(runError, undefined);
  assert.ok(events.includes('RUN_FINISHED'));
  pass('real model run completed');

  const history = await api.getConversation(spaceId);
  assert.equal(history.sessionId, before.sessionId);
  const target = history.messages.find((message) =>
    message.role === 'assistant' && message.content?.includes(marker));
  assert.ok(target, 'assistant reply containing marker not found');
  assert.equal(target.metadata.feedbackAvailable, true);
  assert.deepEqual(await api.getMessageFeedback(spaceId, target.id, history.sessionId), target.feedback);
  pass('authoritative metadata/feedback parsed from real history');

  const revision = history.revision;
  assert.deepEqual((await api.getMessageFeedbackEvents(spaceId, target.id, history.sessionId)).events, []);
  assert.equal((await api.setMessageReaction(spaceId, target.id, history.sessionId, 'like')).reaction, 'like');
  await revisionUnchanged(revision);
  assert.equal((await api.setMessageReaction(spaceId, target.id, history.sessionId, 'dislike')).reaction, 'dislike');
  await revisionUnchanged(revision);
  assert.equal((await api.setMessageReaction(spaceId, target.id, history.sessionId, null)).reaction, null);
  await revisionUnchanged(revision);
  pass('reaction PUT round-trip with unchanged chat revision');

  const added = await api.addMessageComment(spaceId, target.id, history.sessionId, `  live comment ${stamp}  `);
  assert.equal(added.comments.length, 1);
  const comment = added.comments[0];
  assert.equal(comment.text, `live comment ${stamp}`);
  const edited = await api.editMessageComment(
    spaceId, target.id, comment.id, history.sessionId, `edited comment ${stamp}`,
  );
  assert.equal(edited.comments[0].id, comment.id);
  assert.equal(edited.comments[0].text, `edited comment ${stamp}`);
  await revisionUnchanged(revision);
  pass('comment POST/PATCH round-trip');

  const rawEvents = await api.getMessageFeedbackEvents(spaceId, target.id, history.sessionId);
  const reactionEvents = rawEvents.events.filter((event) => event.type === 'reaction_changed');
  assert.deepEqual(reactionEvents.map((event) => [event.from, event.to]), [
    [null, 'like'], ['like', 'dislike'], ['dislike', null],
  ]);
  assert.ok(rawEvents.events.some((event) =>
    event.type === 'comment_added' && event.text === `live comment ${stamp}`));
  assert.ok(rawEvents.events.some((event) =>
    event.type === 'comment_edited' &&
    event.fromText === `live comment ${stamp}` &&
    event.toText === `edited comment ${stamp}`));
  pass('raw feedback events preserve operation order and edit history');

  const removed = await api.deleteMessageComment(spaceId, target.id, comment.id, history.sessionId);
  assert.deepEqual(removed.comments, []);
  const afterDeleteEvents = await api.getMessageFeedbackEvents(spaceId, target.id, history.sessionId);
  assert.ok(afterDeleteEvents.events.some((event) =>
    event.type === 'comment_deleted' && event.text === `edited comment ${stamp}`));
  await revisionUnchanged(revision);
  pass('comment DELETE round-trip and deletion event');

  await assert.rejects(
    api.getMessageFeedback(spaceId, target.id, 'bad/session'),
    (error) => error instanceof ApiError && error.status === 400,
  );
  await assert.rejects(
    api.getMessageFeedback(spaceId, target.id, staleSessionId),
    (error) => error instanceof ApiError && error.status === 409,
  );
  await assert.rejects(
    api.deleteMessageComment(spaceId, target.id, missingCommentId, history.sessionId),
    (error) => error instanceof ApiError && error.status === 404,
  );
  const unauthorized = new HttpApiClient(base, () => 'invalid-token', () => {});
  await assert.rejects(
    unauthorized.getMessageFeedback(spaceId, target.id, history.sessionId),
    (error) => error instanceof ApiError && error.status === 401,
  );
  pass('400/401/404/409 errors preserve HTTP and ApiError semantics');

  await revisionUnchanged(revision);
  console.log(`SUMMARY ${checks.length} checks passed; space=${spaceId}`);
} catch (error) {
  failure = error;
  throw error;
} finally {
  if (cleanupRequired) {
    try {
      await api.deleteSpace(spaceId);
      assert.equal((await api.listSpaces()).some((space) => space.id === spaceId), false);
      console.log(`CLEANUP space=${spaceId}`);
    } catch (cleanupError) {
      if (failure) console.error('CLEANUP_FAILED', cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      else throw cleanupError;
    }
  }
}
