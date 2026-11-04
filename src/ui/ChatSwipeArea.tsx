import { useRef, type ReactNode } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import { swipeDirection } from '../workspace/avatar-navigation';

/** 只在明确横扫后取得 responder，避免纵向 ScrollView 吞掉结束事件。
 * 输入栏、表单不包在这里；横向代码/表格通过起手 stopPropagation 保留原生滚动。
 * 全部、私聊和新闻共用一套判定；不将横扫解释成业务视图切换。
 */
export function ChatSwipeArea({ children, onSwipe }: { children: ReactNode; onSwipe?: (direction: -1 | 1) => void }) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const claimed = useRef(false);
  const clear = () => { start.current = null; claimed.current = false; };
  const direction = (event: GestureResponderEvent) => {
    const origin = start.current;
    if (!origin) return;
    return swipeDirection(event.nativeEvent.pageX - origin.x, event.nativeEvent.pageY - origin.y,
      event.nativeEvent.timestamp - origin.at);
  };
  return <View style={{ flex: 1, minHeight: 0 }}
    onTouchStartCapture={clear}
    onTouchStart={(event) => {
      const touch = event.nativeEvent;
      if (touch.touches.length === 1) start.current = { x: touch.pageX, y: touch.pageY, at: touch.timestamp };
    }}
    onTouchMove={(event) => { if (event.nativeEvent.touches.length !== 1) clear(); }}
    onMoveShouldSetResponderCapture={(event) => {
      if (!onSwipe || event.nativeEvent.touches.length !== 1) { clear(); return false; }
      return direction(event) !== undefined;
    }}
    onResponderGrant={() => { claimed.current = true; }}
    onResponderTerminationRequest={() => true}
    onResponderTerminate={clear}
    onTouchCancel={() => { if (!claimed.current) clear(); }}
    onResponderRelease={(event) => {
      const next = direction(event);
      const single = event.nativeEvent.touches.length === 0;
      clear();
      if (single && next) onSwipe?.(next);
    }}>
    {children}
  </View>;
}
