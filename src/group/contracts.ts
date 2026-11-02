import { ApiError } from '../api/errors';
import type { MessageView } from '../chat/chat-state';

export type GroupMessage = { id: string; role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; isError?: boolean;
  toolCalls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] };
export type GroupTurn = { id: string; rootId: string; sourceSpaceId: string | null; targetSpaceId: string; discussionId: string;
  createdAt: string; finishedAt: string | null; status: 'running' | 'completed' | 'failed' | 'cancelled'; messages: GroupMessage[] };
export type GroupSnapshot = { id: 'main'; defaultSpaceId: 'local-main'; running: string | null; turns: GroupTurn[] };
export type GroupInput = { id: string; content: string; targetSpaceId?: string };
export type GroupEvent = { type: 'turn'; turn: Omit<GroupTurn, 'messages'> } | { type: 'delta'; id: string; text: string } | { type: 'settled' } | { type: 'error'; code: string; message: string };
export interface GroupClient {
  getGroup(signal?: AbortSignal): Promise<GroupSnapshot>;
  sendGroup(input: GroupInput, onEvent: (event: GroupEvent) => void, signal?: AbortSignal): Promise<void>;
  stopGroup(id: string, signal?: AbortSignal): Promise<void>;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const messageId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const space = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const date = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const invalid = () => new ApiError(502, '群聊数据不正确，请重新同步核对');
function turn(value: unknown): GroupTurn {
  if (!record(value) || !messageId(value.id) || !messageId(value.rootId) || !uuid(value.discussionId) || !space(value.targetSpaceId) ||
    !(value.sourceSpaceId === null || space(value.sourceSpaceId)) || !date(value.createdAt) || !(value.finishedAt === null || date(value.finishedAt)) ||
    !['running', 'completed', 'failed', 'cancelled'].includes(String(value.status)) || !Array.isArray(value.messages)) throw invalid();
  for (const message of value.messages) {
    if (!record(message) || typeof message.id !== 'string' || typeof message.content !== 'string' || !['user', 'assistant', 'tool'].includes(String(message.role))) throw invalid();
    if (message.role === 'tool' && (typeof message.toolCallId !== 'string' || (message.isError !== undefined && typeof message.isError !== 'boolean'))) throw invalid();
    if (message.toolCalls !== undefined && (!Array.isArray(message.toolCalls) || !message.toolCalls.every((call) => record(call) && typeof call.id === 'string' && call.type === 'function' && record(call.function) && typeof call.function.name === 'string' && typeof call.function.arguments === 'string'))) throw invalid();
  }
  return value as unknown as GroupTurn;
}
export function parseGroup(value: unknown): GroupSnapshot {
  if (!record(value) || value.id !== 'main' || value.defaultSpaceId !== 'local-main' || !(value.running === null || messageId(value.running)) || !Array.isArray(value.turns)) throw invalid();
  const turns = value.turns.map(turn);
  if (new Set(turns.map((item) => item.id)).size !== turns.length) throw invalid();
  return { id: 'main', defaultSpaceId: 'local-main', running: value.running, turns };
}
export function parseGroupEvent(value: unknown): GroupEvent {
  if (!record(value)) throw invalid();
  if (value.type === 'settled') return { type: 'settled' };
  if (value.type === 'turn' && record(value.turn)) { const parsed = turn({ ...value.turn, messages: [] }); return { type: 'turn', turn: parsed }; }
  if (value.type === 'delta' && messageId(value.id) && typeof value.text === 'string') return { type: 'delta', id: value.id, text: value.text };
  if (value.type === 'error' && typeof value.code === 'string' && typeof value.message === 'string') return { type: 'error', code: value.code, message: value.message };
  throw invalid();
}

/** 只按可靠发送者显示；正文中的 @ 不会被当成成员发言或路由事实。 */
export function groupRows(turns: GroupTurn[]) {
  const rows: { key: string; sender: string | null; target?: string; at: string; message: MessageView }[] = [];
  for (const item of turns) {
    const user = item.messages.find((message) => message.role === 'user');
    if (user) rows.push({ key: item.id, sender: item.sourceSpaceId, target: item.targetSpaceId, at: item.createdAt,
      message: { id: user.id, role: item.sourceSpaceId ? 'assistant' : 'user', text: user.content, toolCalls: [], feedbackAvailable: false } });
    const assistant = item.messages.find((message) => message.role === 'assistant');
    if (assistant) rows.push({ key: `reply-${item.id}`, sender: item.targetSpaceId, at: item.finishedAt ?? item.createdAt,
      message: { id: assistant.id, role: 'assistant', text: assistant.content, feedbackAvailable: false,
        toolCalls: (assistant.toolCalls ?? []).map((call) => { const result = item.messages.find((message) => message.toolCallId === call.id); return {
          id: call.id, name: call.function.name, args: call.function.arguments, ...(result ? { result: result.content, isError: result.isError } : {}),
        }; }) } });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/** 手动输入的显式 @ 与成员选择器一致；未知目标拒绝，不静默交给 main。 */
export function resolveGroupTarget(text: string, members: { id: string; name: string }[], selected?: string) {
  if (!text.startsWith('@')) return { content: text, ...(selected ? { targetSpaceId: selected } : {}) };
  const member = [...members].sort((a, b) => b.name.length - a.name.length).find((item) => [item.name, item.id].some((name) => text.startsWith(`@${name} `) || text.startsWith(`@${name}\n`)));
  if (!member) throw new Error('请从成员列表选择要 @ 的对象');
  const alias = [member.name, member.id].find((name) => text.startsWith(`@${name} `) || text.startsWith(`@${name}\n`))!;
  return { content: text.slice(alias.length + 2), targetSpaceId: member.id };
}
