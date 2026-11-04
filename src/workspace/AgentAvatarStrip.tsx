import { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, View, type LayoutRectangle, type ScrollViewInstance } from 'react-native';
import { Users } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme } from '../ui/tokens';
import { MemberAvatar } from './MemberAvatar';

const SETTINGS_HOLD_MS = 500;

/** 单击只切聊天，长按只开设置；不根据选中态改变单击含义，也不另建会话所有者。 */
export function AgentAvatarStrip({ targets, selected, title, compact, disabled, onSelect, onSettings }: {
  targets: string[]; selected: string; title: (id: string) => string; compact: boolean; disabled: boolean;
  onSelect: (id: string) => void; onSettings: (id: string) => void;
}) {
  const { colors: c } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const settingsPress = useRef(false);
  const pressedAt = useRef(0);
  const heldForSettings = (timestamp: number) => settingsPress.current || timestamp - pressedAt.current >= SETTINGS_HOLD_MS;
  const frames = useRef<Record<string, LayoutRectangle>>({});
  const viewport = useRef(0); const offset = useRef(0);
  const reveal = useCallback((id: string) => {
    const frame = frames.current[id]; if (!frame || !viewport.current) return;
    const x = frame.x < offset.current ? frame.x : frame.x + frame.width > offset.current + viewport.current ? frame.x + frame.width - viewport.current : offset.current;
    scroll.current?.scrollTo({ x: Math.max(0, x), animated: false });
  }, []);
  useEffect(() => { reveal(selected); }, [selected, compact, reveal]);
  // 选择及键盘布局改变时露出当前头像；不重建按钮，保留读屏焦点。
  return <View testID="agent-avatar-strip" style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[12], paddingVertical: spacing[6], gap: spacing[8], backgroundColor: c.canvas }}>
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
      onLayout={(event) => { viewport.current = event.nativeEvent.layout.width; reveal(selected); }}
      onScroll={(event) => { offset.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={16}>
      {targets.map((id) => {
        const active = selected === id; const name = title(id);
        return <Pressable key={id} accessibilityRole="tab" accessibilityLabel={`切换到${name}`} accessibilityState={{ selected: active, disabled }}
          accessibilityHint={id === 'group' ? '点击切换到全部，长按打开全局设置' : '点击切换聊天，长按打开智能体设置'} disabled={disabled}
          accessibilityActions={[{ name: 'settings', label: id === 'group' ? '打开全局设置' : `打开${name}的智能体设置` }]}
          onAccessibilityAction={(event) => { if (!disabled && event.nativeEvent.actionName === 'settings') onSettings(id); }}
          delayLongPress={SETTINGS_HOLD_MS}
          onPressIn={(event) => { settingsPress.current = false; pressedAt.current = event.nativeEvent.timestamp; }}
          onLongPress={() => { settingsPress.current = true; }}
          // 松手并结束原生触摸后再跳页，避免卸载仍持有 responder 的头像，吞掉新页面第一次点击。
          onPressOut={(event) => {
            // 流式渲染繁忙时 JS 长按计时器可能晚于松手；原生触摸时间仍能区分长按，避免误切聊天。
            settingsPress.current = heldForSettings(event.nativeEvent.timestamp);
            if (settingsPress.current) requestAnimationFrame(() => onSettings(id));
          }}
          // Pressability 的延迟 press-out 可能晚于 onPress，单击路径也按同一次原生时长判定。
          onPress={(event) => { if (!heldForSettings(event.nativeEvent.timestamp) && !active) onSelect(id); }}
          onLayout={(event) => { frames.current[id] = event.nativeEvent.layout; if (active) reveal(id); }}
          style={({ pressed }) => ({ minWidth: compact ? 48 : 62, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: spacing[4], paddingHorizontal: spacing[4], paddingVertical: spacing[4], opacity: pressed ? 0.6 : 1 })}>
          <View style={{ padding: 3, borderRadius: 19, borderWidth: 1.5, borderColor: active ? c.accentText : 'transparent' }}>
            {id === 'group' ? <View style={{ width: compact ? 30 : 36, height: compact ? 30 : 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: c.blueSoft }}><Users size={21} color={c.accentText} /></View> : <MemberAvatar agentId={id} size={compact ? 30 : 36} />}
          </View>
          {!compact && <Text numberOfLines={1} style={{ ...workspaceTheme.typography.caption, maxWidth: 72, color: active ? c.accentText : c.muted, fontWeight: active ? '600' : '400' }}>{name}</Text>}
        </Pressable>;
      })}
    </ScrollView>
  </View>;
}
