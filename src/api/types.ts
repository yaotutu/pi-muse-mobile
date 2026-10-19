/**
 * 服务端接口领域类型 —— 逐项对齐 openapi.json（http://127.0.0.1:8790/docs）。
 *
 * 契约约束：
 * - 字段名/枚举值以接口文档为唯一事实来源，客户端不得自行增删枚举；
 * - 任务和审批字段严格保留 OpenAPI 声明的形状；网络快照与客户端合成视图
 *   分开表达，避免把客户端派生通知误认为服务端快照字段。
 */

// ---------------------------------------------------------------------------
// 会话与历史
// ---------------------------------------------------------------------------

/** GET /api/threads 条目（注：服务端暂无标题/重命名，见 docs/notes.md） */
export type ThreadInfo = { id: string; updatedAt: string };

export type ChatRole = 'user' | 'assistant' | 'tool';

/** 权威历史里 assistant 消息携带的工具调用投影 */
export type ToolCallProjection = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

/** GET /api/conversation 条目：role=tool 时 content 为结果、toolCallId 关联调用 */
export type ConversationMessage = {
  id: string;
  role: ChatRole;
  content?: string;
  toolCalls?: ToolCallProjection[];
  toolCallId?: string;
};

/** 历史与版本必须同时保存；发送只提交新消息和 expectedRevision，冲突由服务端返回 409。 */
export type ConversationSnapshot = { revision: string; messages: ConversationMessage[] };

// ---------------------------------------------------------------------------
// AG-UI SSE 事件（POST /api/conversation/run）
// ---------------------------------------------------------------------------

/**
 * 服务端事件契约的客户端子集：type 必有，其余字段按事件类型按需出现
 * （passthrough 风格，对齐 pi-muse web/src/api/contracts.ts 的 SseEvent）。
 */
export type AgUiEvent = {
  type: string;
  /** RUN_STARTED / RUN_FINISHED */
  threadId?: string;
  /** 本轮运行 ID；停止请求以 threadId 与 runId 双重匹配 */
  runId?: string;
  /** TEXT_MESSAGE_START */
  role?: string;
  /** TEXT_MESSAGE_* */
  messageId?: string;
  delta?: string;
  /** TOOL_CALL_* */
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string | null;
  content?: string;
  /** RUN_ERROR */
  code?: string;
  message?: string;
  /** MESSAGES_SNAPSHOT */
  messages?: ConversationMessage[];
};

// ---------------------------------------------------------------------------
// 工作区快照（GET /api/agent）
// ---------------------------------------------------------------------------

export type TaskKind = 'job' | 'task';
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'scheduled'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type AgentTask = {
  id: string;
  title: string;
  prompt: string;
  kind: TaskKind;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** 定时任务下次触发时间；一次性任务完成后无此字段 */
  nextRunAt?: string;
  result?: string;
  error: string | null;
};

/** GET /api/agent/tasks/:id 返回的任务与时间线组合。 */
export type TaskDetails = { task: AgentTask; events: TaskEvent[] };

/** 任务详情（GET /api/agent/tasks/:id）的时间线条目 */
export type TaskEventKind =
  | 'plan'
  | 'step'
  | 'observation'
  | 'approval'
  | 'result'
  | 'error'
  | 'status';
export type TaskEvent = {
  id: string;
  taskId: string;
  date: string;
  kind: TaskEventKind;
  title: string;
  detail: string;
};

export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';
export type Milestone = { id: string; title: string; done: boolean; doneAt?: string };
export type Goal = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: GoalStatus;
  milestones: Milestone[];
  createdAt: string;
  updatedAt: string;
};

export type MonitorCondition = 'change' | 'contains';
export type MonitorStatus = 'active' | 'paused' | 'stopped';
export type Monitor = {
  id: string;
  title: string;
  url: string;
  condition: MonitorCondition;
  value?: string;
  intervalMinutes: number;
  status: MonitorStatus;
  createdAt: string;
  lastCheckedAt?: string;
  checks: number;
  error?: string;
  /** 服务端回填来源会话 ID；未跨会话导出时缺省 */
  originThreadId?: string;
};

/** 会话自定义指令（SOUL/GUIDELINES 等场景），空串视为"已设置但不写内容" */
export type ThreadInstructions = { instructions: string };

/** 单条线程级技能；name 为后端注册键，defaultEnabled 来自服务端列表，enabled 为当前覆盖值 */
export type ThreadSkill = {
  name: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
};

/** GET /api/threads/:id/skills 返回结果：技能列表 + 服务端可选诊断（如本地 YAML 读取失败等） */
export type ThreadSkills = {
  skills: ThreadSkill[];
  diagnostics?: { path: string; message: string }[];
};

/** 删除会话仅清点级联移除的定时任务与监控。 */
export type DeleteThreadResult = {
  ok: true;
  removed: { jobs: number; monitors: number };
};

export type MemoryItem = {
  id: string;
  text: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
export type ApprovalNotification = {
  id: string;
  kind: 'file_write' | 'file_edit';
  title: string;
  /** 键名服务端文档未定义（docs/notes.md 待澄清），渲染时通用遍历 */
  payload: Record<string, string>;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  expiresAt?: string;
  threadId?: string;
  runId?: string;
};

export type Identity = {
  name: string;
  tone: string;
  avatar?: string;
  showChatUpdates?: boolean;
};

export type WorkspaceSnapshot = {
  tasks: AgentTask[];
  goals: Goal[];
  monitors: Monitor[];
  memories: MemoryItem[];
  /** 客户端合成视图：由独立审批数据与工作区快照合并，服务端 /api/agent 不返回。 */
  notifications: ApprovalNotification[];
  identity: Identity;
  worker: { running: boolean };
};

/** GET /api/agent 的原始网络响应；通知由客户端从独立审批接口合成。 */
export type WorkspaceData = Omit<WorkspaceSnapshot, 'notifications'>;
