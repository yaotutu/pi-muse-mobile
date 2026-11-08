import { Pressable, ScrollView, Text, View } from 'react-native';
import type { SessionRecord } from '../sessions/types';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { spacing, workspaceTheme } from '../ui/tokens';

/** 列表与切换面板消费同一权威目录，不合成缺失的默认会话。 */
export function SessionRows({ sessions, currentId, onSelect }: { sessions: readonly SessionRecord[]; currentId?: string; onSelect: (id: string) => void }) {
  const { colors } = useTheme();
  return <View style={{ gap: spacing[8] }}>{sessions.map((session) => <Pressable key={session.id}
    accessibilityRole="button" accessibilityLabel={`打开会话 ${session.title}`} accessibilityState={{ selected: session.id === currentId }}
    testID={`session-open-${session.id}`} onPress={() => onSelect(session.id)}
    style={({ pressed }) => ({ padding: spacing[16], minHeight: 64, borderRadius: workspaceTheme.radius.card, backgroundColor: session.id === currentId ? colors.selected : colors.surface, opacity: pressed ? 0.7 : 1 })}>
    <Text style={{ ...workspaceTheme.typography.itemTitle, color: colors.ink }}>{session.isMain ? '默认会话' : session.title}</Text>
    <Text style={{ ...workspaceTheme.typography.caption, color: colors.muted }}>{session.isMain ? '日常聊天与重要通知' : new Date(session.updatedAt).toLocaleString()}</Text>
  </Pressable>)}</View>;
}
export function SessionListScreen({ sessions, loading, loaded, error, busy, uncertain, onSelect, onCreate, onReload }: {
  sessions: readonly SessionRecord[]; loading: boolean; loaded: boolean; error?: string; busy: boolean; uncertain: boolean;
  onSelect: (id: string) => void; onCreate: () => void; onReload: () => void;
}) {
  const { colors } = useTheme();
  return <ScrollView contentContainerStyle={{ padding: spacing[20], gap: spacing[16] }} testID="session-list-screen">
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text accessibilityRole="header" style={{ ...workspaceTheme.typography.section, color: colors.ink }}>消息</Text>
      <ActionButton label="新建会话" onPress={onCreate} disabled={busy || uncertain || !loaded} />
    </View>
    {loading && <Text style={{ color: colors.muted }}>正在读取会话…</Text>}
    {error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
    {uncertain && <Text style={{ color: colors.warning }}>操作结果未明，请先刷新目录核对，不会自动重发。</Text>}
    <SessionRows sessions={sessions} onSelect={onSelect} />
    <ActionButton label="刷新会话列表" onPress={onReload} disabled={loading || busy} />
  </ScrollView>;
}
