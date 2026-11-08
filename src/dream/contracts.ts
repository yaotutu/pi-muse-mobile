import { isSessionId } from '../sessions/types';
import { ApiError } from '../api/errors';
import {
  type DreamOverview,
  type DreamPending,
  type DreamPendingReason,
  type DreamRun,
  type DreamRunStatus,
  type DreamTarget,
} from './types';

const invalid = (): never => {
  throw new ApiError(502, '服务器 Dream 响应格式不正确，请刷新核对服务器版本');
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();

const text = (value: unknown, nonempty = false): string =>
  typeof value === 'string' && (!nonempty || value.length > 0) ? value : invalid();

const boolean = (value: unknown): boolean => typeof value === 'boolean' ? value : invalid();

function date(value: unknown): string {
  const result = text(value, true);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) return invalid();
  const day = result.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return invalid();
  return result;
}

const target = (value: unknown): DreamTarget =>
  value === 'user' || value === 'soul' || value === 'instructions' || value === 'memory' ? value : invalid();

const pendingReason = (value: unknown): DreamPendingReason =>
  value === 'ambiguous' || value === 'global_from_session' || value === 'no_purpose' ? value : invalid();

const runStatus = (value: unknown): DreamRunStatus =>
  value === 'running' || value === 'completed' || value === 'failed' || value === 'partial' ? value : invalid();

function pending(value: unknown): DreamPending {
  const item = object(value);
  return {
    id: text(item.id, true),
    text: text(item.text),
    suggestedTarget: target(item.suggestedTarget),
    reason: pendingReason(item.reason),
    createdAt: date(item.createdAt),
    ...(item.sourceSessionId === undefined ? {} : { sourceSessionId: typeof item.sourceSessionId === 'string' && isSessionId(item.sourceSessionId) ? item.sourceSessionId : invalid() }),
  };
}

function run(value: unknown): DreamRun {
  const item = object(value);
  if (!Array.isArray(item.changed)) return invalid();
  const processed = item.processed;
  if (typeof processed !== 'number' || !Number.isSafeInteger(processed) || processed < 0) return invalid();
  return {
    at: date(item.at),
    status: runStatus(item.status),
    changed: item.changed.map(target),
    processed,
    ...(item.error === undefined ? {} : { error: text(item.error) }),
  };
}

/** 全局唯一整理状态；不接受旧的按会话配置列表。 */
export function parseDreamOverview(value: unknown): DreamOverview {
  const item = object(value);
  if (Object.keys(item).some((key) => !['enabled', 'cursors', 'lastRun', 'pending', 'globalPrompt', 'defaultPrompt', 'intervalHours', 'running'].includes(key))) return invalid();
  if (!Array.isArray(item.pending)) return invalid();
  const cursors = object(item.cursors);
  if (Object.entries(cursors).some(([id, cursor]) => !isSessionId(id) || typeof cursor !== 'string' || !cursor)) return invalid();
  const intervalHours = item.intervalHours;
  if (typeof intervalHours !== 'number' || !Number.isSafeInteger(intervalHours) || intervalHours <= 0) return invalid();
  return { enabled: boolean(item.enabled), cursors: cursors as Record<string, string>,
    ...(item.lastRun === undefined ? {} : { lastRun: run(item.lastRun) }), pending: item.pending.map(pending),
    globalPrompt: text(item.globalPrompt), defaultPrompt: text(item.defaultPrompt), intervalHours, running: boolean(item.running) };
}
