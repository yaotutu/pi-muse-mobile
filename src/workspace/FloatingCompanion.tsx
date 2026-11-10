import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompanionImages, CompanionState } from '../companion/types';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, workspaceTheme } from '../ui/tokens';
import { MuseCompanion } from './MuseCompanion';

/** 仅局部岛面承接触控；绝对定位不为聊天列表或键盘布局预留标题栏。 */
export function FloatingCompanion({ state, images, offline, statusLabel, onPress, onReturnArticle }: {
  state: CompanionState;
  images: CompanionImages;
  offline: boolean;
  statusLabel: string;
  onPress: () => void;
  onReturnArticle?: () => void;
}) {
  const { colors } = useTheme();
  const surface = { backgroundColor: colors.surface, borderColor: colors.line, shadowColor: colors.ink };
  return <View pointerEvents="box-none" style={styles.overlay} testID="workspace-companion-overlay">
    <Pressable accessibilityRole="button" accessibilityLabel={`Pi Muse 形象：${statusLabel}，打开主聊天操作`}
      onPress={onPress} testID="workspace-avatar-status"
      style={({ pressed }) => [styles.island, surface, pressed && { backgroundColor: colors.selected }]}>
      {/* 形象与可见短状态由整个岛面统一朗读，避免嵌套按钮及截断的无障碍状态。 */}
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.identity}>
        <MuseCompanion state={state} size={sizing[64]} offline={offline} images={images} />
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.status, { color: colors.muted }]}>{statusLabel}</Text>
      </View>
    </Pressable>
    {/* 返回入口另占局部命中区并按实际高度向下排列，大字体和窄屏不与岛面相叠。 */}
    {onReturnArticle && <Pressable accessibilityRole="button" accessibilityLabel="返回文章" onPress={onReturnArticle}
      testID="workspace-return-article" style={({ pressed }) => [styles.returnArticle, surface, pressed && { backgroundColor: colors.selected }]}>
      <Text style={[styles.returnLabel, { color: colors.ink }]}>返回文章</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: spacing[8], left: spacing[12], right: spacing[12],
    alignItems: 'center', gap: spacing[8], zIndex: 1,
  },
  island: {
    width: sizing[140], maxWidth: '100%', minHeight: workspaceTheme.layout.controlSize,
    padding: spacing[8], borderRadius: workspaceTheme.radius.card, borderWidth: sizing.borderWidth,
    shadowOffset: { width: 0, height: spacing[2] }, shadowOpacity: 0.14, shadowRadius: spacing[6], elevation: 4,
  },
  identity: { alignItems: 'center', gap: spacing[2] },
  status: { ...workspaceTheme.typography.caption, textAlign: 'center', alignSelf: 'stretch' },
  returnArticle: {
    minHeight: workspaceTheme.layout.controlSize, maxWidth: '100%', justifyContent: 'center',
    paddingHorizontal: spacing[16], paddingVertical: spacing[8],
    borderRadius: workspaceTheme.radius.round, borderWidth: sizing.borderWidth,
  },
  returnLabel: { ...workspaceTheme.typography.caption, textAlign: 'center' },
});
