/** Android Back 由工作区根层统一判定优先级，避免父子监听器互相抢先。 */
export type WorkspaceBackAction = 'keyboard' | 'session' | 'drawer' | 'settings' | 'goal' | 'none';

export function workspaceBackAction(state: {
  keyboardVisible: boolean;
  sessionMounted: boolean;
  drawerOpen: boolean;
  page: 'chat' | 'activity' | 'goals' | 'settings';
  settingsSubpage: string | null;
  goalCreating: boolean;
}): WorkspaceBackAction {
  if (state.keyboardVisible) return 'keyboard';
  if (state.sessionMounted) return 'session';
  if (state.drawerOpen) return 'drawer';
  if (state.page === 'settings' && state.settingsSubpage) return 'settings';
  if (state.page === 'goals' && state.goalCreating) return 'goal';
  return 'none';
}
