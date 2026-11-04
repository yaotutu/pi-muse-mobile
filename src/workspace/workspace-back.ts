/** Android Back 由工作区根层统一判定优先级，避免父子监听器互相抢先。 */
export type WorkspaceBackAction = 'group' | 'discussion' | 'keyboard' | 'browser' | 'session' | 'chat-return' | 'feature' | 'news-owner' | 'news-article' | 'news-sources' | 'settings' | 'goal' | 'agent' | 'none';

export function workspaceBackAction(state: {
  keyboardVisible: boolean;
  browserOpen?: boolean;
  sessionMounted: boolean;
  page: 'group' | 'chat' | 'discussion' | 'news' | 'goals' | 'settings' | 'agent' | 'feature';
  newsArticleOpen?: boolean;
  newsManaging?: boolean;
  settingsSubpage: string | null;
  goalCreating: boolean;
}): WorkspaceBackAction {
  if (state.keyboardVisible) return 'keyboard';
  if (state.browserOpen) return 'browser';
  if (state.sessionMounted) return 'session';
  if (state.page === 'news' && state.newsArticleOpen) return 'news-article';
  if (state.page === 'news' && state.newsManaging) return 'news-sources';
  if (state.page === 'news') return 'news-owner';
  if (state.page === 'settings' && state.settingsSubpage) return 'settings';
  if (state.page === 'settings') return 'chat-return';
  if (state.page === 'feature') return 'feature';
  if (state.page === 'group') return 'none';
  if (state.page === 'chat') return 'group';
  if (state.page === 'discussion') return 'discussion';
  if (state.page === 'agent') return 'agent';
  if (state.page === 'goals' && state.goalCreating) return 'goal';
  return 'none';
}
