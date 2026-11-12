/** 各会话的失效版本只和自己的 session 绑定，不受当前选中会话影响。 */
export function conversationRefreshKey(refreshVersion: number, runtime: {
  synchronized: boolean; conversationSyncVersion: number; conversationInvalidationVersion: number;
  conversationInvalidationPiSessionId: string | null | undefined;
}) {
  // 失同步仅锁定等待 ready；不能把已有版本回退为 0，制造一次断线 GET。
  return `${refreshVersion}:${runtime.conversationSyncVersion}:${runtime.conversationInvalidationVersion}`;
}
