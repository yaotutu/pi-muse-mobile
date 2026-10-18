/**
 * 容器/表面原语：图标底盒、卡片、胶囊标签。
 * 本层不认识业务枚举，语义色由调用方以 bg/fg 传入。
 */

import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, sizing, radius, spacing, typography } from './tokens';

/** 圆角图标底盒：列表行/空状态/卡片标题前的图标容器，默认 36×36。 */
export function IconBox({
  icon: Icon,
  size = sizing[36],
  tint = colors.sky,
  iconSize = sizing.iconMedium,
  iconColor = colors.ink,
}: {
  icon: LucideIcon;
  size?: number;
  tint?: string;
  iconSize?: number;
  iconColor?: string;
}) {
  return (
    <View style={[styles.iconBox, { width: size, height: size, backgroundColor: tint }]}>
      <Icon size={iconSize} color={iconColor} />
    </View>
  );
}

/** 白底大圆角卡片：所有页面内容容器的基本形态。 */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** 小胶囊标签：分类、附注等中性标注；带色语义标注请用 Badge。 */
export function Chip({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <View style={[styles.chip, tint ? { backgroundColor: tint } : null]}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

/**
 * 语义色胶囊：与 Chip 同形，额外要求调用方给出前景色。
 * label 同时作为读屏文案，故无障碍语义不依赖颜色本身。
 */
export function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.chip, { backgroundColor: bg }]}
    >
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  iconBox: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.iconBox,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing[20],
  },
  chip: {
    paddingHorizontal: spacing[10],
    paddingVertical: spacing.xs,
    borderRadius: radius.chip,
    alignSelf: 'flex-start',
    backgroundColor: colors.canvas,
  },
  chipText: { ...typography.chip, fontWeight: '600', color: colors.muted },
});
