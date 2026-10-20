import type { ActivityStatus, ActivityStep } from './types';

export const activityStatusLabel = (status: ActivityStatus) => ({ running: '执行中', waiting_approval: '等待审批', waiting_user: '等待补充信息', awaiting_continuation: '等待明确继续', completed: '已完成', failed: '执行失败', stopped: '已停止', interrupted: '执行中断' })[status];
export const stepStatusLabel = (status: ActivityStep['status']) => ({ running: '进行中', succeeded: '成功', failed: '失败', denied: '已拒绝', cancelled: '已取消', expired: '已过期', interrupted: '已中断' })[status];
export const stepKindLabel = (kind: ActivityStep['kind']) => ({ execution: '执行', model: '模型', tool: '工具', subagent: '子代理', approval: '人工审批', file_commit: '文件提交' })[kind];
