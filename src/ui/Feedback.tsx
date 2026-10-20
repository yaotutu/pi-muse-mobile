/** 状态类展示原语：统一呈现可恢复的错误提示。 */

import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from './tokens';

/** 错误提示条：error 为空时整体不渲染，调用方只需把错误字符串传进来。 */
export function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <View accessibilityRole="alert" style={styles.errorNotice}>
      <Text style={{ ...typography.text, color: colors.danger }}>{error}</Text>
    </View>
  ) : null;
}

const styles = StyleSheet.create({
  errorNotice: {
    padding: spacing.lg,
    borderRadius: radius.notice,
    backgroundColor: colors.dangerBg,
    marginVertical: spacing[10],
    gap: spacing.xs,
  },
});
