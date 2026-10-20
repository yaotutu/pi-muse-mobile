import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../src/api/http-client.ts';
import { parseResetSpace, parseSpaces } from '../src/api/space-contracts.ts';
import { parseApprovalView } from '../src/approvals/contracts.ts';
import { parseActivityOverview } from '../src/activities/contracts.ts';
import { ensureAgentStatus } from '../src/runtime/contracts.ts';
import { approvalFixture } from './helpers/approval-fixtures.ts';
import { activityFixture } from './helpers/activity-fixtures.ts';

const resetResult = { ok: true, spaceId: 'space/a', sessionId: 'new-session', cancelledApprovals: 1, removed: { jobs: 0, monitors: 0 } };
const invalid = (error) => error.status === 502;
test('空间列表必须有真实 sessionId，旧列表、缺绑定或重复空间不能伪装成功', () => {
  const entry = { id: 'a', sessionId: 'session-a', updatedAt: '2026-10-20T00:00:00Z' };
  assert.deepEqual(parseSpaces({ spaces: [entry] }), [entry]);
  for (const body of [{ threads: [entry] }, { spaces: [{ ...entry, sessionId: undefined }] }, { spaces: [{ ...entry, sessionId: '' }] }, { spaces: [entry, entry] }]) {
    assert.throws(() => parseSpaces(body), invalid);
  }
});
test('resetSpace 只提交 clearSchedules 并编码空间ID，默认保留定时任务与监控', async () => {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(resetResult)); };
  try {
    const api = new HttpApiClient('https://space.example', () => 'token', () => {});
    assert.deepEqual(await api.resetSpace('space/a'), resetResult);
    await api.resetSpace('space/a', { clearSchedules: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(({ init }) => JSON.parse(init.body)), [{ clearSchedules: false }, { clearSchedules: true }]);
    for (const { url, init } of calls) {
      assert.equal(url, 'https://space.example/api/spaces/space%2Fa/reset');
      assert.equal(init.method, 'POST'); assert.equal(init.headers.authorization, 'Bearer token'); assert.equal(init.redirect, 'error');
    }
  } finally { globalThis.fetch = original; }
});
test('重置严格校验空间归属、sessionId与非负计数，不把坏响应当作已清空', () => {
  assert.deepEqual(parseResetSpace(resetResult, 'space/a'), resetResult);
  for (const body of [{ ...resetResult, ok: false }, { ...resetResult, spaceId: 'other' }, { ...resetResult, sessionId: '' },
    { ...resetResult, cancelledApprovals: undefined }, { ...resetResult, cancelledApprovals: -1 },
    { ...resetResult, removed: { jobs: 1.5, monitors: 0 } }, { ...resetResult, removed: { jobs: 0 } }]) assert.throws(() => parseResetSpace(body, 'space/a'), invalid);
});
test('resetSpace 错误/取消不自动重试，保留 SPACE_DELETING 语义与401鉴权守卫', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 409, 500]) {
      let count = 0; let unauthorized = 0;
      globalThis.fetch = async () => { count++; return new Response(JSON.stringify({ error: 'failed', code: 'SPACE_DELETING' }), { status }); };
      const api = new HttpApiClient('https://space.example', () => 'token', () => { unauthorized++; });
      await assert.rejects(api.resetSpace('a'), (e) => e.status === status && (status !== 409 || e.code === 'SPACE_DELETING'));
      assert.equal(count, 1); assert.equal(unauthorized, status === 401 ? 1 : 0);
    }
    let count = 0; globalThis.fetch = async () => { count++; };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(new HttpApiClient('https://space.example', () => 'token', () => {}).resetSpace('a', {}, controller.signal), (e) => e.name === 'AbortError');
    assert.equal(count, 0);
  } finally { globalThis.fetch = original; }
});
test('审批以空间字段为准，兼容thread作用域但绝不回退旧归属或接受矛盾别名', () => {
  const v = approvalFixture();
  for (const scope of ['space', 'thread']) {
    const raw = { ...v, threadId: v.spaceId, workspaceThreadId: v.workspaceSpaceId,
      preview: { ...v.preview, scope, ownerThreadId: v.preview.ownerSpaceId } };
    const parsed = parseApprovalView(raw);
    assert.equal(parsed.spaceId, v.spaceId); assert.equal(parsed.preview.scope, scope);
    assert.equal('threadId' in parsed, false); assert.equal('ownerThreadId' in parsed.preview, false);
  }
  for (const raw of [{ ...v, spaceId: undefined, threadId: v.spaceId }, { ...v, threadId: 'other' },
    { ...v, workspaceThreadId: 'other' }, { ...v, preview: { ...v.preview, ownerSpaceId: undefined, ownerThreadId: v.preview.ownerSpaceId } },
    { ...v, preview: { ...v.preview, ownerThreadId: 'other' } }]) assert.throws(() => parseApprovalView(raw), invalid);
});
test('活动必须有spaceId，兼容别名只能一致且不进入缓存', () => {
  const v = activityFixture();
  assert.deepEqual(parseActivityOverview({ ...v, threadId: v.spaceId }), v);
  assert.throws(() => parseActivityOverview({ ...v, spaceId: undefined, threadId: v.spaceId }), invalid);
  assert.throws(() => parseActivityOverview({ ...v, threadId: 'other' }), invalid);
});
test('运行状态缺spaceId或新旧归属冲突时拒绝，不串到当前空间', () => {
  const v = { activityId: null, spaceId: 'a', threadId: 'a', runId: 'run', revision: 1, source: 'chat', jobId: null,
    title: '', status: 'running', phase: 'preparing', label: '', tools: [], subagents: [], pendingApprovalIds: [], startedAt: 'now', updatedAt: 'now', endedAt: null };
  assert.equal(ensureAgentStatus(v).spaceId, 'a'); assert.equal('threadId' in ensureAgentStatus(v), false);
  assert.throws(() => ensureAgentStatus({ ...v, spaceId: undefined }), invalid);
  assert.throws(() => ensureAgentStatus({ ...v, threadId: 'other' }), invalid);
});
