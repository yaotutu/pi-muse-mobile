import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, type LayoutRectangle, type ScrollViewInstance } from 'react-native';
import { Users } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme } from '../ui/tokens';
import { MemberAvatar } from './MemberAvatar';

/** 顶栏占正常布局；当前头像再点进入资料，其他头像只切换，不另建会话所有者。 */
export function AgentAvatarStrip({ targets, selected, title, compact, disabled, onSelect, onProfile, action }: {
  targets: string[]; selected: string; title: (id: string) => string; compact: boolean; disabled: boolean;
  onSelect: (id: string) => void; onProfile: (id: string) => void; action: ReactNode;
}) {
  const { colors: c } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
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
          accessibilityHint={active ? '再次点击查看资料' : '切换聊天，草稿和正在进行的回复会保留'} disabled={disabled}
          onPress={() => active ? onProfile(id) : onSelect(id)} onLongPress={() => onProfile(id)}
          onLayout={(event) => { frames.current[id] = event.nativeEvent.layout; if (active) reveal(id); }}
          style={({ pressed }) => ({ minWidth: compact ? 48 : 62, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: spacing[4], paddingHorizontal: spacing[4], paddingVertical: spacing[4], opacity: pressed ? 0.6 : 1 })}>
          <View style={{ padding: 3, borderRadius: 19, borderWidth: 1.5, borderColor: active ? c.accentText : 'transparent' }}>
            {id === 'group' ? <View style={{ width: compact ? 30 : 36, height: compact ? 30 : 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: c.blueSoft }}><Users size={21} color={c.accentText} /></View> : <MemberAvatar agentId={id} size={compact ? 30 : 36} />}
          </View>
          {!compact && <Text numberOfLines={1} style={{ ...workspaceTheme.typography.caption, maxWidth: 72, color: active ? c.accentText : c.muted, fontWeight: active ? '600' : '400' }}>{name}</Text>}
        </Pressable>;
      })}
    </ScrollView>
    {action}
  </View>;
}
