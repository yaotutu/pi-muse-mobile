import { useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Activity, ChevronRight, FileText, FolderOpen, Settings2, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { workspaceTheme, spacing, sizing } from '../ui/tokens';
import { FilesScreen } from './FilesScreen';
import { AgentHeader } from './AgentHeader';
import { AgentSettings } from './AgentSettings';
import type { AgentSection } from './agent-navigation';
import { MemberAvatar } from './MemberAvatar';
import { isBuiltinMember } from './agent-labels';
import { CapabilityPanel } from '../group/RoutingSettingsPanel';
import type { RoutingSettingsStore } from '../group/routing-settings-store';

const titles: Record<AgentSection, string> = { home: '智能体设置', files: '文件', rules: '专属规则', capability: '公开能力', skills: '技能', maintenance: '会话管理' };
const entries: { section: Exclude<AgentSection, 'home'>; title: string; detail: string; icon: LucideIcon }[] = [
  { section: 'files', title: '文件', detail: '浏览目录、直接编辑 Markdown 与文本原文', icon: FolderOpen },
  { section: 'rules', title: '专属规则', detail: '只在这个智能体生效的指令', icon: FileText },
  { section: 'capability', title: '公开能力', detail: '向组内路由说明擅长处理的任务', icon: Sparkles },
  { section: 'skills', title: '技能', detail: '选择这个智能体可以使用的技能', icon: Sparkles },
  { section: 'maintenance', title: '会话管理', detail: '重置这个智能体的会话', icon: Settings2 },
];

/** 智能体页只组织当前智能体的功能；不持有聊天/SSE，也不创建另一份规则文件。 */
export function AgentPage({ agentId, name, section, onSection, onBack, onActivity, onFeatureSettings, onSaved, maintenance, statusLabel, routing }: {
  routing: RoutingSettingsStore;
  agentId: string; name: string; section: AgentSection; onSection: (section: AgentSection) => void;
  onBack: () => void; onActivity: () => void; onFeatureSettings: () => void;
  onSaved: () => void; maintenance: ReactNode;
  statusLabel: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1 }, caption: { ...workspaceTheme.typography.caption, color: colors.muted },
    content: { padding: workspaceTheme.layout.sidePadding, gap: spacing[18], paddingBottom: spacing[28] },
    identity: { gap: spacing[12], paddingVertical: spacing[12], alignItems: 'center' }, name: { ...workspaceTheme.typography.section, color: colors.ink },
    group: { borderRadius: workspaceTheme.radius.card, overflow: 'hidden', backgroundColor: colors.surface },
    row: { minHeight: 64, padding: spacing[16], flexDirection: 'row', alignItems: 'center', gap: spacing[14] },
    rowText: { flex: 1, minWidth: 0, gap: spacing[4] }, label: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
    pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  }), [colors]);
  return <View style={styles.root} testID="workspace-agent-page">
    {section === 'files' ? <FilesScreen currentAgentId={agentId} agentName={name} onBack={onBack} /> : <>
    <AgentHeader title={titles[section]} caption={section === 'home' ? undefined : name} onBack={onBack} backLabel={section === 'home' ? '返回智能体管理' : undefined} />
    <ScrollView key={section} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {section === 'home' && <>
        <View style={styles.identity}><MemberAvatar agentId={agentId} size={72} /><Text style={styles.name}>{name}</Text><Text accessibilityLiveRegion="polite" style={styles.caption}>{statusLabel}</Text></View>
        <View style={styles.group}>{entries.map(({ section: target, title, detail, icon: Icon }) => <Pressable key={target} accessibilityRole="button" accessibilityLabel={`打开${title}`} testID={`agent-open-${target}`}
          onPress={() => onSection(target)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Icon size={sizing.iconMedium} color={colors.blue} /><View style={styles.rowText}><Text style={styles.label}>{title}</Text><Text style={styles.caption}>{detail}</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
        </Pressable>)}</View>
        <View style={styles.group}>
          {isBuiltinMember(agentId) && <Pressable accessibilityRole="button" accessibilityLabel={`管理${name}功能`} onPress={onFeatureSettings} style={styles.row}>
            <Settings2 size={sizing.iconMedium} color={colors.blue} /><View style={styles.rowText}><Text style={styles.label}>{name}设置</Text><Text style={styles.caption}>后台处理、来源与通知承接</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="查看成员动态与审批" onPress={onActivity} style={styles.row}>
            <Activity size={sizing.iconMedium} color={colors.blue} /><View style={styles.rowText}><Text style={styles.label}>动态与审批</Text><Text style={styles.caption}>执行进度、待处理与历史</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
          </Pressable>
        </View>
      </>}
      {(section === 'rules' || section === 'skills') && <AgentSettings key={`${agentId}:${section}`} agentId={agentId} section={section} onSaved={onSaved} />}
      {section === 'capability' && <CapabilityPanel store={routing} agentId={agentId} />}
      {section === 'maintenance' && maintenance}
    </ScrollView></>}
  </View>;
}
