import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, themeTokens } from '../theme/tokens';

/** 仅统一输入外观；值、校验、提交、安全输入与键盘行为完全由调用方控制。 */
export const FormInput = forwardRef<TextInput, TextInputProps & { variant?: 'field' | 'search' | 'code' }>(
  function FormInput({ variant = 'field', multiline, editable = true, style, placeholderTextColor, onFocus, onBlur, ...props }, ref) {
    const { colors } = useTheme();
    const [focused, setFocused] = useState(false);
    return <TextInput {...props} ref={ref} multiline={multiline} editable={editable}
      placeholderTextColor={placeholderTextColor ?? colors.faint}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      style={[styles.base, multiline && styles.multiline, variant === 'search' && styles.search,
        variant === 'code' && styles.code, style,
        { color: colors.ink, backgroundColor: variant === 'search' ? 'transparent' : colors.canvas,
          borderColor: variant === 'search' ? 'transparent' : focused ? colors.blue : colors.line,
          opacity: editable ? 1 : themeTokens.interaction.disabledOpacity }]}
    />;
  },
);

const styles = StyleSheet.create({
  base: { minWidth: 0, minHeight: themeTokens.layout.inputMinHeight, paddingHorizontal: spacing[16],
    borderRadius: themeTokens.radius.field, borderWidth: StyleSheet.hairlineWidth, ...themeTokens.typography.input },
  multiline: { paddingVertical: spacing[14], textAlignVertical: 'top', ...themeTokens.typography.detail },
  search: { flex: 1, borderWidth: 0, paddingHorizontal: 0, minHeight: themeTokens.layout.smallControl },
  code: { ...themeTokens.typography.mono },
});
