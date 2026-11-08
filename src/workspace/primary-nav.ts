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
 * 任何二级/详情/管理/浏览器/通知讨论（discussion）/聊天均非根页。
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

export type NotificationOrigin =
  | { type: 'messages' }
  | {
      type: 'chat';
      sessionId: string;
      chatReturn: 'messages' | 'news';
    };

export type NotificationReturnResult =
  | { page: 'messages'; errorNotice?: string }
  | { page: 'chat'; sessionId: string; chatReturn: 'messages' | 'news' };

/**
 * 纯函数：计算从通知讨论返回时的目标页面与状态。
 * - 若来源于聊天：检查原 Session 是否仍存在于目录中；存在则返回原 Session 并恢复原来源（messages 或 news）；
 *   若已被删除，绝不复活或静默跳到其他 Session，安全回消息（messages）并给出提示。
 * - 若来源于会话列表：安全回消息（messages）。
 */
export function resolveNotificationReturn(
  origin: NotificationOrigin,
  existingSessionIds: readonly string[],
): NotificationReturnResult {
  if (origin.type === 'chat') {
    if (existingSessionIds.includes(origin.sessionId)) {
      return { page: 'chat', sessionId: origin.sessionId, chatReturn: origin.chatReturn };
    }
    return { page: 'messages', errorNotice: `原会话 ${origin.sessionId} 不存在或已被删除，已返回消息` };
  }
  return { page: 'messages' };
}

export type ChatReturn = 'messages' | 'news';
/** 只有显式新闻讨论保留文章返回来源；普通切换不继承上一次新闻来源。 */
export function chatReturnForEntry(source: 'messages' | 'news' | 'switch' | 'notification'): ChatReturn {
  return source === 'news' ? 'news' : 'messages';
}
