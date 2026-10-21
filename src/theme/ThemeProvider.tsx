import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { deviceThemePreferences } from './device-preferences';
import { themeRegistry, type ThemeId } from './registry';
import { ThemeController, type ThemePreferenceStore, type ThemeState } from './theme-controller';
import type { ThemeAppearance, ThemeColors, ThemeDefinition } from './types';

type ThemeValue = ThemeState & {
  themeId: ThemeId;
  theme: ThemeDefinition;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  selectTheme: (id: ThemeId) => void;
  toggleAppearance: () => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

/** 根级唯一实例：主题变化只更新 context，不以主题为 key 重建连接、会话或更新任务。 */
export function ThemeProvider({ children, storage = deviceThemePreferences }: { children: ReactNode; storage?: ThemePreferenceStore }) {
  const [controller] = useState(() => new ThemeController(storage));
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const readState = useCallback(() => controller.state, [controller]);
  const state = useSyncExternalStore(subscribe, readState, readState);
  useEffect(() => {
    void controller.load();
  }, [controller]);
  const selectTheme = useCallback((id: ThemeId) => controller.selectTheme(id), [controller]);
  const toggleAppearance = useCallback(() => controller.toggleAppearance(), [controller]);
  const value = useMemo(() => {
    const themeId = state.selection.themeId;
    const theme = themeRegistry[themeId];
    return { ...state, themeId, theme, appearance: theme.appearance, colors: theme.colors, selectTheme, toggleAppearance };
  }, [state, selectTheme, toggleAppearance]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('主题消费者必须在根级 ThemeProvider 内使用');
  return value;
}
