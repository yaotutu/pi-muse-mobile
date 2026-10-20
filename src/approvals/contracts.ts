import { ApiError } from '../api/errors';
import { assertSpaceAlias } from '../api/space-contracts';
import type { ApprovalExecution, ApprovalPage, ApprovalResolution, ApprovalState, ApprovalSummary, ApprovalView } from './types';

const statuses = ['pending', 'approved', 'denied', 'expired', 'cancelled'];
const executionStatuses = ['running', 'succeeded', 'failed', 'cancelled', 'unknown'];
const invalid = (): never => { throw new ApiError(502, '服务器审批响应格式不正确，请重新同步后核对'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const text = (value: unknown, nonempty = false): string => typeof value === 'string' && (!nonempty || value.length > 0) ? value : invalid();
const nullableText = (value: unknown): string | null => value === null ? null : text(value, true);
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
  if (new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) return invalid();
  return value;
}
const nullableDate = (value: unknown): string | null => value === null ? null : date(value);

/** 409 的当前审批仍是权威视图；调用方应合并它，而不是重发原决定。 */
export class ApprovalConflictError extends ApiError {
  constructor(readonly approval: ApprovalView) {
    super(409, '审批状态已变化，已同步服务器结果，请重新核对');
  }
}

function execution(value: unknown): ApprovalExecution | null {
  if (value === null) return null;
  const entry = object(value);
  if (!executionStatuses.includes(entry.status as string)) invalid();
  return {
    status: entry.status as ApprovalExecution['status'],
    startedAt: date(entry.startedAt), finishedAt: nullableDate(entry.finishedAt),
    result: entry.result === null ? null : text(entry.result),
  };
}

function state(value: unknown): ApprovalState {
  const entry = object(value);
  assertSpaceAlias(entry);
  assertSpaceAlias(entry, 'workspaceSpaceId', 'workspaceThreadId');
  if (!Number.isSafeInteger(entry.revision) || (entry.revision as number) < 1 || !statuses.includes(entry.status as string)) invalid();
  const result: ApprovalState = {
    id: text(entry.id, true), revision: entry.revision as number,
    spaceId: nullableText(entry.spaceId), runId: nullableText(entry.runId),
    toolCallId: nullableText(entry.toolCallId), subagentId: nullableText(entry.subagentId),
    workspaceSpaceId: nullableText(entry.workspaceSpaceId), activityId: nullableText(entry.activityId),
    status: entry.status as ApprovalState['status'], execution: execution(entry.execution),
    createdAt: date(entry.createdAt), expiresAt: date(entry.expiresAt),
    resolvedAt: nullableDate(entry.resolvedAt), decidedAt: nullableDate(entry.decidedAt),
  };
  if (result.status === 'pending' ? result.resolvedAt !== null || result.decidedAt !== null || result.execution !== null : result.resolvedAt === null) invalid();
  if (result.status === 'expired' || result.status === 'cancelled') { if (result.decidedAt !== null) invalid(); }
  return result;
}

export function parseApprovalSummary(value: unknown): ApprovalSummary {
  const entry = object(value);
  if (entry.kind !== 'file_write' && entry.kind !== 'file_edit') invalid();
  return { ...state(entry), title: text(entry.title, true), kind: entry.kind as ApprovalSummary['kind'] };
}

export function parseApprovalView(value: unknown): ApprovalView {
  const entry = object(value);
  const preview = object(entry.preview);
  assertSpaceAlias(preview, 'ownerSpaceId', 'ownerThreadId');
  const ownerSpaceId = nullableText(preview.ownerSpaceId);
  if (preview.scope !== 'space' && preview.scope !== 'thread' && preview.scope !== 'shared') invalid();
  if (preview.scope !== 'shared' ? ownerSpaceId === null : ownerSpaceId !== null) invalid();
  if (typeof preview.beforeExists !== 'boolean') invalid();
  return {
    ...parseApprovalSummary(entry),
    preview: {
      scope: preview.scope as 'space' | 'thread' | 'shared', ownerSpaceId,
      path: text(preview.path, true), before: text(preview.before), after: text(preview.after),
      beforeExists: preview.beforeExists as boolean,
    },
  };
}

export function parseApprovalResolution(value: unknown): ApprovalResolution {
  const result = state(value);
  if (result.status === 'pending') invalid();
  return result as ApprovalResolution;
}

export function parsePendingApprovals(value: unknown): ApprovalView[] {
  const entries = object(value).approvals;
  if (!Array.isArray(entries) || entries.length > 32) invalid();
  const approvals = (entries as unknown[]).map(parseApprovalView);
  if (approvals.some((item) => item.status !== 'pending') || new Set(approvals.map((item) => item.id)).size !== approvals.length) invalid();
  return approvals;
}

export function parseApprovalPage(value: unknown): ApprovalPage {
  const page = object(value);
  if (!Array.isArray(page.approvals) || typeof page.hasMore !== 'boolean') invalid();
  const approvals = (page.approvals as unknown[]).map(parseApprovalSummary);
  const nextCursor = nullableText(page.nextCursor);
  if (approvals.some((item) => item.status === 'pending') || page.hasMore !== (nextCursor !== null)) invalid();
  if (new Set(approvals.map((item) => item.id)).size !== approvals.length) invalid();
  return { approvals, hasMore: page.hasMore as boolean, nextCursor };
}
