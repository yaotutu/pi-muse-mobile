/** 活动是模型显式登记的工作，不是聊天 run 的别名；客户端只有只读权限。 */
export const activityStatuses = ['running', 'waiting_approval', 'waiting_user', 'awaiting_continuation', 'completed', 'failed', 'stopped', 'interrupted'] as const;
export type ActivityStatus = typeof activityStatuses[number];
export type ActivityOverview = {
  id: string;
  threadId: string;
  title: string;
  goal: string;
  deliverable: string;
  status: ActivityStatus;
  progress: string;
  result: string | null;
  /** 首次绑定顺序；继续原工作会追加 run，不创建新活动。 */
  runIds: string[];
  currentRunId: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};
export const stepKinds = ['execution', 'model', 'tool', 'subagent', 'approval', 'file_commit'] as const;
export const stepStatuses = ['running', 'succeeded', 'failed', 'denied', 'cancelled', 'expired', 'interrupted'] as const;
export type ActivityStep = {
  /** 仅在 run 内稳定；显示和去重必须同时使用 runId。 */
  id: string;
  runId: string;
  parentId: string | null;
  kind: typeof stepKinds[number];
  title: string;
  status: typeof stepStatuses[number];
  startedAt: string;
  finishedAt: string | null;
  result: string | null;
};
export type ActivityDetail = { activity: ActivityOverview; steps: ActivityStep[] };
export type ActivityFilter = { threadId?: string; status?: ActivityStatus };
export type ActivityQuery = ActivityFilter & { limit?: number; cursor?: string };
export type ActivityPage = { activities: ActivityOverview[]; hasMore: boolean; nextCursor: string | null };
export interface ActivityClient {
  listActivities(query?: ActivityQuery, signal?: AbortSignal): Promise<ActivityPage>;
  getActivity(id: string, signal?: AbortSignal): Promise<ActivityDetail>;
}
