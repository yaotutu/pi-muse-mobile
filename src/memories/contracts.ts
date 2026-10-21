import { ApiError } from '../api/errors';
import type { MemoryItem } from '../api/types';
import type { MemoryPage } from './types';

const invalid = (): never => { throw new ApiError(502, '服务器记忆响应格式不正确，请刷新核对'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const text = (value: unknown): string => typeof value === 'string' ? value : invalid();
function date(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) return invalid();
  // Date.parse 会归一化不存在的日期；先校验日历日期，保留服务端时间原文而不是重新排序。
  const day = result.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return invalid();
  return result;
}

/** 正文仅为纯文本；只投影公开字段，不将意外响应载荷写进界面、日志或持久存储。 */
export function parseMemoryItem(value: unknown, expectedId?: string): MemoryItem {
  const v = object(value); const id = text(v.id);
  if (!id || expectedId !== undefined && id !== expectedId) return invalid();
  return { id, text: text(v.text), source: text(v.source), createdAt: date(v.createdAt), updatedAt: date(v.updatedAt) };
}
export function parseMemoryPage(value: unknown): MemoryPage {
  const v = object(value);
  if (!Array.isArray(v.memories)) return invalid();
  const memories = v.memories.map((item) => parseMemoryItem(item));
  if (new Set(memories.map((item) => item.id)).size !== memories.length) return invalid();
  return { memories };
}
export function parseMemoryRemoval(value: unknown, expectedId?: string): void {
  const v = object(value);
  if (v.ok !== true) invalid();
  if (v.id !== undefined) {
    const id = text(v.id);
    if (!id || (expectedId !== undefined && id !== expectedId)) invalid();
  }
}
