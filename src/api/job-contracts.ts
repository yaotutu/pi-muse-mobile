import { ApiError } from './errors';
import type { DeleteJobResult, JobDetail, JobEvent, JobItem } from './types';

function invalid(): never { throw new ApiError(502, '定时任务响应格式不正确，请刷新核对服务端状态'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
const statuses = ['scheduled', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'queued'];
const kinds = ['plan', 'step', 'observation', 'approval', 'result', 'error', 'status'];

/** 只接纳独立 Jobs 契约；不再用旧 task/threadId 别名掩盖部署不匹配。 */
export function parseJob(value: unknown, expectedId?: string): JobItem {
  const item = object(value);
  for (const field of ['id', 'title', 'prompt', 'at', 'createdAt', 'updatedAt']) if (typeof item[field] !== 'string') invalid();
  if (!item.id || (expectedId !== undefined && item.id !== expectedId) || item.kind !== 'job' || typeof item.daily !== 'boolean' || typeof item.enabled !== 'boolean' || !statuses.includes(item.status as string)) invalid();
  if (item.error !== null && typeof item.error !== 'string') invalid();
  for (const field of ['nextRunAt', 'lastRunAt', 'lastResult', 'originSpaceId']) if (item[field] !== undefined && typeof item[field] !== 'string') invalid();
  // 响应只按文档检查结构，历史任务的 at 不重新解释；所有新提交由表单严格校验。
  return item as JobItem;
}
export function parseJobs(value: unknown): JobItem[] {
  const page = object(value);
  if (!Array.isArray(page.jobs)) return invalid();
  const jobs = page.jobs.map((item) => parseJob(item));
  if (new Set(jobs.map((item) => item.id)).size !== jobs.length) invalid();
  return jobs;
}
export function parseJobDetail(value: unknown, id: string): JobDetail {
  const detail = object(value); const job = parseJob(detail.job, id);
  if (!Array.isArray(detail.events)) return invalid();
  const events = detail.events.map((value) => {
    const event = object(value);
    for (const field of ['id', 'taskId', 'date', 'title', 'detail']) if (typeof event[field] !== 'string') invalid();
    if (!event.id || event.taskId !== id || !kinds.includes(event.kind as string)) invalid();
    return event as JobEvent;
  });
  if (new Set(events.map((event) => event.id)).size !== events.length) invalid();
  return { job, events };
}
export function parseJobRemoval(value: unknown, id: string): DeleteJobResult {
  const result = object(value);
  if (result.ok !== true || result.id !== id) return invalid();
  return { ok: true, id };
}
export function parseServerTimeZone(value: unknown): string {
  const health = object(value);
  if (health.ok !== true || typeof health.timeZone !== 'string' || !health.timeZone) return invalid();
  try { new Intl.DateTimeFormat('en', { timeZone: health.timeZone }).format(); } catch { return invalid(); }
  return health.timeZone;
}
