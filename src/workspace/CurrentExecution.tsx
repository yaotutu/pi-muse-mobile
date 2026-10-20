import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { workspaceTheme, spacing } from '../ui/tokens';
import { useWorkspaceTheme } from './WorkspaceTheme';
import { useSpaceRuntime } from '../runtime/RuntimeProvider';
import type { AgentStatus } from '../runtime/types';
import { useServiceConnection } from '../connection/ConnectionProvider';

export function CurrentExecution({ spaceId, onSettled, onApprovals, onHistory }: { spaceId: string; onSettled?: () => void; onApprovals?: () => void; onHistory?: (activityId?: string) => void }) {
  const runtime = useSpaceRuntime(spaceId);
  const connection = useServiceConnection();
  const { colors } = useWorkspaceTheme();
  const styles = useMemo(() => StyleSheet.create({
    section: { ...workspaceTheme.typography.section, color: colors.ink, marginBottom: spacing[12] },
    label: { ...workspaceTheme.typography.detail, color: colors.muted },
    card: { backgroundColor: colors.surface, borderRadius: workspaceTheme.radius.card, padding: spacing[16], gap: spacing[12], marginBottom: spacing[16] },
    title: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, color: colors.faint },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] },
    body: { flex: 1, gap: spacing[4] },
    button: { alignSelf: 'flex-start', paddingVertical: spacing[8], paddingHorizontal: spacing[14], borderRadius: workspaceTheme.radius.round, backgroundColor: colors.control },
    buttonText: { ...workspaceTheme.typography.status, color: colors.ink },
    sublist: { gap: spacing[12], paddingTop: spacing[12], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  }), [colors]);
  const settled = runtime.runs.some((run) => run.status !== 'running');
  const signature = runtime.runs.map((run) => `${run.runId}:${run.status}`).join('|');
  useEffect(() => { if (settled) onSettled?.(); }, [settled, signature, onSettled]);
  return <View>
    <Text style={styles.section}>当前执行</Text>
    {!runtime.synchronized && <View style={styles.card}>
      <Text style={styles.label}>{runtime.label}</Text>
      <Text style={styles.caption}>以下为最后观测状态，不表示运行已停止。</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="重新同步运行状态" style={styles.button} onPress={() => { runtime.retry(); connection?.retry(); }}>
        <Text style={styles.buttonText}>重新同步</Text>
      </Pressable>
    </View>}
    {runtime.runs.length === 0 && <View style={styles.card}>
      <Text style={styles.label}>{runtime.synchronized ? '当前没有进行中的执行' : '正在等待运行状态同步'}</Text>
      <Text style={styles.caption}>这里展示本会话的当前执行，不代表活动历史或整项工作的完成状态。</Text>
    </View>}
    {runtime.runs.map((run) => <View key={run.runId} style={styles.card}>
      <View style={styles.row}>
        {run.status === 'running' && runtime.synchronized && <ActivityIndicator color={colors.muted} size="small" />}
        <View style={styles.body}>
          <Text style={styles.title}>{run.title}</Text>
          <Text style={styles.label}>{run.label}</Text>
        </View>
      </View>
      <Text style={styles.caption}>{run.source === 'job' ? '定时任务执行' : '聊天执行'}{run.status !== 'running' ? ' · 最近观测结果' : ''}</Text>
      {!!run.tools.length && <View style={styles.sublist}>
        <Text style={styles.caption}>进行中的工具</Text>
        {run.tools.map((tool) => <View key={`${tool.subagentId ?? 'parent'}:${tool.toolCallId}`} style={styles.row}>
          <View style={styles.body}>
            <Text style={styles.label}>{tool.label}</Text>
            <Text style={styles.caption}>{tool.subagentId ? '子代理工具' : '当前运行工具'} · {tool.status === 'waiting_approval' ? '等待审批' : '执行中'}</Text>
          </View>
        </View>)}
      </View>}
      {!!run.subagents.length && <View style={styles.sublist}>
        <Text style={styles.caption}>子代理</Text>
        {run.subagents.map((child) => <View key={child.id} style={styles.body}>
          <Text style={styles.label}>{child.role} · {child.label}</Text>
          <Text style={styles.caption}>{subagentStatus(child.status)}</Text>
        </View>)}
      </View>}
      {!!run.pendingApprovalIds.length && <View style={styles.body}><Text style={styles.caption}>等待 {run.pendingApprovalIds.length} 项审批</Text>
        {onApprovals && <Pressable accessibilityRole="button" accessibilityLabel="查看待审批" onPress={onApprovals} style={styles.button}><Text style={styles.buttonText}>查看待审批</Text></Pressable>}
      </View>}
      {run.activityId !== null && onHistory && <Pressable accessibilityRole="button" accessibilityLabel="查看关联活动" onPress={() => onHistory(run.activityId!)} style={styles.button}><Text style={styles.buttonText}>查看关联活动</Text></Pressable>}
    </View>)}
    {onHistory && <Pressable accessibilityRole="button" accessibilityLabel="查看活动历史" onPress={() => onHistory()} style={styles.button}><Text style={styles.buttonText}>查看活动历史</Text></Pressable>}
    <Text style={styles.caption}>本轮正常结束不等于整项工作完成；未登记活动的聊天不会出现在历史中。</Text>
  </View>;
}
function subagentStatus(status: AgentStatus['subagents'][number]['status']) {
  return { queued: '等待执行名额', running: '执行中', succeeded: '已完成', failed: '执行失败', cancelled: '已停止' }[status];
}
