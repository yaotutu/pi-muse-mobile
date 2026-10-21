import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** 系统减少动画偏好与配色选择无关，监听独立清理；初次读取前保持静态呈现。 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; listener.remove(); };
  }, []);
  return reduced;
}
