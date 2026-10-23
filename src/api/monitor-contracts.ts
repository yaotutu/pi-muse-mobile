import { ApiError } from './errors';
import type { DeleteMonitorResult, Monitor, MonitorCondition, MonitorStatus } from './types';

/** 网页监控（/api/monitors）独立 REST 契约白名单解析与校验；坏结构按 502 暴露。 */
const monitorConditions: MonitorCondition[] = ['change', 'contains'];
const monitorStatuses: MonitorStatus[] = ['active', 'paused', 'stopped'];

function invalid(): never {
  throw new ApiError(502, '网页监控响应格式不正确，请刷新核对服务端状态');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && value.length === 0)) return invalid();
  return value;
}

function parseDate(value: unknown): string {
  const result = text(value, true);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) {
    return invalid();
  }
  return result;
}

function parseUrl(value: unknown): string {
  const url = text(value, true);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return invalid();
  } catch {
    return invalid();
  }
  return url;
}

function parseIntervalMinutes(value: unknown): number {
  // 响应契约只要求 number；聊天工具未复用 REST 的整数/上限输入约束，不能把输入规则混入输出解析。
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 5) return invalid();
  return value;
}

function parseChecks(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}

export function parseMonitor(value: unknown, expectedId?: string): Monitor {
  const item = object(value);
  const id = text(item.id, true);
  if (expectedId !== undefined && id !== expectedId) return invalid();
  const title = text(item.title, true);
  const url = parseUrl(item.url);

  if (!monitorConditions.includes(item.condition as MonitorCondition)) return invalid();
  const condition = item.condition as MonitorCondition;

  let valueField: string | undefined;
  if (item.value !== undefined) {
    valueField = text(item.value);
  }
  if (condition === 'contains' && (valueField === undefined || valueField.trim().length === 0)) return invalid();

  const intervalMinutes = parseIntervalMinutes(item.intervalMinutes);

  if (!monitorStatuses.includes(item.status as MonitorStatus)) return invalid();
  const status = item.status as MonitorStatus;

  const createdAt = parseDate(item.createdAt);

  let lastCheckedAt: string | undefined;
  if (item.lastCheckedAt !== undefined) {
    lastCheckedAt = parseDate(item.lastCheckedAt);
  }

  const checks = parseChecks(item.checks);

  let error: string | undefined;
  if (item.error !== undefined) {
    error = text(item.error);
  }

  let originSpaceId: string | undefined;
  if (item.originSpaceId !== undefined) {
    originSpaceId = text(item.originSpaceId, true);
  }

  let lastNotifiedAt: string | undefined;
  if (item.lastNotifiedAt !== undefined) {
    lastNotifiedAt = parseDate(item.lastNotifiedAt);
  }

  let lastMatched: boolean | undefined;
  if (item.lastMatched !== undefined) {
    if (typeof item.lastMatched !== 'boolean') return invalid();
    lastMatched = item.lastMatched;
  }

  return {
    id,
    title,
    url,
    condition,
    ...(valueField !== undefined ? { value: valueField } : {}),
    intervalMinutes,
    status,
    createdAt,
    ...(lastCheckedAt !== undefined ? { lastCheckedAt } : {}),
    checks,
    ...(error !== undefined ? { error } : {}),
    ...(originSpaceId !== undefined ? { originSpaceId } : {}),
    ...(lastNotifiedAt !== undefined ? { lastNotifiedAt } : {}),
    ...(lastMatched !== undefined ? { lastMatched } : {}),
  };
}

export function parseMonitors(value: unknown): Monitor[] {
  const container = object(value);
  if (!Array.isArray(container.monitors)) return invalid();
  const list = container.monitors.map((item) => parseMonitor(item));
  if (new Set(list.map((m) => m.id)).size !== list.length) return invalid();
  return list;
}

export function parseDeleteMonitorResult(value: unknown, expectedId?: string): DeleteMonitorResult {
  const container = object(value);
  if (container.ok !== true) return invalid();
  const id = text(container.id, true);
  if (expectedId !== undefined && id !== expectedId) return invalid();
  return { ok: true, id };
}
