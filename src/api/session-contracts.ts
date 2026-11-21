import type { DeleteSessionResult, SessionSchedules } from './types';
import { ApiError } from './errors';
import { isSessionId, orderSessions, type SessionRecord } from '../sessions/types';

const invalid = (): never => { throw new ApiError(502, '服务器会话响应格式不正确，请刷新核对'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));

export function parseSessionRecord(value: unknown, expectedId?: string): SessionRecord {
  const item = object(value);
  if (Object.keys(item).some((key) => !['id', 'title', 'createdAt', 'updatedAt', 'isMain'].includes(key)) ||
    typeof item.id !== 'string' || !isSessionId(item.id) || (expectedId !== undefined && item.id !== expectedId) ||
    typeof item.title !== 'string' || !item.title.trim() || !timestamp(item.createdAt) || !timestamp(item.updatedAt) ||
    typeof item.isMain !== 'boolean' || item.isMain !== (item.id === 'main') || (item.isMain && item.title !== '默认会话')) return invalid();
  return { id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, isMain: item.isMain };
}
export function parseSessions(value: unknown): SessionRecord[] {
  const item = object(value);
  if (Object.keys(item).join(',') !== 'sessions' || !Array.isArray(item.sessions)) return invalid();
  const sessions = item.sessions.map((value) => parseSessionRecord(value));
  if (sessions.filter((session) => session.isMain).length !== 1 || new Set(sessions.map((session) => session.id)).size !== sessions.length) return invalid();
  return orderSessions(sessions);
}
export function parseSession(value: unknown, expectedId?: string): SessionRecord {
  return parseSessionRecord(object(value).session, expectedId);
}
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();

export function parseResetSession(value: unknown, expectedId: string) {
  const item = object(value);
  return { session: parseSessionRecord(item.session, expectedId), cancelledApprovals: count(item.cancelledApprovals) };
}

export function parseSessionSchedules(value: unknown): SessionSchedules {
  const data = object(value);
  const entries = (items: unknown) => {
    if (!Array.isArray(items)) return invalid();
    return items.map((value) => {
      const item = object(value);
      if (typeof item.id !== 'string' || !item.id || typeof item.title !== 'string') return invalid();
      return { id: item.id, title: item.title };
    });
  };
  if (typeof data.scheduleRevision !== 'string' || !data.scheduleRevision) return invalid();
  return { scheduleRevision: data.scheduleRevision, jobs: entries(data.jobs), monitors: entries(data.monitors) };
}

export function parseDeleteSession(value: unknown): DeleteSessionResult {
  const data = object(value);
  if (data.ok !== true) return invalid();
  const removed = object(data.removed);
  const moved = object(data.moved);
  return { ok: true, removed: { sessions: count(removed.sessions), jobs: count(removed.jobs), monitors: count(removed.monitors) },
    moved: { jobs: count(moved.jobs), monitors: count(moved.monitors) } };
}
