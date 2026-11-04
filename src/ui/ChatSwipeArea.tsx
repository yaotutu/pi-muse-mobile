import { useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { swipeDirection } from '../workspace/avatar-navigation';

/** 只观察阅读区的触摸，不抢 ScrollView responder；输入栏、表单不包在这里。
 * 横向代码/表格在自己的 onTouchStart 阻止冒泡，保留其原生横向滚动。
 */
export function ChatSwipeArea({ children, onSwipe }: { children: ReactNode; onSwipe?: (direction: -1 | 1) => void }) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  return <View style={{ flex: 1, minHeight: 0 }}
    onTouchStartCapture={() => { start.current = null; }}
    onTouchStart={(event) => {
      const touch = event.nativeEvent;
      if (touch.touches.length === 1) start.current = { x: touch.pageX, y: touch.pageY, at: Date.now() };
    }}
    onTouchMove={(event) => { if (event.nativeEvent.touches.length !== 1) start.current = null; }}
    onTouchCancel={() => { start.current = null; }}
    onTouchEnd={(event) => {
      const origin = start.current; start.current = null;
      if (!origin || event.nativeEvent.touches.length) return;
      const direction = swipeDirection(event.nativeEvent.pageX - origin.x, event.nativeEvent.pageY - origin.y, Date.now() - origin.at);
      if (direction) onSwipe?.(direction);
    }}>
    {children}
  </View>;
}
