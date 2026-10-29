/** 审批属于连接内存数据域；正文不持久化，也不从旧 notifications.payload 兼容推断。 */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
export type SettledApprovalStatus = Exclude<ApprovalStatus, 'pending'>;
export type ApprovalDecision = 'approve' | 'deny';

export type ApprovalPreview = {
  scope: 'space' | 'shared' | 'skill';
  /** 文件归属由服务端明确给出，不能用子代理 ID 或路径反推。 */
  ownerSpaceId: string | null;
  path: string;
  before: string;
  after: string;
  beforeExists: boolean;
};
export type ApprovalExecution = {
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  startedAt: string;
  finishedAt: string | null;
  result: string | null;
};
export type ApprovalState = {
  id: string;
  /** 与运行 revision 不同：审批 revision 跨服务进程持久。 */
  revision: number;
  spaceId: string | null;
  runId: string | null;
  toolCallId: string | null;
  subagentId: string | null;
  workspaceSpaceId: string | null;
  activityId: string | null;
  status: ApprovalStatus;
  execution: ApprovalExecution | null;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  decidedAt: string | null;
};
export type ApprovalSummary = ApprovalState & { title: string; kind: 'file_write' | 'file_edit' };
export type ApprovalView = ApprovalSummary & { preview: ApprovalPreview };
/** approval_updated 不携带 title/kind/preview，绝不把缺失正文当作空文件。 */
export type ApprovalResolution = ApprovalState & { status: SettledApprovalStatus };
export type ApprovalRecord = ApprovalView | ApprovalSummary | ApprovalResolution;
export type ApprovalFilter = { status?: SettledApprovalStatus; spaceId?: string; activityId?: string };
export type ApprovalQuery = ApprovalFilter & { limit?: number; cursor?: string };
export type ApprovalPage = { approvals: ApprovalSummary[]; hasMore: boolean; nextCursor: string | null };

export interface ApprovalClient {
  listApprovals(query?: ApprovalQuery, signal?: AbortSignal): Promise<ApprovalPage>;
  getPendingApprovals(signal?: AbortSignal): Promise<ApprovalView[]>;
  getApproval(id: string, signal?: AbortSignal): Promise<ApprovalView>;
  decideApproval(id: string, decision: ApprovalDecision, signal?: AbortSignal): Promise<ApprovalView>;
}
