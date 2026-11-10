import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompanionImages, CompanionState } from '../companion/types';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, workspaceTheme } from '../ui/tokens';
import { MuseCompanion } from './MuseCompanion';

/** 形象本体直接悬浮在聊天之上：无底座、无边框、无阴影；外层不拦截列表触控。 */
export function FloatingCompanion({ state, images, offline, statusLabel, onPress, onReturnArticle }: {
  state: CompanionState;
  images: CompanionImages;
  offline: boolean;
  statusLabel: string;
  onPress: () => void;
  onReturnArticle?: () => void;
}) {
  const { colors } = useTheme();
  return <View pointerEvents="box-none" style={styles.overlay} testID="workspace-companion-overlay">
    {/* 状态由八种姿态与整个可点击区域的完整无障碍标签表达，不再绘制底座或可见状态行。 */}
    <Pressable accessibilityRole="button" accessibilityLabel={`Pi Muse 形象：${statusLabel}，打开主聊天操作`}
      onPress={onPress} testID="workspace-avatar-status" style={styles.avatar}>
      <MuseCompanion state={state} size={sizing[64]} offline={offline} images={images} />
    </Pressable>
    {/* 文本按钮没有底色会不可读；返回入口仅新闻流程出现，保留紧凑局部样式。 */}
    {onReturnArticle && <Pressable accessibilityRole="button" accessibilityLabel="返回文章" onPress={onReturnArticle}
      testID="workspace-return-article" style={({ pressed }) => [styles.returnArticle, { backgroundColor: colors.surface, borderColor: colors.line }, pressed && { backgroundColor: colors.selected }]}>
      <Text style={[styles.returnLabel, { color: colors.ink }]}>返回文章</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: spacing[8], left: spacing[12], right: spacing[12],
    alignItems: 'center', gap: spacing[8], zIndex: 1,
  },
  avatar: { minHeight: workspaceTheme.layout.controlSize, alignItems: 'center', justifyContent: 'center' },
  returnArticle: {
    minHeight: workspaceTheme.layout.controlSize, maxWidth: '100%', justifyContent: 'center',
    paddingHorizontal: spacing[16], paddingVertical: spacing[8],
    borderRadius: workspaceTheme.radius.round, borderWidth: sizing.borderWidth,
  },
  returnLabel: { ...workspaceTheme.typography.caption, textAlign: 'center' },
});
