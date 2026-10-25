/** 页面内容容器原语：本层不包含业务语义，仅提供通用卡片。 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { spacing, workspaceTheme } from './tokens';
import { useTheme } from '../theme/ThemeProvider';

/** 主题表面卡片：统一圆角、细边界与常见状态底色，内容和风险文案由页面提供。 */
export function Card({ children, style, tone = 'default', ...props }: ViewProps & { children: ReactNode; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const { colors } = useTheme();
  const backgroundColor = tone === 'success' ? colors.successSoft : tone === 'warning' ? colors.warningSoft : tone === 'danger' ? colors.dangerSoft : colors.surface;
  return <View {...props} style={[styles.card, style, { backgroundColor, borderColor: colors.line }]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: workspaceTheme.radius.card,
    padding: spacing[16],
    borderWidth: StyleSheet.hairlineWidth,
  },
});
