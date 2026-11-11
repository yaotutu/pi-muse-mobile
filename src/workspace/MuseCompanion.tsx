/**
 * 助手虚拟形象：按真实运行状态切换 3D 助手姿态图，并用 Reanimated 播放有限次状态动效。
 *
 * 素材为八张 512px 透明底状态图（idle/thinking/responding/working/waiting-approval/success/error/stopped）；
 * 动效仅作状态强化并在有限次数后静止，保持界面可读与无障碍稳定。
 * 无障碍：状态经 accessibilityLabel 传达；系统减弱动效时保持静态姿态，不用动画冒充进度。
 */
import { useEffect } from 'react';
import { Image, ImageStyle, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { builtinPenguin } from '../companion/builtin-packs';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../ui/use-reduced-motion';
import { describeCompanionState, type CompanionState } from './companion-state';

export function MuseCompanion({
  state,
  images = builtinPenguin.images,
  size = 64,
  offline = false,
}: {
  state: CompanionState;
  images?: Record<CompanionState, ImageSourcePropType>;
  size?: number;
  /** 通知流未同步时整体降饱和度，不猜测运行状态。 */
  offline?: boolean;
}) {
  const reduced = useReducedMotion();
  // 终态时长由上层状态机（WorkspaceScreen 的 recentOutcome）控制；本组件只渲染当前状态。
  const display = state;

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      rotate.value = 0;
      return;
    }
    // 切换状态先平滑复位上一状态的变换，避免 stopped 倾角或偏置残留到下一状态。
    scale.value = withTiming(1, { duration: 120 });
    translateX.value = withTiming(0, { duration: 120 });
    translateY.value = withTiming(0, { duration: 120 });
    rotate.value = withTiming(0, { duration: 120 });
    const ease = Easing.inOut(Easing.quad);
    // 动效按状态播放有限次数后停在对应姿态：既能表达状态，也保证窗口最终静止，
    // 否则持续动画会让无障碍树永不 idle，原生自动化与辅助功能读取都会失效。
    const cycles = (count: number, step: (index: number) => number) =>
      withSequence(...Array.from({ length: count }, (_, index) => step(index)));
    switch (display) {
      case 'idle':
        scale.value = cycles(3, () => withSequence(
          withTiming(1.03, { duration: 900, easing: ease }),
          withTiming(1, { duration: 900, easing: ease }),
        ));
        break;
      case 'thinking':
        rotate.value = cycles(4, () => withSequence(
          withTiming(-3, { duration: 420, easing: ease }),
          withTiming(3, { duration: 420, easing: ease }),
        ));
        scale.value = cycles(4, () => withSequence(
          withTiming(1.04, { duration: 380, easing: ease }),
          withTiming(1, { duration: 380, easing: ease }),
        ));
        break;
      case 'responding':
        translateX.value = cycles(6, () => withSequence(
          withTiming(-2, { duration: 200, easing: ease }),
          withTiming(2, { duration: 200, easing: ease }),
        ));
        break;
      case 'working':
        // 奔跑感：横向微冲 + 轻微上下颠簸，最后回正。
        translateX.value = cycles(6, () => withSequence(
          withTiming(-2, { duration: 140, easing: ease }),
          withTiming(2, { duration: 140, easing: ease }),
        ));
        translateY.value = withSequence(
          cycles(6, () => withSequence(
            withTiming(-3, { duration: 140, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 140, easing: Easing.in(Easing.quad) }),
          )),
          withTiming(0, { duration: 120 }),
        );
        break;
      case 'waiting-approval':
        scale.value = cycles(5, () => withSequence(
          withTiming(1.07, { duration: 300, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 300, easing: Easing.in(Easing.quad) }),
        ));
        break;
      case 'success':
        // 胜利起跳：向上跃起伴随轻度放大，然后平稳落回原位。
        translateY.value = withSequence(
          withTiming(-8, { duration: 200, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 280, easing: Easing.inOut(Easing.quad) }),
        );
        scale.value = withSequence(
          withTiming(1.12, { duration: 200, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 280, easing: Easing.inOut(Easing.quad) }),
        );
        break;
      case 'error':
        translateX.value = withSequence(
          withTiming(-6, { duration: 90, easing: Easing.out(Easing.quad) }),
          withTiming(6, { duration: 90, easing: Easing.inOut(Easing.quad) }),
          withTiming(-4, { duration: 90, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) }),
        );
        break;
      case 'stopped':
        translateY.value = withSequence(
          withTiming(2, { duration: 220, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 240, easing: Easing.inOut(Easing.quad) }),
        );
        break;
    }
    return () => { cancelAnimation(scale); cancelAnimation(translateX); cancelAnimation(translateY); cancelAnimation(rotate); };
  }, [display, reduced, scale, translateX, translateY, rotate]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  const description = describeCompanionState(display);
  const label = offline ? `${description}（离线）` : description;
  // 纯姿态展示：交互与完整运行状态标签由悬浮层（FloatingCompanion）唯一持有，嵌入时整体对无障碍隐藏。
  return <View accessibilityRole="image" accessibilityLabel={`Pi Muse 形象：${label}`} style={companionStyles.press}>
    <Animated.View style={[companionStyles.frame, { width: size, height: size }, animatedStyle]}>
      <Image source={images[display]} style={[companionStyles.image, offline && { opacity: 0.5 } as ImageStyle]} />
    </Animated.View>
  </View>;
}

const companionStyles = StyleSheet.create({
  press: { alignItems: 'center' },
  frame: { aspectRatio: 1 },
  image: { width: '100%', height: '100%', resizeMode: 'contain' } as ImageStyle,
});
