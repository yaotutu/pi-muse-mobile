/** 状态类展示原语：调用方决定提示内容与级别，本层只呈现语义色。 */

import { StyleSheet, Text, View } from 'react-native';
import { spacing, workspaceTheme } from './tokens';
import { useTheme } from '../theme/ThemeProvider';

/** 旧的错误入口仍委托同一反馈外观；空文案不渲染。 */
export function ErrorNotice({ error }: { error?: string }) {
  return <FeedbackNotice text={error} tone="danger" />;
}

export function FeedbackNotice({ text, tone }: { text?: string; tone: 'success' | 'warning' | 'danger' }) {
  const { colors } = useTheme();
  if (!text) return null;
  const foreground = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.success;
  const background = tone === 'danger' ? colors.dangerSoft : tone === 'warning' ? colors.warningSoft : colors.successSoft;
  return <View accessibilityRole={tone === 'danger' ? 'alert' : undefined}
    accessibilityLiveRegion={tone === 'success' ? 'polite' : undefined}
    style={[styles.errorNotice, { backgroundColor: background, borderColor: foreground }]}>
    <Text style={{ ...workspaceTheme.typography.detail, color: foreground }}>{text}</Text>
  </View>;
}

const styles = StyleSheet.create({
  errorNotice: {
    padding: spacing.lg,
    borderRadius: workspaceTheme.radius.field,
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: spacing[10],
    gap: spacing.xs,
  },
});
