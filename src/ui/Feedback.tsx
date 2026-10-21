/** 状态类展示原语：统一呈现可恢复的错误提示。 */

import { StyleSheet, Text, View } from 'react-native';
import { spacing, workspaceTheme } from './tokens';
import { useTheme } from '../theme/ThemeProvider';

/** 错误提示条：error 为空时整体不渲染，调用方只需把错误字符串传进来。 */
export function ErrorNotice({ error }: { error?: string }) {
  const { colors } = useTheme();
  return error ? (
    <View accessibilityRole="alert" style={[styles.errorNotice, { backgroundColor: colors.dangerSoft }]}>
      <Text style={{ ...workspaceTheme.typography.detail, color: colors.danger }}>{error}</Text>
    </View>
  ) : null;
}

const styles = StyleSheet.create({
  errorNotice: {
    padding: spacing.lg,
    borderRadius: workspaceTheme.radius.field,
    marginVertical: spacing[10],
    gap: spacing.xs,
  },
});
