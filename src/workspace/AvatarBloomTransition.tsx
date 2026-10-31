/**
 * 虚拟形象向外扩散过渡容器。
 * 点击虚拟形象时，从虚拟形象中心向外优雅展开全屏背景，
 * 顶栏控制（关闭按钮与主题切换）与会话面板内容柔和就位；
 * 点击关闭时，全部元素平滑收拢回虚拟形象中心。
 * 使用 react-native-reanimated 驱动高性能原生过渡。
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export interface AvatarBloomTransitionProps {
  open: boolean;
  reducedMotion?: boolean;
  avatarCenterX: number;
  avatarCenterY: number;
  bloomRadius?: number;
  targetScale: number;
  canvasColor: string;
  accentColor?: string;
  headerLeft: ReactNode;
  headerCenter: ReactNode;
  headerRight: ReactNode;
  headerHeight: number;
  headerTop: number;
  sidePadding: number;
  renderSurface?: (children: ReactNode) => ReactNode;
  children: ReactNode;
  onCloseComplete: () => void;
  onBackdropPress?: () => void;
  testID?: string;
}

// 采用 iOS 经典流体缓动曲线，带来优雅、从容、高级的展开体验
const appleFluidEaseOut = Easing.bezier(0.16, 1, 0.3, 1);
const appleFluidEaseInOut = Easing.bezier(0.25, 1, 0.5, 1);

export function AvatarBloomTransition({
  open,
  reducedMotion = false,
  avatarCenterX,
  avatarCenterY,
  bloomRadius = 50,
  targetScale,
  canvasColor,
  headerLeft,
  headerCenter,
  headerRight,
  headerHeight,
  headerTop,
  sidePadding,
  renderSurface,
  children,
  onCloseComplete,
  onBackdropPress,
  testID = 'workspace-session-modal',
}: AvatarBloomTransitionProps) {
  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dy > 0) {
            dragY.value = gesture.dy;
          }
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 90 || gesture.vy > 0.8) {
            onBackdropPress?.();
          } else {
            dragY.value = withTiming(0, { duration: 200, easing: appleFluidEaseOut });
          }
        },
        onPanResponderTerminate: () => {
          dragY.value = withTiming(0, { duration: 200, easing: appleFluidEaseOut });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onBackdropPress],
  );

  useEffect(() => {
    if (open) {
      dragY.value = 0;
      if (reducedMotion) {
        progress.value = 1;
      } else {
        progress.value = withTiming(1, {
          duration: 400,
          easing: appleFluidEaseOut,
        });
      }
    } else {
      if (reducedMotion) {
        progress.value = 0;
        onCloseComplete();
      } else {
        progress.value = withTiming(
          0,
          {
            duration: 320,
            easing: appleFluidEaseInOut,
          },
          (finished) => {
            if (finished) {
              runOnJS(onCloseComplete)();
            }
          },
        );
      }
    }
  }, [open, reducedMotion, onCloseComplete, progress, dragY]);

  const bloomCircleStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1], [0.85, targetScale], Extrapolation.CLAMP);
    return {
      transform: [{ scale }],
      opacity: 0,
    };
  });

  const backdropStyle = useAnimatedStyle(() => {
    const baseOpacity = interpolate(progress.value, [0, 1], [0, 0.45], Extrapolation.CLAMP);
    const dragFade = interpolate(dragY.value, [0, 300], [1, 0.2], Extrapolation.CLAMP);
    return {
      opacity: baseOpacity * dragFade,
    };
  });

  const surfaceWrapStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.15, 1], [0, 0.7, 1], Extrapolation.CLAMP);
    const baseTranslateY = interpolate(progress.value, [0, 1], [380, 0], Extrapolation.CLAMP);
    const translateY = Math.max(0, baseTranslateY + dragY.value);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const headerLeftStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.3, 1], [0, 0.4, 1], Extrapolation.CLAMP);
    const translateX = interpolate(progress.value, [0, 1], [-8, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateX }],
    };
  });

  const headerRightStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.3, 1], [0, 0.4, 1], Extrapolation.CLAMP);
    const translateX = interpolate(progress.value, [0, 1], [8, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateX }],
    };
  });

  const contentStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.25, 1], [0, 0.4, 1], Extrapolation.CLAMP);
    const translateY = interpolate(progress.value, [0, 1], [-24, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const bloomLeft = Math.round(avatarCenterX - bloomRadius);
  const bloomTop = Math.round(avatarCenterY - bloomRadius);
  const bloomDiameter = bloomRadius * 2;

  const innerContent = (
    <View style={styles.sheetInner}>
      <View {...panResponder.panHandlers} style={styles.grabberArea}>
        <View style={styles.grabber} />
      </View>
      <View {...panResponder.panHandlers} style={[styles.header, { height: headerHeight, marginTop: headerTop, marginHorizontal: sidePadding }]}>
        <Animated.View style={[styles.headerLeft, headerLeftStyle]}>{headerLeft}</Animated.View>
        <View style={styles.headerCenter}>{headerCenter}</View>
        <Animated.View style={[styles.headerRight, headerRightStyle]}>{headerRight}</Animated.View>
      </View>
      <Animated.View style={[styles.contentWrap, contentStyle]}>{children}</Animated.View>
    </View>
  );

  return (
    <Animated.View style={styles.layer} testID={testID}>
      <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.backdrop, backdropStyle]}>
        {onBackdropPress && <Pressable style={StyleSheet.absoluteFill} onPress={onBackdropPress} accessibilityLabel="关闭会话面板背景" />}
      </Animated.View>
      {/* 虚拟形象中心向外优雅展开的全屏背景底色 */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.bloomDisk,
          {
            left: bloomLeft,
            top: bloomTop,
            width: bloomDiameter,
            height: bloomDiameter,
            borderRadius: bloomRadius,
            backgroundColor: canvasColor,
          },
          bloomCircleStyle,
        ]}
      />
      <Animated.View style={[styles.surfaceWrap, surfaceWrapStyle]}>
        {renderSurface ? renderSurface(innerContent) : innerContent}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', zIndex: 10, elevation: 10 },
  bloomDisk: { position: 'absolute' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  surfaceWrap: {
    flex: 1,
    marginTop: 44,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128, 128, 128, 0.25)',
  },
  grabberArea: {
    paddingTop: 10,
    paddingBottom: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetInner: { flex: 1 },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128, 128, 128, 0.35)',
  },
  header: { flexShrink: 0 },
  headerLeft: { position: 'absolute', top: 0, left: 0 },
  headerCenter: { alignSelf: 'center', alignItems: 'center' },
  headerRight: { position: 'absolute', top: 0, right: 0, flexDirection: 'row' },
  contentWrap: { flex: 1 },
});
