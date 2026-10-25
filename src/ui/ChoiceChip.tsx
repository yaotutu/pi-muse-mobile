import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, themeTokens } from '../theme/tokens';

/** 受控的单项选择：调用方决定值及可否切换，本层仅呈现选中与读屏状态。 */
export function ChoiceChip({ label, text, accessibilityLabel, selected, onPress, disabled = false, role = 'button', style, testID }: {
  label: string;
  text?: string;
  accessibilityLabel?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  role?: 'button' | 'tab' | 'radio';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole={role} accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={role === 'radio' ? { checked: selected, disabled } : { selected, disabled }}
    aria-selected={role === 'tab' ? selected : undefined} disabled={disabled} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.chip, { backgroundColor: selected ? colors.selected : colors.floatingSurface,
      borderColor: selected ? colors.blue : colors.floatingLine }, pressed && styles.pressed, disabled && styles.disabled, style]}>
    <Text style={[styles.text, { color: selected ? colors.accentText : colors.ink }]}>{text ?? label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  chip: { minHeight: themeTokens.layout.smallControl, maxWidth: '100%', alignSelf: 'flex-start',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[14], paddingVertical: spacing[8],
    borderRadius: themeTokens.radius.round, borderWidth: StyleSheet.hairlineWidth },
  text: { ...themeTokens.typography.status, minWidth: 0, flexShrink: 1, textAlign: 'center' },
  pressed: { opacity: themeTokens.interaction.pressedOpacity },
  disabled: { opacity: themeTokens.interaction.disabledOpacity },
});
