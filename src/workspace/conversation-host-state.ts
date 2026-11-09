/** 各会话的失效版本只和自己的 session 绑定，不受当前选中会话影响。 */
export function conversationRefreshKey(refreshVersion: number, runtime: {
  synchronized: boolean; conversationSyncVersion: number; conversationInvalidationVersion: number;
  conversationInvalidationPiSessionId: string | null | undefined;
}) {
  return runtime.synchronized
    ? `${refreshVersion}:${runtime.conversationSyncVersion}:${runtime.conversationInvalidationVersion}`
    : `${refreshVersion}:0:0`;
}
