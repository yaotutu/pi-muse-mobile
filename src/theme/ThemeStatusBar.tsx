import { StatusBar } from 'expo-status-bar';
import { useTheme } from './ThemeProvider';

/** 原生 Modal 独立覆盖状态栏；颜色规则集中在主题层，避免多套浅色被误判为深色。 */
export function ThemeStatusBar() {
  const { appearance } = useTheme();
  return <StatusBar style={appearance === 'dark' ? 'light' : 'dark'} />;
}
