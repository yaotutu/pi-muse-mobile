/**
 * 虚拟形象向外扩散过渡容器。
 * 点击虚拟形象时，从虚拟形象中心向外展开全屏背景与涟漪光环，
 * 顶栏控制（关闭按钮与主题切换）向两侧滑入，会话面板内容向下滑入展开；
 * 点击关闭时，全部元素平滑收拢回虚拟形象中心。
 * 使用 react-native-reanimated 驱动高性能原生过渡。
 */
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
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
  accentColor: string;
  headerLeft: ReactNode;
  headerCenter: ReactNode;
  headerRight: ReactNode;
  headerHeight: number;
  headerTop: number;
  sidePadding: number;
  renderSurface?: (children: ReactNode) => ReactNode;
  children: ReactNode;
  onCloseComplete: () => void;
  testID?: string;
}

export function AvatarBloomTransition({
  open,
  reducedMotion = false,
  avatarCenterX,
  avatarCenterY,
  bloomRadius = 50,
  targetScale,
  canvasColor,
  accentColor,
  headerLeft,
  headerCenter,
  headerRight,
  headerHeight,
  headerTop,
  sidePadding,
  renderSurface,
  children,
  onCloseComplete,
  testID = 'workspace-session-modal',
}: AvatarBloomTransitionProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (open) {
      if (reducedMotion) {
        progress.value = 1;
      } else {
        progress.value = withSpring(1, {
          damping: 18,
          stiffness: 110,
          mass: 0.8,
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
            duration: 250,
            easing: Easing.out(Easing.cubic),
          },
          (finished) => {
            if (finished) {
              runOnJS(onCloseComplete)();
            }
          },
        );
      }
    }
  }, [open, reducedMotion, onCloseComplete, progress]);

  const bloomCircleStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1], [0.8, targetScale], Extrapolation.CLAMP);
    return {
      transform: [{ scale }],
    };
  });

  const bloomRingStyle = useAnimatedStyle(() => {
    const scale = interpolate(progress.value, [0, 1], [0.8, targetScale * 1.05], Extrapolation.CLAMP);
    const opacity = interpolate(progress.value, [0, 0.15, 0.75, 1], [0, 0.7, 0.15, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  const surfaceWrapStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.6, 1], [0, 0.3, 1], Extrapolation.CLAMP);
    return {
      opacity,
    };
  });

  const headerLeftStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.3, 1], [0, 0.4, 1], Extrapolation.CLAMP);
    const translateX = interpolate(progress.value, [0, 1], [-28, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateX }],
    };
  });

  const headerRightStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.3, 1], [0, 0.4, 1], Extrapolation.CLAMP);
    const translateX = interpolate(progress.value, [0, 1], [28, 0], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateX }],
    };
  });

  const contentStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.3, 1], [0, 0.5, 1], Extrapolation.CLAMP);
    const translateY = interpolate(progress.value, [0, 1], [-40, 0], Extrapolation.CLAMP);
    const scale = interpolate(progress.value, [0, 1], [0.93, 1], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }, { scale }],
    };
  });

  const bloomLeft = Math.round(avatarCenterX - bloomRadius);
  const bloomTop = Math.round(avatarCenterY - bloomRadius);
  const bloomDiameter = bloomRadius * 2;

  const innerContent = (
    <>
      <View style={[styles.header, { height: headerHeight, marginTop: headerTop, marginHorizontal: sidePadding }]}>
        <Animated.View style={[styles.headerLeft, headerLeftStyle]}>{headerLeft}</Animated.View>
        <View style={styles.headerCenter}>{headerCenter}</View>
        <Animated.View style={[styles.headerRight, headerRightStyle]}>{headerRight}</Animated.View>
      </View>
      <Animated.View style={[styles.contentWrap, contentStyle]}>{children}</Animated.View>
    </>
  );

  return (
    <Animated.View style={styles.layer} testID={testID}>
      {/* 虚拟形象中心向外扩散的涟漪光环 */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.bloomDisk,
          styles.bloomRing,
          {
            left: bloomLeft,
            top: bloomTop,
            width: bloomDiameter,
            height: bloomDiameter,
            borderRadius: bloomRadius,
            borderColor: accentColor,
          },
          bloomRingStyle,
        ]}
      />
      {/* 虚拟形象中心向外扩散的全屏背景底色 */}
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
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  bloomDisk: { position: 'absolute' },
  bloomRing: { borderWidth: 3, backgroundColor: 'transparent' },
  surfaceWrap: { flex: 1 },
  header: { flexShrink: 0 },
  headerLeft: { position: 'absolute', top: 0, left: 0 },
  headerCenter: { alignSelf: 'center', alignItems: 'center' },
  headerRight: { position: 'absolute', top: 0, right: 0, flexDirection: 'row' },
  contentWrap: { flex: 1 },
});
