import { ChevronRight, RefreshCw } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useJobs } from '../jobs/JobProvider';
import { useMonitors } from '../monitors/MonitorProvider';
import { availableJobActions, JOB_PROMPT_LIMIT, jobActionLabel, jobStatusLabel, localJobTime } from '../jobs/presentation';
import { availableMonitorActions, monitorActionLabel, monitorStatusLabel } from '../monitors/monitor-store';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { Sheet } from '../ui/Sheet';
import { Card } from '../ui/Surfaces';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme } from '../ui/tokens';

/** 设置子页只消费已有领域 Store；写入确认与未明结果仍由原所有者守护。 */
export function SchedulePanel({ kind }: { kind: 'jobs' | 'monitors' }) {
  return kind === 'jobs' ? <Jobs /> : <Monitors />;
}

function ScheduleFeedback({ state, label, refresh, acknowledge }: {
  state: { error?: string; notice?: string; loading: boolean; writing: boolean; uncertain: boolean; reviewed: boolean };
  label: string;
  refresh: () => void;
  acknowledge: () => void;
}) {
  const { colors } = useTheme();
  if (!state.error && !state.notice && !state.uncertain) return null;
  return <Card tone={state.uncertain ? 'warning' : 'default'} style={styles.stack}>
    {!!state.error && <Text accessibilityRole="alert" style={[styles.detail, { color: colors.danger }]}>{state.error}</Text>}
    {!!state.notice && <Text accessibilityLiveRegion="polite" style={[styles.detail, { color: colors.muted }]}>{state.notice}</Text>}
    {state.uncertain && <ActionButton
      label={state.reviewed ? `已核对${label}，解除锁定` : `回读核对${label}`}
      disabled={state.loading || state.writing} onPress={state.reviewed ? acknowledge : refresh} />}
    {!state.uncertain && !!state.error && <ActionButton label={`重新读取${label}`} disabled={state.loading || state.writing} onPress={refresh} />}
  </Card>;
}

function ScheduleList({ label, empty, count, loading, loaded, writing, refresh, children }: {
  label: string;
  empty: string;
  count: number;
  loading: boolean;
  loaded: boolean;
  writing: boolean;
  refresh: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return <View style={styles.stack}>
    <View style={styles.listHeader}>
      <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: colors.muted }]}>
        {loaded ? `${count} 项` : loading ? '正在读取…' : ''}
      </Text>
      <ActionButton label={`刷新${label}`} text="刷新" icon={RefreshCw} disabled={loading || writing} onPress={refresh} />
    </View>
    {count > 0 && <Card style={styles.list}>{children}</Card>}
    {loaded && count === 0 && <Card><Text style={[styles.detail, { color: colors.muted }]}>{empty}</Text></Card>}
  </View>;
}

function ScheduleRow({ title, description, divider, disabled, onPress }: {
  title: string;
  description: string;
  divider: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}，${description}`} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.row, { borderTopWidth: divider ? StyleSheet.hairlineWidth : 0, borderColor: colors.line,
      backgroundColor: pressed ? colors.selected : colors.surface }]}>
    <View style={styles.rowText}>
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text numberOfLines={1} style={[styles.caption, { color: colors.muted }]}>{description}</Text>
    </View>
    <ChevronRight size={18} color={colors.muted} />
  </Pressable>;
}

function Jobs() {
  const { store, snapshot: state } = useJobs();
  const { colors } = useTheme();
  const [showDetail, setShowDetail] = useState(false);
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  const job = state.detail?.job;
  const { editor, confirmation } = state;
  const inSheet = showDetail || !!editor;
  const canEdit = store.canWrite() && job?.status !== 'running' && job?.status !== 'queued';
  const refresh = () => void store.refresh();
  const feedback = <ScheduleFeedback state={state} label="任务" refresh={refresh} acknowledge={store.acknowledgeReviewed} />;

  const close = () => {
    if (state.writing) return;
    if (confirmation) { store.cancelAction(); return; }
    if (editor) {
      if (state.uncertain) return;
      const discard = () => { Keyboard.dismiss(); store.cancelEdit(); };
      if (editor.prompt === editor.original.prompt) discard();
      else Alert.alert('放弃提示词修改？', undefined, [
        { text: '继续编辑', style: 'cancel' }, { text: '放弃修改', style: 'destructive', onPress: discard },
      ]);
      return;
    }
    setShowDetail(false);
  };

  return <View style={styles.stack}>
    {!inSheet && feedback}
    <ScheduleList label="任务" empty="还没有定时任务" count={state.jobs.length} loading={state.loading}
      loaded={state.loaded} writing={state.writing} refresh={refresh}>
      {state.jobs.map((item, index) => <ScheduleRow key={item.id} title={item.title} divider={index > 0}
        description={`${jobStatusLabel(item.status)} · ${item.daily ? `每天 ${item.at}` : localJobTime(item.at)}`}
        disabled={state.writing || state.uncertain || !!editor}
        onPress={() => { store.select(item.id); setShowDetail(true); }} />)}
    </ScheduleList>
    {inSheet && <Sheet title={editor ? '编辑任务提示词' : confirmation ? jobActionLabel(confirmation.action) : job?.title ?? '任务详情'}
      onClose={close}
      footer={editor ? <View style={styles.footer}>
        <ActionButton label="取消编辑任务" text="取消" onPress={close} disabled={state.writing || state.uncertain} />
        <ActionButton label="保存任务" text="保存" tone="primary" busy={state.writing}
          disabled={!canEdit || !editor.prompt.trim() || editor.prompt === editor.original.prompt || editor.prompt.length > JOB_PROMPT_LIMIT}
          onPress={() => { Keyboard.dismiss(); void store.save(); }} />
      </View> : confirmation ? <View style={styles.footer}>
        <ActionButton label="取消任务操作" text="取消" onPress={store.cancelAction} disabled={state.writing} />
        <ActionButton label="确认任务操作" text={jobActionLabel(confirmation.action)}
          tone={confirmation.action === 'delete' || confirmation.action === 'cancel' ? 'danger' : 'primary'}
          busy={state.writing} disabled={!store.canWrite()}
          onPress={() => void store.confirmAction().then((success) => { if (success && confirmation.action === 'delete') setShowDetail(false); })} />
      </View> : undefined}>
      <View style={styles.stack}>
        {feedback}
        {editor ? <>
          <FormInput accessibilityLabel="任务提示词" multiline textAlignVertical="top" value={editor.prompt}
            maxLength={JOB_PROMPT_LIMIT} onChangeText={(prompt) => store.setEditor({ prompt })}
            editable={!state.writing && !state.uncertain} style={styles.input} />
          <Text style={[styles.caption, { color: colors.muted }]}>{editor.prompt.length} / {JOB_PROMPT_LIMIT}</Text>
        </> : confirmation ? <Text style={[styles.detail, { color: colors.ink }]}>
          {confirmation.action === 'delete' ? `将永久删除「${job?.title}」。` : `对「${job?.title}」执行${jobActionLabel(confirmation.action)}？`}
        </Text> : job ? <>
          <Text style={[styles.caption, { color: colors.muted }]}>
            {jobStatusLabel(job.status)} · {job.daily ? `每天 ${job.at}${state.timeZone ? `（${state.timeZone}）` : ''}` : localJobTime(job.at)}
          </Text>
          <Card style={styles.stack}>
            <Text style={[styles.caption, { color: colors.muted }]}>任务提示词</Text>
            <Text selectable style={[styles.detail, { color: colors.ink }]}>{job.prompt}</Text>
            <ActionButton label="编辑任务提示词" text="编辑提示词" onPress={store.edit} disabled={!canEdit} />
          </Card>
          <View style={styles.actions}>
            {availableJobActions(job).map((action) => <ActionButton key={action} label={jobActionLabel(action)}
              onPress={() => store.requestAction(action)} disabled={!store.canWrite()} />)}
            <ActionButton label="删除任务" tone="danger" onPress={() => store.requestAction('delete')} disabled={!canEdit} />
          </View>
          {!!state.detail?.events.length && <Card style={styles.stack}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>执行记录</Text>
            {state.detail.events.map((event) => <Text key={event.id} style={[styles.caption, { color: colors.muted }]}>{event.title} · {event.detail}</Text>)}
          </Card>}
        </> : state.loading && <Text style={[styles.detail, { color: colors.muted }]}>正在读取任务…</Text>}
      </View>
    </Sheet>}
  </View>;
}

function Monitors() {
  const { store, snapshot: state } = useMonitors();
  const { colors } = useTheme();
  const [selectedId, setSelectedId] = useState<string>();
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  const monitor = state.monitors.find((item) => item.id === selectedId);
  const { deleteTarget } = state;
  const refresh = () => void store.refresh();
  const feedback = <ScheduleFeedback state={state} label="监控" refresh={refresh} acknowledge={store.acknowledgeReviewed} />;
  const close = () => {
    if (state.writing) return;
    if (deleteTarget) store.cancelDelete();
    else setSelectedId(undefined);
  };

  return <View style={styles.stack}>
    {!selectedId && feedback}
    <ScheduleList label="监控" empty="还没有网页监控" count={state.monitors.length} loading={state.loading}
      loaded={state.loaded} writing={state.writing} refresh={refresh}>
      {state.monitors.map((item, index) => <ScheduleRow key={item.id} title={item.title} divider={index > 0}
        description={monitorStatusLabel(item.status)} disabled={state.writing}
        onPress={() => setSelectedId(item.id)} />)}
    </ScheduleList>
    {selectedId && <Sheet title={deleteTarget ? '删除监控' : monitor?.title ?? '监控详情'} onClose={close}
      footer={deleteTarget && <View style={styles.footer}>
        <ActionButton label="取消删除监控" text="取消" onPress={store.cancelDelete} disabled={state.writing} />
        <ActionButton label="确认删除监控" text="删除" tone="danger" busy={state.writing} disabled={!store.canWrite()}
          onPress={() => void store.confirmDelete().then((success) => { if (success) setSelectedId(undefined); })} />
      </View>}>
      <View style={styles.stack}>
        {feedback}
        {deleteTarget ? <Text style={[styles.detail, { color: colors.ink }]}>将永久删除「{deleteTarget.title}」。</Text>
          : monitor ? <>
            <Card style={styles.stack}>
              <Text style={[styles.caption, { color: colors.muted }]}>{monitorStatusLabel(monitor.status)}</Text>
              <Text selectable style={[styles.detail, { color: colors.ink }]}>{monitor.url}</Text>
            </Card>
            <View style={styles.actions}>
              {availableMonitorActions(monitor).map((action) => <ActionButton key={action} label={monitorActionLabel(action)}
                onPress={() => void store.control(monitor.id, action)} disabled={!store.canWrite()} />)}
              <ActionButton label={`删除监控 ${monitor.title}`} text="删除监控" tone="danger"
                onPress={() => store.requestDelete(monitor.id)} disabled={!store.canWrite()} />
            </View>
          </> : <Text style={[styles.detail, { color: colors.muted }]}>此监控已不存在。</Text>}
      </View>
    </Sheet>}
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing[12] },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { padding: 0, overflow: 'hidden' },
  row: { minHeight: 58, paddingHorizontal: spacing[16], paddingVertical: spacing[12], gap: spacing[12], flexDirection: 'row', alignItems: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: spacing[2] },
  title: { ...workspaceTheme.typography.itemTitle, fontWeight: '600' },
  caption: workspaceTheme.typography.caption,
  detail: workspaceTheme.typography.detail,
  input: { minHeight: 96, maxHeight: 170 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  footer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing[8] },
});
