/**
 * 运行状态流（GET /api/events）与单点运行查询（GET /api/runs/status）的协议解析与结构校验。
 *
 * 契约边界：
 * - 字段类型、枚举值或归属错位一律抛 ApiError(502)；坏协议不静默漏状态，也不替上层臆造默认值；
 * - ready 首帧同时校验运行集合与待审批完整集合（复用 parsePendingApprovals）。
 */
import { ApiError } from '../api/errors';
import { parsePendingApprovals } from '../approvals/contracts';
import { parseActivityOverview } from '../activities/contracts';
import { isActiveActivity } from '../activities/types';
import type {
  SessionPresence,
  SessionStatus,
  SessionStatusResponse,
  ConversationInvalidation,
  RunPhase,
  RuntimeEvent,
  SubagentPhase,
} from './types';

const RUN_STATUSES = new Set(['running', 'succeeded', 'failed', 'cancelled']);
const RUN_PHASES = new Set([
  'preparing',
  'waiting_model',
  'responding',
  'executing_tool',
  'waiting_subagents',
  'waiting_approval',
  'finalizing',
]);
const SUBAGENT_PHASES = new Set([
  'preparing',
  'waiting_model',
  'responding',
  'executing_tool',
  'waiting_approval',
  'finalizing',
]);
const TOOL_STATUSES = new Set(['running', 'waiting_approval']);
const SUBAGENT_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const RUN_SOURCES = new Set(['chat', 'job']);

function ensureString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ApiError(502, `运行状态字段 ${field} 不是字符串`);
  return value;
}

function ensureText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ApiError(502, `运行状态字段 ${field} 不是文本`);
  return value;
}

function ensureOptionalString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) throw new ApiError(502, `运行状态字段 ${field} 不是字符串或 null`);
  return value;
}

function ensureRevision(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new ApiError(502, `运行状态字段 ${field} 不是正安全整数`);
  return value as number;
}

function ensureEnum<T extends string>(value: unknown, allowed: Set<string>, field: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) throw new ApiError(502, `运行状态字段 ${field} 不是允许的枚举值`);
  return value as T;
}

function ensurePhase<T extends RunPhase | SubagentPhase>(value: unknown, allowed: Set<string>, field: string): T {
  if (value === null) return null as T;
  if (typeof value !== 'string' || !allowed.has(value)) throw new ApiError(502, `运行状态字段 ${field} 不是允许的阶段值或 null`);
  return value as T;
}

function ensureStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new ApiError(502, `运行状态字段 ${field} 不是字符串数组`);
  for (const entry of value) if (typeof entry !== 'string' || entry.length === 0) throw new ApiError(502, `运行状态字段 ${field} 包含非字符串元素`);
  return value as string[];
}

function ensureToolState(value: unknown): SessionStatus['tools'][number] {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态 tools 项不是对象');
  const entry = value as Record<string, unknown>;
  return {
    toolCallId: ensureString(entry.toolCallId, 'tools[].toolCallId'),
    name: entry.name === null ? null : ensureString(entry.name, 'tools[].name'),
    label: ensureText(entry.label, 'tools[].label'),
    status: ensureEnum<SessionStatus['tools'][number]['status']>(entry.status, TOOL_STATUSES, 'tools[].status'),
    subagentId: entry.subagentId === null ? null : ensureString(entry.subagentId, 'tools[].subagentId'),
  };
}

function ensureSubagentState(value: unknown): SessionStatus['subagents'][number] {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态 subagents 项不是对象');
  const entry = value as Record<string, unknown>;
  return {
    id: ensureString(entry.id, 'subagents[].id'),
    role: ensureString(entry.role, 'subagents[].role'),
    status: ensureEnum<SessionStatus['subagents'][number]['status']>(entry.status, SUBAGENT_STATUSES, 'subagents[].status'),
    phase: ensurePhase<SubagentPhase>(entry.phase, SUBAGENT_PHASES, 'subagents[].phase'),
    label: ensureText(entry.label, 'subagents[].label'),
    startedAt: ensureOptionalString(entry.startedAt, 'subagents[].startedAt'),
    updatedAt: ensureString(entry.updatedAt, 'subagents[].updatedAt'),
    endedAt: ensureOptionalString(entry.endedAt, 'subagents[].endedAt'),
  };
}

export function ensureSessionStatus(value: unknown): SessionStatus {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态 status 不是对象');
  const entry = value as Record<string, unknown>;
  if (!Array.isArray(entry.tools) || entry.tools.length > 64) throw new ApiError(502, '运行状态 tools 不是长度 ≤64 的数组');
  if (!Array.isArray(entry.subagents) || entry.subagents.length > 64) throw new ApiError(502, '运行状态 subagents 不是长度 ≤64 的数组');
  return {
    activityId: entry.activityId === null ? null : ensureString(entry.activityId, 'status.activityId'),
    sessionId: ensureString(entry.sessionId, 'status.sessionId'),
    runId: ensureString(entry.runId, 'status.runId'),
    revision: ensureRevision(entry.revision, 'status.revision'),
    source: ensureEnum<SessionStatus['source']>(entry.source, RUN_SOURCES, 'status.source'),
    jobId: entry.jobId === null ? null : ensureString(entry.jobId, 'status.jobId'),
    title: ensureText(entry.title, 'status.title'),
    status: ensureEnum<SessionStatus['status']>(entry.status, RUN_STATUSES, 'status.status'),
    phase: ensurePhase<RunPhase>(entry.phase, RUN_PHASES, 'status.phase'),
    label: ensureText(entry.label, 'status.label'),
    tools: entry.tools.map(ensureToolState),
    subagents: entry.subagents.map(ensureSubagentState),
    pendingApprovalIds: ensureStringArray(entry.pendingApprovalIds, 'status.pendingApprovalIds'),
    startedAt: ensureString(entry.startedAt, 'status.startedAt'),
    updatedAt: ensureString(entry.updatedAt, 'status.updatedAt'),
    endedAt: ensureOptionalString(entry.endedAt, 'status.endedAt'),
  };
}

export function parseSessionStatusResponse(value: unknown): SessionStatusResponse {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态响应不是对象');
  const entry = value as Record<string, unknown>;
  const instanceId = ensureString(entry.instanceId, 'instanceId');
  return { instanceId, status: ensureSessionStatus(entry.status) };
}

export function parseRuntimeReady(value: unknown): Extract<RuntimeEvent, { event: 'ready' }>['data'] {
  if (!value || typeof value !== 'object') throw new ApiError(502, 'ready 事件 data 不是对象');
  const entry = value as Record<string, unknown>;
  const instanceId = ensureString(entry.instanceId, 'ready.data.instanceId');
  const serverTime = ensureString(entry.serverTime, 'ready.data.serverTime');
  if (!Array.isArray(entry.sessionStatuses)) throw new ApiError(502, 'ready.data.sessionStatuses 不是数组');
  if (!Array.isArray(entry.sessionPresences)) throw new ApiError(502, 'ready.data.sessionPresences 不是数组');
  const sessionPresences = entry.sessionPresences.map(parseSessionPresence);
  if (new Set(sessionPresences.map((item) => item.sessionId)).size !== sessionPresences.length) throw new ApiError(502, '头像状态集合存在重复会话');
  if (!Array.isArray(entry.activities)) throw new ApiError(502, 'ready.data.activities 不是数组');
  const activities = entry.activities.map(parseActivityOverview);
  if (new Set(activities.map((item) => item.id)).size !== activities.length || activities.some((item) => !isActiveActivity(item))) {
    throw new ApiError(502, 'ready 活动集合含重复项或终态，无法作为完整当前集合');
  }
  return {
    instanceId,
    serverTime,
    sessionStatuses: entry.sessionStatuses.map(ensureSessionStatus),
    sessionPresences,
    pendingApprovals: parsePendingApprovals({ approvals: entry.pendingApprovals }),
    activities,
  };
}

export function parseSessionPresence(value: unknown): SessionPresence {
  if (!value || typeof value !== 'object') throw new ApiError(502, '头像状态不是对象');
  const entry = value as Record<string, unknown>;
  if (entry.lastActiveAt !== null && (typeof entry.lastActiveAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(entry.lastActiveAt) || !Number.isFinite(Date.parse(entry.lastActiveAt)))) throw new ApiError(502, '最近活动时间不合法');
  return {
    sessionId: ensureString(entry.sessionId, 'presence.sessionId'),
    state: ensureEnum<SessionPresence['state']>(entry.state, new Set(['idle', 'working', 'waiting', 'error']), 'presence.state'),
    label: ensureText(entry.label, 'presence.label'),
    lastActiveAt: entry.lastActiveAt as string | null,
  };
}

export function parseSessionStatusUpdate(value: unknown, expectedInstanceId: string): SessionStatus & { instanceId: string } {
  if (!value || typeof value !== 'object') throw new ApiError(502, 'session_status_updated data 不是对象');
  const entry = value as Record<string, unknown>;
  const instanceId = ensureString(entry.instanceId, 'session_status_updated.data.instanceId');
  if (instanceId !== expectedInstanceId) {
    throw new ApiError(502, 'session_status_updated 与 ready 的 instanceId 不一致，按服务端约定视为非法帧');
  }
  const status = ensureSessionStatus(entry);
  return { ...status, instanceId };
}

export function parseConversationUpdated(
  value: unknown,
  expectedInstanceId: string,
): ConversationInvalidation & { instanceId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(502, 'conversation_updated data 不是对象');
  const entry = value as Record<string, unknown>;
  // 契约是 strictObject；未知字段说明服务端与客户端协议版本不一致，不能悄悄当作状态或审批载荷。
  if (Object.keys(entry).sort().join(',') !== 'instanceId,piSessionId,sessionId') {
    throw new ApiError(502, 'conversation_updated 字段不符合契约');
  }
  const instanceId = ensureString(entry.instanceId, 'conversation_updated.data.instanceId');
  if (instanceId !== expectedInstanceId) {
    throw new ApiError(502, 'conversation_updated 与 ready 的 instanceId 不一致，按服务端约定视为非法帧');
  }
  return {
    instanceId,
    sessionId: ensureString(entry.sessionId, 'conversation_updated.data.sessionId'),
    piSessionId: ensureString(entry.piSessionId, 'conversation_updated.data.piSessionId'),
  };
}
