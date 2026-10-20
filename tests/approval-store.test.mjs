import assert from 'node:assert/strict';
import test from 'node:test';
import { ApprovalStore, hasApprovalPreview } from '../src/approvals/approval-store.ts';
import { ApprovalConflictError } from '../src/approvals/contracts.ts';
import { ApiError } from '../src/api/errors.ts';
import { approvalFixture, settledApproval, approvalSummary, approvalResolution } from './helpers/approval-fixtures.ts';

const ready = (pendingApprovals = [], instanceId = 'instance-a') => ({ event: 'ready', data: { instanceId, serverTime: '2026-10-20T00:00:00.000Z', agentStatuses: [], pendingApprovals } });
const update = (approval = settledApproval()) => ({ event: 'approval_updated', data: { ...approvalResolution(approval), instanceId: 'instance-a' } });
const pending = (approval = approvalFixture()) => ({ event: 'approval_pending', data: { ...approval, instanceId: 'instance-a' } });
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(overrides = {}) {
  const calls = [];
  const client = {
    getApproval: async (id) => { calls.push(['get', id]); return settledApproval({ id }); },
    decideApproval: async (id, decision) => { calls.push(['decide', id, decision]); return settledApproval({ id, status: decision === 'approve' ? 'approved' : 'denied' }); },
    getPendingApprovals: async () => [],
    listApprovals: async () => ({ approvals: [], hasMore: false, nextCursor: null }),
    ...overrides,
  };
  const store = new ApprovalStore(client); store.setActive(true);
  return { store, calls };
}
test('ready 整体替换 pending，断线期间消失项补读权威终态而不猜测', async () => {
  const { store, calls } = setup(); store.receive(ready([approvalFixture()])); assert.equal(store.canDecide('approval-a'), true);
  store.setConnection('reconnecting'); assert.equal(store.canDecide('approval-a'), false);
  store.receive(ready([])); assert.deepEqual(store.getSnapshot().pendingIds, []); await tick();
  assert.deepEqual(calls, [['get', 'approval-a']]); assert.equal(store.getSnapshot().records['approval-a'].status, 'approved');
});
test('断线保留最后观测，但 HTTP 补读不能代替 ready 重新放行决定', async () => {
  const { store } = setup({ getPendingApprovals: async () => [approvalFixture()] });
  store.receive(ready([approvalFixture()])); store.setConnection('paused'); await store.refreshPending();
  assert.equal(store.getSnapshot().pendingIds.length, 1); assert.equal(store.canDecide('approval-a'), false);
});
test('重复/乱序事件不回退状态或把终态重新加入 pending', () => {
  const { store } = setup(); store.receive(ready([approvalFixture()])); store.receive(update(settledApproval({ revision: 5 })));
  store.receive(pending(approvalFixture({ revision: 1 }))); store.receive(update(settledApproval({ revision: 3, status: 'denied' })));
  assert.equal(store.getSnapshot().records['approval-a'].revision, 5); assert.equal(store.getSnapshot().records['approval-a'].status, 'approved');
  assert.deepEqual(store.getSnapshot().pendingIds, []);
});
test('审批 revision 跨 instanceId 保留，不跟随运行版本缓存清零', async () => {
  const { store } = setup(); store.receive(ready([approvalFixture()])); store.receive(update(settledApproval({ revision: 8 })));
  store.setConnection('reconnecting'); store.receive(ready([approvalFixture({ revision: 1 })], 'instance-b')); await tick();
  assert.equal(store.getSnapshot().records['approval-a'].revision, 8); assert.equal(store.canDecide('approval-a'), false);
});
test('轻量终态先到，较旧完整详情只补预览，不覆盖新的执行结果', async () => {
  const get = deferred(); const { store } = setup({ getApproval: () => get.promise });
  store.receive(ready()); store.receive(update(settledApproval({ revision: 5, execution: { status: 'succeeded', startedAt: '2026-10-20T00:01:00.000Z', finishedAt: '2026-10-20T00:01:01.000Z', result: '已提交' } })));
  get.resolve(approvalFixture()); await tick();
  const record = store.getSnapshot().records['approval-a']; assert.equal(record.revision, 5); assert.equal(record.execution.status, 'succeeded');
  assert.equal(hasApprovalPreview(record), true); assert.equal(record.preview.after, approvalFixture().preview.after); assert.deepEqual(store.getSnapshot().pendingIds, []);
});
test('同 revision 完整详情可补正文，但历史摘要不能抹去既有预览', async () => {
  const item = settledApproval();
  const { store } = setup({ listApprovals: async () => ({ approvals: [approvalSummary(item)], hasMore: false, nextCursor: null }) });
  store.receive(ready([approvalFixture()])); store.receive(update(item)); await store.loadHistory({});
  assert.equal(hasApprovalPreview(store.getSnapshot().records[item.id]), true);
});
test('快速重复点击只发一个决定，直到权威响应前不乐观改成 approved', async () => {
  const reply = deferred(); let posts = 0;
  const { store } = setup({ decideApproval: () => { posts++; return reply.promise; } }); store.receive(ready([approvalFixture()]));
  const first = store.decide('approval-a', 'approve'); const second = await store.decide('approval-a', 'deny');
  assert.equal(second, false); assert.equal(posts, 1); assert.equal(store.getSnapshot().records['approval-a'].status, 'pending');
  reply.resolve(settledApproval()); assert.equal(await first, true); assert.equal(store.getSnapshot().records['approval-a'].execution, null);
});
test('决定的旧 HTTP 响应不能覆盖先到的 SSE 执行回执', async () => {
  const reply = deferred(); const { store } = setup({ decideApproval: () => reply.promise }); store.receive(ready([approvalFixture()]));
  const task = store.decide('approval-a', 'approve');
  store.receive(update(settledApproval({ revision: 4, execution: { status: 'failed', startedAt: '2026-10-20T00:01:00.000Z', finishedAt: '2026-10-20T00:01:01.000Z', result: '文件版本变化' } })));
  reply.resolve(settledApproval({ revision: 2 })); await task;
  assert.equal(store.getSnapshot().records['approval-a'].revision, 4); assert.equal(store.getSnapshot().records['approval-a'].execution.status, 'failed');
});
test('409 合并服务器当前审批，不自动重试，也不猜成本次决定成功', async () => {
  let posts = 0; const current = settledApproval({ revision: 3, status: 'denied' });
  const { store } = setup({ decideApproval: async () => { posts++; throw new ApprovalConflictError(current); } });
  store.receive(ready([approvalFixture()])); assert.equal(await store.decide('approval-a', 'approve'), false);
  assert.equal(posts, 1); assert.equal(store.getSnapshot().records['approval-a'].status, 'denied'); assert.match(store.getSnapshot().errors['approval-a'], /没有重发/);
});
test('网络/超时提交结果未明时锁住重试，只有显式详情核对后才再放行', async () => {
  let posts = 0; const { store } = setup({ decideApproval: async () => { posts++; throw new ApiError(408, 'timeout'); }, getApproval: async () => approvalFixture() });
  store.receive(ready([approvalFixture()])); assert.equal(await store.decide('approval-a', 'approve'), false);
  assert.equal(await store.decide('approval-a', 'approve'), false); assert.equal(store.canDecide('approval-a'), false); assert.equal(posts, 1);
  await store.loadDetail('approval-a'); assert.equal(store.canDecide('approval-a'), true); assert.equal(posts, 1);
});
test('后台/切服取消在途决定，迟到结果不写回，恢复后不会自动重发', async () => {
  const reply = deferred(); let posts = 0; const { store } = setup({ decideApproval: () => { posts++; return reply.promise; } });
  store.receive(ready([approvalFixture()])); const task = store.decide('approval-a', 'approve'); store.setActive(false);
  reply.resolve(settledApproval()); await task; assert.equal(store.getSnapshot().records['approval-a'].status, 'pending');
  store.setActive(true); store.receive(ready([approvalFixture()])); assert.equal(store.canDecide('approval-a'), false); assert.equal(posts, 1);
  store.dispose();
});
test('本地过期、未读取完整预览、未同步、404 均不能决定', async () => {
  const { store } = setup({ getApproval: async () => { throw new ApiError(404, 'missing'); } });
  store.receive(ready([approvalFixture({ expiresAt: '2020-01-01T00:00:00.000Z' })])); assert.equal(store.canDecide('approval-a'), false);
  store.receive(ready([approvalFixture({ id: 'missing' })])); await store.loadDetail('missing'); assert.equal(store.canDecide('missing'), false);
  assert.equal(store.getSnapshot().pendingIds.includes('missing'), false);
});
test('pending REST 请求期间的新事件不能被旧集合删除，旧 pending 也不能复活终态', async () => {
  const reply = deferred(); const { store } = setup({ getPendingApprovals: () => reply.promise });
  store.receive(ready([approvalFixture()])); const task = store.refreshPending();
  store.receive(pending(approvalFixture({ id: 'new' }))); store.receive(update()); reply.resolve([approvalFixture()]); await task;
  assert.deepEqual(store.getSnapshot().pendingIds, ['new']); assert.equal(store.getSnapshot().records['approval-a'].status, 'approved');
});
test('pending 补读失败保留最后观测并显示失败，不伪装空列表', async () => {
  const { store } = setup({ getPendingApprovals: async () => { throw new ApiError(500, 'failed'); } });
  store.receive(ready([approvalFixture()])); await store.refreshPending(); assert.equal(store.getSnapshot().pendingIds.length, 1); assert.match(store.getSnapshot().error, /失败/);
});
test('历史分页原样使用 nextCursor，去重且保持服务端页序', async () => {
  const queries = []; const { store } = setup({ listApprovals: async (query) => {
    queries.push(query);
    return query.cursor ? { approvals: [approvalSummary(settledApproval({ id: 'b' })), approvalSummary(settledApproval({ id: 'c' }))], hasMore: false, nextCursor: null }
      : { approvals: [approvalSummary(settledApproval({ id: 'a' })), approvalSummary(settledApproval({ id: 'b' }))], hasMore: true, nextCursor: 'opaque=+/cursor' };
  } });
  store.receive(ready()); await store.loadHistory({ spaceId: 'thread-a', status: 'approved' }); await store.loadHistory({ spaceId: 'thread-a', status: 'approved' }, true);
  assert.equal(queries[1].cursor, 'opaque=+/cursor'); assert.deepEqual(store.getSnapshot().history.ids, ['a', 'b', 'c']);
});
test('改变历史过滤会重置游标并忽略旧响应，不把其他会话混入当前范围', async () => {
  const old = deferred(); const queries = [];
  const { store } = setup({ listApprovals: async (query) => { queries.push(query); return query.spaceId === 'a' ? old.promise : { approvals: [approvalSummary(settledApproval({ id: 'b-item', spaceId: 'b' }))], hasMore: false, nextCursor: null }; } });
  const first = store.loadHistory({ spaceId: 'a' }); await store.loadHistory({ spaceId: 'b' });
  old.resolve({ approvals: [approvalSummary(settledApproval({ id: 'a-item', spaceId: 'a' }))], hasMore: false, nextCursor: null }); await first;
  assert.deepEqual(store.getSnapshot().history.ids, ['b-item']); assert.equal(queries[1].cursor, undefined);
});
test('历史失败保留同范围已读结果，状态变化只提示刷新，不重置分页或盲轮询', async () => {
  let reads = 0; const { store } = setup({ listApprovals: async () => { if (++reads > 1) throw new ApiError(500, 'failed'); return { approvals: [approvalSummary()], hasMore: false, nextCursor: null }; } });
  store.receive(ready()); await store.loadHistory({}); store.receive(update(settledApproval({ revision: 4 })));
  assert.equal(reads, 1); assert.equal(store.getSnapshot().history.dirty, true);
  await store.loadHistory({}); assert.deepEqual(store.getSnapshot().history.ids, ['approval-a']); assert.match(store.getSnapshot().history.error, /失败/);
});
test('终态全文缓存有界，pending 与正在查看的完整预览不被裁剪', () => {
  const { store } = setup(); const items = Array.from({ length: 14 }, (_, i) => approvalFixture({ id: `a-${i}` }));
  store.receive(ready(items));
  for (const item of items.slice(0, 12)) store.receive(update(settledApproval({ id: item.id })));
  const records = Object.values(store.getSnapshot().records);
  assert.equal(records.filter((item) => item.status !== 'pending' && hasApprovalPreview(item)).length, 8);
  assert.equal(records.filter((item) => item.status === 'pending' && hasApprovalPreview(item)).length, 2);
});
