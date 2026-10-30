import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { activityStatusLabel, stepStatusLabel, stepKindLabel } from '../src/activities/presentation.ts';
import { activityStatuses, stepKinds, stepStatuses } from '../src/activities/types.ts';

test('工作等待继续和本轮成功不混淆，所有活动/步骤状态都有真实语义文案', () => {
  assert.match(activityStatusLabel('awaiting_continuation'), /继续/); assert.equal(activityStatusLabel('completed'), '已完成'); assert.equal(stepStatusLabel('succeeded'), '成功');
  for (const status of activityStatuses) assert.equal(typeof activityStatusLabel(status), 'string');
  for (const status of stepStatuses) assert.equal(typeof stepStatusLabel(status), 'string');
  for (const kind of stepKinds) assert.equal(typeof stepKindLabel(kind), 'string');
});
test('实际入口挂载只读历史，关联只使用显式 activityId，步骤无伪造审批跳转', () => {
  const read = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const provider = read('runtime/RuntimeProvider.tsx'); const panel = read('workspace/ActivityPanel.tsx');
  assert.match(provider, /activities.receive\(event\)/); assert.match(provider, /activities.setActive\(enabled\)/);
  assert.match(read('workspace/SessionPanel.tsx'), /tab === 'history'.*ActivityPanel/);
  assert.match(read('workspace/CurrentExecution.tsx'), /run.activityId !== null/); assert.match(panel, /key=\{activityStepKey\(step\)\}/);
  assert.doesNotMatch(panel, /decideApproval|createTask|dangerouslySetInnerHTML|parseInt\(step.id/);
});
