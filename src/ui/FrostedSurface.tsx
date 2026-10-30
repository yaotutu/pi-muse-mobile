/**
 * 会话面板的模糊底层。Android 只采样调用方明确传入的 BlurTargetView，
 * BlurView 必须是目标的后续兄弟节点，避免采样自身或重新挂载聊天。
 */
import { BlurView } from 'expo-blur';
import { type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View, type ViewInstance } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { themeTokens } from '../theme/tokens';

export function FrostedSurface({ blurTarget, children }: {
  blurTarget: RefObject<ViewInstance | null>;
  children: ReactNode;
}) {
  const { appearance, colors } = useTheme();
  return <View style={styles.root}>
    <BlurView
      blurTarget={blurTarget}
      blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
      intensity={themeTokens.material.panelBlurIntensity}
      tint={appearance}
      style={styles.blur}
    />
    {/* 高覆盖率语义填充保证长消息不会透出干扰面板阅读；模糊仍采样真实聊天。 */}
    <View pointerEvents="none" style={[styles.veil, { backgroundColor: colors.panelVeil }]} />
    <View style={styles.content}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  blur: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  veil: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  content: { flex: 1 },
});
