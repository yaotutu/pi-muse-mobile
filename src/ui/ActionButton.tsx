import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, themeTokens } from '../theme/tokens';

/** 小型文字操作的外观和真实交互状态；能否执行始终由调用方判断。 */
export function ActionButton({ label, text, accessibilityLabel, onPress, icon: Icon, tone = 'secondary', disabled = false, busy = false, expanded, wide = false, style, testID }: {
  label: string;
  text?: string;
  accessibilityLabel?: string;
  onPress: () => void;
  icon?: LucideIcon;
  tone?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  expanded?: boolean;
  /** 表单操作在窄屏自然换行，每项仍保留足够宽度。 */
  wide?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  const locked = disabled || busy;
  const foreground = tone === 'primary' ? colors.onAccent : tone === 'danger' ? colors.danger : colors.ink;
  const background = tone === 'primary' ? colors.blue : tone === 'danger' ? colors.dangerSoft : colors.floatingSurface;
  const border = tone === 'primary' ? colors.blue : tone === 'danger' ? colors.danger : colors.floatingLine;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: locked, busy, ...(expanded === undefined ? {} : { expanded }) }}
    disabled={locked} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.button, { backgroundColor: background, borderColor: border }, wide && styles.wide, pressed && styles.pressed, locked && styles.disabled, style]}>
    {busy ? <ActivityIndicator size="small" color={foreground} /> : Icon ? <Icon size={themeTokens.layout.iconSize - spacing[8]} color={foreground} strokeWidth={1.8} /> : null}
    <Text style={[styles.text, { color: foreground }]}>{text ?? label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { minHeight: themeTokens.layout.smallControl, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    maxWidth: '100%', gap: spacing[8], paddingHorizontal: spacing[16], paddingVertical: spacing[8], borderRadius: themeTokens.radius.round, borderWidth: StyleSheet.hairlineWidth },
  text: { ...themeTokens.typography.status, minWidth: 0, flexShrink: 1, fontWeight: '500', textAlign: 'center' },
  wide: { flexGrow: 1, flexBasis: themeTokens.layout.profileActionMinWidth, minWidth: 0 },
  pressed: { opacity: themeTokens.interaction.pressedOpacity },
  disabled: { opacity: themeTokens.interaction.disabledOpacity },
});
