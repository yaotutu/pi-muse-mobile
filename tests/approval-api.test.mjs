import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import { ApprovalConflictError, parseApprovalView, parseApprovalResolution, parseApprovalPage, parsePendingApprovals } from '../src/approvals/contracts.ts';
import { approvalFixture, settledApproval, approvalSummary, approvalResolution } from './helpers/approval-fixtures.ts';

const BASE = 'https://approval-server';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
async function withFetch(fetcher, work) {
  const original = globalThis.fetch; globalThis.fetch = fetcher;
  try { return await work(new HttpApiClient(BASE, () => 'test-token', () => {})); } finally { globalThis.fetch = original; }
}
test('审批严格解析完整不可变预览，空内容不是缺失字段', () => {
  assert.deepEqual(parseApprovalView(approvalFixture()), approvalFixture());
  const empty = approvalFixture({ preview: { ...approvalFixture().preview, after: '' } });
  assert.equal(parseApprovalView(empty).preview.after, '');
});
test('审批缺字段、伪造作用域、坏 revision/时间/执行状态均拒绝而非补默认', () => {
  const item = approvalFixture();
  const invalid = [null, {}, { ...item, execution: undefined }, { ...item, revision: 0 }, { ...item, revision: 1.5 },
    { ...item, spaceId: undefined }, { ...item, expiresAt: 'invalid' }, { ...item, status: 'success' },
    { ...item, preview: { ...item.preview, after: undefined } }, { ...item, preview: { ...item.preview, ownerSpaceId: null } },
    { ...item, preview: { ...item.preview, scope: 'shared', ownerSpaceId: 'thread-a' } },
    { ...item, execution: { status: 'success' } }, { ...item, resolvedAt: item.createdAt },
  ];
  for (const value of invalid) assert.throws(() => parseApprovalView(value), (error) => error.status === 502);
});
test('终态轻量事件保留独立执行回执，不要求或伪造正文', () => {
  const resolution = approvalResolution(settledApproval({ execution: { status: 'unknown', startedAt: '2026-10-20T00:01:00.000Z', finishedAt: null, result: null } }));
  assert.deepEqual(parseApprovalResolution(resolution), resolution);
  assert.equal('preview' in parseApprovalResolution(resolution), false);
  assert.throws(() => parseApprovalResolution(approvalFixture()), (error) => error.status === 502);
});
test('pending 完整集合不允许终态、重复项或超过 32 项', () => {
  assert.deepEqual(parsePendingApprovals({ approvals: [approvalFixture()] }), [approvalFixture()]);
  for (const approvals of [[settledApproval()], [approvalFixture(), approvalFixture()], Array.from({ length: 33 }, (_, i) => approvalFixture({ id: `a-${i}` }))]) {
    assert.throws(() => parsePendingApprovals({ approvals }), (error) => error.status === 502);
  }
});
test('历史只含摘要终态，分页游标与 hasMore 必须一致', () => {
  const page = { approvals: [approvalSummary()], hasMore: true, nextCursor: 'opaque-cursor' };
  assert.deepEqual(parseApprovalPage(page), page);
  for (const value of [{ ...page, nextCursor: null }, { ...page, hasMore: false }, { ...page, approvals: [approvalFixture()] }]) {
    assert.throws(() => parseApprovalPage(value), (error) => error.status === 502);
  }
});
test('审批列表只发送声明的过滤参数，不透明 cursor 编码后原样往返', async () => {
  await withFetch(async (url, init) => {
    const parsed = new URL(url); assert.equal(parsed.pathname, '/api/approvals');
    assert.equal(parsed.searchParams.get('cursor'), 'Ab+c/d==_中文');
    assert.equal(parsed.searchParams.get('spaceId'), 'thread-a'); assert.equal(parsed.searchParams.get('status'), 'denied');
    assert.equal(parsed.searchParams.get('activityId'), 'activity-a'); assert.equal(parsed.searchParams.get('limit'), '20');
    assert.equal(parsed.searchParams.has('extra'), false); assert.equal(init.headers.authorization, 'Bearer test-token');
    return json({ approvals: [], hasMore: false, nextCursor: null });
  }, (api) => api.listApprovals({ cursor: 'Ab+c/d==_中文', spaceId: 'thread-a', status: 'denied', activityId: 'activity-a', limit: 20, extra: 'not-sent' }));
});
test('补读 pending 使用新版端点，未调用旧 actions 或全量工作区', async () => {
  await withFetch(async (url) => { assert.equal(url, `${BASE}/api/approvals/pending`); return json({ approvals: [approvalFixture()] }); }, async (api) => {
    assert.deepEqual(await api.getPendingApprovals(), [approvalFixture()]);
  });
});
test('详情编码 ID 并校验响应归属', async () => {
  await withFetch(async (url) => { assert.equal(url, `${BASE}/api/approvals/a%2F%E4%B8%80`); return json(approvalFixture({ id: 'a/一' })); }, async (api) => {
    assert.equal((await api.getApproval('a/一')).id, 'a/一');
  });
  await withFetch(async () => json(approvalFixture({ id: 'other' })), async (api) => assert.rejects(api.getApproval('a'), (error) => error.status === 502));
});
test('决定仅提交 decision，批准响应仍允许 execution=null，不伪装成功', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, `${BASE}/api/approvals/a%2F1/decision`); assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { decision: 'approve' }); assert.equal(init.redirect, 'error');
    return json(settledApproval({ id: 'a/1' }));
  }, async (api) => { const value = await api.decideApproval('a/1', 'approve'); assert.equal(value.status, 'approved'); assert.equal(value.execution, null); });
});
test('409 校验并携带当前完整审批，保持 revision；绝不自动重试', async () => {
  let calls = 0; const approval = settledApproval({ status: 'denied', revision: 8 });
  await withFetch(async () => { calls++; return json({ error: 'conflict', approval }, 409); }, async (api) => {
    await assert.rejects(api.decideApproval(approval.id, 'approve'), (error) => error instanceof ApprovalConflictError && error.approval.revision === 8 && error.approval.status === 'denied');
  }); assert.equal(calls, 1);
});
test('坏 409、不匹配 ID 和 404/500 都不转成成功或重新提交', async () => {
  for (const [body, status, expected] of [[{}, 409, 502], [{ approval: settledApproval({ id: 'other' }) }, 409, 502], [{ error: 'missing' }, 404, 404], [{ error: 'failed' }, 500, 500]]) {
    let calls = 0;
    await withFetch(async () => { calls++; return json(body, status); }, async (api) => assert.rejects(api.decideApproval('approval-a', 'deny'), (error) => error instanceof ApiError && error.status === expected));
    assert.equal(calls, 1);
  }
});
test('审批沿用真实鉴权守卫，401 只通知原凭据失效', async () => {
  let sentToken;
  const original = globalThis.fetch; globalThis.fetch = async () => json({ error: 'unauthorized' }, 401);
  try {
    const api = new HttpApiClient(BASE, () => 'original-token', (token) => { sentToken = token; });
    await assert.rejects(api.getPendingApprovals(), (error) => error.status === 401); assert.equal(sentToken, 'original-token');
  } finally { globalThis.fetch = original; }
});
test('审批读取和决定支持本地取消，不因取消发聊天 Stop', async () => {
  const calls = [];
  await withFetch((url, init) => {
    calls.push(url); return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }));
  }, async (api) => {
    const controller = new AbortController(); const pending = api.decideApproval('approval-a', 'approve', controller.signal); controller.abort();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
  }); assert.deepEqual(calls, [`${BASE}/api/approvals/approval-a/decision`]);
});
