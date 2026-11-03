import type { AgentEntry } from '../api/types';

export const MAIN_AGENT = 'local-main';

export function mainAgent(): AgentEntry {
  return { id: MAIN_AGENT, sessionId: null, updatedAt: new Date().toISOString() };
}

/** 服务端约束：字母开头、仅含字母数字和 _ -，长度不超过 64。 */
export function newAgent(): AgentEntry {
  return { id: `side-${Math.random().toString(36).slice(2, 10)}`, sessionId: null, updatedAt: new Date().toISOString() };
}
