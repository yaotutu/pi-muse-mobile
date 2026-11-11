import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { CompanionImages, CompanionState } from '../companion/types';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, workspaceTheme } from '../ui/tokens';
import { ActionButton } from '../ui/ActionButton';
import { MuseCompanion } from './MuseCompanion';

/** 描边副本的 8 向偏移；tint 后极低透明度，只勾出形象轮廓，不形成底座。 */
const OUTLINE_OFFSETS: readonly (readonly [number, number])[] = [
  [-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, -2], [-2, 2], [2, 2],
];
/** 本体与描边副本共用同一尺寸，改一处理即整体生效。 */
const AVATAR_SIZE = sizing[64];

/** 形象本体直接悬浮在聊天之上：无底座、无边框，只有一圈很淡的轮廓增强分离；外层不拦截列表触控。 */
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
    {/* 唯一可聚焦元素：完整运行状态与操作说明只在这里朗读一次；姿态本体对无障碍隐藏。 */}
    <Pressable accessibilityRole="button" accessibilityLabel={`Pi Muse 形象：${statusLabel}，打开主聊天操作`}
      onPress={onPress} testID="workspace-avatar-status">
      {/* 轮廓副本静置在动效本体之下：本体呼吸/摇摆时描边不跟着抖。 */}
      {OUTLINE_OFFSETS.map(([x, y]) => <Image key={`${x}:${y}`} accessible={false} importantForAccessibility="no" source={images[state]}
        style={[styles.outline, { tintColor: colors.ink, opacity: 0.12, transform: [{ translateX: x }, { translateY: y }] }]} />)}
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MuseCompanion state={state} size={AVATAR_SIZE} offline={offline} images={images} />
      </View>
    </Pressable>
    {/* 返回文章是常规文字操作：直接复用共享药丸控件（自带悬浮语义色），仅新闻流程出现。 */}
    {onReturnArticle && <ActionButton label="返回文章" onPress={onReturnArticle} testID="workspace-return-article"
      style={styles.returnArticle} />}
  </View>;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: spacing[8], left: spacing[12], right: spacing[12],
    alignItems: 'center', gap: spacing[8], zIndex: 1,
  },
  outline: { position: 'absolute', width: AVATAR_SIZE, height: AVATAR_SIZE },
  returnArticle: { minHeight: workspaceTheme.layout.controlSize },
});
