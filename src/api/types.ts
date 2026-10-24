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

/** 空间持有配置与文件；sessionId 是当前聊天绑定，重置时改变，不能作为空间 ID 发请求。 */
export type SpaceInfo = { id: string; sessionId: string; updatedAt: string };
/** 未持久化的本地空间草稿不伪造服务端 sessionId。 */
export type SpaceEntry = Omit<SpaceInfo, 'sessionId'> & { sessionId: string | null };

export type ResetSpaceResult = {
  ok: true;
  spaceId: string;
  sessionId: string;
  cancelledApprovals: number;
  removed: { jobs: number; monitors: number };
};

export type ChatRole = 'user' | 'assistant' | 'tool';

/** POST /api/conversation/run 的附件上传 DTO；本地派生字段绝不能发给 strict schema。 */
export type MessageAttachmentInput = {
  id: string;
  name: string;
  mimeType: string;
  dataBase64: string;
};

/** GET /api/conversation 与 MESSAGES_SNAPSHOT 的附件元数据；文本正文不回灌。 */
export type ConversationAttachment = {
  id: string;
  name: string;
  kind: 'image' | 'text';
  mimeType: string;
  size: number;
  sha256: string;
  /** 仅服务端从真实 user image block 投影的预览；不是任意 URI。 */
  image?: { mimeType: string; dataBase64: string };
};

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
  /** 仅 role=user；按提交顺序返回，图片可有服务端投影的 Base64 预览。 */
  attachments?: ConversationAttachment[];
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
  spaceId?: string;
  /** 本轮运行 ID；停止请求以 spaceId 与 runId 双重匹配 */
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
// 定时任务（Jobs）：查询、详情、控制、更新与删除（/api/jobs）
// ---------------------------------------------------------------------------

export type JobKind = 'job';
export type JobStatus =
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'queued';

export type JobItem = {
  id: string;
  title: string;
  prompt: string;
  kind: JobKind;
  daily: boolean;
  at: string;
  enabled: boolean;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  /** 下次计划触发时间（ISO 8601） */
  nextRunAt?: string;
  /** 最近一次触发时间（ISO 8601） */
  lastRunAt?: string;
  /** 最近一次执行结果文本摘要 */
  lastResult?: string;
  /** 错误信息（上次执行失败时非 null） */
  error: string | null;
  /** 所属空间 ID */
  originSpaceId?: string;
};

/** 定时任务详情时间线条目（GET /api/jobs/:id） */
export type JobEventKind =
  | 'plan'
  | 'step'
  | 'observation'
  | 'approval'
  | 'result'
  | 'error'
  | 'status';

export type JobEvent = {
  id: string;
  taskId: string;
  date: string;
  kind: JobEventKind;
  title: string;
  detail: string;
};

/** GET /api/jobs/:id 响应契约 */
export type JobDetail = { job: JobItem; events: JobEvent[] };

/** GET /api/jobs 查询参数 */
export type JobsQuery = {
  spaceId?: string;
  sort?: 'nextRunAt' | 'updatedAt' | 'createdAt';
  order?: 'asc' | 'desc';
};

/** 定时任务生命周期控制动作（POST /api/jobs/:id/control） */
export type JobAction = 'pause' | 'resume' | 'cancel' | 'retry';

/** 定时任务直接编辑请求载荷（PATCH /api/jobs/:id） */
export type UpdateJobInput = {
  prompt?: string;
  daily?: boolean;
  at?: string;
  originSpaceId?: string;
};

/** DELETE /api/jobs/:id 响应契约 */
export type DeleteJobResult = {
  ok: true;
  id: string;
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

export type GoalsQuery = {
  status?: GoalStatus;
  category?: string;
  sort?: 'updatedAt' | 'createdAt';
  order?: 'asc' | 'desc';
};

export type UpdateGoalInput = {
  title?: string;
  description?: string;
  category?: string;
  status?: GoalStatus;
};

/** DELETE /api/goals/:id 响应契约 */
export type DeleteGoalResult = {
  ok: true;
  id: string;
};

/** GET /api/monitors 查询参数 */
export type MonitorsQuery = {
  spaceId?: string;
  sort?: 'createdAt' | 'lastCheckedAt' | 'status';
  order?: 'asc' | 'desc';
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
  /** 服务端回填来源空间 ID；未提供来源时缺省 */
  originSpaceId?: string;
  lastNotifiedAt?: string;
  lastMatched?: boolean;
};

/** DELETE /api/monitors/:id 响应契约 */
export type DeleteMonitorResult = {
  ok: true;
  id: string;
};

/** 空间专属规则；重置聊天会话时保留，空串表示清空规则内容。 */
export type SpaceInstructions = { instructions: string };

/** 单条空间级技能；name 为后端注册键，defaultEnabled 来自服务端列表，enabled 为当前生效值。 */
export type SpaceSkill = {
  name: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
};

/** GET /api/spaces/:id/skills 返回结果：技能列表 + 服务端可选诊断（如本地 YAML 读取失败等） */
export type SpaceSkills = {
  skills: SpaceSkill[];
  diagnostics?: { path: string; message: string }[];
};

/** 删除空间的响应仅清点级联移除的定时任务与监控，不代表只删除这两类数据。 */
export type DeleteSpaceResult = {
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

export type Identity = {
  name: string;
  tone: string;
  avatar?: string;
  showChatUpdates?: boolean;
};

export type WorkspaceSnapshot = {
  identity: Identity;
};
