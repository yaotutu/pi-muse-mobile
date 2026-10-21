/**
 * 运行状态流（GET /api/events）+ 单点状态查询（GET /api/agent/status）契约。
 *
 * 数据来源是服务端工作区推送；与聊天 AG-UI 流（POST /api/conversation/run）独立。
 * 运行与审批共用一条通知连接，分别交给各自的内存 store；用户决定仍走独立 HTTP。
 */
import type { ApprovalResolution, ApprovalView } from '../approvals/types';
import type { ActivityOverview } from '../activities/types';

export type RunSource = 'chat' | 'job';

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 父运行阶段；终态时为 null。 */
export type RunPhase =
  | 'preparing'
  | 'waiting_model'
  | 'responding'
  | 'executing_tool'
  | 'waiting_subagents'
  | 'waiting_approval'
  | 'finalizing'
  | null;

/** 子代理阶段集合与父运行相同，但不含 waiting_subagents。 */
export type SubagentPhase =
  | 'preparing'
  | 'waiting_model'
  | 'responding'
  | 'executing_tool'
  | 'waiting_approval'
  | 'finalizing'
  | null;

export type ToolStatus = 'running' | 'waiting_approval';

export type SubagentStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type AgentToolState = {
  toolCallId: string;
  name: string | null;
  label: string;
  status: ToolStatus;
  subagentId: string | null;
};

export type SubagentState = {
  id: string;
  role: string;
  status: SubagentStatus;
  phase: SubagentPhase;
  label: string;
  startedAt: string | null;
  updatedAt: string;
  endedAt: string | null;
};

export type AgentStatus = {
  activityId: string | null;
  spaceId: string;
  runId: string;
  revision: number;
  source: RunSource;
  jobId: string | null;
  title: string;
  status: RunStatus;
  phase: RunPhase;
  label: string;
  tools: AgentToolState[];
  subagents: SubagentState[];
  pendingApprovalIds: string[];
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
};

/** GET /api/agent/status 响应；instanceId 由服务端进程决定。 */
export type AgentStatusResponse = {
  instanceId: string;
  status: AgentStatus;
};

/** 三个集合分别完整替换；活动集合不包含终态，不能拿它清空持久历史。 */
export type RuntimeReadyEvent = {
  event: 'ready';
  data: {
    instanceId: string;
    serverTime: string;
    agentStatuses: AgentStatus[];
    pendingApprovals: ApprovalView[];
    activities: ActivityOverview[];
  };
};

export type RuntimeAgentStatusUpdatedEvent = {
  event: 'agent_status_updated';
  data: AgentStatus & { instanceId: string };
};

/** 本轮订阅对外契约；未知事件由传输层直接跳过，不向上抛。 */
export type RuntimeEvent = RuntimeReadyEvent | RuntimeAgentStatusUpdatedEvent
  | { event: 'approval_pending'; data: ApprovalView & { instanceId: string } }
  | { event: 'approval_updated'; data: ApprovalResolution & { instanceId: string } }
  | { event: 'activity_updated'; data: ActivityOverview & { instanceId: string } };
