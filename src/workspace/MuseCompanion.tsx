/**
 * 助手虚拟形象：按真实运行状态切换冰蓝企鹅姿态图，并用 Reanimated 播放状态动效。
 *
 * 素材为 docs/assets/avatar 的八张 512px 状态图（docs/avatar.md 的 T1 基准）；
 * 视频素材未接入（白底、非循环，未达验收），先用程序动效表达状态。
 * 无障碍：状态经 accessibilityLabel 传达；系统减弱动效时保持静态姿态，不用动画冒充进度。
 */
import { useEffect } from 'react';
import { Image, ImageStyle, Pressable, StyleSheet } from 'react-native';
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

const IMAGES: Record<CompanionState, ImageSource> = {
  idle: require('../../assets/images/avatar/idle.png'),
  thinking: require('../../assets/images/avatar/thinking.png'),
  responding: require('../../assets/images/avatar/responding.png'),
  working: require('../../assets/images/avatar/working.png'),
  'waiting-approval': require('../../assets/images/avatar/waiting-approval.png'),
  success: require('../../assets/images/avatar/success.png'),
  error: require('../../assets/images/avatar/error.png'),
  stopped: require('../../assets/images/avatar/stopped.png'),
};
type ImageSource = number;

export function MuseCompanion({
  state,
  size = 64,
  offline = false,
  onPress,
  testID,
}: {
  state: CompanionState;
  size?: number;
  /** 通知流未同步时整体降饱和度，不猜测运行状态。 */
  offline?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  // 终态时长由上层状态机（WorkspaceScreen 的 recentOutcome）控制；本组件只渲染当前状态。
  const display = state;

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(scale); cancelAnimation(translateX); cancelAnimation(rotate);
      scale.value = withTiming(1, { duration: 160 });
      translateX.value = withTiming(0, { duration: 160 });
      rotate.value = withTiming(0, { duration: 160 });
      return;
    }
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
        translateX.value = cycles(8, () => withSequence(
          withTiming(-3, { duration: 160, easing: ease }),
          withTiming(3, { duration: 160, easing: ease }),
        ));
        break;
      case 'waiting-approval':
        scale.value = cycles(5, () => withSequence(
          withTiming(1.08, { duration: 300, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 300, easing: Easing.in(Easing.quad) }),
        ));
        break;
      case 'success':
        scale.value = withSequence(
          withTiming(1.18, { duration: 220, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 360, easing: Easing.inOut(Easing.quad) }),
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
        rotate.value = withTiming(-6, { duration: 420, easing: Easing.out(Easing.quad) });
        break;
    }
  }, [display, reduced, scale, translateX, rotate]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  const description = describeCompanionState(display);
  const label = offline ? `${description}（离线）` : description;
  return <Pressable
    accessibilityRole={onPress ? 'button' : 'image'}
    accessibilityLabel={`Pi Muse 形象：${label}${onPress ? '，打开主聊天操作' : ''}`}
    onPress={onPress} disabled={!onPress} testID={testID ?? 'muse-companion'}
    style={companionStyles.press}>
    <Animated.View style={[companionStyles.frame, { width: size, height: size }, animatedStyle]}>
      <Image source={IMAGES[display]} style={[companionStyles.image, offline && { opacity: 0.5 } as ImageStyle]} />
    </Animated.View>
  </Pressable>;
}

const companionStyles = StyleSheet.create({
  press: { alignItems: 'center' },
  frame: { aspectRatio: 1 },
  image: { width: '100%', height: '100%', resizeMode: 'contain' } as ImageStyle,
});
