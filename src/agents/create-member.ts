import type { ApiClient } from '../api/contracts';
import { isRequestCancelled } from '../api/errors';
import type { AgentInfo } from '../api/types';

/** 创建响应丢失时只回读原 ID，不自动再写，也不生成第二个临时成员。 */
export async function createMember(api: Pick<ApiClient, 'createAgent' | 'listAgents'>, id: string, signal: AbortSignal): Promise<AgentInfo> {
  try {
    return await api.createAgent(id, signal);
  } catch (error) {
    if (signal.aborted || isRequestCancelled(error)) throw error;
    try {
      const member = (await api.listAgents(signal)).find((item) => item.id === id);
      if (!signal.aborted && member?.sessionId) return { ...member, sessionId: member.sessionId };
    } catch { /* 保留原创建错误；读失败不能冒充成员不存在。 */ }
    throw error;
  }
}
