import { useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Activity, ChevronRight, FileText, FolderOpen, MessageCircle, Newspaper, Settings2, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { workspaceTheme, spacing, sizing } from '../ui/tokens';
import { FilesScreen } from './FilesScreen';
import { SpaceHeader } from './SpaceHeader';
import { SpaceSettings } from './SpaceSettings';
import type { SpaceSection } from './space-navigation';
import { MemberAvatar } from './MemberAvatar';
import { isBuiltinMember, memberDescription } from './space-labels';
import { ActionButton } from '../ui/ActionButton';

const titles: Record<SpaceSection, string> = { home: '成员主页', files: '文件', rules: '专属规则', skills: '技能', maintenance: '会话管理' };
const entries: { section: Exclude<SpaceSection, 'home'>; title: string; detail: string; icon: LucideIcon }[] = [
  { section: 'files', title: '文件', detail: '浏览目录、直接编辑 Markdown 与文本原文', icon: FolderOpen },
  { section: 'rules', title: '专属规则', detail: '只在这个空间生效的指令', icon: FileText },
  { section: 'skills', title: '技能', detail: '选择这个空间可以使用的技能', icon: Sparkles },
  { section: 'maintenance', title: '会话管理', detail: '重置会话与空间管理', icon: Settings2 },
];

/** 空间页只组织当前空间的功能；不持有聊天/SSE，也不创建另一份规则文件。 */
export function SpacePage({ spaceId, name, section, onSection, onBack, onChat, onActivity, onFeatureSettings, onReadNews, onSaved, maintenance }: {
  spaceId: string; name: string; section: SpaceSection; onSection: (section: SpaceSection) => void;
  onBack: () => void; onChat: () => void; onActivity: () => void; onFeatureSettings: () => void; onReadNews: () => void; onSaved: () => void; maintenance: ReactNode;
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
  return <View style={styles.root} testID="workspace-space-page">
    {section === 'files' ? <FilesScreen currentSpaceId={spaceId} spaceName={name} onBack={onBack} /> : <>
    <SpaceHeader title={titles[section]} caption={section === 'home' ? undefined : name} onBack={onBack} backLabel={section === 'home' ? '返回上一页' : undefined} />
    <ScrollView key={section} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {section === 'home' && <>
        <View style={styles.identity}><MemberAvatar spaceId={spaceId} size={92} /><Text style={styles.name}>{name}</Text><Text style={styles.caption}>{memberDescription(spaceId)}</Text>
          <ActionButton label={`给${name}发消息`} text="发消息" icon={MessageCircle} tone="primary" style={{ alignSelf: 'center' }} onPress={onChat} />
        </View>
        {spaceId === 'news-internal' && <View style={styles.group}><Pressable accessibilityRole="button" accessibilityLabel="阅读新闻" onPress={onReadNews} style={styles.row}>
          <Newspaper size={sizing.iconMedium} color={colors.blue} /><View style={styles.rowText}><Text style={styles.label}>阅读新闻</Text><Text style={styles.caption}>查看文章、收藏与阅读来源</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
        </Pressable></View>}
        <View style={styles.group}>{entries.map(({ section: target, title, detail, icon: Icon }) => <Pressable key={target} accessibilityRole="button" accessibilityLabel={`打开${title}`} testID={`space-open-${target}`}
          onPress={() => onSection(target)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Icon size={sizing.iconMedium} color={colors.blue} /><View style={styles.rowText}><Text style={styles.label}>{title}</Text><Text style={styles.caption}>{detail}</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
        </Pressable>)}</View>
        <View style={styles.group}>
          {isBuiltinMember(spaceId) && <Pressable accessibilityRole="button" accessibilityLabel={`管理${name}功能`} onPress={onFeatureSettings} style={styles.row}>
            <Settings2 size={sizing.iconMedium} color={colors.blue} /><View style={styles.rowText}><Text style={styles.label}>{name}设置</Text><Text style={styles.caption}>后台处理、来源与通知承接</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="查看成员动态与审批" onPress={onActivity} style={styles.row}>
            <Activity size={sizing.iconMedium} color={colors.blue} /><View style={styles.rowText}><Text style={styles.label}>动态与审批</Text><Text style={styles.caption}>执行进度、待处理与历史</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
          </Pressable>
        </View>
      </>}
      {(section === 'rules' || section === 'skills') && <SpaceSettings key={`${spaceId}:${section}`} spaceId={spaceId} section={section} onSaved={onSaved} />}
      {section === 'maintenance' && maintenance}
    </ScrollView></>}
  </View>;
}
