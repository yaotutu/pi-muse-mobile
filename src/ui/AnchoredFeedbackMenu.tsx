/**
 * 聊天消息与新闻共用的短菜单外观。调用方持有 Modal、目标和写入状态；这里仅处理
 * window 锚点、安全区、入场动画、遮罩、反应按钮及菜单行，不接管业务生命周期。
 */
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { themeTokens, sizing, spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/types';
import { positionFeedbackMenu, type MenuRect } from './menu-position';
import { useReducedMotion } from './use-reduced-motion';

const { messageFeedback: m, radius: r, typography: t } = themeTokens;

export function AnchoredFeedbackMenu({ anchor, align, dismissLabel, onDismiss, testID, children }: {
  anchor: MenuRect | null; align: 'left' | 'right'; dismissLabel: string;
  onDismiss: () => void; testID: string; children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [viewport, setViewport] = useState({ width: window.width, height: window.height });
  const [menuHeight, setMenuHeight] = useState<number>(m.initialMenuHeight);
  const reveal = useSharedValue(0);

  useEffect(() => {
    reveal.value = reducedMotion ? 1 : withTiming(1, { duration: m.revealDuration });
  }, [reducedMotion, reveal]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: m.revealScale + (1 - m.revealScale) * reveal.value }],
  }));
  const position = anchor ? positionFeedbackMenu(
    anchor, { width: m.menuWidth, height: menuHeight }, viewport, insets,
    align, m.anchorGap, m.screenMargin,
    // Android Fabric 测得应用窗口坐标；透明全屏 Modal 从状态栏上方开始。
    Platform.OS === 'android' ? insets.top : 0,
  ) : { x: 0, y: 0 };

  return <View style={styles.overlay} onLayout={(event) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== viewport.width || height !== viewport.height) setViewport({ width, height });
  }}>
    <Pressable accessibilityRole="button" accessibilityLabel={dismissLabel} onPress={onDismiss}
      style={StyleSheet.absoluteFill} />
    <Animated.View accessibilityViewIsModal testID={testID}
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height;
        if (height !== menuHeight) setMenuHeight(height);
      }}
      style={[styles.context, revealStyle, { left: position.x, top: position.y,
        maxHeight: viewport.height - insets.top - insets.bottom - m.screenMargin * 2 }]}>
      {children}
    </Animated.View>
  </View>;
}

export function FeedbackReactionPill({ reaction, locked, busy, subjectLabel, align = 'left', onReaction,
  likeTestID, dislikeTestID }: {
  reaction: 'like' | 'dislike' | null; locked: boolean; busy: boolean; subjectLabel: string;
  align?: 'left' | 'right'; onReaction: (reaction: 'like' | 'dislike') => void;
  likeTestID?: string; dislikeTestID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={[styles.reactionPill, align === 'right' && styles.reactionPillRight]}>
    {(['like', 'dislike'] as const).map((value) => <Pressable key={value} accessibilityRole="button"
      accessibilityLabel={reaction === value ? `撤销${value === 'like' ? '喜欢' : '不喜欢'}` : `${value === 'like' ? '喜欢' : '不喜欢'}${subjectLabel}`}
      accessibilityState={{ selected: reaction === value, disabled: locked, busy }}
      disabled={locked} onPress={() => onReaction(value)} testID={value === 'like' ? likeTestID : dislikeTestID}
      style={({ pressed }) => [styles.reactionButton, reaction === value && styles.selected,
        pressed && styles.pressed, locked && styles.disabled]}>
      <Text style={styles.reactionEmoji}>{value === 'like' ? '👍' : '👎'}</Text>
    </Pressable>)}
  </View>;
}

export function FeedbackMenuRows({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={styles.actionMenu}>{children}</View>;
}

export function FeedbackMenuRow({ icon: Icon, label, text, onPress, testID, selected = false, disabled = false }: {
  icon: LucideIcon; label: string; text: string; onPress: () => void;
  testID?: string; selected?: boolean; disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.actionRow, selected && styles.selected,
      pressed && styles.pressed, disabled && styles.disabled]}>
    <Icon size={sizing.iconMedium} color={colors.ink} />
    <Text style={styles.actionText}>{text}</Text>
  </Pressable>;
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  pressed: { opacity: themeTokens.interaction.pressedOpacity },
  disabled: { opacity: themeTokens.interaction.disabledOpacity },
  selected: { backgroundColor: c.blueSoft },
  overlay: { flex: 1, backgroundColor: c.scrim },
  context: { position: 'absolute', width: m.menuWidth, gap: spacing[8], elevation: m.elevation },
  reactionPill: { alignSelf: 'flex-start', flexDirection: 'row', padding: spacing[4],
    borderRadius: r.round, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, backgroundColor: c.canvas },
  reactionPillRight: { alignSelf: 'flex-end' },
  reactionButton: { width: m.reactionSize, height: m.reactionSize, alignItems: 'center',
    justifyContent: 'center', borderRadius: r.round },
  reactionEmoji: { fontSize: m.reactionEmojiSize },
  actionMenu: { borderRadius: r.field, borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.line, backgroundColor: c.canvas, overflow: 'hidden' },
  actionRow: { minHeight: m.actionHeight, flexDirection: 'row', gap: spacing[12],
    alignItems: 'center', paddingHorizontal: spacing[16] },
  actionText: { ...t.detail, color: c.ink },
});
