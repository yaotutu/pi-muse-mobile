import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityStore } from '../src/activities/activity-store.ts';
import { RuntimeStore } from '../src/runtime/runtime-store.ts';
import { ApiError } from '../src/api/errors.ts';
import { activityFixture, activityPage, detailFixture } from './helpers/activity-fixtures.ts';

const tick = () => new Promise(setImmediate);
const wait = () => new Promise((r) => setTimeout(r, 10));
const ready = (activities = []) => ({ event: 'ready', data: { instanceId: 'i', serverTime: '2026-10-20T00:00:00Z', agentStatuses: [], pendingApprovals: [], activities } });
const update = (activity) => ({ event: 'activity_updated', data: { ...activity, instanceId: 'i' } });
function fixture() {
  const lists = []; const details = [];
  const client = {
    listActivities(query, signal) { return new Promise((resolve, reject) => lists.push({ query, signal, resolve, reject })); },
    getActivity(id, signal) { return new Promise((resolve, reject) => details.push({ id, signal, resolve, reject })); },
  };
  const store = new ActivityStore(client, 1);
  return { store, client, lists, details };
}
test('不可见不读接口，打开/前台恢复读真实第一页；关闭和销毁取消消费', async () => {
  const { store, lists } = fixture(); store.setActive(true); store.receive(ready()); await wait(); assert.equal(lists.length, 0);
  store.open({ spaceId: 'thread-a' }); assert.equal(lists.length, 1); lists[0].resolve(activityPage()); await tick();
  assert.equal(store.getSnapshot().loaded, true); store.setActive(false); assert.equal(store.getSnapshot().stale, true);
  store.setActive(true); assert.equal(lists.length, 2); store.close(); assert.equal(lists[1].signal.aborted, true);
  lists[1].resolve(activityPage([])); await tick(); assert.equal(store.getSnapshot().activities.length, 1); store.dispose();
});
test('切会话/状态丢弃旧游标、详情和迟到读取，不能串服或串范围', async () => {
  const { store, lists, details } = fixture(); store.setActive(true); store.open({ spaceId: 'thread-a' });
  store.select('activity-a'); store.setFilter({ spaceId: 'thread-b', status: 'completed' });
  assert.equal(lists[0].signal.aborted, true); assert.equal(details[0].signal.aborted, true); assert.equal(lists[1].query.cursor, undefined);
  lists[0].resolve(activityPage()); details[0].resolve(detailFixture());
  lists[1].resolve(activityPage([activityFixture({ id: 'b', spaceId: 'thread-b', status: 'completed' })])); await tick();
  assert.deepEqual(store.getSnapshot().activities.map((a) => a.id), ['b']); assert.equal(store.getSnapshot().detail, undefined); store.dispose();
});
test('不冻结分页原样回传游标并去重，刷新替换第一页；旧追加页不倒灌', async () => {
  const { store, lists } = fixture(); store.setActive(true); store.open(); lists[0].resolve(activityPage([activityFixture()], 'opaque')); await tick();
  store.loadMore(); assert.equal(lists[1].query.cursor, 'opaque'); lists[1].resolve(activityPage([activityFixture(), activityFixture({ id: 'b' })])); await tick();
  assert.deepEqual(store.getSnapshot().activities.map((a) => a.id), ['activity-a', 'b']);
  store.refresh(); lists[2].resolve(activityPage([activityFixture({ id: 'new' })], 'next')); await tick(); store.loadMore(); store.refresh();
  assert.equal(lists[3].signal.aborted, true); lists[4].resolve(activityPage([])); lists[3].resolve(activityPage([activityFixture({ id: 'late' })])); await tick();
  assert.deepEqual(store.getSnapshot().activities, []); store.dispose();
});
test('失败保留最后观测和重试入口，不把错误伪装空列表；范围错位及不前进游标失败', async () => {
  const { store, lists } = fixture(); store.setActive(true); store.open({ spaceId: 'thread-a' }); lists[0].resolve(activityPage()); await tick();
  store.refresh(); lists[1].reject(new ApiError(500, '不可用')); await tick(); assert.equal(store.getSnapshot().activities.length, 1); assert.match(store.getSnapshot().error, /不可用/); assert.equal(store.getSnapshot().stale, true);
  store.refresh(); lists[2].resolve(activityPage([activityFixture({ spaceId: 'other' })])); await tick(); assert.match(store.getSnapshot().error, /范围/);
  store.refresh(); lists[3].resolve(activityPage([activityFixture()], 'cursor')); await tick(); store.loadMore(); lists[4].resolve(activityPage([activityFixture()], 'cursor')); await tick(); assert.match(store.getSnapshot().error, /游标/); store.dispose();
});
test('详情选择隔离，404 清除旧正文；网络失败保留但标旧，不合成完成状态', async () => {
  const { store, lists, details } = fixture(); store.setActive(true); store.open(); lists[0].resolve(activityPage()); await tick();
  store.select('activity-a'); details[0].resolve(detailFixture()); await tick(); store.refreshDetail(); details[1].reject(new Error('offline')); await tick();
  assert.equal(store.getSnapshot().detail.activity.status, 'awaiting_continuation'); assert.equal(store.getSnapshot().detailStale, true);
  store.refreshDetail(); details[2].reject(new ApiError(404, 'missing')); await tick(); assert.equal(store.getSnapshot().detail, undefined); assert.equal(store.getSnapshot().missing, true);
  store.select('b'); store.select('c'); details[3].resolve(detailFixture(activityFixture({ id: 'b' }))); details[4].resolve(detailFixture(activityFixture({ id: 'c' }))); await tick(); assert.equal(store.getSnapshot().detail.activity.id, 'c');
  store.close(); assert.equal(store.getSnapshot().detail, undefined); store.dispose();
});
test('同一通知流驱动失效；通知风暴合并、在途事件补读一次、无周期轮询', async () => {
  const { store, client, lists, details } = fixture(); let connections = 0; let emit;
  client.subscribeRuntime = (receive) => { connections++; emit = receive; return new Promise(() => {}); };
  const runtime = new RuntimeStore(client, { onEvent: store.receive, onConnection: store.setConnection });
  store.setActive(true); runtime.setActive(true); store.open({ spaceId: 'thread-a' }); store.select('activity-a');
  lists[0].resolve(activityPage()); details[0].resolve(detailFixture()); await tick(); emit(ready());
  for (let i = 0; i < 20; i++) store.invalidate('thread-a'); await wait(); assert.equal(lists.length, 2); assert.equal(details.length, 2); assert.equal(connections, 1);
  store.invalidate('thread-a'); await wait(); assert.equal(lists.length, 2); lists[1].resolve(activityPage()); details[1].resolve(detailFixture()); await wait(); assert.equal(lists.length, 3); assert.equal(details.length, 3);
  lists[2].resolve(activityPage()); details[2].resolve(detailFixture()); await wait(); await wait(); assert.equal(lists.length, 3);
  store.invalidate('unrelated'); await wait(); assert.equal(lists.length, 3); runtime.dispose(); store.dispose();
});
test('删除只移除所属数据，后台迟到详情不能复活；连接域独立', async () => {
  const { store, lists, details } = fixture(); store.setActive(true); store.open({ spaceId: 'thread-a' }); lists[0].resolve(activityPage()); await tick(); store.select('activity-a');
  store.forgetSpace('thread-a'); details[0].resolve(detailFixture()); await tick(); assert.equal(store.getSnapshot().detail, undefined); assert.deepEqual(store.getSnapshot().activities, []);
  const other = fixture(); assert.equal(other.store.getSnapshot().loaded, false); store.dispose(); other.store.dispose();
});
test('ready 整体替换当前集合而不抹掉分页历史，终态推送移出当前集合', async () => {
  const { store, lists } = fixture(); store.setActive(true);
  store.receive(ready([activityFixture()]));
  assert.equal(store.getSnapshot().activeActivities.length, 1);
  store.open(); lists[0].resolve(activityPage([activityFixture({ id: 'past', status: 'failed' })])); await tick();
  store.receive(ready([activityFixture({ id: 'new' })]));
  assert.deepEqual(store.getSnapshot().activeActivities.map((a) => a.id), ['new']);
  assert.deepEqual(store.getSnapshot().activities.map((a) => a.id), ['past']);
  store.receive(update(activityFixture({ id: 'new', status: 'completed', result: '已交付' })));
  assert.deepEqual(store.getSnapshot().activeActivities, []);
  store.receive(ready()); assert.deepEqual(store.getSnapshot().activeActivities, []); store.dispose();
});
test('推送直接替换列表和详情概览，不按时间或虚构 revision 丢帧，步骤仍等待回读', async () => {
  const { store, lists, details } = fixture(); store.setActive(true); store.open(); store.select('activity-a');
  lists[0].resolve(activityPage()); details[0].resolve(detailFixture()); await tick();
  const steps = store.getSnapshot().detail.steps;
  const complete = activityFixture({ status: 'completed', result: '真实交付', updatedAt: '2026-10-19T00:00:00.000Z' });
  store.receive(update(complete));
  assert.equal(store.getSnapshot().activities[0].result, '真实交付');
  assert.equal(store.getSnapshot().detail.activity.status, 'completed');
  assert.equal(store.getSnapshot().detail.steps, steps); assert.equal(store.getSnapshot().detailStale, true);
  // 活动协议没有 revision，不能借用运行版本或 updatedAt 做前端排序。
  store.receive(update(activityFixture({ progress: '后收到的权威概览', updatedAt: '2026-10-18T00:00:00.000Z' })));
  assert.equal(store.getSnapshot().detail.activity.progress, '后收到的权威概览'); store.dispose();
});
test('状态切换立即移出旧筛选范围，新增成员不伪造分页顺序而补读', async () => {
  const { store, lists } = fixture(); store.setActive(true); store.open({ status: 'awaiting_continuation' });
  lists[0].resolve(activityPage()); await tick();
  store.receive(update(activityFixture({ status: 'completed', result: '交付' })));
  assert.deepEqual(store.getSnapshot().activities, []);
  store.receive(update(activityFixture({ id: 'b' })));
  assert.deepEqual(store.getSnapshot().activities, []); await wait();
  lists[1].resolve(activityPage([activityFixture({ id: 'b' })])); await tick();
  assert.equal(store.getSnapshot().activities[0].id, 'b'); store.dispose();
});
for (const failure of [false, true]) test(`推送后迟到 HTTP ${failure ? '错误及404' : '成功'}不能回退概览或清空详情`, async () => {
  const { store, lists, details } = fixture(); store.setActive(true); store.open(); store.select('activity-a');
  lists[0].resolve(activityPage()); details[0].resolve(detailFixture()); await tick();
  store.refresh();
  const complete = activityFixture({ status: 'completed', result: '新结果' }); store.receive(update(complete));
  if (failure) { lists[1].reject(new ApiError(500, '旧错误')); details[1].reject(new ApiError(404, '旧404')); }
  else { lists[1].resolve(activityPage()); details[1].resolve(detailFixture()); }
  await tick();
  assert.equal(store.getSnapshot().activities[0].result, '新结果'); assert.equal(store.getSnapshot().detail.activity.result, '新结果');
  assert.equal(store.getSnapshot().missing, false); assert.equal(store.getSnapshot().error, undefined); assert.equal(store.getSnapshot().detailError, undefined);
  await wait(); assert.equal(lists.length, 3); assert.equal(details.length, 3);
  lists[2].resolve(activityPage([complete])); details[2].resolve(detailFixture(complete)); await tick();
  assert.equal(store.getSnapshot().detailStale, false); store.dispose();
});
