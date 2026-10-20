import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApprovals } from '../approvals/ApprovalProvider';
import { hasApprovalPreview } from '../approvals/approval-store';
import { approvalScopeLabel, approvalStatusLabel, executionLabel } from '../approvals/presentation';
import type { ApprovalDecision, ApprovalFilter, ApprovalRecord, SettledApprovalStatus } from '../approvals/types';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { useWorkspaceTheme } from './WorkspaceTheme';
import { useRuntimeStore } from '../runtime/RuntimeProvider';

const HISTORY_STATUSES: { value?: SettledApprovalStatus; label: string }[] = [
  { label: '全部状态' }, { value: 'approved', label: '已批准' }, { value: 'denied', label: '已拒绝' },
  { value: 'expired', label: '已过期' }, { value: 'cancelled', label: '已撤销' },
];
function useStyles() { const { colors } = useWorkspaceTheme(); return useMemo(() => createStyles(colors), [colors]); }
function Action({ label, onPress, disabled, primary, danger }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={[styles.button, primary && styles.primary, disabled && styles.disabled]}><Text style={[styles.buttonText, primary && styles.onAccent, danger && styles.danger]}>{label}</Text></Pressable>;
}

/** 全屏会话面板内的审批领域；不混入活动历史，也不创建额外导航层或连接。 */
export function ApprovalPanel({ spaceId }: { spaceId: string }) {
  const { store, snapshot } = useApprovals(); const runtime = useRuntimeStore();
  const styles = useStyles(); const { colors } = useWorkspaceTheme();
  const [mode, setMode] = useState<'pending' | 'history'>('pending');
  const [scope, setScope] = useState<'all' | 'space'>('all');
  const [status, setStatus] = useState<SettledApprovalStatus>();
  const [selectedId, setSelectedId] = useState<string>();
  const [confirmationRequest, setConfirmation] = useState<{ decision: ApprovalDecision; revision: number; id: string; syncVersion: number }>();
  const [now, setNow] = useState(Date.now);
  const filter = useMemo<ApprovalFilter>(() => ({ ...(scope === 'space' ? { spaceId } : {}), ...(status ? { status } : {}) }), [scope, spaceId, status]);
  useEffect(() => { if (mode === 'history') void store.loadHistory(filter); }, [store, mode, filter]);
  useEffect(() => { store.select(selectedId); return () => store.select(); }, [store, selectedId]);
  const selected = selectedId ? snapshot.records[selectedId] : undefined;
  const confirmation = confirmationRequest?.id === selectedId && confirmationRequest?.revision === selected?.revision
    && confirmationRequest?.syncVersion === snapshot.syncVersion && snapshot.synchronized ? confirmationRequest : undefined;
  useEffect(() => {
    if (!selected || selected.status !== 'pending') return;
    // 仅更新过期按钮和提示，不产生网络轮询，也不本地伪造 expired 状态。
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [selected]);
  const pending = snapshot.pendingIds.map((id) => snapshot.records[id]).filter((item) => item && (scope === 'all' || item.spaceId === spaceId));
  const historyMatches = snapshot.history.filter.spaceId === filter.spaceId && snapshot.history.filter.status === filter.status;
  const history = historyMatches ? snapshot.history.ids.map((id) => snapshot.records[id]) : [];
  const canDecide = selectedId ? store.canDecide(selectedId, now) : false;
  const submitting = !!selectedId && snapshot.submittingIds.includes(selectedId);
  const loading = !!selectedId && snapshot.loadingIds.includes(selectedId);
  const submit = () => {
    if (!selectedId || !confirmation || confirmation.revision !== store.getSnapshot().records[selectedId]?.revision
      || confirmation.syncVersion !== store.getSnapshot().syncVersion || !store.canDecide(selectedId)) { setConfirmation(undefined); return; }
    const decision = confirmation.decision; setConfirmation(undefined);
    void store.decide(selectedId, decision);
  };

  return <View style={styles.root} testID="approval-panel">
    <Text style={styles.heading}>审批</Text>
    <Text style={styles.caption}>批准仅授权这一次文件操作；是否写入成功，以执行回执为准。</Text>
    {!snapshot.synchronized && <View style={styles.card}>
      <Text accessibilityRole="alert" style={styles.body}>审批状态待同步，暂时不能提交决定。</Text>
      <Text style={styles.caption}>以下是最后观测内容，不代表授权仍然有效。</Text>
      <Action label="重新同步审批" onPress={runtime.retry} />
    </View>}
    {selectedId ? <>
      <View style={styles.row}><Action label="返回审批列表" onPress={() => setSelectedId(undefined)} /><Action label="刷新审批详情" disabled={loading || submitting} onPress={() => void store.loadDetail(selectedId)} /></View>
      {loading && <ActivityIndicator accessibilityLabel="正在读取审批详情" color={colors.muted} />}
      {selected && <ApprovalHeading record={selected} />}
      {hasApprovalPreview(selected) ? <>
        <View style={styles.card}>
          <Text style={styles.title}>{approvalScopeLabel(selected.preview)}</Text>
          <Text selectable style={styles.body}>{selected.preview.path}</Text>
          <Text style={styles.caption}>{selected.kind === 'file_edit' ? '精确编辑文件' : selected.preview.beforeExists ? '覆盖已有文件' : '新建文件'} · 服务端登记时固定的完整预览</Text>
          <Preview title="修改前全文" content={selected.preview.before} empty={selected.preview.beforeExists ? '（空文件）' : '（文件尚不存在）'} />
          <Preview title="计划写入全文" content={selected.preview.after} empty="（计划写入空内容）" />
        </View>
        <View style={styles.card}>
          <Text style={styles.title}>执行回执</Text><Text style={styles.body}>{executionLabel(selected.execution)}</Text>
          {selected.execution?.result !== null && selected.execution?.result !== undefined && <Text selectable style={styles.body}>{selected.execution.result}</Text>}
          <Text style={styles.caption}>人的决定与实际提交相互独立；历史预览不代表授权仍然有效。</Text>
        </View>
        {selected.status === 'pending' && <View style={styles.card}>
          <Text style={styles.body}>{Date.parse(selected.expiresAt) <= now ? '有效期已到，等待服务器确认状态；不能继续决定。' : '请核对完整原文、计划写入内容及文件归属，再作决定。'}</Text>
          {!snapshot.pendingIds.includes(selectedId) && <Text style={styles.caption}>此项已不在最新待审批集合，正在核对最终状态。</Text>}
          {confirmation ? <>
            <Text style={styles.title}>{confirmation.decision === 'approve' ? '确认授权这一次操作？' : '确认拒绝这一次操作？'}</Text>
            <Text style={styles.caption}>{confirmation.decision === 'approve' ? '提交后工具可能立即写入上述完整内容；不会批准其他操作。' : '本次操作将不执行，不代表整项活动失败。'}</Text>
            <View style={styles.row}><Action label="暂不提交" onPress={() => setConfirmation(undefined)} /><Action label={confirmation.decision === 'approve' ? '确认批准' : '确认拒绝'} primary disabled={!canDecide} onPress={submit} /></View>
          </> : <View style={styles.row}>
            <Action label="拒绝本次操作" danger disabled={!canDecide} onPress={() => setConfirmation({ decision: 'deny', revision: selected.revision, id: selectedId, syncVersion: snapshot.syncVersion })} />
            <Action label={submitting ? '正在提交决定' : '批准本次操作'} primary disabled={!canDecide} onPress={() => setConfirmation({ decision: 'approve', revision: selected.revision, id: selectedId, syncVersion: snapshot.syncVersion })} />
          </View>}
        </View>}
      </> : !loading && <Text style={styles.body}>完整预览尚未读取，不能作决定。请刷新审批详情。</Text>}
      {!!snapshot.errors[selectedId] && <Text accessibilityRole="alert" style={styles.error}>{snapshot.errors[selectedId]}</Text>}
    </> : <>
      <View style={styles.row}>
        <Choice label="全部空间" selected={scope === 'all'} onPress={() => setScope('all')} />
        <Choice label="当前空间" selected={scope === 'space'} onPress={() => setScope('space')} />
      </View>
      <View style={styles.row}>
        <Choice label={`待审批 (${pending.length})`} selected={mode === 'pending'} onPress={() => setMode('pending')} />
        <Choice label="审批历史" selected={mode === 'history'} onPress={() => setMode('history')} />
      </View>
      {mode === 'pending' ? <>
        <Action label={snapshot.refreshing ? '正在补读待审批' : '补读待审批'} disabled={snapshot.refreshing} onPress={() => void store.refreshPending()} />
        {!!snapshot.error && <Text accessibilityRole="alert" style={styles.error}>{snapshot.error}</Text>}
        {!pending.length && <Text style={styles.body}>{snapshot.synchronized ? '当前范围没有待审批项' : '正在等待服务端的完整待审批集合'}</Text>}
        {pending.map((item) => <ApprovalRow key={item.id} record={item} onOpen={() => setSelectedId(item.id)} />)}
      </> : <>
        <View style={styles.row}>{HISTORY_STATUSES.map((item) => <Choice key={item.value ?? 'all'} label={item.label} selected={status === item.value} onPress={() => setStatus(item.value)} />)}</View>
        <Action label="刷新审批历史" disabled={snapshot.history.loading} onPress={() => void store.loadHistory(filter)} />
        {snapshot.history.dirty && <Text style={styles.caption}>历史有更新，刷新可读取最新列表；不把待审批混入历史。</Text>}
        {snapshot.history.loading && <ActivityIndicator accessibilityLabel="正在读取审批历史" color={colors.muted} />}
        {historyMatches && !!snapshot.history.error && <Text accessibilityRole="alert" style={styles.error}>{snapshot.history.error}</Text>}
        {historyMatches && snapshot.history.loaded && !history.length && !snapshot.history.error && <Text style={styles.body}>当前范围没有审批历史</Text>}
        {history.map((item) => <ApprovalRow key={item.id} record={item} onOpen={() => setSelectedId(item.id)} />)}
        {historyMatches && snapshot.history.hasMore && <Action label="加载更多审批历史" disabled={snapshot.history.loading} onPress={() => void store.loadHistory(filter, true)} />}
      </>}
    </>}
  </View>;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.button, selected && styles.selected]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function ApprovalRow({ record, onOpen }: { record: ApprovalRecord; onOpen: () => void }) {
  const styles = useStyles();
  const title = 'title' in record ? record.title : '审批详情待同步';
  return <Pressable accessibilityRole="button" accessibilityLabel={`查看审批 ${title}`} testID={`approval-open-${record.id}`} onPress={onOpen} style={styles.card}>
    <Text style={styles.title}>{title}</Text><Text style={styles.body}>{approvalStatusLabel(record.status)}</Text>
    <Text style={styles.caption}>来源空间：{record.spaceId ?? '未关联会话'}</Text>
    {record.subagentId !== null && <Text style={styles.caption}>子代理：{record.subagentId}</Text>}
    {record.status !== 'pending' && <Text style={styles.caption}>{executionLabel(record.execution)}</Text>}
    <Text style={styles.caption}>{record.resolvedAt ?? record.createdAt} · 查看完整预览与详情</Text>
  </Pressable>;
}
function ApprovalHeading({ record }: { record: ApprovalRecord }) {
  const styles = useStyles();
  return <View style={styles.card}>
    <Text style={styles.title}>{'title' in record ? record.title : '审批详情'}</Text><Text style={styles.body}>{approvalStatusLabel(record.status)}</Text>
    <Text selectable style={styles.caption}>审批：{record.id} · revision {record.revision}</Text>
    <Text selectable style={styles.caption}>来源空间：{record.spaceId ?? '未关联会话'}</Text>
    {(['runId', 'toolCallId', 'subagentId', 'activityId'] as const).map((key) => record[key] !== null && <Text key={key} selectable style={styles.caption}>{key}：{record[key]}</Text>)}
    <Text style={styles.caption}>有效期至：{record.expiresAt}</Text>
    {record.decidedAt !== null && <Text style={styles.caption}>人工决定：{record.decidedAt}</Text>}
    {record.resolvedAt !== null && <Text style={styles.caption}>状态结束：{record.resolvedAt}</Text>}
  </View>;
}
function Preview({ title, content, empty }: { title: string; content: string; empty: string }) {
  const styles = useStyles();
  return <View style={styles.previewBlock}><Text style={styles.title}>{title}</Text>
    {/* 原样显示不可变全文；不执行 HTML/Markdown，不把正文里的指令当成应用操作。 */}
    <ScrollView nestedScrollEnabled style={styles.preview} contentContainerStyle={styles.previewContent} accessibilityLabel={title}>
      <Text selectable style={styles.previewText}>{content === '' ? empty : content}</Text>
    </ScrollView>
  </View>;
}
const createStyles = (colors: WorkspaceColors) => StyleSheet.create({
  root: { gap: spacing[12], paddingBottom: spacing[24] },
  heading: { ...workspaceTheme.typography.section, color: colors.ink },
  title: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
  body: { ...workspaceTheme.typography.detail, color: colors.muted },
  caption: { ...workspaceTheme.typography.caption, color: colors.faint },
  error: { ...workspaceTheme.typography.detail, color: colors.danger },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8], alignItems: 'center' },
  card: { borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface, padding: spacing[16], gap: spacing[8] },
  button: { minHeight: workspaceTheme.layout.smallControl, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing[14], paddingVertical: spacing[8], borderRadius: workspaceTheme.radius.round, backgroundColor: colors.control, alignSelf: 'flex-start' },
  buttonText: { ...workspaceTheme.typography.status, color: colors.ink },
  primary: { backgroundColor: colors.blue }, selected: { backgroundColor: colors.selected },
  onAccent: { color: colors.onAccent }, danger: { color: colors.danger }, disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
  previewBlock: { gap: spacing[8], marginTop: spacing[8] },
  preview: { maxHeight: workspaceTheme.layout.approvalPreviewMaxHeight, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: workspaceTheme.radius.listItem },
  previewContent: { padding: spacing[12] }, previewText: { ...workspaceTheme.typography.detail, color: colors.ink },
});
