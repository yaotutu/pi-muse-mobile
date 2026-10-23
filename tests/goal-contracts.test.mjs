import assert from 'node:assert/strict';
import './register-source.mjs';
import test from 'node:test';

const {
  parseGoal,
  parseGoals,
  parseMilestoneToggle,
  parseGoalRemoval,
} = await import('../src/api/goal-contracts.ts');
const { ApiError } = await import('../src/api/errors.ts');

// 合法目标 fixture：各负向用例在其上做最小改动，避免重复大对象
const goalFixture = (patch = {}) => ({
  id: 'goal-1',
  title: '完成 v1',
  description: '说明',
  category: 'product',
  status: 'active',
  milestones: [{ id: 'm-1', title: '步骤1', done: false }],
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  ...patch,
});

const milestoneFixture = (patch = {}) => ({ id: 'm-1', title: '步骤1', done: false, ...patch });

const expect502 = (fn) => {
  assert.throws(fn, (err) => err instanceof ApiError && err.status === 502);
};

test('parseGoal 投影白名单字段，额外字段不透传', () => {
  const goal = parseGoal(goalFixture({
    extra: 'should-drop',
    milestones: [milestoneFixture({ note: 'drop' })],
  }));
  assert.equal('extra' in goal, false);
  assert.equal('note' in goal.milestones[0], false);
  assert.deepEqual(Object.keys(goal).sort(), [
    'category', 'createdAt', 'description', 'id', 'milestones', 'status', 'title', 'updatedAt',
  ]);
  assert.deepEqual(Object.keys(goal.milestones[0]).sort(), ['done', 'id', 'title']);
});

test('parseGoal 拒绝非法 status', () => {
  expect502(() => parseGoal(goalFixture({ status: 'unknown' })));
  expect502(() => parseGoal(goalFixture({ status: 1 })));
});

test('parseGoal 拒绝非法 createdAt/updatedAt', () => {
  expect502(() => parseGoal(goalFixture({ createdAt: 'not-a-date' })));
  expect502(() => parseGoal(goalFixture({ updatedAt: '2026-13-40T00:00:00Z' })));
  expect502(() => parseGoal(goalFixture({ createdAt: 0 })));
});

test('parseGoal 拒绝里程碑缺字段或错类型', () => {
  expect502(() => parseGoal(goalFixture({ milestones: [{ title: '步骤1', done: false }] })));
  expect502(() => parseGoal(goalFixture({ milestones: [milestoneFixture({ done: 'yes' })] })));
  expect502(() => parseGoal(goalFixture({ milestones: [milestoneFixture({ title: 1 })] })));
  expect502(() => parseGoal(goalFixture({ milestones: 'not-an-array' })));
});

test('parseGoal 拒绝重复里程碑 ID', () => {
  expect502(() => parseGoal(goalFixture({
    milestones: [milestoneFixture(), milestoneFixture()],
  })));
});

test('parseGoal 校验 doneAt 与 done 状态一致且为合法 ISO 时间', () => {
  // done=true 缺 doneAt
  expect502(() => parseGoal(goalFixture({ milestones: [milestoneFixture({ done: true })] })));
  // done=false 携带 doneAt
  expect502(() => parseGoal(goalFixture({
    milestones: [milestoneFixture({ doneAt: '2026-10-20T00:00:00Z' })],
  })));
  // doneAt 非法时间
  expect502(() => parseGoal(goalFixture({
    milestones: [milestoneFixture({ done: true, doneAt: 'yesterday' })],
  })));
  // done=true 且 doneAt 合法时通过
  const goal = parseGoal(goalFixture({
    milestones: [milestoneFixture({ done: true, doneAt: '2026-10-21T08:30:00.000Z' })],
  }));
  assert.deepEqual(goal.milestones[0], {
    id: 'm-1', title: '步骤1', done: true, doneAt: '2026-10-21T08:30:00.000Z',
  });
});

test('parseGoal 校验 expectedId 归属', () => {
  expect502(() => parseGoal(goalFixture(), 'goal-other'));
  const goal = parseGoal(goalFixture(), 'goal-1');
  assert.equal(goal.id, 'goal-1');
});

test('parseMilestoneToggle 校验 goalId 与 milestoneId', () => {
  expect502(() => parseMilestoneToggle(goalFixture(), 'goal-other', 'm-1'));
  expect502(() => parseMilestoneToggle(goalFixture(), 'goal-1', 'm-missing'));
  const goal = parseMilestoneToggle(goalFixture(), 'goal-1', 'm-1');
  assert.equal(goal.id, 'goal-1');
});

test('parseGoalRemoval 严格校验 {ok:true,id} 且匹配 expectedId', () => {
  expect502(() => parseGoalRemoval({ ok: false, id: 'goal-1' }, 'goal-1'));
  expect502(() => parseGoalRemoval({ ok: true, id: 'goal-other' }, 'goal-1'));
  expect502(() => parseGoalRemoval({ ok: true }, 'goal-1'));
  assert.deepEqual(parseGoalRemoval({ ok: true, id: 'goal-1' }, 'goal-1'), { ok: true, id: 'goal-1' });
});

test('parseGoals 拒绝坏外层与坏 item', () => {
  expect502(() => parseGoals(null));
  expect502(() => parseGoals({ goals: 'not-an-array' }));
  expect502(() => parseGoals({ goals: [goalFixture({ status: 'unknown' })] }));
});

test('parseGoals 拒绝重复 goal ID', () => {
  expect502(() => parseGoals({ goals: [goalFixture(), goalFixture()] }));
  const goals = parseGoals({ goals: [goalFixture(), goalFixture({ id: 'goal-2' })] });
  assert.equal(goals.length, 2);
});
