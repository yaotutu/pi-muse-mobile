import { ApiError } from './errors';
import type { ResetSpaceResult, SpaceInfo } from './types';

const invalid = (): never => { throw new ApiError(502, '服务器空间响应格式不正确，请刷新核对服务器版本'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const text = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : invalid();
const count = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : invalid();

/** 只消费新字段；服务端仍输出旧别名时必须一致，避免归属矛盾被静默忽略。 */
export function assertSpaceAlias(value: Record<string, unknown>, field = 'spaceId', alias = 'threadId') {
  if (Object.hasOwn(value, alias) && value[alias] !== value[field]) invalid();
}

export function parseSpaces(value: unknown): SpaceInfo[] {
  const entries = object(value).spaces;
  if (!Array.isArray(entries)) return invalid();
  const spaces = entries.map((entry): SpaceInfo => {
    const v = object(entry);
    return { id: text(v.id), sessionId: text(v.sessionId), updatedAt: text(v.updatedAt) };
  });
  if (new Set(spaces.map((entry) => entry.id)).size !== spaces.length) return invalid();
  return spaces;
}

export function parseResetSpace(value: unknown, expectedSpaceId: string): ResetSpaceResult {
  const v = object(value); const removed = object(v.removed);
  if (v.ok !== true || v.spaceId !== expectedSpaceId) return invalid();
  return { ok: true, spaceId: expectedSpaceId, sessionId: text(v.sessionId), cancelledApprovals: count(v.cancelledApprovals),
    removed: { jobs: count(removed.jobs), monitors: count(removed.monitors) } };
}
