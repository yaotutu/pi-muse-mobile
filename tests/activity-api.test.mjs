import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../src/api/http-client.ts';
import { parseActivityOverview, parseActivityPage, parseActivityDetail, activityStepKey } from '../src/activities/contracts.ts';
import { activityStatuses, stepKinds, stepStatuses } from '../src/activities/types.ts';
import { activityFixture, stepFixture, detailFixture, activityPage } from './helpers/activity-fixtures.ts';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
async function withFetch(handler, work) {
  const original = globalThis.fetch; globalThis.fetch = handler;
  try { return await work(new HttpApiClient('https://activities.example', () => 'test-token', () => {})); } finally { globalThis.fetch = original; }
}
test('活动响应严格挑选公开字段，不透传意外载荷或伪造结果', () => {
  assert.deepEqual(parseActivityOverview({ ...activityFixture(), secret: 'not for UI' }), activityFixture());
  assert.deepEqual(parseActivityDetail(detailFixture()), detailFixture());
  for (const field of Object.keys(activityFixture())) {
    assert.throws(() => parseActivityOverview({ ...activityFixture(), [field]: undefined }), (e) => e.status === 502, field);
  }
  assert.throws(() => parseActivityOverview(activityFixture({ result: '未完成却有结果' })), (e) => e.status === 502);
});
test('活动所有正式状态可解析，中断时间可空；未知状态、坏日期、缺字段不能伪装空列表', () => {
  for (const status of activityStatuses) assert.equal(parseActivityOverview(activityFixture({ status })).status, status);
  for (const overrides of [{ status: 'success' }, { runIds: ['run-a', 'run-a'] }, { currentRunId: 'other' }, { createdAt: '2026-02-30T01:00:00Z' }, { updatedAt: '2026-10-20T01:00:00+08:00' }, { spaceId: '../x' }, { runIds: [1] }]) {
    assert.throws(() => parseActivityOverview(activityFixture(overrides)), (e) => e.status === 502);
  }
  for (const value of [{}, { activities: [], hasMore: false }, activityPage([activityFixture(), activityFixture()]), { ...activityPage(), hasMore: true }, activityPage([], 'cursor')]) assert.throws(() => parseActivityPage(value), (e) => e.status === 502);
  assert.deepEqual(parseActivityPage(activityPage([])), activityPage([]));
});
test('步骤保留执行顺序与所有终态；相同步骤 ID 可跨运行，运行内重复或越域拒绝', () => {
  const a = activityFixture({ runIds: ['run-a', 'run-b'] });
  const steps = [stepFixture({ runId: 'run-b' }), stepFixture()];
  assert.deepEqual(parseActivityDetail(detailFixture(a, steps)).steps, steps);
  assert.notEqual(activityStepKey(steps[0]), activityStepKey(steps[1]));
  for (const kind of stepKinds) for (const status of stepStatuses) {
    assert.equal(parseActivityDetail(detailFixture(a, [stepFixture({ kind, status, finishedAt: null })])).steps[0].status, status);
  }
  for (const steps of [[stepFixture(), stepFixture()], [stepFixture({ runId: 'unbound' })], [stepFixture({ kind: 'thinking' })], [stepFixture({ status: 'completed' })], [stepFixture({ result: undefined })]]) assert.throws(() => parseActivityDetail(detailFixture(a, steps)), (e) => e.status === 502);
  assert.throws(() => parseActivityDetail(detailFixture(), 'wrong-id'), (e) => e.status === 502);
});
test('活动列表序列化只读声明参数，游标原样编码，复用 Bearer/禁止重定向', async () => {
  await withFetch(async (url, init) => {
    const u = new URL(url); assert.equal(u.pathname, '/api/activities');
    assert.deepEqual(Object.fromEntries(u.searchParams), { limit: '1', cursor: 'a+b/中文==', spaceId: 'thread-a', status: 'completed' });
    assert.equal(init.method, 'GET'); assert.equal(init.headers.authorization, 'Bearer test-token'); assert.equal(init.redirect, 'error'); assert.equal(init.body, undefined);
    return json(activityPage([]));
  }, (api) => api.listActivities({ limit: 1, cursor: 'a+b/中文==', spaceId: 'thread-a', status: 'completed', extra: 'never sent' }));
});
test('活动详情编码 ID 并检查响应归属，HTTP 错误保留且不重试', async () => {
  await withFetch(async (url) => { assert.equal(url, 'https://activities.example/api/activities/a%2F%E4%B8%80'); return json(detailFixture(activityFixture({ id: 'a/一' }))); }, async (api) => assert.equal((await api.getActivity('a/一')).activity.id, 'a/一'));
  await withFetch(async () => json(detailFixture()), (api) => assert.rejects(api.getActivity('wrong-id'), (e) => e.status === 502));
  for (const status of [400, 404, 500]) {
    let calls = 0;
    await withFetch(async () => { calls++; return json({ error: 'error' }, status); }, (api) => assert.rejects(api.getActivity('a'), (e) => e.status === status));
    assert.equal(calls, 1);
  }
});
test('活动沿用 401 守卫与信号取消，取消只读请求绝不发聊天 Stop', async () => {
  const original = globalThis.fetch; let rejectedToken;
  globalThis.fetch = async () => json({}, 401);
  try { await assert.rejects(new HttpApiClient('https://a', () => 'original', (token) => { rejectedToken = token; }).listActivities(), (e) => e.status === 401); assert.equal(rejectedToken, 'original'); } finally { globalThis.fetch = original; }
  const calls = [];
  await withFetch((url, init) => { calls.push(url); return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')), { once: true })); }, async (api) => {
    const c = new AbortController(); const work = api.getActivity('a', c.signal); c.abort(); await assert.rejects(work, (e) => e.name === 'AbortError');
  });
  assert.deepEqual(calls, ['https://activities.example/api/activities/a']);
});
