import type { ApiClient } from '../api/contracts';
import { isRequestCancelled } from '../api/errors';
import type { SpaceInfo } from '../api/types';

/** 创建响应丢失时只回读原 ID，不自动再写，也不生成第二个临时成员。 */
export async function createMember(api: Pick<ApiClient, 'createSpace' | 'listMembers'>, id: string, signal: AbortSignal): Promise<SpaceInfo> {
  try {
    return await api.createSpace(id, signal);
  } catch (error) {
    if (signal.aborted || isRequestCancelled(error)) throw error;
    try {
      const member = (await api.listMembers(signal)).find((item) => item.id === id && item.kind === 'workspace');
      if (!signal.aborted && member?.sessionId) return { ...member, sessionId: member.sessionId };
    } catch { /* 保留原创建错误；读失败不能冒充成员不存在。 */ }
    throw error;
  }
}
