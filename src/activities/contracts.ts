import { ApiError } from '../api/errors';
import { assertSpaceAlias } from '../api/space-contracts';
import { activityStatuses, stepKinds, stepStatuses, type ActivityDetail, type ActivityOverview, type ActivityPage, type ActivityStep } from './types';

const invalid = (): never => { throw new ApiError(502, '服务器活动响应格式不正确，请刷新后核对'); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const text = (v: unknown, nonempty = false): string => typeof v === 'string' && (!nonempty || v.length > 0) ? v : invalid();
const nullableText = (v: unknown): string | null => v === null ? null : text(v);
function date(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v) || !Number.isFinite(Date.parse(v))) return invalid();
  // Date.parse 会把 2 月 30 日归一化；不能把非法协议时间悄悄变成另一天。
  if (new Date(v).toISOString().slice(0, 19) !== v.slice(0, 19)) return invalid();
  return v;
}
const nullableDate = (v: unknown): string | null => v === null ? null : date(v);

export function parseActivityOverview(value: unknown): ActivityOverview {
  const v = object(value);
  assertSpaceAlias(v);
  if (!activityStatuses.includes(v.status as ActivityOverview['status']) || !Array.isArray(v.runIds)) return invalid();
  const runIds = (v.runIds as unknown[]).map((id) => text(id, true));
  const currentRunId = v.currentRunId === null ? null : text(v.currentRunId, true);
  if (new Set(runIds).size !== runIds.length || currentRunId !== null && !runIds.includes(currentRunId)) return invalid();
  const result = nullableText(v.result);
  if (v.status !== 'completed' && result !== null) return invalid();
  const spaceId = text(v.spaceId, true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(spaceId)) return invalid();
  // 只挑选公开安全投影，额外字段绝不透传给 UI 或缓存。
  return { id: text(v.id, true), spaceId, title: text(v.title), goal: text(v.goal), deliverable: text(v.deliverable),
    status: v.status as ActivityOverview['status'], progress: text(v.progress), result, runIds, currentRunId,
    createdAt: date(v.createdAt), updatedAt: date(v.updatedAt), finishedAt: nullableDate(v.finishedAt) };
}
export const activityStepKey = (step: Pick<ActivityStep, 'runId' | 'id'>) => JSON.stringify([step.runId, step.id]);
export function parseActivityDetail(value: unknown, expectedId?: string): ActivityDetail {
  const v = object(value); const activity = parseActivityOverview(v.activity);
  if (expectedId !== undefined && activity.id !== expectedId || !Array.isArray(v.steps)) return invalid();
  const steps = (v.steps as unknown[]).map((entry): ActivityStep => {
    const step = object(entry);
    if (!stepKinds.includes(step.kind as ActivityStep['kind']) || !stepStatuses.includes(step.status as ActivityStep['status'])) return invalid();
    const runId = text(step.runId, true);
    if (!activity.runIds.includes(runId)) return invalid();
    return { id: text(step.id, true), runId, parentId: nullableText(step.parentId), kind: step.kind as ActivityStep['kind'],
      title: text(step.title), status: step.status as ActivityStep['status'], startedAt: date(step.startedAt), finishedAt: nullableDate(step.finishedAt), result: nullableText(step.result) };
  });
  if (new Set(steps.map(activityStepKey)).size !== steps.length) return invalid();
  return { activity, steps }; // 服务端给出真实执行顺序，不按时间、类型或父子关系重排。
}
export function parseActivityPage(value: unknown): ActivityPage {
  const v = object(value);
  if (!Array.isArray(v.activities) || typeof v.hasMore !== 'boolean') return invalid();
  const activities = (v.activities as unknown[]).map(parseActivityOverview);
  const nextCursor = v.nextCursor === null ? null : text(v.nextCursor, true);
  if (v.hasMore !== (nextCursor !== null) || v.hasMore && activities.length === 0 || new Set(activities.map((item) => item.id)).size !== activities.length) return invalid();
  return { activities, hasMore: v.hasMore, nextCursor };
}
