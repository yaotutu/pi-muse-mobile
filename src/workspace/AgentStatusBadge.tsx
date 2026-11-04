import { useEffect, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { Pause } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useReducedMotion } from './primitives';
import type { AgentPresence } from '../runtime/types';

export type AvatarStatus = AgentPresence['state'] | 'unknown';
export const avatarStatusLabel = (state: AvatarStatus) => ({ idle: '空闲', working: '正在工作', waiting: '等待你处理', error: '遇到问题', unknown: '状态待同步' }[state]);

/** 选中态仍只使用外环；右下角只表达一个状态，没有数量、点击区或聚合逻辑。 */
export function AgentStatusBadge({ state }: { state: AvatarStatus }) {
  const { colors: c } = useTheme();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    opacity.setValue(1);
    if (state !== 'working' || reduced) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.35, duration: 750, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
    ]));
    animation.start(); return () => animation.stop();
  }, [state, reduced, opacity]);
  if (state === 'idle') return null;
  const color = state === 'error' ? c.danger : state === 'waiting' ? c.warning : state === 'unknown' ? c.faint : c.accentText;
  return <View pointerEvents="none" testID={`avatar-status-${state}`} style={{ position: 'absolute', bottom: 0, right: 0, width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: c.canvas, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
    {state === 'working' ? <Animated.View style={{ opacity, width: 5, height: 5, borderRadius: 3, backgroundColor: c.canvas }} />
      : state === 'waiting' ? <Pause size={8} strokeWidth={3} color={c.canvas} />
      : <Text style={{ color: c.canvas, fontSize: 10, lineHeight: 11, fontWeight: '700' }}>{state === 'error' ? '!' : '-'}</Text>}
  </View>;
}
