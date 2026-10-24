/**
 * 工作区视觉原语：只负责外观与交互反馈，不读业务 store、不发请求。
 * 所有页面与根级更新弹层共用同一个主题；状态色仅强调调用方给出的事实。
 */
import { type LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { useReducedMotion } from '../ui/use-reduced-motion';
export { useReducedMotion } from '../ui/use-reduced-motion';

const { layout: l, radius: r, typography: t } = workspaceTheme;
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

export function IconControl({ icon: Icon, label, onPress, testID, disabled, small, style }: {
  icon: LucideIcon; label: string; onPress: () => void; testID?: string;
  disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme(); const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.control, small && styles.smallControl, pressed && styles.pressed, disabled && styles.disabled, style]}>
    <Icon size={small ? l.iconSize - spacing[4] : l.iconSize} strokeWidth={1.7} color={colors.ink} />
  </Pressable>;
}

/** 头像为打包进应用的原创位图；会话信息区和面板共用同一离线资源。 */
export function MuseAvatar({ size = l.headerAvatar }: { size?: number }) {
  return <Image accessible accessibilityRole="image" accessibilityLabel="Pi Muse 头像"
    source={require('../../assets/images/muse-companion.png')} resizeMode="cover"
    style={{ width: size, height: size, borderRadius: size / 2 }} />;
}

export function StatusPill({ label, tone = 'neutral', dot = true }: { label: string; tone?: StatusTone; dot?: boolean }) {
  const { colors: c } = useTheme(); const styles = useStyles();
  const foreground = { neutral: c.muted, success: c.success, warning: c.warning, danger: c.danger, accent: c.accentText }[tone];
  const background = { neutral: c.surface, success: c.successSoft, warning: c.warningSoft, danger: c.dangerSoft, accent: c.blueSoft }[tone];
  return <View style={[styles.status, { backgroundColor: background }]}>
    {dot && <View style={[styles.dot, { backgroundColor: foreground }]} />}
    <Text numberOfLines={1} style={[styles.statusText, { color: foreground }]}>{label}</Text>
  </View>;
}

export function SectionHeading({ title, eyebrow, description }: { title: string; eyebrow?: string; description?: string }) {
  const styles = useStyles();
  return <View style={styles.heading}>
    {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    {!!description && <Text style={styles.description}>{description}</Text>}
  </View>;
}

export function EmptyState({ icon: Icon, title, description, compact }: { icon: LucideIcon; title: string; description?: string; compact?: boolean }) {
  const { colors } = useTheme(); const styles = useStyles();
  return <View style={[styles.empty, compact && styles.emptyCompact]}>
    <View style={styles.emptyIcon}><Icon size={l.iconSize} color={colors.muted} strokeWidth={1.4} /></View>
    <Text style={styles.emptyTitle}>{title}</Text>
    {!!description && <Text style={styles.emptyDescription}>{description}</Text>}
  </View>;
}

/** 只有真实流仍在运行时才挂载；减少动态效果时保持静态，不用动画冒充进度。 */
export function TypingIndicator() {
  const reduced = useReducedMotion(); const styles = useStyles();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) { progress.setValue(0); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: workspaceTheme.motion.pulseDuration, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: workspaceTheme.motion.pulseDuration, useNativeDriver: true }),
    ]));
    animation.start(); return () => animation.stop();
  }, [progress, reduced]);
  return <View accessible accessibilityLabel="正在生成回复" style={styles.typing}>
    {[0, 1, 2].map((index) => <Animated.View key={index} style={[styles.typingDot, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: index === 1 ? [1, workspaceTheme.interaction.disabledOpacity] : [workspaceTheme.interaction.disabledOpacity, 1] }) }]} />)}
  </View>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  control: { width: l.controlSize, height: l.controlSize, borderRadius: r.round, backgroundColor: c.control, alignItems: 'center', justifyContent: 'center' },
  smallControl: { width: l.smallControl, height: l.smallControl },
  pressed: { opacity: workspaceTheme.interaction.pressedOpacity }, disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
  status: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing[6], paddingHorizontal: spacing[10], paddingVertical: spacing[4], borderRadius: r.round, maxWidth: l.statusMaxWidth },
  dot: { width: l.stateDotSize - spacing[2], height: l.stateDotSize - spacing[2], borderRadius: r.round },
  statusText: { ...t.caption, flexShrink: 1 }, heading: { gap: spacing[8] },
  eyebrow: { ...t.eyebrow, color: c.faint }, title: { ...t.section, color: c.ink }, description: { ...t.caption, color: c.faint },
  empty: { minHeight: l.emptyMinHeight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[24], paddingVertical: spacing[34], gap: spacing[12] },
  emptyCompact: { minHeight: 0, paddingVertical: spacing[24] },
  emptyIcon: { width: l.emptyIcon, height: l.emptyIcon, backgroundColor: c.surface, borderRadius: r.round, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[4] },
  emptyTitle: { ...t.itemTitle, color: c.ink, textAlign: 'center' }, emptyDescription: { ...t.caption, color: c.faint, textAlign: 'center', maxWidth: l.drawerMaxWidth },
  typing: { width: l.typingWidth, height: l.typingHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[7], backgroundColor: c.surface, borderRadius: r.round, alignSelf: 'flex-start' },
  typingDot: { width: l.typingDotSize, height: l.typingDotSize, backgroundColor: c.muted, borderRadius: r.round },
});
