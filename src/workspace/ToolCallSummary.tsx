import { ChevronDown, ChevronUp, Wrench } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ToolCallView } from '../chat/chat-state';
import { summarizeToolCalls } from '../chat/tool-display';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { ToolResultCard } from './ToolResultCard';

/** 只收起同一条回复的执行细节，不合并成员或改动审批、运行与消息生命周期。 */
export function ToolCallSummary({ tools }: { tools: ToolCallView[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeToolCalls(tools);
  if (!summary.total) return null;
  const Chevron = expanded ? ChevronUp : ChevronDown;
  const status = [summary.failed ? `${summary.failed} 项失败` : '', summary.pending ? `${summary.pending} 项尚无结果` : ''].filter(Boolean).join(' · ') || '结果已返回';
  return <View style={styles.root}>
    <Pressable accessibilityRole="button" accessibilityLabel={expanded ? '收起本条消息的工具记录' : '展开本条消息的工具记录'} accessibilityValue={{ text: `${summary.total} 项，${status}` }} accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.toggle}>
      <Wrench size={sizing[14]} color={colors.muted} />
      <View style={styles.labels}>
        <Text style={styles.text}>{summary.total} 项工具记录</Text>
        <Text style={[styles.text, summary.failed > 0 && styles.failure]}>{status}</Text>
      </View>
      <Chevron size={sizing[14]} color={colors.muted} />
    </Pressable>
    {expanded && <View style={styles.details}>{tools.map((tool) => <ToolResultCard key={tool.id} tool={tool} embedded />)}</View>}
  </View>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { maxWidth: '100%' },
  toggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', minHeight: sizing.touchTarget, gap: spacing[6], paddingHorizontal: spacing[4], paddingVertical: spacing[6] },
  labels: { flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1, columnGap: spacing[8], rowGap: spacing[2] },
  text: { ...workspaceTheme.typography.caption, color: c.muted },
  failure: { color: c.danger },
  details: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
});
