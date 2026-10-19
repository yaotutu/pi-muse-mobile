import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { workspacePalettes, type WorkspaceAppearance, type WorkspaceColors } from '../ui/tokens';

type WorkspaceThemeValue = {
  mode: WorkspaceAppearance;
  colors: WorkspaceColors;
  setMode: (mode: WorkspaceAppearance) => void;
  toggle: () => void;
};

const WorkspaceThemeContext = createContext<WorkspaceThemeValue | null>(null);

/** 外观仅保存在当前进程内存中，切换时不重建会话。 */
export function WorkspaceThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<WorkspaceAppearance>('light');
  const toggle = useCallback(() => setMode((value) => value === 'light' ? 'dark' : 'light'), []);
  const value = useMemo(() => ({ mode, colors: workspacePalettes[mode], setMode, toggle }), [mode, toggle]);
  return <WorkspaceThemeContext.Provider value={value}>{children}</WorkspaceThemeContext.Provider>;
}

export function useWorkspaceTheme() {
  const value = useContext(WorkspaceThemeContext);
  if (!value) throw new Error('工作区外观必须在主题 Provider 内使用');
  return value;
}
