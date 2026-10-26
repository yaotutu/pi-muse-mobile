import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, ChevronRight, FilePenLine, ShieldCheck } from 'lucide-react-native';
import { useApprovals } from '../approvals/ApprovalProvider';
import { hasApprovalPreview } from '../approvals/approval-store';
import { approvalScopeLabel, approvalStatusLabel, executionLabel } from '../approvals/presentation';
import type { ApprovalDecision, ApprovalFilter, ApprovalRecord, SettledApprovalStatus } from '../approvals/types';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { useRuntimeStore } from '../runtime/RuntimeProvider';
import { EmptyState, StatusPill, type StatusTone } from './primitives';
import { ActionButton } from '../ui/ActionButton';
import { ChoiceChip } from '../ui/ChoiceChip';

const HISTORY_STATUSES: { value?: SettledApprovalStatus; label: string }[] = [
  { label: '全部状态' }, { value: 'approved', label: '已批准' }, { value: 'denied', label: '已拒绝' },
  { value: 'expired', label: '已过期' }, { value: 'cancelled', label: '已撤销' },
];
function useStyles() { const { colors } = useTheme(); return useMemo(() => createStyles(colors), [colors]); }

/** 全屏会话面板内的审批领域；不混入活动历史，也不创建额外导航层或连接。 */
export function ApprovalPanel({ spaceId, defaultScope = 'space' }: { spaceId: string; defaultScope?: 'all' | 'space' }) {
  const { store, snapshot } = useApprovals(); const runtime = useRuntimeStore();
  const styles = useStyles(); const { colors } = useTheme();
  const [mode, setMode] = useState<'pending' | 'history'>('pending');
  const [scope, setScope] = useState<'all' | 'space'>(defaultScope);
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
    {!snapshot.synchronized && <Card style={styles.card}>
      <Text accessibilityRole="alert" style={styles.body}>审批状态待同步，暂时不能提交决定。</Text>
      <Text style={styles.caption}>以下是最后观测内容，不代表授权仍然有效。</Text>
      <ActionButton label="重新同步审批" onPress={runtime.retry} />
    </Card>}
    {selectedId ? <>
      <Pressable accessibilityRole="button" accessibilityLabel="返回审批列表" onPress={() => setSelectedId(undefined)} style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}><ArrowLeft size={18} color={colors.ink} /><Text style={styles.backText}>返回审批列表</Text></Pressable>
      {loading && <ActivityIndicator accessibilityLabel="正在读取审批详情" color={colors.muted} />}
      {selected && <ApprovalHeading record={selected} />}
      {hasApprovalPreview(selected) ? <>
        <Card style={styles.card}>
          <Text style={styles.title}>{approvalScopeLabel(selected.preview)}</Text>
          <Text selectable style={styles.body}>{selected.preview.path}</Text>
          <Text style={styles.caption}>{selected.kind === 'file_edit' ? '精确编辑文件' : selected.preview.beforeExists ? '覆盖已有文件' : '新建文件'} · 服务端登记时固定的完整预览</Text>
          <Preview title="修改前全文" content={selected.preview.before} empty={selected.preview.beforeExists ? '（空文件）' : '（文件尚不存在）'} />
          <Preview title="计划写入全文" content={selected.preview.after} empty="（计划写入空内容）" />
        </Card>
        <Card style={styles.card}>
          <Text style={styles.title}>执行回执</Text><Text style={styles.body}>{executionLabel(selected.execution)}</Text>
          {selected.execution?.result !== null && selected.execution?.result !== undefined && <Text selectable style={styles.body}>{selected.execution.result}</Text>}
          <Text style={styles.caption}>人的决定与实际提交相互独立；历史预览不代表授权仍然有效。</Text>
        </Card>
        {selected.status === 'pending' && <Card style={styles.card}>
          <Text style={styles.body}>{Date.parse(selected.expiresAt) <= now ? '有效期已到，等待服务器确认状态；不能继续决定。' : '请核对完整原文、计划写入内容及文件归属，再作决定。'}</Text>
          {!snapshot.pendingIds.includes(selectedId) && <Text style={styles.caption}>此项已不在最新待审批集合，正在核对最终状态。</Text>}
          {confirmation ? <>
            <Text style={styles.title}>{confirmation.decision === 'approve' ? '确认授权这一次操作？' : '确认拒绝这一次操作？'}</Text>
            <Text style={styles.caption}>{confirmation.decision === 'approve' ? '提交后工具可能立即写入上述完整内容；不会批准其他操作。' : '本次操作将不执行，不代表整项活动失败。'}</Text>
            <View style={styles.row}><ActionButton label="暂不提交" onPress={() => setConfirmation(undefined)} /><ActionButton label={confirmation.decision === 'approve' ? '确认批准' : '确认拒绝'} tone="primary" disabled={!canDecide} onPress={submit} /></View>
          </> : <View style={styles.row}>
            <ActionButton label="拒绝本次操作" tone="danger" disabled={!canDecide} onPress={() => setConfirmation({ decision: 'deny', revision: selected.revision, id: selectedId, syncVersion: snapshot.syncVersion })} />
            <ActionButton label={submitting ? '正在提交决定' : '批准本次操作'} tone="primary" disabled={!canDecide} onPress={() => setConfirmation({ decision: 'approve', revision: selected.revision, id: selectedId, syncVersion: snapshot.syncVersion })} />
          </View>}
        </Card>}
      </> : !loading && <Text style={styles.body}>完整预览尚未读取，不能作决定。请刷新审批详情。</Text>}
      {!!snapshot.errors[selectedId] && <FeedbackNotice text={snapshot.errors[selectedId]} tone="danger" />}
    </> : <>
      {defaultScope === 'all' && (
        <View style={styles.row}>
          <ChoiceChip label="全部空间" selected={scope === 'all'} onPress={() => setScope('all')} />
          <ChoiceChip label="当前空间" selected={scope === 'space'} onPress={() => setScope('space')} />
        </View>
      )}
      {mode === 'pending' ? <>
        {!!snapshot.error && <FeedbackNotice text={snapshot.error} tone="danger" />}
        {!pending.length && (
          <View style={styles.emptyWrap}>
            <EmptyState
              compact
              icon={ShieldCheck}
              title={snapshot.synchronized ? '没有待处理的审批' : '审批状态同步中'}
              description={snapshot.synchronized ? '当前范围没有待审批项；模型发起文件修改时会在此显示预览。' : '正在同步待审批集合，暂时不能作决定。'}
            />
            <View style={styles.centerAction}>
              <ActionButton label="查看审批历史" text="查看审批历史" onPress={() => setMode('history')} />
            </View>
          </View>
        )}
        {pending.map((item) => <ApprovalRow key={item.id} record={item} onOpen={() => setSelectedId(item.id)} />)}
        {!!pending.length && <ActionButton label="查看审批历史" text="查看审批历史" onPress={() => setMode('history')} />}
      </> : <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回待审批"
          onPress={() => setMode('pending')}
          style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
        >
          <ArrowLeft size={18} color={colors.ink} />
          <Text style={styles.backText}>返回待审批</Text>
        </Pressable>

        {history.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {HISTORY_STATUSES.map((item) => (
              <ChoiceChip key={item.value ?? 'all'} label={item.label} selected={status === item.value} onPress={() => setStatus(item.value)} />
            ))}
          </ScrollView>
        )}

        {snapshot.history.loading && <ActivityIndicator accessibilityLabel="正在读取审批历史" color={colors.muted} />}
        {historyMatches && !!snapshot.history.error && <FeedbackNotice text={snapshot.history.error} tone="danger" />}
        {historyMatches && snapshot.history.loaded && !history.length && !snapshot.history.error && (
          <EmptyState compact icon={ShieldCheck} title="当前范围没有审批历史" description="已结束的授权记录与独立执行回执会保留在这里。" />
        )}
        {history.map((item) => <ApprovalRow key={item.id} record={item} onOpen={() => setSelectedId(item.id)} />)}
        {historyMatches && snapshot.history.hasMore && (
          <ActionButton label="加载更多审批历史" text="加载更多" disabled={snapshot.history.loading} onPress={() => void store.loadHistory(filter, true)} />
        )}
      </>}
    </>}
  </View>;
}

function ApprovalRow({ record, onOpen }: { record: ApprovalRecord; onOpen: () => void }) {
  const styles = useStyles(); const { colors } = useTheme();
  const title = 'title' in record ? record.title : '审批详情待同步';
  return <Pressable accessibilityRole="button" accessibilityLabel={`查看审批 ${title}`} testID={`approval-open-${record.id}`} onPress={onOpen} style={({ pressed }) => [styles.approvalRow, pressed && styles.pressed]}>
    <View style={styles.fileIcon}><FilePenLine size={workspaceTheme.layout.iconSize} color={colors.muted} strokeWidth={1.5} /></View><View style={styles.rowBody}>
    <View style={styles.row}><Text style={[styles.title, styles.flex]}>{title}</Text><ChevronRight size={workspaceTheme.layout.iconSize - spacing[8]} color={colors.faint} /></View><View style={styles.pillWrap}><StatusPill label={approvalStatusLabel(record.status)} tone={approvalTone(record.status)} /></View>
    <Text style={styles.caption}>来源空间：{record.spaceId ?? '未关联会话'}</Text>
    {record.subagentId !== null && <Text style={styles.caption}>子代理：{record.subagentId}</Text>}
    {record.status !== 'pending' && <Text style={styles.caption}>{executionLabel(record.execution)}</Text>}
    <Text style={styles.caption}>{record.resolvedAt ?? record.createdAt} · 查看完整预览与详情</Text>
    </View>
  </Pressable>;
}
function ApprovalHeading({ record }: { record: ApprovalRecord }) {
  const styles = useStyles();
  return <Card style={styles.card}>
    <Text style={styles.title}>{'title' in record ? record.title : '审批详情'}</Text><View style={styles.pillWrap}><StatusPill label={approvalStatusLabel(record.status)} tone={approvalTone(record.status)} /></View>
    <Text selectable style={styles.caption}>审批：{record.id} · revision {record.revision}</Text>
    <Text selectable style={styles.caption}>来源空间：{record.spaceId ?? '未关联会话'}</Text>
    {(['runId', 'toolCallId', 'subagentId', 'activityId'] as const).map((key) => record[key] !== null && <Text key={key} selectable style={styles.caption}>{key}：{record[key]}</Text>)}
    <Text style={styles.caption}>有效期至：{record.expiresAt}</Text>
    {record.decidedAt !== null && <Text style={styles.caption}>人工决定：{record.decidedAt}</Text>}
    {record.resolvedAt !== null && <Text style={styles.caption}>状态结束：{record.resolvedAt}</Text>}
  </Card>;
}
function approvalTone(status: ApprovalRecord['status']): StatusTone {
  return status === 'pending' ? 'warning' : status === 'approved' ? 'success' : status === 'denied' ? 'danger' : 'neutral';
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
  root: { gap: spacing[18], paddingBottom: spacing[24] },

  title: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
  body: { ...workspaceTheme.typography.detail, color: colors.muted },
  caption: { ...workspaceTheme.typography.caption, color: colors.faint },
  backRow: { flexDirection: "row", alignItems: "center", gap: spacing[8], paddingVertical: spacing[6] },
  backText: { fontSize: 15, fontWeight: "500", color: colors.ink },
  emptyWrap: { gap: spacing[16], alignItems: "center" },
  centerAction: { alignSelf: "center" },

  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8], alignItems: 'center' },
  card: { borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface, padding: spacing[20], gap: spacing[12] },

   pressed: { opacity: workspaceTheme.interaction.pressedOpacity },

  previewBlock: { gap: spacing[8], marginTop: spacing[8] },
  preview: { maxHeight: workspaceTheme.layout.approvalPreviewMaxHeight, backgroundColor: colors.canvas, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: workspaceTheme.radius.field },
  previewContent: { padding: spacing[16] }, previewText: { ...workspaceTheme.typography.mono, color: colors.ink },
  approvalRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing[20], gap: spacing[14], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  fileIcon: { width: workspaceTheme.layout.rowIcon, height: workspaceTheme.layout.rowIcon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderRadius: workspaceTheme.radius.round },
  rowBody: { flex: 1, gap: spacing[8], minWidth: 0 }, flex: { flex: 1 }, pillWrap: { alignSelf: 'flex-start' },
});
