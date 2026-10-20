import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useActivities } from '../activities/ActivityProvider';
import { activityStepKey } from '../activities/contracts';
import { activityStatusLabel, stepKindLabel, stepStatusLabel } from '../activities/presentation';
import { activityStatuses, type ActivityFilter, type ActivityOverview, type ActivityStatus } from '../activities/types';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { useWorkspaceTheme } from './WorkspaceTheme';

function useStyles() { const { colors } = useWorkspaceTheme(); return useMemo(() => createStyles(colors), [colors]); }
function Button({ label, onPress, selected, disabled }: { label: string; onPress: () => void; selected?: boolean; disabled?: boolean }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, selected && styles.selected, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

/** 主任务页与会话面板历史共用同一只读视图；宿主保证同时只有一个可见实例。 */
export function ActivityPanel({ spaceId, defaultScope = 'space', initialActivityId }: { spaceId: string; defaultScope?: 'space' | 'all'; initialActivityId?: string }) {
  const { store, snapshot } = useActivities(); const styles = useStyles(); const { colors } = useWorkspaceTheme();
  const [scope, setScope] = useState(defaultScope);
  const [status, setStatus] = useState<ActivityStatus>();
  const filter = useMemo<ActivityFilter>(() => ({ ...(scope === 'space' ? { spaceId } : {}), ...(status ? { status } : {}) }), [scope, spaceId, status]);
  useEffect(() => {
    store.open(filter);
  }, [store, filter]);
  useEffect(() => () => store.close(), [store]);
  useEffect(() => { if (initialActivityId) store.select(initialActivityId); }, [store, initialActivityId]);
  const matches = snapshot.filter.spaceId === filter.spaceId && snapshot.filter.status === filter.status;
  const detail = matches ? snapshot.detail : undefined;
  return <View style={styles.root} testID="activity-panel">
    <Text style={styles.heading}>活动与执行历史</Text>
    <Text style={styles.caption}>仅包含模型登记的工作及真实执行步骤，不是每轮聊天的运行记录。本轮结束不等于工作完成。</Text>
    {matches && snapshot.selectedId ? <>
      <View style={styles.row}><Button label="返回活动列表" onPress={() => store.select()} /><Button label="刷新活动详情" disabled={snapshot.detailLoading} onPress={store.refreshDetail} /></View>
      {snapshot.detailLoading && <ActivityIndicator accessibilityLabel="正在读取活动详情" color={colors.muted} />}
      {snapshot.detailStale && detail && <Text style={styles.caption}>详情为最后观测内容，可刷新核对最新进展。</Text>}
      {!!snapshot.detailError && <Text accessibilityRole="alert" style={styles.error}>{snapshot.detailError}</Text>}
      {detail && <>
        <Overview activity={detail.activity} />
        <Text style={styles.title}>执行步骤 · {detail.steps.length}</Text>
        <Text style={styles.caption}>按真实执行顺序展示安全摘要；失败、拒绝与中断原样保留。</Text>
        {detail.steps.length === 0 && <Text style={styles.body}>服务端尚未记录执行步骤</Text>}
        {detail.steps.map((step, index) => <View key={activityStepKey(step)} style={styles.card} testID={`activity-step-${step.runId}-${step.id}`}>
          <Text style={styles.caption}>{index + 1} · {stepKindLabel(step.kind)} · {stepStatusLabel(step.status)}</Text>
          <Text selectable style={styles.title}>{step.title}</Text>
          <Text selectable style={styles.caption}>执行：{step.runId}</Text>
          <Text style={styles.caption}>开始：{step.startedAt}</Text>
          <Text style={styles.caption}>{step.finishedAt === null ? step.status === 'running' ? '尚未结束' : '未记录可信结束时间' : `结束：${step.finishedAt}`}</Text>
          {step.result !== null && <Text selectable style={styles.body}>{step.result}</Text>}
        </View>)}
      </>}
    </> : <>
      <View style={styles.row}><Button label="当前空间活动" selected={scope === 'space'} onPress={() => setScope('space')} /><Button label="全部空间活动" selected={scope === 'all'} onPress={() => setScope('all')} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} accessibilityLabel="活动状态筛选">
        <Button label="全部活动状态" selected={!status} onPress={() => setStatus(undefined)} />
        {activityStatuses.map((value) => <Button key={value} label={activityStatusLabel(value)} selected={status === value} onPress={() => setStatus(value)} />)}
      </ScrollView>
      <Button label="刷新活动列表" disabled={snapshot.loading} onPress={store.refresh} />
      <Text style={styles.caption}>打开、回到前台及相关通知后回读；不保证逐步实时。刷新会从第一页重新读取。</Text>
      {snapshot.loading && <ActivityIndicator accessibilityLabel="正在读取活动列表" color={colors.muted} />}
      {matches && !!snapshot.error && <Text accessibilityRole="alert" style={styles.error}>{snapshot.error}</Text>}
      {matches && snapshot.stale && snapshot.loaded && <Text style={styles.caption}>以下为最后观测列表，最新状态待核对。</Text>}
      {matches && snapshot.loaded && !snapshot.activities.length && !snapshot.error && !snapshot.loading && <Text style={styles.body}>当前范围没有已登记的活动；普通聊天可能不会创建活动。</Text>}
      {matches && snapshot.activities.map((activity) => <Pressable key={activity.id} accessibilityRole="button" accessibilityLabel={`查看活动 ${activity.title}`} testID={`activity-open-${activity.id}`} onPress={() => store.select(activity.id)} style={styles.card}>
        <Text style={styles.title}>{activity.title}</Text><Text style={styles.body}>{activityStatusLabel(activity.status)}</Text>
        {!!activity.progress && <Text style={styles.body}>{activity.progress}</Text>}
        <Text style={styles.caption}>来源空间：{activity.spaceId}</Text><Text style={styles.caption}>{activity.createdAt} · {activity.runIds.length} 次执行</Text>
      </Pressable>)}
      {matches && snapshot.hasMore && <Button label="加载更多活动" disabled={snapshot.loading || snapshot.stale} onPress={store.loadMore} />}
    </>}
  </View>;
}
function Overview({ activity }: { activity: ActivityOverview }) {
  const styles = useStyles();
  return <View style={styles.card} testID="activity-detail">
    <Text selectable style={styles.title}>{activity.title}</Text><Text style={styles.body}>{activityStatusLabel(activity.status)}</Text>
    <Text selectable style={styles.body}>目标：{activity.goal}</Text><Text selectable style={styles.body}>交付：{activity.deliverable}</Text>
    <Text selectable style={styles.body}>进展：{activity.progress}</Text>
    {activity.result !== null && <Text selectable style={styles.body}>结果：{activity.result}</Text>}
    <Text selectable style={styles.caption}>活动：{activity.id}</Text><Text selectable style={styles.caption}>来源空间：{activity.spaceId}</Text>
    <Text style={styles.caption}>创建：{activity.createdAt}</Text><Text style={styles.caption}>更新：{activity.updatedAt}</Text>
    <Text style={styles.caption}>{activity.finishedAt === null ? '未记录结束时间' : `结束：${activity.finishedAt}`}</Text>
    <Text selectable style={styles.caption}>关联执行（{activity.runIds.length}）：{activity.runIds.join(' → ') || '尚未绑定'}</Text>
    {activity.currentRunId !== null && <Text selectable style={styles.caption}>当前执行：{activity.currentRunId}</Text>}
    {activity.status === 'awaiting_continuation' && <Text style={styles.body}>本轮已结束，但工作未完成；如需继续，请回聊天页明确提出。</Text>}
  </View>;
}
const createStyles = (colors: WorkspaceColors) => StyleSheet.create({
  root: { gap: spacing[12], paddingBottom: spacing[24] },
  heading: { ...workspaceTheme.typography.section, color: colors.ink },
  title: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
  body: { ...workspaceTheme.typography.detail, color: colors.muted },
  caption: { ...workspaceTheme.typography.caption, color: colors.faint },
  error: { ...workspaceTheme.typography.detail, color: colors.danger },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8], alignItems: 'center' }, filters: { gap: spacing[8] },
  card: { borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface, padding: spacing[16], gap: spacing[8] },
  button: { minHeight: workspaceTheme.layout.smallControl, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing[14], paddingVertical: spacing[8], borderRadius: workspaceTheme.radius.round, backgroundColor: colors.control, alignSelf: 'flex-start' },
  buttonText: { ...workspaceTheme.typography.status, color: colors.ink }, selected: { backgroundColor: colors.selected }, disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
});
