/**
 * 按钮原语。纯交互/纯展示：不持有业务状态，不发请求。
 * 与工作区共用胶囊几何和亮暗主题，不持有业务状态。
 */

import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { sizing, spacing, workspaceTheme } from './tokens';
import { useTheme } from '../theme/ThemeProvider';

/** 主按钮使用独立白色前景；次按钮与危险动作使用语义表面色。 */
export function Button({
  children,
  onPress,
  icon: Icon,
  primary,
  disabled,
  busy,
  small,
  danger,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  icon?: LucideIcon;
  /** 主形态：蓝色底与白色前景 */
  primary?: boolean;
  disabled?: boolean;
  /** 忙态：图标位换成 spinner 并禁点 */
  busy?: boolean;
  small?: boolean;
  danger?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const color = primary ? colors.onAccent : danger ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      aria-disabled={!!(disabled || busy)} aria-busy={!!busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? colors.blue : danger ? colors.dangerSoft : colors.control },
        small && styles.buttonSmall,
        (disabled || busy) && { opacity: workspaceTheme.interaction.disabledOpacity },
        pressed && { opacity: workspaceTheme.interaction.pressedOpacity },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} size="small" />
      ) : Icon ? (
        <Icon size={sizing[15]} color={color} />
      ) : null}
      <Text style={[styles.buttonText, { color }]}>{children}</Text>
    </Pressable>
  );
}

/** 44×44 圆形图标按钮：顶栏动作、Sheet 关闭等命中区敏感的位置用。 */
export function IconButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  /** 无障碍标签（盲用读屏依赖，必填） */
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: pressed ? colors.selected : colors.control },
      ]}
    >
      <Icon size={sizing[20]} strokeWidth={1.8} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /** Button 底座：胶囊形，内容横排居中 */
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing[17],
    minHeight: workspaceTheme.layout.smallControl,
    paddingVertical: spacing[10],
    borderRadius: workspaceTheme.radius.round,
  },
  buttonSmall: { minHeight: workspaceTheme.layout.smallControl, paddingVertical: spacing[7], paddingHorizontal: spacing[13] },
  buttonText: { ...workspaceTheme.typography.status, fontWeight: '500' },
  /** IconButton：保留 44×44 触控命中区。 */
  iconButton: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: workspaceTheme.radius.round,
  },
});
