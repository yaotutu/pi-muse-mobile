import type { ApprovalResolution, ApprovalSummary, ApprovalView } from '../../src/approvals/types';

export const approvalFixture = (overrides: Partial<ApprovalView> = {}): ApprovalView => ({
  id: 'approval-a', revision: 1, threadId: 'thread-a', runId: 'run-a', toolCallId: 'tool-a',
  subagentId: null, workspaceThreadId: 'thread-a', activityId: null,
  kind: 'file_write', title: '写入验收文件', status: 'pending', execution: null,
  preview: { scope: 'thread', ownerThreadId: 'thread-a', path: 'audit.txt', before: '', after: '完整中文内容\n第二行\n', beforeExists: false },
  createdAt: '2026-10-20T00:00:00.000Z', expiresAt: '2035-10-20T00:05:00.000Z', resolvedAt: null, decidedAt: null,
  ...overrides,
});
export const settledApproval = (overrides: Partial<ApprovalView> = {}): ApprovalView => approvalFixture({
  revision: 2, status: 'approved', resolvedAt: '2026-10-20T00:01:00.000Z', decidedAt: '2026-10-20T00:01:00.000Z', ...overrides,
});
export function approvalResolution(item = settledApproval()): ApprovalResolution {
  const { preview: _preview, title: _title, kind: _kind, ...state } = item;
  return state as ApprovalResolution;
}
export function approvalSummary(item = settledApproval()): ApprovalSummary {
  const { preview: _preview, ...summary } = item;
  return summary;
}
