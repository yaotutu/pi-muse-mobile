export type PrimaryTabId = 'group' | 'news' | 'settings';

export type PrimaryTabDefinition = {
  id: PrimaryTabId;
  label: string;
  testID: string;
};

/** 一级导航仅此三项，顺序固定，冷启动默认进入消息（原群聊）。 */
export const PRIMARY_TABS: readonly PrimaryTabDefinition[] = [
  { id: 'group', label: '消息', testID: 'primary-tab-group' },
  { id: 'news', label: '新闻', testID: 'primary-tab-news' },
  { id: 'settings', label: '设置', testID: 'primary-tab-settings' },
] as const;

/**
 * 纯函数：本地大小写不敏感子串匹配（同时匹配 id 与 name）。
 * 保持原数组顺序不变，不进行动态重排。
 */
export function filterMembers<T extends { id: string; name: string }>(
  members: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...members];
  return members.filter(
    (item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q),
  );
}

/**
 * 判断当前工作区页面是否为一级根页面。
 * 根页仅由当前 page 及各一级 Tab 的内层状态决定，不依赖残留的历史通知/草稿引用；
 * 会话覆盖层（sessionMounted）处于挂载或动画期间时均非根页（底栏不露出、不被读屏访问）；
 * 任何二级/详情/管理/浏览器/通知讨论（discussion）/私聊均非根页。
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
  if (page === 'group') return true;
  if (page === 'news') return !newsDetailOpen && !newsManaging;
  if (page === 'settings') return settingsSubpage === null;
  return false;
}

export type NotificationOrigin =
  | { type: 'group' }
  | {
      type: 'chat';
      agentId: string;
      chatReturn: 'group' | 'news';
    };

export type NotificationReturnResult =
  | { page: 'group'; errorNotice?: string }
  | { page: 'chat'; agentId: string; chatReturn: 'group' | 'news' };

/**
 * 纯函数：计算从通知讨论返回时的目标页面与状态。
 * - 若来源于私聊：检查原 Agent 是否仍存在于目录中；存在则返回原 Agent 并恢复原来源（group 或 news）；
 *   若已被删除，绝不复活或静默跳到其他 Agent，安全回消息（group）并给出提示。
 * - 若来源于群聊：安全回消息（group）。
 */
export function resolveNotificationReturn(
  origin: NotificationOrigin,
  existingAgentIds: readonly string[],
): NotificationReturnResult {
  if (origin.type === 'chat') {
    if (existingAgentIds.includes(origin.agentId)) {
      return { page: 'chat', agentId: origin.agentId, chatReturn: origin.chatReturn };
    }
    return { page: 'group', errorNotice: `原智能体 ${origin.agentId} 不存在或已被删除，已返回消息` };
  }
  return { page: 'group' };
}
