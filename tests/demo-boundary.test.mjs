import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DemoApiClient } from './helpers/demo-api-client.ts';
import { taskActions, taskMatches } from '../src/activity/task-presentation.ts';
import { goalCategoryLabel } from '../src/goals/presentation.ts';

const task = (kind, status) => ({ kind, status });

test('任务筛选与合法动作不把后台任务当成定时任务', () => {
  assert.equal(taskMatches(task('task', 'failed'), 'finished'), true);
  assert.equal(taskMatches(task('job', 'paused'), 'active'), true);
  assert.equal(taskMatches(task('task', 'running'), 'finished'), false);
  assert.deepEqual(taskActions(task('task', 'running')).map((item) => item.action), ['cancel']);
  assert.deepEqual(taskActions(task('job', 'scheduled')).map((item) => item.action), ['pause', 'cancel']);
  assert.deepEqual(taskActions(task('task', 'failed')).map((item) => item.action), ['retry']);
  assert.deepEqual(taskActions(task('task', 'succeeded')), []);
});

test('分类展示翻译已知分类，保留用户自定义分类', () => {
  assert.equal(goalCategoryLabel('health'), '健康');
  assert.equal(goalCategoryLabel('我的计划'), '我的计划');
});

test('演示任务可控推进、取消后不能推进，并保留完整时间线', async () => {
  const client = new DemoApiClient(true, 1);
  const created = await client.createTask('任务演示');
  client.advanceTask(created.id);
  assert.equal((await client.getTask(created.id)).task.status, 'running');
  client.advanceTask(created.id);
  const details = await client.getTask(created.id);
  assert.equal(details.task.status, 'succeeded');
  assert.equal(details.events.length, 3);
  const cancelled = await client.createTask('取消演示');
  await client.controlTask(cancelled.id, 'cancel', 'task');
  assert.throws(() => client.advanceTask(cancelled.id), (error) => error.status === 409);
});

test('演示聊天与工作区操作不使用任何网络请求', async () => {
  const original = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = () => { networkCalls++; throw new Error('演示不应使用网络'); };
  try {
    const client = new DemoApiClient(true, 1);
    await client.saveIdentity({ name: '演示', tone: 'warm', avatar: 'sand', showChatUpdates: false });
    await client.createGoal({ title: '仅在演示中的目标' });
    await client.saveProfile({ soul: '演示人设', user: '' });
    const { revision } = await client.getConversation('local-main');
    await client.runAgent({ threadId: 'local-main', runId: 'no-network', expectedRevision: revision, message: { id: 'u-network', content: '搜索文档' } }, () => {});
    assert.equal(networkCalls, 0);
    assert.equal((await client.getSnapshot()).identity.avatar, 'sand');
  } finally {
    globalThis.fetch = original;
  }
});
