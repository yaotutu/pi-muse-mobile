import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { previewPalettes, type PreviewAppearance, type PreviewColors } from '../ui/tokens';

type PreviewThemeValue = {
  mode: PreviewAppearance;
  colors: PreviewColors;
  setMode: (mode: PreviewAppearance) => void;
  toggle: () => void;
};

const PreviewThemeContext = createContext<PreviewThemeValue | null>(null);

/** 仅保存在当前 UI 预览内存中，切换外观不重建会话或触碰正式主题配置。 */
export function PreviewThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<PreviewAppearance>('light');
  const toggle = useCallback(() => setMode((value) => value === 'light' ? 'dark' : 'light'), []);
  const value = useMemo(() => ({ mode, colors: previewPalettes[mode], setMode, toggle }), [mode, toggle]);
  return <PreviewThemeContext.Provider value={value}>{children}</PreviewThemeContext.Provider>;
}

export function usePreviewTheme() {
  const value = useContext(PreviewThemeContext);
  if (!value) throw new Error('预览外观只能在 UI 预览中使用');
  return value;
}
