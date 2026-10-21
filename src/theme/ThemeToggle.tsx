import { Moon, Sun } from 'lucide-react-native';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './ThemeProvider';
import { themeTokens } from './tokens';

/** 快捷入口只切换明暗；完整主题选择统一由 ThemePicker 提供。 */
export function ThemeToggle({ testID, style }: { testID?: string; style?: StyleProp<ViewStyle> }) {
  const { colors, appearance, toggleAppearance } = useTheme();
  const light = appearance === 'light';
  const Icon = light ? Moon : Sun;
  return <Pressable accessibilityRole="button" accessibilityLabel={light ? '切换到暗色主题' : '切换到亮色主题'}
    onPress={toggleAppearance} testID={testID} style={({ pressed }) => [styles.control, { backgroundColor: colors.control }, style, pressed && styles.pressed]}>
    <Icon size={themeTokens.layout.iconSize} strokeWidth={1.7} color={colors.ink} />
  </Pressable>;
}

const styles = StyleSheet.create({
  control: { width: themeTokens.layout.controlSize, height: themeTokens.layout.controlSize, borderRadius: themeTokens.radius.round, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: themeTokens.interaction.pressedOpacity },
});
