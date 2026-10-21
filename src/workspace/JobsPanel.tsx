import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CalendarClock, ChevronRight } from 'lucide-react-native';
import { useJobs } from '../jobs/JobProvider';
import { availableJobActions, JOB_PROMPT_LIMIT, jobActionLabel, jobStatusLabel, localJobTime } from '../jobs/presentation';
import type { JobStatus, JobsQuery } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { EmptyState, SectionHeading, StatusPill, type StatusTone } from './primitives';
import { ActivityPanel } from './ActivityPanel';

function useStyles() { const { colors } = useTheme(); return useMemo(() => createStyles(colors), [colors]); }
function Button({ label, onPress, selected, disabled }: { label: string; onPress: () => void; selected?: boolean; disabled?: boolean }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, selected && styles.selected, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

/** 任务主页面只增加同层切换，不改变四个主 Tab 或会话面板的历史入口。 */
export function TasksPage({ spaceId }: { spaceId: string }) {
  const [tab, setTab] = useState<'activity' | 'jobs'>('activity'); const styles = useStyles();
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
    <View style={styles.row}><Button label="活动历史" selected={tab === 'activity'} onPress={() => setTab('activity')} /><Button label="定时任务" selected={tab === 'jobs'} onPress={() => setTab('jobs')} /></View>
    {tab === 'activity' ? <ActivityPanel key={spaceId} spaceId={spaceId} defaultScope="all" /> : <JobsPanel spaceId={spaceId} />}
  </ScrollView>;
}
function jobTone(status: JobStatus): StatusTone {
  return status === 'failed' ? 'danger' : status === 'succeeded' ? 'success' : status === 'running' || status === 'queued' ? 'accent' : status === 'paused' ? 'warning' : 'neutral';
}

export function JobsPanel({ spaceId }: { spaceId: string }) {
  const { store, snapshot: state } = useJobs(); const styles = useStyles(); const { colors } = useTheme();
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  useEffect(() => {
    if (state.query.spaceId && state.query.spaceId !== spaceId && !state.editor && !state.uncertain && !state.writing) store.setQuery({ ...state.query, spaceId });
  }, [spaceId, store, state.query, state.editor, state.uncertain, state.writing]);
  const job = state.detail?.job; const editor = state.editor;
  const disabled = !store.canWrite();
  const locked = state.writing || state.uncertain;
  const query = (patch: Partial<JobsQuery>) => store.setQuery({ ...state.query, ...patch });
  return <View style={styles.root} testID="jobs-panel">
    <SectionHeading title="定时任务" eyebrow="AT THE RIGHT TIME" description="在聊天中告诉 Pi Muse 何时做什么；这里管理真实的排期与执行记录。" />
    <View style={styles.row}>
      {!!state.selectedId && <Button label="返回定时任务列表" disabled={locked || !!editor} onPress={() => store.select()} />}
      <Button label="刷新定时任务" disabled={state.loading || state.writing} onPress={() => void store.refresh()} />
    </View>
    <Text style={styles.caption}>每日时刻按服务端时区：{state.timeZone ?? '尚未读取'}。一次性任务与下次执行时刻按手机本地时间展示。</Text>
    {!!state.timeZoneError && <Text accessibilityRole="alert" style={styles.error}>{state.timeZoneError}</Text>}
    {state.loading && <ActivityIndicator color={colors.muted} accessibilityLabel="正在读取定时任务" />}
    {state.stale && state.loaded && <Text style={styles.caption}>最后观测数据，操作前请刷新核对。运行通知仅提示回读，最新调度结果可能稍后落盘。</Text>}
    {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    {!!state.notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text>}
    {state.uncertain && <View style={styles.card}><Text style={styles.title}>提交结果待核对</Text><Text style={styles.body}>网络中断不代表操作未生效。草稿已保留，不会自动重发；先刷新列表与此任务详情，核对后再解除锁定。</Text><Button label="已核对任务结果，解除锁定" disabled={!state.reviewed || state.loading || state.stale} onPress={store.acknowledgeReviewed} /></View>}
    {!state.selectedId ? <>
      <View style={styles.row}><Button label="全部空间定时任务" selected={!state.query.spaceId} onPress={() => query({ spaceId: undefined })} /><Button label="当前空间定时任务" selected={state.query.spaceId === spaceId} onPress={() => query({ spaceId })} /></View>
      <View style={styles.row}>{([['nextRunAt', '按下次执行'], ['updatedAt', '按更新时间'], ['createdAt', '按创建时间']] as const).map(([sort, label]) => <Button key={sort} label={label} selected={state.query.sort === sort} onPress={() => query({ sort })} />)}<Button label={state.query.order === 'asc' ? '升序' : '降序'} onPress={() => query({ order: state.query.order === 'asc' ? 'desc' : 'asc' })} /></View>
      {state.loaded && !state.loading && !state.error && !state.jobs.length && <EmptyState icon={CalendarClock} title="还没有定时任务" description="可以回到聊天，试着说：每天早上九点提醒我安排今天的工作。这里不会显示示例任务。" />}
      {state.jobs.map((item) => <Pressable key={item.id} testID={`job-open-${item.id}`} accessibilityRole="button" accessibilityLabel={`查看定时任务 ${item.id}`} onPress={() => store.select(item.id)} style={({ pressed }) => [styles.listItem, pressed && styles.pressed]}>
        <CalendarClock size={workspaceTheme.layout.iconSize} color={colors.muted} /><View style={styles.flex}><Text numberOfLines={2} style={styles.title}>{item.title}</Text><StatusPill label={jobStatusLabel(item.status)} tone={jobTone(item.status)} /><Text style={styles.caption}>{item.daily ? `每天 ${item.at} · 服务端时区` : `一次性 · ${localJobTime(item.at)}`}</Text><Text style={styles.caption}>下次执行：{localJobTime(item.nextRunAt)}</Text><Text style={styles.caption}>来源空间：{item.originSpaceId ?? '服务端未记录'}</Text></View><ChevronRight size={workspaceTheme.layout.iconSize} color={colors.faint} />
      </Pressable>)}
    </> : <>
      {editor && <View style={styles.card} testID="job-editor">
        <Text style={styles.title}>编辑任务</Text><Text style={styles.caption}>保存只更新此任务，不改变接收结果的来源空间。刷新不会覆盖未保存草稿。</Text>
        <TextInput accessibilityLabel="定时任务内容" value={editor.prompt} editable={!locked} multiline maxLength={JOB_PROMPT_LIMIT} onChangeText={(prompt) => store.setEditor({ prompt })} style={[styles.input, styles.promptInput]} placeholderTextColor={colors.faint} />
        <View style={styles.row}><Button label="每日重复" selected={editor.daily} disabled={locked} onPress={() => store.setEditor({ daily: true })} /><Button label="仅一次" selected={!editor.daily} disabled={locked} onPress={() => store.setEditor({ daily: false })} /></View>
        {!editor.daily && <><Text style={styles.caption}>手机本地日期 · YYYY-MM-DD</Text><TextInput accessibilityLabel="定时任务日期" value={editor.date} editable={!locked} maxLength={10} autoCapitalize="none" autoCorrect={false} onChangeText={(date) => store.setEditor({ date })} style={styles.input} placeholder="2026-10-29" placeholderTextColor={colors.faint} /></>}
        <Text style={styles.caption}>{editor.daily ? `服务端 ${state.timeZone ?? '未知时区'} 时刻` : '手机本地时刻'} · HH:mm</Text>
        <TextInput accessibilityLabel="定时任务时刻" value={editor.time} editable={!locked} maxLength={5} autoCapitalize="none" autoCorrect={false} onChangeText={(time) => store.setEditor({ time })} style={styles.input} placeholder="09:00" placeholderTextColor={colors.faint} />
        <View style={styles.row}><Button label="保存定时任务" disabled={disabled} onPress={() => void store.save()} /><Button label="取消编辑定时任务" disabled={locked} onPress={store.cancelEdit} /></View>
      </View>}
      {job && <>
        <View style={styles.card} testID="job-detail"><View style={styles.row}><StatusPill label={jobStatusLabel(job.status)} tone={jobTone(job.status)} /><Text style={styles.caption}>{job.enabled ? '调度已启用' : '调度未启用'}</Text></View>
          <Text selectable style={styles.title}>{job.title}</Text><Text selectable style={styles.body}>{job.prompt}</Text>
          <Text style={styles.body}>{job.daily ? `每天 ${job.at} · ${state.timeZone ?? '服务端时区'}` : `一次性 · ${localJobTime(job.at)}`}</Text>
          <Text style={styles.body}>下次执行：{localJobTime(job.nextRunAt)}</Text><Text style={styles.caption}>最近执行：{job.lastRunAt ? localJobTime(job.lastRunAt) : '尚未执行'}</Text>
          <Text selectable style={styles.caption}>来源空间：{job.originSpaceId ?? '服务端未记录'}</Text><Text selectable style={styles.caption}>任务 ID：{job.id}</Text>
          <Text style={styles.caption}>创建：{localJobTime(job.createdAt)}</Text><Text style={styles.caption}>更新：{localJobTime(job.updatedAt)}</Text>
        </View>
        {!editor && <View style={styles.row}><Button label="编辑定时任务" disabled={disabled || job.status === 'running' || job.status === 'queued'} onPress={store.edit} />{availableJobActions(job).map((action) => <Button key={action} label={jobActionLabel(action)} disabled={disabled} onPress={() => store.requestAction(action)} />)}<Button label="删除定时任务" disabled={disabled || job.status === 'running' || job.status === 'queued'} onPress={() => store.requestAction('delete')} /></View>}
        <Text style={styles.caption}>暂停只影响后续调度，不停止正在执行的一轮。执行中或排队中请先等待结束，再管理排期。</Text>
        {state.confirmation && <View style={styles.card} accessibilityViewIsModal><Text style={styles.title}>确认{jobActionLabel(state.confirmation.action)}？</Text><Text style={styles.body}>{state.confirmation.action === 'delete' ? '将永久删除此任务和任务时间线，无法恢复；不删除来源空间。' : state.confirmation.action === 'retry' ? '将立即启动一次真实模型执行，可能产生工具调用、审批和费用；不会自动重复提交。' : state.confirmation.action === 'cancel' ? '取消后不再按原计划调度；这不是正在执行的聊天的停止按钮。' : '仅调整此任务的后续调度，不修改来源空间及任务内容。'}</Text><Text selectable style={styles.caption}>{job.id}</Text><View style={styles.row}><Button label={`确认${jobActionLabel(state.confirmation.action)}`} disabled={disabled} onPress={() => void store.confirmAction()} /><Button label="放弃任务操作" disabled={state.writing} onPress={store.cancelAction} /></View></View>}
        {job.lastResult !== undefined && <View style={styles.card}><Text style={styles.title}>最近执行结果</Text><Text selectable style={styles.body}>{job.lastResult || '未返回文本摘要'}</Text></View>}
        {job.error !== null && <Text selectable accessibilityRole="alert" style={styles.error}>{job.error}</Text>}
        <Text style={styles.title}>任务时间线 · {state.detail?.events.length ?? 0}</Text><Text style={styles.caption}>按服务端返回顺序展示最近运行与控制记录，不代表全部聊天历史。</Text>
        {state.detail?.events.map((event) => <View key={event.id} style={styles.event}><Text style={styles.caption}>{localJobTime(event.date)} · {event.kind}</Text><Text selectable style={styles.title}>{event.title}</Text><Text selectable style={styles.body}>{event.detail}</Text></View>)}
      </>}
    </>}
  </View>;
}
const createStyles = (colors: WorkspaceColors) => StyleSheet.create({
  page: { paddingHorizontal: workspaceTheme.layout.sidePadding, paddingTop: spacing[20], paddingBottom: spacing[24], gap: spacing[22] },
  root: { gap: spacing[16], paddingBottom: spacing[24] }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
  flex: { flex: 1, gap: spacing[8], minWidth: 0 }, title: { ...workspaceTheme.typography.itemTitle, color: colors.ink }, body: { ...workspaceTheme.typography.detail, color: colors.muted }, caption: { ...workspaceTheme.typography.caption, color: colors.faint }, error: { ...workspaceTheme.typography.detail, color: colors.danger },
  card: { padding: spacing[20], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface, gap: spacing[12] },
  button: { minHeight: workspaceTheme.layout.smallControl, paddingHorizontal: spacing[14], paddingVertical: spacing[8], justifyContent: 'center', borderRadius: workspaceTheme.radius.round, backgroundColor: colors.surface, alignSelf: 'flex-start' }, buttonText: { ...workspaceTheme.typography.status, color: colors.ink }, selected: { backgroundColor: colors.blueSoft }, disabled: { opacity: workspaceTheme.interaction.disabledOpacity }, pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[14], paddingVertical: spacing[20], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  input: { ...workspaceTheme.typography.input, color: colors.ink, backgroundColor: colors.canvas, minHeight: workspaceTheme.layout.inputMinHeight, borderRadius: workspaceTheme.radius.field, padding: spacing[14] }, promptInput: { minHeight: workspaceTheme.layout.composerMaxHeight, textAlignVertical: 'top' },
  event: { borderLeftWidth: spacing[2], borderLeftColor: colors.line, paddingLeft: spacing[16], paddingVertical: spacing[8], gap: spacing[6] },
});
