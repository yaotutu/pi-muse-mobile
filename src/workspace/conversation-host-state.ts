/** 会话切换只增加所有者；仅真实删除会话才从挂载集合移除。 */
export function reconcileConversationOwners(visited: string[], currentSessionId: string, sessionIds: string[]) {
  const available = new Set(sessionIds);
  const owners = [...new Set([...visited, currentSessionId])].filter((id) => available.has(id));
  return owners.length === visited.length && owners.every((id, index) => id === visited[index]) ? visited : owners;
}

/** 各会话的失效版本只和自己的 session 绑定，不受当前选中会话影响。 */
export function conversationRefreshKey(refreshVersion: number, runtime: {
  synchronized: boolean; conversationSyncVersion: number; conversationInvalidationVersion: number;
  conversationInvalidationPiSessionId: string | null | undefined;
}) {
  return runtime.synchronized
    ? `${refreshVersion}:${runtime.conversationSyncVersion}:${runtime.conversationInvalidationVersion}`
    : `${refreshVersion}:0:0`;
}
