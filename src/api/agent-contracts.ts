import { ApiError } from './errors';
import type { ResetAgentResult, AgentInfo } from './types';

const invalid = (): never => { throw new ApiError(502, '服务器智能体响应格式不正确，请刷新核对服务器版本'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const text = (value: unknown): string => typeof value === 'string' && value.length > 0 ? value : invalid();
const count = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : invalid();

export function parseAgents(value: unknown): AgentInfo[] {
  const entries = object(value).agents;
  if (!Array.isArray(entries)) return invalid();
  const agents = entries.map((entry): AgentInfo => {
    const v = object(entry);
    if (!Array.isArray(v.extensions) || v.extensions.some((id) => id !== 'news' && id !== 'sms')) return invalid();
    return { id: text(v.id), sessionId: text(v.sessionId), updatedAt: text(v.updatedAt), extensions: v.extensions as ('news' | 'sms')[],
      ...(v.name === undefined ? {} : { name: text(v.name) }) };
  });
  if (new Set(agents.map((entry) => entry.id)).size !== agents.length) return invalid();
  return agents;
}

export function parseCreatedAgent(value: unknown, expectedAgentId: string): AgentInfo {
  const [agent] = parseAgents({ agents: [object(value).agent] });
  if (agent.id !== expectedAgentId) return invalid();
  return agent;
}

export function parseResetAgent(value: unknown, expectedAgentId: string): ResetAgentResult {
  const v = object(value); const removed = object(v.removed);
  if (v.ok !== true || v.agentId !== expectedAgentId) return invalid();
  return { ok: true, agentId: expectedAgentId, sessionId: text(v.sessionId), cancelledApprovals: count(v.cancelledApprovals),
    removed: { jobs: count(removed.jobs), monitors: count(removed.monitors) } };
}
