/** Android Back 由工作区根层统一判定优先级，避免父子监听器互相抢先。 */
export type WorkspaceBackAction = 'keyboard' | 'browser' | 'session' | 'inbox' | 'feature' | 'news-article' | 'news-sources' | 'settings' | 'goal' | 'space' | 'none';

export function workspaceBackAction(state: {
  keyboardVisible: boolean;
  browserOpen?: boolean;
  sessionMounted: boolean;
  page: 'inbox' | 'members' | 'chat' | 'news' | 'goals' | 'settings' | 'space' | 'feature';
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
  if (state.page === 'news') return 'inbox';
  if (state.page === 'settings' && state.settingsSubpage) return 'settings';
  if (state.page === 'settings') return 'inbox';
  if (state.page === 'feature') return 'feature';
  if (state.page === 'chat' || state.page === 'members') return 'inbox';
  if (state.page === 'space') return 'space';
  if (state.page === 'goals' && state.goalCreating) return 'goal';
  return 'none';
}
