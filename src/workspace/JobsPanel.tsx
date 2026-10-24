import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CalendarClock, ChevronRight, Clock3, Globe2 } from 'lucide-react-native';
import { useJobs } from '../jobs/JobProvider';
import { availableJobActions, JOB_PROMPT_LIMIT, jobActionLabel, jobStatusLabel, localJobTime } from '../jobs/presentation';
import type { JobStatus, JobsQuery } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { EmptyState, StatusPill, type StatusTone } from './primitives';
import { ActivityPanel } from './ActivityPanel';
import { MonitorsPanel } from './MonitorsPanel';

function useStyles() { const { colors } = useTheme(); return useMemo(() => createStyles(colors), [colors]); }
function Button({ label, shortLabel, onPress, selected, disabled }: { label: string; shortLabel?: string; onPress: () => void; selected?: boolean; disabled?: boolean }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, selected && styles.selected, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.buttonText}>{shortLabel ?? label}</Text></Pressable>;
}

/** 任务主页面与会话面板使用同一组胶囊语言；切换仍只挂载当前领域视图。 */
export function TasksPage({ spaceId }: { spaceId: string }) {
  const [tab, setTab] = useState<'activity' | 'jobs' | 'monitors'>('activity'); const styles = useStyles(); const { colors } = useTheme();
  const tabs = [
    { id: 'activity', label: '活动历史', Icon: Clock3 },
    { id: 'jobs', label: '定时任务', Icon: CalendarClock },
    { id: 'monitors', label: '网页监控', Icon: Globe2 },
  ] as const;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
    <View accessibilityRole="tablist" accessibilityLabel="任务内容" style={styles.tablist}>
      {tabs.map(({ id, label, Icon }) => <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: tab === id }}
        testID={`tasks-tab-${id}`} onPress={() => setTab(id)} style={({ pressed }) => [styles.tab, tab === id && styles.tabSelected, pressed && styles.pressed]}>
        <Icon size={workspaceTheme.layout.iconSize - spacing[4]} color={tab === id ? colors.ink : colors.faint} strokeWidth={tab === id ? 2 : 1.6} />
        <Text numberOfLines={1} style={[styles.tabLabel, tab === id && styles.tabLabelSelected]}>{label}</Text>
      </Pressable>)}
    </View>
    {tab === 'activity' ? <ActivityPanel key={spaceId} spaceId={spaceId} defaultScope="all" /> : tab === 'jobs' ? <JobsPanel spaceId={spaceId} /> : <MonitorsPanel spaceId={spaceId} />}
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
    <View style={styles.toolbar}>
      {!!state.selectedId && <Button label="返回定时任务列表" disabled={locked || !!editor} onPress={() => store.select()} />}
      {!state.selectedId && <Text style={styles.caption}>{state.loaded ? `${state.jobs.length} 项定时任务` : '定时任务列表'}</Text>}
      <Button label="刷新定时任务" shortLabel="刷新" disabled={state.loading || state.writing} onPress={() => void store.refresh()} />
    </View>
    <Text style={styles.caption}>每日按服务端时区 {state.timeZone ?? '尚未读取'}；一次性与下次执行按手机本地时间。</Text>
    {!!state.timeZoneError && <Text accessibilityRole="alert" style={styles.error}>{state.timeZoneError}</Text>}
    {state.loading && <ActivityIndicator color={colors.muted} accessibilityLabel="正在读取定时任务" />}
    {state.stale && state.loaded && <View style={styles.warning}><Text style={styles.warningText}>最后观测数据，操作前请刷新核对。运行通知仅提示回读，最新调度结果可能稍后落盘。</Text></View>}
    {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    {!!state.notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text>}
    {state.uncertain && <View style={[styles.card, styles.warning]}><Text style={styles.title}>提交结果待核对</Text><Text style={styles.body}>网络中断不代表操作未生效。草稿已保留，不会自动重发；先刷新列表与此任务详情，核对后再解除锁定。</Text><Button label="已核对任务结果，解除锁定" disabled={!state.reviewed || state.loading || state.stale} onPress={store.acknowledgeReviewed} /></View>}
    {!state.selectedId ? <>
      <View style={styles.row}><Button label="全部空间定时任务" shortLabel="全部空间" selected={!state.query.spaceId} onPress={() => query({ spaceId: undefined })} /><Button label="当前空间定时任务" shortLabel="当前空间" selected={state.query.spaceId === spaceId} onPress={() => query({ spaceId })} /></View>
      <View style={styles.sortRow}><ScrollView horizontal showsHorizontalScrollIndicator style={styles.sortScroll} contentContainerStyle={styles.sortOptions} accessibilityLabel="定时任务排序">
        {([['nextRunAt', '按下次执行', '下次执行'], ['updatedAt', '按更新时间', '更新时间'], ['createdAt', '按创建时间', '创建时间']] as const).map(([sort, label, shortLabel]) => <Button key={sort} label={label} shortLabel={shortLabel} selected={state.query.sort === sort} onPress={() => query({ sort })} />)}
      </ScrollView><Button label={state.query.order === 'asc' ? '升序' : '降序'} onPress={() => query({ order: state.query.order === 'asc' ? 'desc' : 'asc' })} /></View>
      {state.loaded && !state.loading && !state.error && !state.jobs.length && <EmptyState compact icon={CalendarClock} title="还没有定时任务" description="在聊天中告诉 Pi Muse 何时执行任务。" />}
      {state.jobs.map((item) => <Pressable key={item.id} testID={`job-open-${item.id}`} accessibilityRole="button" accessibilityLabel={`查看定时任务 ${item.id}`} onPress={() => store.select(item.id)} style={({ pressed }) => [styles.listItem, pressed && styles.pressed]}>
        <View style={styles.listIcon}><CalendarClock size={workspaceTheme.layout.iconSize - spacing[4]} color={colors.muted} /></View><View style={styles.flex}>
          <View style={styles.titleRow}><Text numberOfLines={2} style={[styles.title, styles.flex]}>{item.title}</Text><ChevronRight size={workspaceTheme.layout.iconSize - spacing[8]} color={colors.faint} /></View>
          <View style={styles.row}><StatusPill label={jobStatusLabel(item.status)} tone={jobTone(item.status)} /><Text style={styles.caption}>{item.daily ? `每天 ${item.at} · 服务端时区` : `一次性 · ${localJobTime(item.at)}`}</Text></View>
          <Text style={styles.body}>下次执行：{localJobTime(item.nextRunAt)}</Text><Text style={styles.caption}>来源空间：{item.originSpaceId ?? '服务端未记录'}</Text>
        </View>
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
  page: { paddingHorizontal: workspaceTheme.layout.sidePadding, paddingTop: spacing[12], paddingBottom: spacing[24], gap: spacing[16] },
  tablist: { height: workspaceTheme.layout.sessionTabsHeight, flexDirection: 'row', alignItems: 'center', padding: workspaceTheme.layout.sessionTabInset, backgroundColor: colors.surface, borderRadius: workspaceTheme.radius.tab },
  tab: { flex: 1, minWidth: 0, height: workspaceTheme.layout.sessionTabsHeight - workspaceTheme.layout.sessionTabInset * 2, borderRadius: workspaceTheme.radius.round, alignItems: 'center', justifyContent: 'center', gap: workspaceTheme.layout.tabLabelGap },
  tabSelected: { backgroundColor: colors.selected }, tabLabel: { ...workspaceTheme.typography.navigation, color: colors.faint }, tabLabelSelected: { color: colors.ink },
  root: { gap: spacing[12], paddingBottom: spacing[24] }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing[8] }, sortRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] }, sortScroll: { flex: 1, minWidth: 0 }, sortOptions: { gap: spacing[8], paddingRight: spacing[8] },
  flex: { flex: 1, gap: spacing[8], minWidth: 0 }, title: { ...workspaceTheme.typography.itemTitle, color: colors.ink }, body: { ...workspaceTheme.typography.detail, color: colors.muted }, caption: { ...workspaceTheme.typography.caption, color: colors.faint }, error: { ...workspaceTheme.typography.detail, color: colors.danger },
  card: { padding: spacing[16], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface, gap: spacing[10] },
  warning: { padding: spacing[12], borderRadius: workspaceTheme.radius.field, backgroundColor: colors.warningSoft }, warningText: { ...workspaceTheme.typography.status, color: colors.warning },
  button: { minHeight: workspaceTheme.layout.smallControl, paddingHorizontal: spacing[12], paddingVertical: spacing[8], justifyContent: 'center', borderRadius: workspaceTheme.radius.round, backgroundColor: colors.control, alignSelf: 'flex-start' }, buttonText: { ...workspaceTheme.typography.status, color: colors.ink }, selected: { backgroundColor: colors.blueSoft }, disabled: { opacity: workspaceTheme.interaction.disabledOpacity }, pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[12], paddingVertical: spacing[14], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, minHeight: workspaceTheme.layout.smallControl },
  listIcon: { width: workspaceTheme.layout.rowIcon, height: workspaceTheme.layout.rowIcon, borderRadius: workspaceTheme.radius.round, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] },
  input: { ...workspaceTheme.typography.input, color: colors.ink, backgroundColor: colors.canvas, minHeight: workspaceTheme.layout.inputMinHeight, borderRadius: workspaceTheme.radius.field, padding: spacing[14] }, promptInput: { minHeight: workspaceTheme.layout.composerMaxHeight, textAlignVertical: 'top' },
  event: { borderLeftWidth: spacing[2], borderLeftColor: colors.line, paddingLeft: spacing[16], paddingVertical: spacing[8], gap: spacing[6] },
});
