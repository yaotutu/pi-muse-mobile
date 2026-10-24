/** 页面依赖的客户端契约；网络实现不向上泄露传输细节。 */
import type {
  AgUiEvent,
  ConversationAttachment,
  ConversationMessage,
  ConversationSnapshot,
  DeleteGoalResult,
  DeleteJobResult,
  DeleteMonitorResult,
  DeleteSpaceResult,
  Goal,
  GoalStatus,
  GoalsQuery,
  Identity,
  JobAction,
  JobDetail,
  JobEvent,
  JobEventKind,
  JobItem,
  JobsQuery,
  MessageAttachmentInput,
  Monitor,
  MonitorsQuery,
  ResetSpaceResult,
  SpaceInfo,
  SpaceInstructions,
  SpaceSkills,
  UpdateGoalInput,
  UpdateJobInput,
  WorkspaceSnapshot,
} from './types';
import { ApiError } from './errors';
import { isCanonicalBase64 } from '../attachments/validation';
import type { AgentStatusResponse, RuntimeEvent } from '../runtime/types';
import type { ApprovalClient } from '../approvals/types';
import type { ActivityClient } from '../activities/types';
import type { MemoryClient } from '../memories/types';
import type { DreamClient } from '../dream/types';
import type { FilesClient } from '../files/types';

/** 增量聊天只提交一条新用户消息；历史与工具消息始终由服务端持有。 */
export type RunInput = {
  spaceId: string;
  /** 本轮唯一 ID；成功请求可幂等重放。 */
  runId: string;
  /** 来自 GET /api/conversation；空会话也是明确的 empty 版本。 */
  expectedRevision: string;
  message: {
    id: string;
    content: string;
    /** 可选附件；失败重试与 completed 重放必须保持顺序和原始字节身份。 */
    attachments?: MessageAttachmentInput[];
  };
};

const ATTACHMENT_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'image/svg+xml',
  'application/json', 'application/xml', 'text/xml', 'application/yaml', 'text/yaml',
  'application/javascript', 'text/javascript', 'text/typescript', 'application/sql',
  'text/css', 'application/octet-stream',
]);
const IMAGE_PREVIEW_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const SHA256 = /^[a-f0-9]{64}$/;

const invalidHistory = () => new ApiError(502, '服务器返回的会话历史格式不正确，请确认服务器版本与地址');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function parseAttachment(value: unknown): ConversationAttachment {
  if (!isRecord(value)) throw invalidHistory();
  const allowed = new Set(['id', 'name', 'kind', 'mimeType', 'size', 'sha256', 'image']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw invalidHistory();
  const { id, name, kind, mimeType, size, sha256, image } = value;
  if (typeof id !== 'string' || !id || id.length > 100 || !/^[A-Za-z0-9._-]+$/.test(id)) throw invalidHistory();
  if (typeof name !== 'string' || !name || name.length > 200 ||
    name.includes('/') || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name)) throw invalidHistory();
  if (kind !== 'image' && kind !== 'text') throw invalidHistory();
  if (typeof mimeType !== 'string' || !ATTACHMENT_MIME_TYPES.has(mimeType)) throw invalidHistory();
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) throw invalidHistory();
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw invalidHistory();

  let parsedImage: ConversationAttachment['image'];
  if (image !== undefined) {
    if (kind !== 'image' || !isRecord(image)) throw invalidHistory();
    const imageKeys = Object.keys(image);
    if (imageKeys.length !== 2 || !('mimeType' in image) || !('dataBase64' in image)) throw invalidHistory();
    const imageMime = image.mimeType;
    const dataBase64 = image.dataBase64;
    if (typeof imageMime !== 'string' || !IMAGE_PREVIEW_MIME_TYPES.has(imageMime)) throw invalidHistory();
    if (typeof dataBase64 !== 'string' || !dataBase64 || !isCanonicalBase64(dataBase64)) throw invalidHistory();
    parsedImage = { mimeType: imageMime, dataBase64 };
  }
  return { id, name, kind, mimeType, size, sha256, ...(parsedImage ? { image: parsedImage } : {}) };
}

function parseMessage(value: unknown): ConversationMessage {
  if (!isRecord(value)) throw invalidHistory();
  const { id, role, content, attachments, toolCalls, toolCallId } = value;
  if (typeof id !== 'string' || !id) throw invalidHistory();
  if (role !== 'user' && role !== 'assistant' && role !== 'tool') throw invalidHistory();
  if (content !== undefined && typeof content !== 'string') throw invalidHistory();
  if (toolCallId !== undefined && typeof toolCallId !== 'string') throw invalidHistory();
  if (role !== 'user' && attachments !== undefined) throw invalidHistory();

  let parsedAttachments: ConversationAttachment[] | undefined;
  if (attachments !== undefined) {
    if (!Array.isArray(attachments)) throw invalidHistory();
    parsedAttachments = attachments.map(parseAttachment);
  }

  let parsedToolCalls: ConversationMessage['toolCalls'];
  if (toolCalls !== undefined) {
    if (!Array.isArray(toolCalls)) throw invalidHistory();
    parsedToolCalls = toolCalls.map((call) => {
      if (!isRecord(call) || call.type !== 'function' || typeof call.id !== 'string' ||
        !isRecord(call.function) || typeof call.function.name !== 'string' || typeof call.function.arguments !== 'string') {
        throw invalidHistory();
      }
      return {
        id: call.id,
        type: 'function',
        function: { name: call.function.name, arguments: call.function.arguments },
      };
    });
  }
  return {
    id,
    role,
    ...(content === undefined ? {} : { content }),
    ...(parsedAttachments ? { attachments: parsedAttachments } : {}),
    ...(parsedToolCalls ? { toolCalls: parsedToolCalls } : {}),
    ...(toolCallId === undefined ? {} : { toolCallId }),
  };
}

/** 历史与 MESSAGES_SNAPSHOT 共用同一套附件白名单，防止坏 SHA、data URI 或未知 MIME 进入渲染层。 */
export function parseConversationMessages(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) throw invalidHistory();
  return value.map(parseMessage);
}

export function parseConversationSnapshot(value: unknown): ConversationSnapshot {
  if (!isRecord(value) || typeof value.revision !== 'string' || !value.revision) throw invalidHistory();
  return { revision: value.revision, messages: parseConversationMessages(value.messages) };
}

export function parseMessagesSnapshotEvent(event: AgUiEvent): AgUiEvent {
  if (event.type !== 'MESSAGES_SNAPSHOT') return event;
  return { ...event, messages: parseConversationMessages(event.messages) };
}

/**
 * 客户端接口：页面只依赖此抽象，不感知 mock/HTTP 差异。
 */
export interface ApiClient extends DreamClient, ApprovalClient, ActivityClient, MemoryClient, FilesClient {
  /** 免鉴权 health 的权威 IANA 时区；不猜测服务端与手机处于相同时区。 */
  getServerTimeZone(signal?: AbortSignal): Promise<string>;
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

  // --- 监控（创建走聊天 monitor 工具，页面只做控制） ---

  /** 查询网页监控列表：全量返回不分页，支持 spaceId、sort (createdAt/lastCheckedAt/status)、order (asc/desc) 过滤与排序 */
  listMonitors(query?: MonitorsQuery, signal?: AbortSignal): Promise<Monitor[]>;
  /** 读取指定网页监控详情 */
  getMonitor(id: string, signal?: AbortSignal): Promise<Monitor>;
  /** 控制监控生命周期（pause/resume/stop） */
  controlMonitor(id: string, action: MonitorAction, signal?: AbortSignal): Promise<Monitor>;
  /** 彻底删除指定网页监控项 */
  deleteMonitor(id: string, signal?: AbortSignal): Promise<DeleteMonitorResult>;

  // --- 目标（GET /api/goals 独立端点，快照中已不再包含 goals） ---

  /** 查询目标列表：全量返回不分页，支持 status、category、sort (updatedAt/createdAt)、order (asc/desc) 过滤与排序 */
  listGoals(query?: GoalsQuery, signal?: AbortSignal): Promise<Goal[]>;
  /** 读取指定目标详情 */
  getGoal(id: string, signal?: AbortSignal): Promise<Goal>;
  /** 创建目标：支持标题、描述、分类及初始里程碑列表 */
  createGoal(input: GoalInput, signal?: AbortSignal): Promise<Goal>;
  /** 编辑目标：支持标题、描述、分类或状态（completed 会自动将名下所有里程碑勾选完成） */
  updateGoal(id: string, input: UpdateGoalInput, signal?: AbortSignal): Promise<Goal>;
  /** 兼容快捷设置状态：等价于 updateGoal(id, { status }) */
  setGoalStatus(id: string, status: GoalStatus, signal?: AbortSignal): Promise<Goal>;
  /** 切换指定里程碑完成状态（POST /api/goals/:id/milestones/:mid/toggle） */
  toggleMilestone(goalId: string, milestoneId: string, signal?: AbortSignal): Promise<Goal>;
  /** 彻底删除指定目标（DELETE /api/goals/:id） */
  removeGoal(id: string, signal?: AbortSignal): Promise<DeleteGoalResult>;

  // --- 身份 / 记忆 / 人设 ---

  /** 身份编辑只提交 name/tone；avatar 与 showChatUpdates 由服务端原样保留。 */
  saveIdentity(input: IdentityInput, signal?: AbortSignal): Promise<Identity>;
  /** SOUL/USER 人设文本（空串=未设置） */
  getProfile(signal?: AbortSignal): Promise<Profile>;
  saveProfile(profile: Profile, signal?: AbortSignal): Promise<Profile>;

  // --- 工作区文件（手动管理；模型写入仍走聊天工具审批） ---

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
  DeleteGoalResult,
  DeleteJobResult,
  GoalsQuery,
  JobAction,
  JobDetail,
  JobEvent,
  JobEventKind,
  JobItem,
  JobsQuery,
  MonitorsQuery,
  UpdateGoalInput,
  UpdateJobInput,
};
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
