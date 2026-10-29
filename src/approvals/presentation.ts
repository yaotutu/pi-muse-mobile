import type { ApprovalExecution, ApprovalPreview, ApprovalStatus } from './types';

export function approvalStatusLabel(status: ApprovalStatus): string {
  return { pending: '等待审批', approved: '已批准（仅授权）', denied: '已拒绝', expired: '已过期', cancelled: '已撤销' }[status];
}
export function executionLabel(execution: ApprovalExecution | null): string {
  if (execution === null) return '尚未观察到执行';
  return { running: '正在提交文件', succeeded: '文件写入成功', failed: '文件提交失败', cancelled: '文件提交已取消', unknown: '执行结果未知，需核对' }[execution.status];
}
export function approvalScopeLabel(preview: ApprovalPreview): string {
  // 技能库归实例共享；来源空间只负责发起审批，不是文件归属。
  if (preview.scope === 'skill') return '技能库';
  if (preview.scope === 'shared') return '共享工作区';
  return `空间私有工作区 · ${preview.ownerSpaceId}`;
}
/** 本地时间只用于保守禁用过期操作；不改变服务端状态，也不能延长授权。 */
export function approvalCanDecide(approval: { status: ApprovalStatus; expiresAt: string }, synchronized: boolean, now = Date.now()): boolean {
  return synchronized && approval.status === 'pending' && Date.parse(approval.expiresAt) > now;
}
