import { useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, FileText, FolderOpen, Inbox, Settings2, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { workspaceTheme, spacing, sizing } from '../ui/tokens';
import { FilesScreen } from './FilesScreen';
import { SpaceHeader } from './SpaceHeader';
import { SpaceSettings } from './SpaceSettings';
import { InformationSettingsCard } from '../information/InformationSettingsCard';
import type { SpaceSection } from './space-navigation';

const titles: Record<SpaceSection, string> = { home: '空间', files: '文件', rules: '空间规则', skills: '空间技能', information: '信息处理', maintenance: '空间维护' };
const entries: { section: Exclude<SpaceSection, 'home'>; title: string; detail: string; icon: LucideIcon }[] = [
  { section: 'files', title: '文件', detail: '浏览目录、阅读和编辑 Markdown 与文本', icon: FolderOpen },
  { section: 'rules', title: '空间规则', detail: '只在这个空间生效的指令', icon: FileText },
  { section: 'skills', title: '空间技能', detail: '选择这个空间可以使用的技能', icon: Sparkles },
  { section: 'information', title: '信息处理', detail: '管理当前空间已有的信息处理设置', icon: Inbox },
  { section: 'maintenance', title: '空间维护', detail: '重置会话与空间管理', icon: Settings2 },
];

/** 空间页只组织当前空间的功能；不持有聊天/SSE，也不创建另一份规则文件。 */
export function SpacePage({ spaceId, name, section, onSection, onBack, openDrawer, onSaved, maintenance }: {
  spaceId: string; name: string; section: SpaceSection; onSection: (section: SpaceSection) => void;
  onBack: () => void; openDrawer: () => void; onSaved: () => void; maintenance: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1 }, caption: { ...workspaceTheme.typography.caption, color: colors.muted },
    content: { padding: workspaceTheme.layout.sidePadding, gap: spacing[18], paddingBottom: spacing[28] },
    identity: { gap: spacing[6], paddingVertical: spacing[12] }, name: { ...workspaceTheme.typography.section, color: colors.ink },
    group: { borderRadius: workspaceTheme.radius.card, overflow: 'hidden', backgroundColor: colors.surface },
    row: { minHeight: workspaceTheme.layout.appSettingsRowHeight, padding: spacing[16], flexDirection: 'row', alignItems: 'center', gap: spacing[14] },
    rowText: { flex: 1, minWidth: 0, gap: spacing[4] }, label: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
    pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  }), [colors]);
  return <View style={styles.root} testID="workspace-space-page">
    {section === 'files' ? <FilesScreen currentSpaceId={spaceId} spaceName={name} onBack={onBack} /> : <>
    <SpaceHeader title={titles[section]} caption={section === 'home' ? undefined : name} home={section === 'home'} onBack={section === 'home' ? openDrawer : onBack} />
    <ScrollView key={section} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {section === 'home' && <>
        <View style={styles.identity}><Text style={styles.name}>{name}</Text><Text style={styles.caption}>这里的文件、规则和技能只属于当前空间。</Text></View>
        <View style={styles.group}>{entries.map(({ section: target, title, detail, icon: Icon }) => <Pressable key={target} accessibilityRole="button" accessibilityLabel={`打开${title}`} testID={`space-open-${target}`}
          onPress={() => onSection(target)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Icon size={sizing.iconMedium} color={colors.blue} /><View style={styles.rowText}><Text style={styles.label}>{title}</Text><Text style={styles.caption}>{detail}</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
        </Pressable>)}</View>
      </>}
      {(section === 'rules' || section === 'skills') && <SpaceSettings key={`${spaceId}:${section}`} spaceId={spaceId} section={section} onSaved={onSaved} />}
      {section === 'information' && <InformationSettingsCard key={spaceId} spaceId={spaceId} />}
      {section === 'maintenance' && maintenance}
    </ScrollView></>}
  </View>;
}
