import { Pressable, ScrollView, Text, View } from 'react-native';
import { Plus, Trash2 } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { workspaceTheme, spacing } from '../ui/tokens';
import { AgentHeader } from './AgentHeader';
import { MemberAvatar } from './MemberAvatar';
import { isBuiltinMember } from './agent-labels';
import { MAIN_AGENT } from '../agents/agent-state';
import { ActionButton } from '../ui/ActionButton';
import { IconControl } from '../ui/IconControl';

/** 添加和删除只在全局管理出现；进入设置不切换聊天所有者。 */
export function AgentManagement({ members, onBack, onSettings, onCreate, onDelete, creating, deleting, uncertain, error, onReload }: {
  members: { id: string; name: string }[]; onBack: () => void; onSettings: (id: string) => void;
  onCreate: () => void; onDelete: (id: string) => void; creating: boolean; deleting: boolean;
  uncertain?: string; error?: string; onReload: () => void;
}) {
  const { colors: c } = useTheme();
  const locked = creating || deleting;
  return <View style={{ flex: 1 }}><AgentHeader title="智能体管理" onBack={onBack} backLabel="返回全局设置" />
    <ScrollView contentContainerStyle={{ padding: workspaceTheme.layout.sidePadding, gap: spacing[20] }}>
      <Text style={{ ...workspaceTheme.typography.detail, color: c.muted }}>管理智能体及其设置，不会切换正在聊天的对象。</Text>
      {!!error && <Text accessibilityRole="alert" style={{ ...workspaceTheme.typography.caption, color: c.danger }}>{error}</Text>}
      {!!uncertain && <Text accessibilityRole="alert" style={{ ...workspaceTheme.typography.caption, color: c.danger }}>删除结果未明，请先重新读取智能体核对，不会自动重发。</Text>}
      <ActionButton label="重新读取智能体" text="刷新列表" disabled={locked} onPress={onReload} />
      <ActionButton icon={Plus} label="添加智能体" text="添加智能体" busy={creating} disabled={deleting || !!uncertain} onPress={onCreate} />
      <View style={{ backgroundColor: c.surface, borderRadius: workspaceTheme.radius.card, overflow: 'hidden' }}>
        {members.map((member) => <View key={member.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[12] }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`打开${member.name}的智能体设置`} disabled={locked || !!uncertain} onPress={() => onSettings(member.id)}
            style={{ flex: 1, minHeight: 72, flexDirection: 'row', alignItems: 'center', padding: spacing[12], gap: spacing[14] }}>
            <MemberAvatar agentId={member.id} size={44} /><View style={{ flex: 1 }}>
              <Text style={{ ...workspaceTheme.typography.itemTitle, color: c.ink }}>{member.name}</Text>
              <Text numberOfLines={1} style={{ ...workspaceTheme.typography.caption, color: c.muted }}>{member.id === MAIN_AGENT ? '默认回复' : isBuiltinMember(member.id) ? '内置智能体' : member.id}</Text>
            </View>
          </Pressable>
          {member.id !== MAIN_AGENT && !isBuiltinMember(member.id) && <IconControl icon={Trash2} label={`删除${member.name}`} disabled={locked || !!uncertain} onPress={() => onDelete(member.id)} />}
        </View>)}
      </View>
    </ScrollView>
  </View>;
}
