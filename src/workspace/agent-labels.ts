import type { AgentEntry } from '../api/types';
import { MAIN_AGENT } from '../agents/agent-state';

/** 服务端没有标题；首次见到智能体时按时间排序分配智能体编号，刷新不会重排已有编号。 */
export class AgentLabels {
  constructor(private readonly labels = new Map<string, number>()) {}
  sync(agents: AgentEntry[]): AgentLabels {
    const known = new Set(agents.map((agent) => agent.id));
    const updated = new Map([...this.labels].filter(([id]) => known.has(id)));
    const next = Math.max(0, ...updated.values()) + 1;
    agents.filter((agent) => agent.id !== MAIN_AGENT && !isBuiltinMember(agent.id) && !updated.has(agent.id))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
      .forEach((agent, index) => updated.set(agent.id, next + index));
    if (updated.size === this.labels.size && [...updated].every(([id, number]) => this.labels.get(id) === number)) return this;
    return new AgentLabels(updated);
  }
  title(id: string) { return id === MAIN_AGENT ? 'Muse' : id === 'news-internal' ? '新闻' : id === 'sms-internal' ? '短信' : `成员 ${this.labels.get(id) ?? '…'}`; }
}

export function isBuiltinMember(id: string) { return id === 'news-internal' || id === 'sms-internal'; }
