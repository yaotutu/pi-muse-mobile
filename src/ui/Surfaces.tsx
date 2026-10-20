/** 页面内容容器原语：本层不包含业务语义，仅提供通用卡片。 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from './tokens';

/** 白底大圆角卡片：所有页面内容容器的基本形态。 */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing[20],
  },
});
