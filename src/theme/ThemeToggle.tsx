import { Moon, Sun } from 'lucide-react-native';
import { type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './ThemeProvider';
import { IconControl } from '../ui/IconControl';

/** 快捷入口只切换明暗；完整主题选择统一由 ThemePicker 提供。 */
export function ThemeToggle({ testID, style }: { testID?: string; style?: StyleProp<ViewStyle> }) {
  const { appearance, toggleAppearance } = useTheme();
  const light = appearance === 'light';
  const Icon = light ? Moon : Sun;
  return <IconControl icon={Icon} label={light ? '切换到暗色主题' : '切换到亮色主题'}
    onPress={toggleAppearance} testID={testID} style={style} />;
}
