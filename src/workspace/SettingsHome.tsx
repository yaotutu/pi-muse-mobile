import { BookOpen, Brain, ChevronRight, Clock, FileText, Globe, MessageSquare, Moon, Newspaper, Palette, Radio, Server, Smile, ShieldCheck, SlidersHorizontal, Sparkles, Target, UserRound, Download, type LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, themeTokens } from '../theme/tokens';
import { Card } from '../ui/Surfaces';

export type SettingsPage = 'profile' | 'memory' | 'dream' | 'goals' | 'jobs' | 'monitors' | 'files' | 'sms' | 'rules' | 'skills' | 'activity' | 'news-sources' | 'news-preferences' | 'appearance' | 'companion';

export const SETTINGS_PAGE_TITLES: Record<SettingsPage, string> = {
  profile: '身份与人设',
  memory: '长期记忆',
  dream: 'Dream 记忆整理',
  goals: '目标',
  jobs: '定时任务',
  monitors: '网页监控',
  files: '工作区文件',
  sms: '短信设置',
  rules: '会话指令',
  skills: '会话技能',
  activity: '动态与审批',
  'news-sources': '新闻来源',
  'news-preferences': '新闻偏好',
  appearance: '外观主题',
  companion: '助手形象',
};

type PageEntry = { page: SettingsPage; icon: LucideIcon; description?: string };

const PAGE_GROUPS: readonly { title: string; entries: readonly PageEntry[] }[] = [
  { title: '助手', entries: [
    { page: 'profile', icon: UserRound, description: '助手身份与表达风格' },
    { page: 'rules', icon: FileText, description: '主聊天的自定义指令' },
    { page: 'skills', icon: Sparkles, description: '主聊天可用的技能' },
    { page: 'dream', icon: Moon, description: '记忆整理配置与待决建议' },
  ] },
  { title: '资料与任务', entries: [
    { page: 'memory', icon: Brain },
    { page: 'goals', icon: Target },
    { page: 'jobs', icon: Clock },
    { page: 'monitors', icon: Radio },
    { page: 'files', icon: BookOpen },
    { page: 'activity', icon: ShieldCheck, description: '查看主聊天执行与审批' },
  ] },
  { title: '信息', entries: [
    { page: 'news-sources', icon: Newspaper },
    { page: 'news-preferences', icon: SlidersHorizontal },
    { page: 'sms', icon: MessageSquare },
  ] },
];

export function SettingsHome({ onOpen, onConnection, onBrowser, onUpdate, notice }: {
  onOpen: (page: SettingsPage) => void;
  onConnection: () => void;
  onBrowser: () => void;
  onUpdate?: () => void;
  notice?: string;
}) {
  const { colors } = useTheme();
  // 安全区与底栏由工作区根持有；这里只保留正文留白，不叠加另一层避让。
  return <ScrollView testID="settings-home" keyboardShouldPersistTaps="handled"
    style={[styles.root, { backgroundColor: colors.canvas }]} contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>设置</Text>
    {notice && <Text style={{ ...themeTokens.typography.status, color: colors.muted }}>{notice}</Text>}
    {PAGE_GROUPS.map((group) => <View key={group.title} style={styles.group}>
      <Text accessibilityRole="header" style={[styles.groupTitle, { color: colors.muted }]}>{group.title}</Text>
      <Card style={styles.card}>
        {group.entries.map((entry, index) => <SettingsRow key={entry.page} icon={entry.icon}
          label={SETTINGS_PAGE_TITLES[entry.page]} description={entry.description}
          testID={`settings-open-${entry.page}`} divider={index > 0} onPress={() => onOpen(entry.page)} />)}
      </Card>
    </View>)}
    <View style={styles.group}>
      <Text accessibilityRole="header" style={[styles.groupTitle, { color: colors.muted }]}>应用</Text>
      <Card style={styles.card}>
        <SettingsRow icon={Globe} label="浏览器" testID="viewer-open" onPress={onBrowser} />
        <SettingsRow icon={Palette} label={SETTINGS_PAGE_TITLES.appearance} description="选择本机显示主题"
          testID="settings-open-appearance" divider onPress={() => onOpen('appearance')} />
        <SettingsRow icon={Smile} label={SETTINGS_PAGE_TITLES.companion} description="选择本机助手形象包"
          testID="settings-open-companion" divider onPress={() => onOpen('companion')} />
        <SettingsRow icon={Server} label="服务器连接" testID="settings-connection" divider onPress={onConnection} />
        {onUpdate && <SettingsRow icon={Download} label="应用更新" testID="settings-update" divider onPress={onUpdate} />}
      </Card>
    </View>
  </ScrollView>;
}

function SettingsRow({ icon: Icon, label, description, onPress, testID, divider = false }: {
  icon: LucideIcon; label: string; description?: string; onPress: () => void; testID: string; divider?: boolean;
}) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={description}
    onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.selected : colors.surface }]}>
    {divider && <View pointerEvents="none" style={[styles.divider, { backgroundColor: colors.line }]} />}
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.iconBox, { backgroundColor: colors.control }]}>
      <Icon size={themeTokens.layout.appSettingsIcon} strokeWidth={1.7} color={colors.ink} />
    </View>
    <View style={styles.rowText}>
      <Text style={[styles.rowTitle, { color: colors.ink }]}>{label}</Text>
      {description && <Text style={[styles.description, { color: colors.muted }]}>{description}</Text>}
    </View>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.chevron}>
      <ChevronRight size={themeTokens.layout.appSettingsIcon} strokeWidth={1.7} color={colors.muted} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    width: '100%', maxWidth: themeTokens.layout.maxWidth, alignSelf: 'center',
    paddingHorizontal: spacing[16], paddingTop: themeTokens.layout.pageTop,
    paddingBottom: themeTokens.layout.pageTop, gap: spacing.section,
  },
  title: { ...themeTokens.typography.pageTitle, fontWeight: '700' },
  group: { gap: spacing[8] },
  groupTitle: { ...themeTokens.typography.status, fontWeight: '600', paddingHorizontal: spacing[12] },
  card: { padding: 0, overflow: 'hidden' },
  row: {
    minHeight: themeTokens.layout.appSettingsRowHeight, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing[16], paddingVertical: spacing[12], gap: spacing[12],
  },
  divider: { position: 'absolute', top: 0, left: spacing[16], right: spacing[16], height: StyleSheet.hairlineWidth },
  iconBox: {
    width: themeTokens.layout.appSettingsIconBox, height: themeTokens.layout.appSettingsIconBox,
    flexShrink: 0, borderRadius: spacing[12], alignItems: 'center', justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0, gap: spacing[2] },
  rowTitle: { ...themeTokens.typography.itemTitle, fontWeight: '500' },
  description: { ...themeTokens.typography.status },
  chevron: { flexShrink: 0 },
});
