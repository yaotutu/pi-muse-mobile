import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { GoalStore, goalStatusLabel, goalStatusTone } from '../src/goals/goal-store.ts';
import { ApiError } from '../src/api/errors.ts';

const goalFixture = (patch = {}) => ({
  id: 'goal-1',
  title: '完成移动端目标功能',
  description: '支持增删改查与里程碑',
  category: '开发',
  status: 'active',
  milestones: [
    { id: 'm-1', title: '实现 GoalStore', done: true, doneAt: '2026-10-23T10:00:00Z' },
    { id: 'm-2', title: '实现 GoalsPanel', done: false },
  ],
  createdAt: '2026-10-23T08:00:00Z',
  updatedAt: '2026-10-23T10:00:00Z',
  ...patch,
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(overrides = {}) {
  let goals = [goalFixture()];
  const calls = [];
  const client = {
    async listGoals(query, signal) {
      calls.push(['list', query, signal]);
      return goals;
    },
    async createGoal(input, signal) {
      calls.push(['create', input, signal]);
      const newGoal = goalFixture({
        id: 'goal-new',
        title: input.title,
        description: input.description ?? '',
        category: input.category ?? '',
        milestones: (input.milestones ?? []).map((t, i) => ({ id: `m-${i + 1}`, title: t, done: false })),
      });
      goals = [newGoal, ...goals];
      return newGoal;
    },
    async setGoalStatus(id, status, signal) {
      calls.push(['setStatus', id, status, signal]);
      goals = goals.map((g) => (g.id === id ? { ...g, status } : g));
      return goals.find((g) => g.id === id);
    },
    async toggleMilestone(goalId, milestoneId, signal) {
      calls.push(['toggleMilestone', goalId, milestoneId, signal]);
      goals = goals.map((g) => {
        if (g.id !== goalId) return g;
        return {
          ...g,
          milestones: g.milestones.map((m) =>
            m.id === milestoneId ? { ...m, done: !m.done, doneAt: !m.done ? '2026-10-23T11:00:00Z' : undefined } : m,
          ),
        };
      });
      return goals.find((g) => g.id === goalId);
    },
    async removeGoal(id, signal) {
      calls.push(['remove', id, signal]);
      goals = goals.filter((g) => g.id !== id);
      return { ok: true, id };
    },
    ...overrides,
  };
  const store = new GoalStore(client);
  return { client, calls, store, setGoals: (g) => { goals = g; } };
}

async function opened(overrides) {
  const env = setup(overrides);
  env.store.setActive(true);
  env.store.open();
  await tick();
  return env;
}

test('目标前台与页面打开才读取，关闭和后台取消在途读取，不盲轮询', async () => {
  const env = setup();
  env.store.setActive(true);
  assert.equal(env.calls.length, 0);
  env.store.open();
  await tick();
  assert.equal(env.calls.filter((c) => c[0] === 'list').length, 1);

  const read = deferred();
  let readSignal;
  env.client.listGoals = (_query, signal) => {
    readSignal = signal;
    return read.promise;
  };
  env.store.refresh();
  assert.equal(env.store.getSnapshot().loading, true);
  env.store.close();
  assert.equal(readSignal.aborted, true);
  assert.equal(env.store.getSnapshot().stale, true);
  assert.equal(env.store.getSnapshot().loading, false);

  env.client.listGoals = async () => [goalFixture()];
  env.store.open();
  await tick();
  assert.equal(env.store.getSnapshot().loaded, true);
  assert.equal(env.store.getSnapshot().stale, false);
  env.store.dispose();
});

test('目标读取失败保留既有数据并标 stale，不伪装成空列表', async () => {
  const env = await opened();
  assert.equal(env.store.getSnapshot().goals.length, 1);
  assert.equal(env.store.canWrite(), true);

  env.client.listGoals = async () => {
    throw new ApiError(500, '目标服务暂不可用');
  };
  await env.store.refresh();
  assert.equal(env.store.getSnapshot().goals.length, 1);
  assert.equal(env.store.getSnapshot().stale, true);
  assert.equal(env.store.getSnapshot().error, '目标服务暂不可用');
  assert.equal(env.store.canWrite(), false);
  env.store.dispose();
});

test('过滤与排序更新 query 并刷新列表，写入或表单编辑中不可切换', async () => {
  const env = await opened();
  env.store.setQuery({ status: 'completed', sort: 'createdAt', order: 'asc' });
  await tick();
  const lastList = env.calls.filter((c) => c[0] === 'list').at(-1);
  assert.deepEqual(lastList[1], { status: 'completed', sort: 'createdAt', order: 'asc' });

  env.store.startCreate();
  env.store.setCreator({ title: '草稿目标' });
  env.store.setQuery({ status: 'paused' });
  assert.equal(env.store.getSnapshot().query.status, 'completed');
  env.store.dispose();
});

test('目标创建表单：标题必填，描述/分类/里程碑可选；空标题不发请求，成功清空表单并回读', async () => {
  const env = await opened();
  env.store.startCreate();
  env.store.setCreator({ title: '   ' });
  assert.equal(await env.store.saveCreate(), false);
  assert.equal(env.calls.some((c) => c[0] === 'create'), false);
  assert.equal(env.store.getSnapshot().error, '目标标题不能为空');

  env.store.setCreator({
    title: '  学习 React Native  ',
    description: '  系统学习核心组件与架构  ',
    category: '  学习  ',
    milestonesText: '阅读文档\n\n编写示例项目\n跑通测试',
  });
  assert.equal(await env.store.saveCreate(), true);
  await tick();
  const createCall = env.calls.find((c) => c[0] === 'create');
  assert.deepEqual(createCall[1], {
    title: '学习 React Native',
    description: '系统学习核心组件与架构',
    category: '学习',
    milestones: ['阅读文档', '编写示例项目', '跑通测试'],
  });
  assert.equal(env.store.getSnapshot().creator, undefined);
  assert.equal(env.store.getSnapshot().notice, '目标已创建');
  env.store.dispose();
});

test('状态更新与里程碑勾选校验 canWrite，成功刷新并更新文案，相同状态不发请求', async () => {
  const env = await opened();
  assert.equal(await env.store.setStatus('goal-1', 'active'), false);
  assert.equal(env.calls.some((c) => c[0] === 'setStatus'), false);

  assert.equal(await env.store.setStatus('goal-1', 'paused'), true);
  await tick();
  assert.equal(env.calls.some((c) => c[0] === 'setStatus' && c[2] === 'paused'), true);
  assert.equal(env.store.getSnapshot().notice, '目标状态已更新为已暂停');

  assert.equal(await env.store.toggleMilestone('goal-1', 'm-2'), true);
  await tick();
  assert.equal(env.calls.some((c) => c[0] === 'toggleMilestone' && c[2] === 'm-2'), true);
  assert.equal(env.store.getSnapshot().notice, '里程碑“实现 GoalsPanel”状态已更新');

  assert.equal(await env.store.toggleMilestone('goal-1', 'm-missing'), false);
  env.store.dispose();
});

test('删除必须明确确认，取消或刷新使确认失效，成功调用 DELETE 并回读', async () => {
  const env = await opened();
  env.store.requestDelete('goal-1');
  assert.equal(env.store.getSnapshot().deleteTarget?.id, 'goal-1');
  env.store.cancelDelete();
  assert.equal(env.store.getSnapshot().deleteTarget, undefined);
  assert.equal(await env.store.confirmDelete(), false);

  env.store.requestDelete('goal-1');
  await env.store.refresh();
  assert.equal(env.store.getSnapshot().deleteTarget, undefined);
  assert.equal(await env.store.confirmDelete(), false);

  env.store.requestDelete('goal-1');
  assert.equal(await env.store.confirmDelete(), true);
  await tick();
  assert.equal(env.calls.some((c) => c[0] === 'remove' && c[1] === 'goal-1'), true);
  assert.equal(env.store.getSnapshot().notice, '目标已删除');
  assert.equal(env.store.getSnapshot().goals.length, 0);
  env.store.dispose();
});

test('写入结果未明锁定重提，草稿保留，失败刷新不能解锁，完整刷新核对后人工解除锁定', async () => {
  for (const err of [new ApiError(0, 'offline'), new ApiError(408, 'timeout'), new ApiError(500, 'server error')]) {
    const env = await opened({
      async createGoal() {
        throw err;
      },
    });
    env.store.startCreate();
    env.store.setCreator({ title: '重要计划' });
    assert.equal(await env.store.saveCreate(), false);
    assert.equal(env.store.getSnapshot().uncertain, true);
    assert.equal(env.store.getSnapshot().creator?.title, '重要计划');
    assert.equal(env.store.canWrite(), false);

    env.store.acknowledgeReviewed();
    assert.equal(env.store.getSnapshot().uncertain, true);

    env.client.listGoals = async () => {
      throw new ApiError(500, '仍未恢复');
    };
    await env.store.refresh();
    assert.equal(env.store.getSnapshot().uncertain, true);
    env.store.acknowledgeReviewed();
    assert.equal(env.store.getSnapshot().uncertain, true);

    env.client.listGoals = async () => [goalFixture()];
    await env.store.refresh();
    assert.equal(env.store.getSnapshot().reviewed, true);
    assert.equal(env.store.getSnapshot().uncertain, true);
    env.store.acknowledgeReviewed();
    assert.equal(env.store.getSnapshot().uncertain, false);
    assert.equal(env.store.getSnapshot().creator?.title, '重要计划');
    env.store.dispose();
  }
});

test('后台中断在途写入，标记结果未明且保留草稿，迟到成功不静默清除', async () => {
  const write = deferred();
  let writeSignal;
  const env = await opened({
    async createGoal(_input, signal) {
      writeSignal = signal;
      return write.promise;
    },
  });
  env.store.startCreate();
  env.store.setCreator({ title: '后台在途目标' });
  const saving = env.store.saveCreate();
  assert.equal(env.store.getSnapshot().writing, true);

  env.store.setActive(false);
  assert.equal(writeSignal.aborted, true);
  assert.equal(env.store.getSnapshot().uncertain, true);
  assert.equal(env.store.getSnapshot().creator?.title, '后台在途目标');

  write.resolve(goalFixture({ id: 'late-goal' }));
  assert.equal(await saving, false);
  assert.equal(env.store.getSnapshot().creator?.title, '后台在途目标');
  env.store.dispose();
});

test('状态语义与配色 tone 契约一致', () => {
  assert.equal(goalStatusLabel('active'), '进行中');
  assert.equal(goalStatusLabel('paused'), '已暂停');
  assert.equal(goalStatusLabel('completed'), '已完成');
  assert.equal(goalStatusLabel('archived'), '已归档');

  assert.equal(goalStatusTone('active'), 'accent');
  assert.equal(goalStatusTone('paused'), 'warning');
  assert.equal(goalStatusTone('completed'), 'success');
  assert.equal(goalStatusTone('archived'), 'neutral');
});

test('源码与架构挂载：GoalsProvider 在 RuntimeProvider 同层装配，WorkspaceScreen 接入 GoalsPanel 替换占位页', () => {
  const root = new URL('../', import.meta.url);
  const read = (p) => readFileSync(new URL(p, root), 'utf8');

  const runtimeSource = read('src/runtime/RuntimeProvider.tsx');
  assert.match(runtimeSource, /import\s+\{\s*GoalStore\s*\}\s+from\s+'\.\.\/goals\/goal-store'/);
  assert.match(runtimeSource, /import\s+\{\s*GoalProvider\s*\}\s+from\s+'\.\.\/goals\/GoalProvider'/);
  assert.match(runtimeSource, /const goals = useMemo\(\(\) => new GoalStore\(api\), \[api\]\)/);
  assert.match(runtimeSource, /goals\.setActive\(enabled\)/);
  assert.match(runtimeSource, /goals\.dispose\(\)/);
  assert.match(runtimeSource, /<GoalProvider store=\{goals\}>/);

  const workspaceSource = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(workspaceSource, /import\s+\{\s*GoalsPanel\s*\}\s+from\s+'\.\/GoalsPanel'/);
  assert.match(workspaceSource, /import\s+\{\s*useGoals\s*\}\s+from\s+'\.\.\/goals\/GoalProvider'/);
  assert.match(workspaceSource, /const \{ store: goals \} = useGoals\(\)/);
  assert.match(workspaceSource, /goals\.invalidate\(\)/);
  assert.match(workspaceSource, /!sessionOpen && <GoalsPanel \/>/);
  assert.doesNotMatch(workspaceSource, /目标尚未接入/);

  const panelSource = read('src/workspace/GoalsPanel.tsx');
  assert.doesNotMatch(panelSource, /#[0-9a-f]{3,8}\b/i, 'GoalsPanel 禁止硬编码十六进制颜色');
  assert.match(panelSource, /testID="goals-panel"/);
  assert.match(panelSource, /testID="goal-creator"/);
  assert.match(panelSource, /testID="goal-delete-confirm"/);
  assert.match(panelSource, /testID="goals-uncertain"/);
  assert.match(panelSource, /accessibilityLabel="正在读取目标"/);
  assert.match(panelSource, /accessibilityRole="checkbox"/);
  assert.match(panelSource, /accessibilityRole="alert"/);
  assert.match(panelSource, /store\.open\(\);\s*return \(\) => store\.close\(\)/);
});
