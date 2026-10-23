/**
 * 工具调用的只读展示：语义、摘要和搜索来源完全来自共享投影 helper。
 * 状态只表示是否收到工具结果及其明确失败，不推断保存、审批或任务完成。
 */
import { ChevronDown, ChevronUp, Clock3, CloudSun, FileText, Globe2, Goal, MemoryStick, Monitor, Search, CalendarClock, Workflow, Wrench, ExternalLink } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ToolCallView } from '../chat/chat-state';
import { safeMessageUrl } from '../chat/message-links';
import { describeTool, type ToolDisplay } from '../chat/tool-display';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';

const icons = {
  search: Search,
  web: Globe2,
  weather: CloudSun,
  time: Clock3,
  files: FileText,
  memory: MemoryStick,
  schedule: CalendarClock,
  goal: Goal,
  monitor: Monitor,
  subagent: Workflow,
  generic: Wrench,
} satisfies Record<ToolDisplay['kind'], typeof Wrench>;

export function ToolResultCard({ tool }: { tool: ToolCallView }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const display = useMemo(() => describeTool(tool.name, tool.args, tool.result), [tool.name, tool.args, tool.result]);
  const [expanded, setExpanded] = useState(false);
  const Icon = icons[display.kind];
  const Chevron = expanded ? ChevronUp : ChevronDown;
  const generic = display.kind === 'generic';
  const status = display.status === 'pending' ? '尚无结果' : display.status === 'failed' ? '执行失败' : '结果已返回';
  const sources = display.sources?.map((source) => ({ ...source, safeUrl: safeMessageUrl(source.url) })) ?? [];

  return <View style={styles.card}>
    <View style={styles.header}>
      <View style={styles.icon}><Icon size={sizing[18]} color={colors.accentText} /></View>
      <View style={styles.heading}>
        <Text style={styles.title}>{display.title}</Text>
        <Text style={[styles.meta, display.status === 'failed' && styles.failure]}>
          {[display.scope, status].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {generic && <Pressable accessibilityRole="button" accessibilityLabel={expanded ? '收起工具详情' : '展开工具详情'} accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.expand}>
        <Chevron size={sizing[18]} color={colors.muted} />
      </Pressable>}
    </View>

    {(!generic || expanded) && !!display.summary && <Text selectable style={[styles.summary, (display.kind === 'weather' || display.kind === 'time') && styles.prominent, display.status === 'failed' && styles.failure]}>{display.summary}</Text>}
    {generic && expanded && <Text style={styles.meta}>工具名称：{tool.name}</Text>}
    {generic && expanded && !display.summary && <Text style={styles.meta}>服务端未提供可展示摘要</Text>}

    {sources.length > 0 && <View style={styles.sources}>
      {sources.map((source, index) => source.safeUrl
        ? <Pressable key={`${source.url}-${index}`} accessibilityRole="link" accessibilityLabel={`打开来源：${source.title}`} onPress={() => {
            void Linking.openURL(source.safeUrl!).catch(() => Alert.alert('无法打开链接', '请稍后重试。'));
          }} style={styles.sourceRow}>
          <ExternalLink size={sizing[14]} color={colors.accentText} />
          <Text style={styles.sourceLink} numberOfLines={2}>{source.title || source.safeUrl}</Text>
        </Pressable>
        : <Text key={`${source.url}-${index}`} style={styles.sourceText} numberOfLines={2}>{source.title}</Text>)}
    </View>}
  </View>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  card: { backgroundColor: c.surface, padding: spacing[16], borderRadius: workspaceTheme.radius.card, gap: spacing[10], borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, maxWidth: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[12] },
  icon: { width: workspaceTheme.layout.rowIcon, height: workspaceTheme.layout.rowIcon, borderRadius: workspaceTheme.radius.round, backgroundColor: c.blueSoft, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, minWidth: 0, gap: spacing[2] },
  title: { ...workspaceTheme.typography.status, color: c.ink, fontWeight: '600' },
  meta: { ...workspaceTheme.typography.caption, color: c.muted },
  failure: { color: c.danger },
  expand: { width: sizing.touchTarget, height: sizing.touchTarget, alignItems: 'center', justifyContent: 'center' },
  summary: { ...workspaceTheme.typography.detail, color: c.ink },
  prominent: { ...workspaceTheme.typography.itemTitle, color: c.ink, fontWeight: '600' },
  sources: { gap: spacing[8], paddingTop: spacing[8], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[8], minHeight: sizing.touchTarget },
  sourceLink: { ...workspaceTheme.typography.detail, color: c.accentText, flex: 1, textDecorationLine: 'underline' },
  sourceText: { ...workspaceTheme.typography.detail, color: c.muted },
});
