/**
 * 运行状态流（GET /api/events）与单点运行查询（GET /api/agent/status）的协议解析与结构校验。
 *
 * 契约边界：
 * - 字段类型、枚举值或归属错位一律抛 ApiError(502)；坏协议不静默漏状态，也不替上层臆造默认值；
 * - ready 首帧同时校验运行集合与待审批完整集合（复用 parsePendingApprovals）。
 */
import { ApiError } from '../api/errors';
import { assertSpaceAlias } from '../api/space-contracts';
import { parsePendingApprovals } from '../approvals/contracts';
import type {
  AgentStatus,
  AgentStatusResponse,
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

function ensureToolState(value: unknown): AgentStatus['tools'][number] {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态 tools 项不是对象');
  const entry = value as Record<string, unknown>;
  return {
    toolCallId: ensureString(entry.toolCallId, 'tools[].toolCallId'),
    name: entry.name === null ? null : ensureString(entry.name, 'tools[].name'),
    label: ensureText(entry.label, 'tools[].label'),
    status: ensureEnum<AgentStatus['tools'][number]['status']>(entry.status, TOOL_STATUSES, 'tools[].status'),
    subagentId: entry.subagentId === null ? null : ensureString(entry.subagentId, 'tools[].subagentId'),
  };
}

function ensureSubagentState(value: unknown): AgentStatus['subagents'][number] {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态 subagents 项不是对象');
  const entry = value as Record<string, unknown>;
  return {
    id: ensureString(entry.id, 'subagents[].id'),
    role: ensureString(entry.role, 'subagents[].role'),
    status: ensureEnum<AgentStatus['subagents'][number]['status']>(entry.status, SUBAGENT_STATUSES, 'subagents[].status'),
    phase: ensurePhase<SubagentPhase>(entry.phase, SUBAGENT_PHASES, 'subagents[].phase'),
    label: ensureText(entry.label, 'subagents[].label'),
    startedAt: ensureOptionalString(entry.startedAt, 'subagents[].startedAt'),
    updatedAt: ensureString(entry.updatedAt, 'subagents[].updatedAt'),
    endedAt: ensureOptionalString(entry.endedAt, 'subagents[].endedAt'),
  };
}

export function ensureAgentStatus(value: unknown): AgentStatus {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态 status 不是对象');
  const entry = value as Record<string, unknown>;
  assertSpaceAlias(entry);
  if (!Array.isArray(entry.tools) || entry.tools.length > 64) throw new ApiError(502, '运行状态 tools 不是长度 ≤64 的数组');
  if (!Array.isArray(entry.subagents) || entry.subagents.length > 64) throw new ApiError(502, '运行状态 subagents 不是长度 ≤64 的数组');
  return {
    activityId: entry.activityId === null ? null : ensureString(entry.activityId, 'status.activityId'),
    spaceId: ensureString(entry.spaceId, 'status.spaceId'),
    runId: ensureString(entry.runId, 'status.runId'),
    revision: ensureRevision(entry.revision, 'status.revision'),
    source: ensureEnum<AgentStatus['source']>(entry.source, RUN_SOURCES, 'status.source'),
    jobId: entry.jobId === null ? null : ensureString(entry.jobId, 'status.jobId'),
    title: ensureText(entry.title, 'status.title'),
    status: ensureEnum<AgentStatus['status']>(entry.status, RUN_STATUSES, 'status.status'),
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

export function parseAgentStatusResponse(value: unknown): AgentStatusResponse {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态响应不是对象');
  const entry = value as Record<string, unknown>;
  const instanceId = ensureString(entry.instanceId, 'instanceId');
  return { instanceId, status: ensureAgentStatus(entry.status) };
}

export function parseRuntimeReady(value: unknown): Extract<RuntimeEvent, { event: 'ready' }>['data'] {
  if (!value || typeof value !== 'object') throw new ApiError(502, 'ready 事件 data 不是对象');
  const entry = value as Record<string, unknown>;
  const instanceId = ensureString(entry.instanceId, 'ready.data.instanceId');
  const serverTime = ensureString(entry.serverTime, 'ready.data.serverTime');
  if (!Array.isArray(entry.agentStatuses)) throw new ApiError(502, 'ready.data.agentStatuses 不是数组');
  return {
    instanceId,
    serverTime,
    agentStatuses: entry.agentStatuses.map(ensureAgentStatus),
    pendingApprovals: parsePendingApprovals({ approvals: entry.pendingApprovals }),
  };
}

export function parseAgentStatusUpdate(value: unknown, expectedInstanceId: string): AgentStatus & { instanceId: string } {
  if (!value || typeof value !== 'object') throw new ApiError(502, 'agent_status_updated data 不是对象');
  const entry = value as Record<string, unknown>;
  const instanceId = ensureString(entry.instanceId, 'agent_status_updated.data.instanceId');
  if (instanceId !== expectedInstanceId) {
    throw new ApiError(502, 'agent_status_updated 与 ready 的 instanceId 不一致，按服务端约定视为非法帧');
  }
  const status = ensureAgentStatus(entry);
  return { ...status, instanceId };
}
