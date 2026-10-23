import { ApiError } from './errors';
import type { Profile } from './contracts';
import type { Identity, WorkspaceSnapshot } from './types';

/** 身份与人设响应只消费服务端声明字段；坏结构按 502 暴露，不落入 UI 状态。 */
function invalid(): never {
  throw new ApiError(502, '服务器身份或人设响应格式不正确，请确认服务器版本与地址');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}

export function parseIdentity(value: unknown): Identity {
  const item = object(value);
  const identity: Identity = { name: text(item.name), tone: text(item.tone) };
  if (item.avatar !== undefined) identity.avatar = text(item.avatar);
  if (item.showChatUpdates !== undefined) {
    if (typeof item.showChatUpdates !== 'boolean') return invalid();
    identity.showChatUpdates = item.showChatUpdates;
  }
  return identity;
}

export function parseProfile(value: unknown): Profile {
  const item = object(value);
  return { soul: text(item.soul), user: text(item.user) };
}

export function parseWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
  const item = object(value);
  return { identity: parseIdentity(item.identity) };
}
