/** 页面依赖的客户端契约；网络实现不向上泄露传输细节。 */
import type {
  AgentTask,
  AgUiEvent,
  ConversationSnapshot,
  DeleteJobResult,
  DeleteSpaceResult,
  Goal,
  GoalStatus,
  Identity,
  JobAction,
  JobDetail,
  JobEvent,
  JobEventKind,
  JobItem,
  JobsQuery,
  Monitor,
  ResetSpaceResult,
  TaskDetails,
  SpaceInfo,
  SpaceInstructions,
  SpaceSkills,
  UpdateJobInput,
  WorkspaceSnapshot,
} from './types';
import type { AgentStatusResponse, RuntimeEvent } from '../runtime/types';
import type { ApprovalClient } from '../approvals/types';
import type { ActivityClient } from '../activities/types';
import type { MemoryClient } from '../memories/types';

/** 增量聊天只提交一条新用户消息；历史与工具消息始终由服务端持有。 */
export type RunInput = {
  spaceId: string;
  /** 本轮唯一 ID；成功请求可幂等重放。 */
  runId: string;
  /** 来自 GET /api/conversation；空会话也是明确的 empty 版本。 */
  expectedRevision: string;
  message: { id: string; content: string };
};

/**
 * 客户端接口：页面只依赖此抽象，不感知 mock/HTTP 差异。
 */
export interface ApiClient extends ApprovalClient, ActivityClient, MemoryClient {
  /** POST /api/session → {token, mode}；客户端不按时间过期，失效以服务端401为准。 */
  createSession(accessKey?: string): Promise<{ token: string; mode: string }>;
  /** GET /api/spaces（按活跃倒序） */
  listSpaces(signal?: AbortSignal): Promise<SpaceInfo[]>;
  /** 重置只替换聊天绑定；默认保留规则、技能、文件、定时任务和监控。副作用绝不自动重试。 */
  resetSpace(spaceId: string, options?: { clearSchedules?: boolean }, signal?: AbortSignal): Promise<ResetSpaceResult>;
  /** GET /api/conversation?spaceId= 权威历史；empty 不代表空间存在，存在性以空间列表为准。 */
  getConversation(spaceId: string, signal?: AbortSignal): Promise<ConversationSnapshot>;
  /** 发起一轮对话：SSE 流式回调 AG-UI 事件；signal 中断即停止消费 */
  runAgent(
    input: RunInput,
    onEvent: (event: AgUiEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /** 只停止指定运行；迟到停止返回 false，不影响下一轮。 */
  stopRun(spaceId: string, runId: string): Promise<boolean>;
  /** 保留的全量快照消费者；新版顶栏、审批与活动不调用此方法，也不恢复盲轮询。 */
  getSnapshot(signal?: AbortSignal): Promise<WorkspaceSnapshot>;

  // --- 空间配置与生命周期 ---

  /** GET /api/spaces/:id/instructions 读取空间规则 */
  getSpaceInstructions(spaceId: string, signal?: AbortSignal): Promise<SpaceInstructions>;
  /** PUT /api/spaces/:id/instructions 保存空间规则；空串允许（等价"清空"） */
  saveSpaceInstructions(spaceId: string, instructions: string, signal?: AbortSignal): Promise<SpaceInstructions>;
  /** GET /api/spaces/:id/skills 读取空间级技能生效值；diagnostics 缺省视为无诊断 */
  getSpaceSkills(spaceId: string, signal?: AbortSignal): Promise<SpaceSkills>;
  /** PUT /api/spaces/:id/skills 用名称→启用态覆盖写入；空对象等价"恢复默认" */
  saveSpaceSkills(
    spaceId: string,
    overrides: Record<string, boolean>,
    signal?: AbortSignal,
  ): Promise<SpaceSkills>;
  /** DELETE /api/spaces/:id 彻底删除空间并清点副作用；服务端 401/404/409 语义保留 */
  deleteSpace(spaceId: string, signal?: AbortSignal): Promise<DeleteSpaceResult>;

  // --- 定时任务（GET /api/jobs, GET /api/jobs/:id, POST /api/jobs/:id/control, PATCH /api/jobs/:id, DELETE /api/jobs/:id） ---

  /** 查询定时任务列表：全量返回不分页，支持空间过滤与排序 */
  listJobs(query?: JobsQuery, signal?: AbortSignal): Promise<JobItem[]>;
  /** 读取指定定时任务详情（含时间线 events） */
  getJob(id: string, signal?: AbortSignal): Promise<JobDetail>;
  /** 控制定时任务生命周期（pause/resume/cancel/retry） */
  controlJob(id: string, action: JobAction, signal?: AbortSignal): Promise<JobItem>;
  /** 直接编辑定时任务提示词、时刻周期或归属空间 */
  updateJob(id: string, updates: UpdateJobInput, signal?: AbortSignal): Promise<JobItem>;
  /** 彻底删除指定定时任务 */
  deleteJob(id: string, signal?: AbortSignal): Promise<DeleteJobResult>;

  /** 兼容旧版：获取任务详情（重定向到 /api/jobs/:id，转换为 TaskDetails） */
  getTask(id: string, signal?: AbortSignal): Promise<TaskDetails>;
  /** 兼容旧版：控制任务（重定向到 /api/jobs/:id/control，去掉冗余 target） */
  controlTask(
    id: string,
    action: TaskAction,
    target?: TaskControlTarget,
    signal?: AbortSignal,
  ): Promise<AgentTask>;

  // --- 监控（创建走聊天 monitor 工具，页面只做控制） ---

  controlMonitor(id: string, action: MonitorAction): Promise<Monitor>;

  // --- 目标 ---

  createGoal(input: GoalInput): Promise<Goal>;
  /** 编辑不含里程碑（服务端编辑端点不接受 milestones） */
  updateGoal(id: string, input: Partial<Omit<GoalInput, 'milestones'>>): Promise<Goal>;
  /** completed 自动勾掉全部里程碑；重新激活不回退勾选 */
  setGoalStatus(id: string, status: GoalStatus): Promise<Goal>;
  toggleMilestone(goalId: string, milestoneId: string): Promise<Goal>;
  removeGoal(id: string): Promise<void>;

  // --- 身份 / 记忆 / 人设 ---

  saveIdentity(input: IdentityInput): Promise<Identity>;
  /** SOUL/USER 人设文本（空串=未设置） */
  getProfile(): Promise<Profile>;
  saveProfile(profile: Profile): Promise<Profile>;

  // --- 运行状态（GET /api/agent/status + GET /api/events） ---

  /** 单点查询指定 (spaceId, runId) 的最新状态；运行不存在或被清理返回 404。 */
  getAgentStatus(spaceId: string, runId: string, signal?: AbortSignal): Promise<AgentStatusResponse>;
  /**
   * 订阅唯一工作区通知流；首帧 ready 同时给出运行和待审批完整集合。
   * 后续运行状态与审批新增／回执事件交由各自领域消费，不额外建立审批 SSE。
   * 连接自然结束（EOF）视为正常，调用方按服务端约定重连；
   * signal 触发不会调用聊天 Stop，订阅生命周期与聊天独立。
   */
  subscribeRuntime(onEvent: (event: RuntimeEvent) => void, signal?: AbortSignal): Promise<void>;
}

export type {
  DeleteJobResult,
  JobAction,
  JobDetail,
  JobEvent,
  JobEventKind,
  JobItem,
  JobsQuery,
  UpdateJobInput,
};
export type TaskAction = JobAction;
export type TaskControlTarget = 'job';
export type MonitorAction = 'pause' | 'resume' | 'stop';
export type { ApprovalDecision } from '../approvals/types';
export type GoalInput = {
  title: string;
  description?: string;
  category?: string;
  /** 里程碑标题列表（仅创建时） */
  milestones?: string[];
};
export type IdentityInput = {
  name: string;
  tone: string;
  avatar?: string;
  showChatUpdates?: boolean;
};
export type Profile = { soul: string; user: string };
