/** 页面依赖的客户端契约；网络实现不向上泄露传输细节。 */
import type {
  AgentTask,
  AgUiEvent,
  ApprovalNotification,
  ConversationSnapshot,
  DeleteThreadResult,
  Goal,
  GoalStatus,
  Identity,
  MemoryItem,
  Monitor,
  TaskDetails,
  ThreadInfo,
  ThreadInstructions,
  ThreadSkills,
  WorkspaceSnapshot,
} from './types';
import type { AgentStatusResponse, RuntimeEvent } from '../runtime/types';

/** 增量聊天只提交一条新用户消息；历史与工具消息始终由服务端持有。 */
export type RunInput = {
  threadId: string;
  /** 本轮唯一 ID；成功请求可幂等重放。 */
  runId: string;
  /** 来自 GET /api/conversation；空会话也是明确的 empty 版本。 */
  expectedRevision: string;
  message: { id: string; content: string };
};

/**
 * 客户端接口：页面只依赖此抽象，不感知 mock/HTTP 差异。
 */
export interface ApiClient {
  /** POST /api/session → {token, mode}；客户端不按时间过期，失效以服务端401为准。 */
  createSession(accessKey?: string): Promise<{ token: string; mode: string }>;
  /** GET /api/threads（按活跃倒序） */
  listThreads(signal?: AbortSignal): Promise<ThreadInfo[]>;
  /** GET /api/conversation?threadId= 权威历史；empty 不代表会话存在，存在性以列表为准。 */
  getConversation(threadId: string, signal?: AbortSignal): Promise<ConversationSnapshot>;
  /** 发起一轮对话：SSE 流式回调 AG-UI 事件；signal 中断即停止消费 */
  runAgent(
    input: RunInput,
    onEvent: (event: AgUiEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /** 只停止指定运行；迟到停止返回 false，不影响下一轮。 */
  stopRun(threadId: string, runId: string): Promise<boolean>;
  /** GET /api/agent 全量快照（顶栏状态/审批/工作台页共用） */
  getSnapshot(signal?: AbortSignal): Promise<WorkspaceSnapshot>;

  // --- 会话配置（线程级 SKILL/指令/删除） ---

  /** GET /api/threads/:id/instructions 读取线程指令 */
  getThreadInstructions(threadId: string, signal?: AbortSignal): Promise<ThreadInstructions>;
  /** PUT /api/threads/:id/instructions 写入线程指令；空串允许（等价"清空"） */
  saveThreadInstructions(threadId: string, instructions: string, signal?: AbortSignal): Promise<ThreadInstructions>;
  /** GET /api/threads/:id/skills 读取线程级技能覆盖；diagnostics 缺省视为无诊断 */
  getThreadSkills(threadId: string, signal?: AbortSignal): Promise<ThreadSkills>;
  /** PUT /api/threads/:id/skills 用名称→启用态覆盖写入；空对象等价"恢复默认" */
  saveThreadSkills(
    threadId: string,
    overrides: Record<string, boolean>,
    signal?: AbortSignal,
  ): Promise<ThreadSkills>;
  /** DELETE /api/threads/:id 删除线程并清点副作用；服务端 401/404/409 语义保留 */
  deleteThread(threadId: string, signal?: AbortSignal): Promise<DeleteThreadResult>;

  // --- 任务（POST /api/agent/tasks 系列） ---

  /** 创建后台任务（立即排队执行）；originThreadId 显式传入以回填会话来源，缺省值与"local-main"同等处理 */
  createTask(prompt: string, title?: string, originThreadId?: string): Promise<AgentTask>;
  /** 任务详情（含时间线 events） */
  getTask(id: string): Promise<TaskDetails>;
  /**
   * 控制任务：target=job（定时）或 task（后台），必须显式传入。
   * 以快照 task.kind 为准，禁止依赖服务端默认分发。
   */
  controlTask(
    id: string,
    action: TaskAction,
    target: TaskControlTarget,
  ): Promise<AgentTask>;

  // --- 监控（创建走聊天 monitor 工具，页面只做控制） ---

  controlMonitor(id: string, action: MonitorAction): Promise<Monitor>;

  // --- 审批 ---

  /** 决定挂起中的写操作；仅 pending 可决定（重复决定服务端 409） */
  decideAction(id: string, decision: ApprovalDecision): Promise<ApprovalNotification>;

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
  addMemory(text: string, source?: string): Promise<MemoryItem>;
  editMemory(id: string, text: string): Promise<MemoryItem>;
  forgetMemory(id: string): Promise<void>;
  /** SOUL/USER 人设文本（空串=未设置） */
  getProfile(): Promise<Profile>;
  saveProfile(profile: Profile): Promise<Profile>;

  // --- 运行状态（GET /api/agent/status + GET /api/events） ---

  /** 单点查询指定 (threadId, runId) 的最新状态；运行不存在或被清理返回 404。 */
  getAgentStatus(threadId: string, runId: string, signal?: AbortSignal): Promise<AgentStatusResponse>;
  /**
   * 订阅工作区实时状态推送；首个 ready 帧必为恰一次，后续为 agent_status_updated。
   * 连接自然结束（EOF）视为正常，调用方按服务端约定重连；
   * signal 触发不会调用聊天 Stop，订阅生命周期与聊天独立。
   */
  subscribeRuntime(onEvent: (event: RuntimeEvent) => void, signal?: AbortSignal): Promise<void>;
}

export type TaskAction = 'pause' | 'resume' | 'cancel' | 'retry';
export type TaskControlTarget = 'job' | 'task';
export type MonitorAction = 'pause' | 'resume' | 'stop';
export type ApprovalDecision = 'approve' | 'deny';
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
