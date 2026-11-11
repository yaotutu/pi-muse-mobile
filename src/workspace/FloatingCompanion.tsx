import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { CompanionImages, CompanionState } from '../companion/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme } from '../ui/tokens';
import { useReducedMotion } from '../ui/use-reduced-motion';
import { ArrowLeft } from 'lucide-react-native';
import { IconControl } from '../ui/IconControl';
import { MuseCompanion } from './MuseCompanion';
import { COMPANION_SIZE, COMPANION_TOP, COMPANION_STATUS_GAP, COMPANION_STATUS_LINE_HEIGHT, COMPANION_STATUS_PADDING,
  COMPANION_TRANSITION_MS, companionContentInset, companionSurfaceGeometry } from './companion-layout';

/** 同一个人物、同一个顶部锚点。仅展开柔和表面和内容，不重挂人物或下层聊天。 */
export function FloatingCompanion({ state, images, offline, statusLabel, visible, expanded, presented, onToggle, onCollapsed, onReturnArticle, children }: {
  state: CompanionState;
  images: CompanionImages;
  offline: boolean;
  statusLabel: string;
  visible: boolean;
  expanded: boolean;
  /** 反向动画结束前仍隔离下层触控/读屏，不能提前把关闭中的界面穿透给聊天。 */
  presented: boolean;
  onToggle: () => void;
  onCollapsed: () => void;
  onReturnArticle?: () => void;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const { width, height, fontScale } = useWindowDimensions();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const generation = useRef(0);
  const finishCollapse = useCallback((version: number) => {
    // UI -> JS 回调可能晚于下一次点击；旧完成回调不能拆掉已重新展开的内容。
    if (generation.current === version) onCollapsed();
  }, [onCollapsed]);
  useLayoutEffect(() => {
    const version = ++generation.current;
    cancelAnimation(progress);
    if (reduced || !visible) {
      progress.value = expanded && visible ? 1 : 0;
      if (!expanded) finishCollapse(version);
    } else {
      progress.value = withTiming(expanded ? 1 : 0, { duration: COMPANION_TRANSITION_MS, easing: Easing.inOut(Easing.quad) }, (finished) => {
        if (finished && !expanded) runOnJS(finishCollapse)(version);
      });
    }
    return () => { generation.current = version + 1; cancelAnimation(progress); };
  }, [expanded, visible, reduced, progress, finishCollapse]);
  const surfaceStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value * 4), transform: [{ scale: progress.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: progress.value, transform: [{ translateY: (1 - progress.value) * spacing[8] }],
  }));
  const surface = companionSurfaceGeometry(width, height);
  const contentTop = companionContentInset(fontScale);
  return <View pointerEvents={!visible ? 'none' : presented ? 'auto' : 'box-none'}
    accessibilityViewIsModal={visible && presented} accessibilityElementsHidden={!visible}
    importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    style={[styles.root, !visible && styles.hidden]} testID="workspace-companion-overlay">
    {/* 中性柔和实色降级，不声称 blur，也不为模糊重新包裹/挂载 ConversationHost。 */}
    <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      style={[styles.surface, { width: surface.diameter, height: surface.diameter, borderRadius: surface.diameter / 2,
        left: surface.left, top: surface.top, backgroundColor: colors.panelVeil }, surfaceStyle]} />
    <View pointerEvents="box-none" style={styles.anchor}>
      {/* 人物与紧贴的短状态为唯一入口；完整事实只朗读一次，文字可截短但不截断 a11y。 */}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
        accessibilityLabel={`Pi Muse 形象：${statusLabel}，${expanded ? '收起形象展开态' : '打开主聊天操作'}`}
        onPress={onToggle} style={styles.entry} testID="workspace-avatar-status">
        <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <MuseCompanion state={state} size={COMPANION_SIZE} offline={offline} images={images} />
        </View>
        <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.status, { maxWidth: Math.min(220, width - spacing[12] * 2), backgroundColor: colors.floatingSurface, borderColor: colors.floatingLine }]}>
          <Text accessible={false} numberOfLines={1} ellipsizeMode="tail" style={[styles.statusText, { color: colors.ink }]}>{statusLabel}</Text>
        </View>
      </Pressable>
    </View>
    {/* 文章来源返回独立放在左上角，固定48dp命中区；不把额外一行压到短对话起排空间里。 */}
    {!presented && onReturnArticle && <IconControl icon={ArrowLeft} label="返回文章" onPress={onReturnArticle}
      testID="workspace-return-article" style={styles.returnArticle} />}
    <Animated.View pointerEvents={presented ? 'auto' : 'none'} accessibilityElementsHidden={!presented}
      importantForAccessibility={presented ? 'auto' : 'no-hide-descendants'}
      style={[styles.content, { top: contentTop }, contentStyle]} testID="workspace-companion-expanded">
      {/* 关闭中保留原内容，只有当前代次反向动画完成后才释放审批/活动读取。 */}
      {presented && <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.contentContainer}>
        {children}
      </ScrollView>}
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1, overflow: 'hidden' },
  hidden: { display: 'none' },
  surface: { position: 'absolute' },
  anchor: { position: 'absolute', top: COMPANION_TOP, left: spacing[12], right: spacing[12], alignItems: 'center', gap: spacing[8] },
  entry: { alignItems: 'center', maxWidth: '100%', minWidth: workspaceTheme.layout.controlSize, minHeight: workspaceTheme.layout.controlSize, gap: COMPANION_STATUS_GAP },
  status: { maxWidth: '100%', borderRadius: workspaceTheme.radius.round, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[12], paddingVertical: COMPANION_STATUS_PADDING },
  statusText: { fontSize: 12, lineHeight: COMPANION_STATUS_LINE_HEIGHT, flexShrink: 1 },
  returnArticle: { position: 'absolute', top: COMPANION_TOP, left: spacing[12], minHeight: workspaceTheme.layout.controlSize },
  content: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  contentContainer: { flexGrow: 1, padding: spacing[16], gap: spacing[12], width: '100%', maxWidth: workspaceTheme.layout.maxWidth, alignSelf: 'center' },
});
