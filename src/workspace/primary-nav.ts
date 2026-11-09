export type PrimaryTabId = 'messages' | 'news' | 'settings';

export type PrimaryTabDefinition = {
  id: PrimaryTabId;
  label: string;
  testID: string;
};

/** 一级导航仅此三项，顺序固定，冷启动默认进入消息。 */
export const PRIMARY_TABS: readonly PrimaryTabDefinition[] = [
  { id: 'messages', label: '消息', testID: 'primary-tab-messages' },
  { id: 'news', label: '新闻', testID: 'primary-tab-news' },
  { id: 'settings', label: '设置', testID: 'primary-tab-settings' },
] as const;

/**
 * 判断当前工作区页面是否为一级根页面。
 * 根页仅由当前 page 及各一级 Tab 的内层状态决定，不依赖残留的历史通知/草稿引用；
 * 会话覆盖层（sessionMounted）处于挂载或动画期间时均非根页（底栏不露出、不被读屏访问）；
 * 文章详情、管理、设置子页和覆盖层非根页；main 聊天本身就是消息根页。
 */
export function isRootWorkspacePage({
  page,
  newsDetailOpen,
  newsManaging,
  settingsSubpage,
  sessionMounted,
}: {
  page: string;
  newsDetailOpen?: boolean;
  newsManaging?: boolean;
  settingsSubpage?: string | null;
  sessionMounted?: boolean;
}): boolean {
  if (sessionMounted) return false;
  if (page === 'messages') return true;
  if (page === 'news') return !newsDetailOpen && !newsManaging;
  if (page === 'settings') return settingsSubpage === null;
  return false;
}

/** 专题 UI 暂缓；即使后端仍保留该会话，也不能把它的通知引用改投 main。 */
export function notificationContinuationNotice(sessionId: string): string | undefined {
  return sessionId === 'main' ? undefined : `来源会话 ${sessionId} 的继续处理暂不可用，目前仅支持主聊天。`;
}

export type ChatReturn = 'messages' | 'news';
/** 只有显式新闻讨论保留文章返回来源；点击消息 Tab 或通知续聊会清理旧来源。 */
export function chatReturnForEntry(source: 'messages' | 'news' | 'notification'): ChatReturn {
  return source === 'news' ? 'news' : 'messages';
}
