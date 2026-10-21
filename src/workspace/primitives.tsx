/**
 * 工作区视觉原语：只负责外观与交互反馈，不读业务 store、不发请求。
 * 所有页面与根级更新弹层共用同一个主题；状态色仅强调调用方给出的事实。
 */
import { type LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { museAvatar as a, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
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

/** 原创矢量角色，在原生/离线下同样清晰；不依赖远程图片或参考产品素材。 */
export function MuseAvatar({ size = l.headerAvatar }: { size?: number }) {
  return <View accessibilityRole="image" accessibilityLabel="Pi Muse 头像" style={{ width: size, height: size, borderRadius: r.round, overflow: 'hidden' }}>
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Defs><LinearGradient id="muse-bg" x1="0" y1="0" x2="1" y2="1"><Stop stopColor={a.highlight} /><Stop offset="1" stopColor={a.background} /></LinearGradient>
        <LinearGradient id="muse-body" x1="0" y1="0" x2="1" y2="1"><Stop stopColor={a.highlight} /><Stop offset="1" stopColor={a.body} /></LinearGradient></Defs>
      <Circle cx="60" cy="60" r="60" fill="url(#muse-bg)" />
      <Circle cx="92" cy="27" r="24" fill={a.glint} />
      <Ellipse cx="60" cy="103" rx="41" ry="8" fill={a.shadow} opacity="0.28" />
      <Path d="M23 94C21 73 24 31 44 23C66 14 87 34 86 59L91 99C72 112 40 113 23 94Z" fill="url(#muse-body)" />
      <Ellipse cx="55" cy="53" rx="24" ry="23" fill={a.face} />
      <Ellipse cx="47" cy="52" rx="2.2" ry="3" fill={a.eye} /><Ellipse cx="63" cy="52" rx="2.2" ry="3" fill={a.eye} />
      <Path d="M51 62Q55 66 59 62" fill="none" stroke={a.eye} strokeWidth="1.5" strokeLinecap="round" />
      <Ellipse cx="39" cy="59" rx="4" ry="2" fill={a.blush} opacity="0.65" /><Ellipse cx="70" cy="59" rx="4" ry="2" fill={a.blush} opacity="0.65" />
      <Path d="M26 55C23 13 84 9 86 57" fill="none" stroke={a.headphones} strokeWidth="5" strokeLinecap="round" />
      <Rect x="20" y="44" width="10" height="24" rx="5" fill={a.headphones} /><Rect x="80" y="44" width="10" height="24" rx="5" fill={a.headphones} />
      <Path d="M36 83Q46 90 62 92" fill="none" stroke={a.body} strokeWidth="12" strokeLinecap="round" />
      <Path d="M66 75L105 70L97 101L58 101Z" fill={a.computer} stroke={a.computerEdge} strokeWidth="1" strokeLinejoin="round" />
      <Circle cx="82" cy="86" r="2.5" fill={a.glint} opacity="0.7" /><Path d="M52 102H99" stroke={a.computerEdge} strokeWidth="3" strokeLinecap="round" />
    </Svg>
  </View>;
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
