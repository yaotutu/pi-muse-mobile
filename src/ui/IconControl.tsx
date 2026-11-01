/**
 * 小型图标操作的统一命中区。仅处理视觉和无障碍状态，调用方决定业务是否可执行。
 * 保持固定最小尺寸，主题切换只更新颜色，不替换承载业务状态的页面树。
 */
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { themeTokens, spacing } from '../theme/tokens';

export function IconControl({ icon: Icon, label, onPress, testID, disabled = false, busy = false, selected = false, small = false, style }: {
  icon: LucideIcon; label: string; onPress: () => void; testID?: string;
  disabled?: boolean; busy?: boolean; selected?: boolean; small?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const size = small ? themeTokens.layout.smallControl : themeTokens.layout.controlSize;
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: disabled || busy, busy, selected }}
    disabled={disabled || busy} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.control, { width: size, height: size, backgroundColor: selected ? colors.selected : colors.floatingSurface, borderColor: colors.floatingLine },
      pressed && styles.pressed, (disabled || busy) && styles.disabled, style]}>
    <Icon size={small ? themeTokens.layout.iconSize - spacing[4] : themeTokens.layout.iconSize} strokeWidth={1.7} color={colors.ink} />
  </Pressable>;
}

const styles = StyleSheet.create({
  control: { borderRadius: themeTokens.radius.round, alignItems: 'center', justifyContent: 'center', minWidth: themeTokens.layout.smallControl, minHeight: themeTokens.layout.smallControl, borderWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: themeTokens.interaction.pressedOpacity },
  disabled: { opacity: themeTokens.interaction.disabledOpacity },
});
