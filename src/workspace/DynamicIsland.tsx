import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { MuseAvatar } from './primitives';

export interface DynamicIslandProps {
  spaceId: string;
  spaceTitle: string;
  running: boolean;
  synchronized: boolean;
  runtimeLabel: string;
  pendingApprovals: number;
  keyboardVisible?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityHint?: string;
  testID?: string;
}

/** 极轻量原生驱动微动效音波柱：AI 正在执行/抓取时动态律动。 */
function WaveBars({ color }: { color: string }) {
  const [anim1] = useState(() => new Animated.Value(0.35));
  const [anim2] = useState(() => new Animated.Value(1));
  const [anim3] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    const loop1 = Animated.loop(
      Animated.sequence([
        Animated.timing(anim1, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim1, { toValue: 0.3, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    const loop2 = Animated.loop(
      Animated.sequence([
        Animated.timing(anim2, { toValue: 0.25, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim2, { toValue: 1, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    const loop3 = Animated.loop(
      Animated.sequence([
        Animated.timing(anim3, { toValue: 1, duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim3, { toValue: 0.35, duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop1.start();
    loop2.start();
    loop3.start();
    return () => {
      loop1.stop();
      loop2.stop();
      loop3.stop();
    };
  }, [anim1, anim2, anim3]);

  return (
    <View style={styles.waveWrap}>
      <Animated.View style={[styles.waveBar, { backgroundColor: color, transform: [{ scaleY: anim1 }] }]} />
      <Animated.View style={[styles.waveBar, { backgroundColor: color, transform: [{ scaleY: anim2 }] }]} />
      <Animated.View style={[styles.waveBar, { backgroundColor: color, transform: [{ scaleY: anim3 }] }]} />
    </View>
  );
}

export function DynamicIsland({
  spaceTitle,
  running,
  synchronized,
  runtimeLabel,
  pendingApprovals,
  keyboardVisible = false,
  disabled = false,
  onPress,
  accessibilityHint,
  testID = 'workspace-open-session',
}: DynamicIslandProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const hasApprovals = pendingApprovals > 0;
  const isRunning = running;
  const isSync = synchronized;

  // 胶囊外轮廓的呼吸动画（在待审批或执行中时优雅脉动）
  const [pulseAnim] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (isRunning || hasApprovals) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
    pulseAnim.setValue(1);
    return undefined;
  }, [isRunning, hasApprovals, pulseAnim]);

  const avatarSize = keyboardVisible ? 22 : 26;

  // 确定文案与视觉状态
  let stateTitle = spaceTitle;
  if (!stateTitle.startsWith('Muse') && !stateTitle.includes('Muse')) {
    stateTitle = `Muse · ${stateTitle}`;
  }

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="打开当前会话面板"
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        testID={testID}
        onPress={onPress}
        style={({ pressed }) => [
          styles.capsule,
          keyboardVisible && styles.capsuleCompact,
          hasApprovals
            ? styles.capsuleWarning
            : isRunning
              ? styles.capsuleRunning
              : !isSync
                ? styles.capsuleMuted
                : styles.capsuleIdle,
          pressed && styles.pressed,
        ]}
      >
        <MuseAvatar size={avatarSize} />

        {hasApprovals ? (
          <View style={styles.contentRow}>
            <AlertTriangle size={13} color={colors.warning} />
            <Text numberOfLines={1} style={[styles.label, { color: colors.warning }]}>
              {pendingApprovals} 项待审批
            </Text>
          </View>
        ) : isRunning ? (
          <View style={styles.contentRow}>
            <Text numberOfLines={1} style={[styles.label, { color: colors.blue }]}>
              {runtimeLabel || '正在执行…'}
            </Text>
            <WaveBars color={colors.blue} />
          </View>
        ) : !isSync ? (
          <View style={styles.contentRow}>
            <View style={[styles.dot, { backgroundColor: colors.warning }]} />
            <Text numberOfLines={1} style={[styles.label, { color: colors.faint }]}>
              未同步
            </Text>
          </View>
        ) : (
          <View style={styles.contentRow}>
            <Text numberOfLines={1} style={[styles.label, { color: colors.ink }]}>
              {stateTitle}
            </Text>
            <View style={[styles.dot, { backgroundColor: colors.success }]} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  waveWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 12,
    paddingHorizontal: 2,
  },
  waveBar: {
    width: 2.2,
    height: 12,
    borderRadius: 1,
  },
});

const createStyles = (c: WorkspaceColors) =>
  StyleSheet.create({
    capsule: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[8],
      paddingLeft: spacing[6],
      paddingRight: spacing[12],
      height: 36,
      borderRadius: workspaceTheme.radius.round,
      borderWidth: 1.2,
      minWidth: 120,
      maxWidth: 240,
    },
    capsuleCompact: {
      height: 32,
      paddingLeft: spacing[4],
      paddingRight: spacing[10],
      gap: spacing[6],
    },
    capsuleIdle: {
      backgroundColor: c.surface,
      borderColor: c.line,
    },
    capsuleRunning: {
      backgroundColor: c.blueSoft,
      borderColor: c.blue,
      shadowColor: c.blue,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 2,
    },
    capsuleWarning: {
      backgroundColor: c.warningSoft,
      borderColor: c.warning,
      shadowColor: c.warning,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 2,
    },
    capsuleMuted: {
      backgroundColor: c.surface,
      borderColor: c.line,
      opacity: 0.8,
    },
    pressed: {
      opacity: workspaceTheme.interaction.pressedOpacity,
    },
    contentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[6],
    },
    label: {
      ...workspaceTheme.typography.status,
      fontSize: 13,
      fontWeight: '600',
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
  });
