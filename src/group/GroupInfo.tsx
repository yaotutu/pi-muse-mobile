import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { workspaceTheme, spacing } from '../ui/tokens';
import { AgentHeader } from '../workspace/AgentHeader';
import { MemberAvatar } from '../workspace/MemberAvatar';

/** 固定默认群，不另建联系人或复杂群管理；成员设置仍归自己的 Agent。 */
export function GroupInfo({ members, onBack, onProfile }: { members: { id: string; name: string }[]; onBack: () => void; onProfile: (id: string) => void }) {
  const { colors: c } = useTheme();
  return <View style={{ flex: 1 }}><AgentHeader title="群组信息" onBack={onBack} backLabel="返回群聊" />
    <ScrollView contentContainerStyle={{ padding: workspaceTheme.layout.sidePadding, gap: spacing[20] }}>
      <Text style={{ ...workspaceTheme.typography.detail, color: c.muted }}>默认由 Muse 回复。@ 某位成员时，只将这条消息交给它。</Text>
      <Text accessibilityRole="header" style={{ ...workspaceTheme.typography.section, color: c.ink }}>群成员（{members.length}）</Text>
      <View style={{ backgroundColor: c.surface, borderRadius: workspaceTheme.radius.card, overflow: 'hidden' }}>
        {members.map((member) => <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`查看${member.name}的主页`} onPress={() => onProfile(member.id)} style={{ minHeight: 72, flexDirection: 'row', alignItems: 'center', padding: spacing[16], gap: spacing[14] }}>
          <MemberAvatar agentId={member.id} size={44} /><Text style={{ ...workspaceTheme.typography.itemTitle, color: c.ink }}>{member.name}</Text>
          {member.id === 'local-main' && <Text style={{ ...workspaceTheme.typography.caption, color: c.muted }}>默认回复</Text>}
        </Pressable>)}
      </View>
    </ScrollView>
  </View>;
}
