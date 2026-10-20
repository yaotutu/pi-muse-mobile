import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalStatusLabel, executionLabel, approvalScopeLabel, approvalCanDecide } from '../src/approvals/presentation.ts';
import { approvalFixture } from './helpers/approval-fixtures.ts';

test('人的决定不等同于执行成功，所有终态都有明确文案', () => {
  assert.match(approvalStatusLabel('approved'), /仅授权/);
  for (const status of ['pending', 'approved', 'denied', 'expired', 'cancelled']) assert.equal(typeof approvalStatusLabel(status), 'string');
  assert.match(executionLabel(null), /尚未观察/);
  assert.match(executionLabel({ status: 'unknown' }), /未知/);
  assert.match(executionLabel({ status: 'succeeded' }), /写入成功/);
  for (const status of ['running', 'succeeded', 'failed', 'cancelled', 'unknown']) assert.equal(typeof executionLabel({ status }), 'string');
});
test('工作区归属以 scope/ownerSpaceId 为准，不从路径或子代理推断', () => {
  const preview = approvalFixture().preview;
  assert.match(approvalScopeLabel({ ...preview, path: 'shared/name.txt' }), /私有工作区.*thread-a/);
  assert.equal(approvalScopeLabel({ ...preview, scope: 'shared', ownerSpaceId: null }), '共享工作区');
});
test('只有同步且未到期的 pending 可决定；本地判断不更改权威状态', () => {
  const approval = approvalFixture(); const now = Date.parse('2026-10-20T00:00:00.000Z');
  assert.equal(approvalCanDecide(approval, true, now), true); assert.equal(approvalCanDecide(approval, false, now), false);
  for (const status of ['approved', 'denied', 'expired', 'cancelled']) assert.equal(approvalCanDecide({ ...approval, status }, true, now), false);
  assert.equal(approvalCanDecide({ ...approval, expiresAt: 'invalid' }, true, now), false);
  assert.equal(approvalCanDecide({ ...approval, expiresAt: '2026-10-20T00:00:00.000Z' }, true, now), false);
  assert.equal(approval.status, 'pending');
});
