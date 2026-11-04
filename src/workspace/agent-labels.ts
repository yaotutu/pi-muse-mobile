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
export function memberDescription(id: string) {
  return id === MAIN_AGENT ? '日常对话与协作，让 Muse 帮你安排。' : id === 'news-internal' ? '阅读新闻、整理资讯，和我聊聊你关心的内容。' : id === 'sms-internal' ? '整理短信、筛选重要信息，保留你自己的偏好。' : '独立的对话、文件与规则，专注处理自己的事情。';
}
