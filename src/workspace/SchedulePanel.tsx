import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useJobs } from '../jobs/JobProvider';
import { useMonitors } from '../monitors/MonitorProvider';
import { availableJobActions, jobActionLabel } from '../jobs/presentation';
import { availableMonitorActions, monitorActionLabel, monitorStatusLabel } from '../monitors/monitor-store';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../ui/tokens';

/** 设置子页只消费已有领域 Store；写入确认与未明结果仍由原所有者守护。 */
export function SchedulePanel({ kind }: { kind: 'jobs' | 'monitors' }) {
  return kind === 'jobs' ? <Jobs /> : <Monitors />;
}
function Jobs() {
  const { store, snapshot: state } = useJobs(); const { colors } = useTheme();
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  const job = state.detail?.job;
  return <View style={{ gap: spacing[12] }}>
    <ActionButton label="刷新任务" onPress={() => void store.refresh()} disabled={state.writing} />
    {!!state.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{state.error}</Text>}
    {!!state.notice && <Text style={{ color: colors.muted }}>{state.notice}</Text>}
    {state.uncertain && <ActionButton label="已回读并核对任务，解除锁定" disabled={!state.reviewed} onPress={store.acknowledgeReviewed} />}
    {state.jobs.map((item) => <ActionButton key={item.id} label={`${item.title} · ${item.status}`} onPress={() => store.select(item.id)} disabled={state.writing || state.uncertain || !!state.editor} />)}
    {job && <><Text selectable style={{ color: colors.ink }}>{job.prompt}</Text><Text style={{ color: colors.muted }}>{job.at}</Text>
      {availableJobActions(job).map((action) => <ActionButton key={action} label={jobActionLabel(action)} onPress={() => store.requestAction(action)} disabled={!store.canWrite()} />)}
      <ActionButton label="编辑任务提示词" onPress={store.edit} disabled={!store.canWrite()} /><ActionButton label="删除任务" tone="danger" onPress={() => store.requestAction('delete')} disabled={!store.canWrite()} />
      {state.detail?.events.map((event) => <Text key={event.id} style={{ color: colors.muted }}>{event.title} · {event.detail}</Text>)}
    </>}
    {state.editor && <><FormInput accessibilityLabel="任务提示词" multiline value={state.editor.prompt} onChangeText={(prompt) => store.setEditor({ prompt })} editable={!state.writing && !state.uncertain} /><ActionButton label="保存任务" onPress={() => void store.save()} disabled={!store.canWrite()} /><ActionButton label="取消编辑任务" onPress={store.cancelEdit} disabled={state.writing || state.uncertain} /></>}
    {state.confirmation && <><Text style={{ color: colors.warning }}>确认{jobActionLabel(state.confirmation.action)}此任务？此操作可能不可撤销。</Text><ActionButton label="确认任务操作" onPress={() => void store.confirmAction()} disabled={!store.canWrite()} /><ActionButton label="取消任务操作" onPress={store.cancelAction} disabled={state.writing} /></>}
  </View>;
}
function Monitors() {
  const { store, snapshot: state } = useMonitors(); const { colors } = useTheme();
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  return <View style={{ gap: spacing[12] }}><ActionButton label="刷新监控" onPress={() => void store.refresh()} disabled={state.writing} />
    {!!state.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{state.error}</Text>}
    {!!state.notice && <Text style={{ color: colors.muted }}>{state.notice}</Text>}
    {state.uncertain && <ActionButton label="已回读并核对监控，解除锁定" disabled={!state.reviewed} onPress={store.acknowledgeReviewed} />}
    {state.monitors.map((monitor) => <View key={monitor.id} style={{ gap: spacing[8] }}><Text style={{ color: colors.ink }}>{monitor.title} · {monitorStatusLabel(monitor.status)}</Text><Text selectable style={{ color: colors.muted }}>{monitor.url}</Text>
      {availableMonitorActions(monitor).map((action) => <ActionButton key={action} label={monitorActionLabel(action)} onPress={() => void store.control(monitor.id, action)} disabled={!store.canWrite()} />)}
      <ActionButton label={`删除监控 ${monitor.title}`} tone="danger" onPress={() => store.requestDelete(monitor.id)} disabled={!store.canWrite()} /></View>)}
    {state.deleteTarget && <><Text style={{ color: colors.warning }}>确认删除 {state.deleteTarget.title}？无法恢复。</Text><ActionButton label="确认删除监控" onPress={() => void store.confirmDelete()} disabled={!store.canWrite()} /><ActionButton label="取消删除监控" onPress={store.cancelDelete} disabled={state.writing} /></>}
  </View>;
}
