/** 空间切换只增加所有者；仅真实删除空间才从挂载集合移除。 */
export function reconcileConversationOwners(visited: string[], currentSpaceId: string, spaceIds: string[]) {
  const available = new Set(spaceIds);
  available.add(currentSpaceId);
  const owners = [...new Set([...visited, currentSpaceId])].filter((id) => available.has(id));
  return owners.length === visited.length && owners.every((id, index) => id === visited[index]) ? visited : owners;
}

/** 各空间的失效版本只和自己的 session 绑定，不受当前选中空间影响。 */
export function conversationRefreshKey(refreshVersion: number, runtime: {
  synchronized: boolean; conversationSyncVersion: number; conversationInvalidationVersion: number;
  conversationInvalidationSessionId: string | null | undefined;
}, sessionId: string | null) {
  const matches = !runtime.conversationInvalidationSessionId || !sessionId ||
    sessionId === runtime.conversationInvalidationSessionId;
  return runtime.synchronized
    ? `${refreshVersion}:${runtime.conversationSyncVersion}:${matches ? runtime.conversationInvalidationVersion : 0}`
    : `${refreshVersion}:0:0`;
}
