import { GroupComposer } from './group-composer';
import { ArrowUp, AtSign, Square, X } from 'lucide-react-native';
import { type ScrollViewInstance, Alert, AppState, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useApi } from '../api/ApiProvider';
import { useApprovals } from '../approvals/ApprovalProvider';
import { useTheme } from '../theme/ThemeProvider';
import { useRuntimeStore } from '../runtime/RuntimeProvider';
import { ActionButton } from '../ui/ActionButton';
import { IconControl } from '../ui/IconControl';
import { spacing, workspaceTheme } from '../ui/tokens';
import { MemberAvatar } from '../workspace/MemberAvatar';
import { AgentHeader } from '../workspace/AgentHeader';
import { Message } from '../workspace/ConversationView';
import { discussionTurns, notificationKey, groupRows, resolveGroupTarget, type GroupSnapshot, type GroupTurn, type NotificationReference } from './contracts';

let groupSequence = 0;
const nextGroupId = () => `group-${Date.now()}-${++groupSequence}`;
const { layout: l, typography: t, radius: r } = workspaceTheme;
/** 连接内只挂一份群聊所有者；换页面不重发、不把私聊草稿或历史带进群里。 */
export function GroupChat({ visible, members, onAgentSettings, onApprovals, notification, onOpenNotification, onBack }: {
  visible: boolean; members: { id: string; name: string }[];
  onAgentSettings: (id: string) => void; onApprovals: (agentId: string) => void;
  notification?: NotificationReference; onOpenNotification: (reference: NotificationReference) => void; onBack: () => void;
}) {
  const api = useApi(); const { colors: c } = useTheme(); const approvals = useApprovals();
  const runtimeStore = useRuntimeStore();
  const runtime = useSyncExternalStore(runtimeStore.subscribe, runtimeStore.getSnapshot, runtimeStore.getSnapshot);
  const [snapshot, setSnapshot] = useState<GroupSnapshot>();
  const [live, setLive] = useState<GroupTurn[]>([]);
  const scope = notification ? notificationKey(notification) : 'group';
  // 每个讨论独立交接草稿；共享的执行所有者收口时只核对原提交，不能清掉别处的新输入。
  const [composers] = useState(() => new Map<string, GroupComposer>());
  if (!composers.has(scope)) composers.set(scope, new GroupComposer());
  const composer = composers.get(scope)!;
  const { draft, target, pending: pendingDraft, suggestion } = useSyncExternalStore(composer.subscribe, composer.getSnapshot, composer.getSnapshot);
  const [choosing, setChoosing] = useState(false); const [loading, setLoading] = useState(false);
  const [runningScope, setRunningScope] = useState<string>();
  const running = runningScope !== undefined;
  const [uncertain, setUncertain] = useState(false); const [error, setError] = useState('');
  const mounted = useRef(true); const request = useRef<AbortController | null>(null);
  const pending = useRef<{ id: string; scope: string } | null>(null); const readVersion = useRef(0); const scroll = useRef<ScrollViewInstance>(null);
  const following = useRef(true);
  const reload = useCallback(async (preserveSendError = false) => {
    const version = ++readVersion.current;
    setLoading(true);
    try {
      const next = await api.getGroup();
      if (!mounted.current || version !== readVersion.current) return;
      setSnapshot(next); if (!preserveSendError) setError('');
      if (!request.current && (!pending.current || next.running !== pending.current.id)) {
        for (const item of composers.values()) item.reconcile(next);
        pending.current = null; setUncertain(false); setLive([]);
      }
    } catch (failure) {
      if (mounted.current && version === readVersion.current) {
        const message = failure instanceof Error ? failure.message : '「全部」消息读取失败';
        setError(message);
      }
    }
    finally { if (mounted.current && version === readVersion.current) setLoading(false); }
  }, [api, composers, setError]);
  useEffect(() => { following.current = true; }, [scope]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  // 隐藏时也同步群聊；共用现有通知流，重复/读中失效以最后一轮权威 GET 为准。
  // 发送期间不抢写 live；收口的 reload 会消费期间积累的所有通知。
  const notificationVersion = runtime.conversationInvalidations.at(-1)?.version ?? 0;
  useEffect(() => { if (!request.current) void reload(); }, [visible, scope, runtime.conversationSyncVersion, notificationVersion, reload]);
  useEffect(() => { const sub = AppState.addEventListener('change', (state) => { if (state === 'active' && !request.current) void reload(); }); return () => sub.remove(); }, [reload]);
  const combined = [...(snapshot?.turns ?? []).filter((turn) => !live.some((item) => item.id === turn.id)), ...live];
  const selectedTurns = discussionTurns(combined, notification);
  const source = notification ? snapshot?.notifications.find((item) => notificationKey(item) === scope) : undefined;
  const rows = groupRows(selectedTurns, notification ? [] : snapshot?.notifications);
  const busy = running || !!snapshot?.running;
  const availableMembers = members.filter((member) => snapshot?.memberIds.includes(member.id));
  const activeHere = !notification || runningScope === scope || selectedTurns.some((turn) => turn.rootId === snapshot?.running);
  const send = async (confirmedTarget?: string) => {
    if ((!confirmedTarget && (!draft.trim() || suggestion)) || request.current || busy || uncertain || pendingDraft || !snapshot || loading || (notification && !source)) return;
    let input: ReturnType<typeof resolveGroupTarget>;
    try { input = confirmedTarget ? { content: suggestion!.content, targetAgentId: confirmedTarget } : notification ? { content: draft.trim() } : resolveGroupTarget(draft, availableMembers, target); if (!input.content.trim()) throw new Error('请输入要发送的消息'); }
    catch (failure) { setError((failure as Error).message); return; }
    const id = nextGroupId(); const controller = new AbortController();
    if (confirmedTarget ? !composer.confirmSuggestion(id, confirmedTarget) : !composer.submit({ id, ...input, ...(notification ? { notification } : {}) })) return;
    request.current = controller; pending.current = { id, scope }; setRunningScope(scope); setError(''); setChoosing(false);
    following.current = true; ++readVersion.current;
    try {
      await api.sendGroup({ id, ...input, ...(notification ? { notification } : {}) }, (event) => {
        if (!mounted.current) return;
        if (event.type === 'suggestion') composer.suggest(event);
        if (event.type === 'turn') {
          composer.accept(event.turn.id);
          setLive((items) => [...items.filter((turn) => turn.id !== event.turn.id), { ...event.turn, messages: event.turn.id === id ? [{ id, role: 'user', content: input.content }] : [] }]);
        }
        if (event.type === 'delta') setLive((items) => items.map((turn) => turn.id !== event.id ? turn : { ...turn, messages: turn.messages.some((message) => message.role === 'assistant')
          ? turn.messages.map((message) => message.role === 'assistant' ? { ...message, content: message.content + event.text } : message)
          : [...turn.messages, { id: `reply-${turn.id}`, role: 'assistant', content: event.text }] }));
      }, controller.signal);
    } catch (failure) { if (mounted.current) { setUncertain(true); setError(failure instanceof Error ? failure.message : '结果未明，请同步核对，不要重复发送'); } }
    finally {
      request.current = null;
      if (mounted.current) { setRunningScope(undefined); await reload(true); }
    }
  };
  const pendingApprovals = approvals.snapshot.pendingIds.map((id) => approvals.snapshot.records[id]).filter((item) => item && item.agentId && selectedTurns.some((turn) => turn.rootId === item.runId));
  const title = (id: string) => members.find((member) => member.id === id)?.name ?? id;
  const anchor = () => { if (visible && following.current) scroll.current?.scrollToEnd({ animated: false }); };
  return <View style={{ flex: 1, minHeight: 0, display: visible ? 'flex' : 'none' }} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
    {notification && <AgentHeader title={source ? `与${title(`${source.featureId}-internal`)}讨论` : '通知讨论'} caption="继续处理这条通知" backLabel="返回通知所在聊天" onBack={() => { Keyboard.dismiss(); onBack(); }} />}
    <ScrollView key={scope} ref={scroll} keyboardShouldPersistTaps="handled" onContentSizeChange={anchor} onLayout={anchor} scrollEventThrottle={16}
      onScroll={(event) => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; following.current = contentSize.height - contentOffset.y - layoutMeasurement.height < l.scrollThreshold; }}
      contentContainerStyle={{ flexGrow: 1, paddingTop: spacing[12], paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: l.groupMessageGap }}>
      {!snapshot && loading && <Text style={{ ...t.caption, color: c.muted }}>正在读取消息…</Text>}
      {notification && source && <View style={{ borderLeftWidth: 2, borderLeftColor: c.line, paddingLeft: spacing[12], gap: spacing[4] }}>
        <Text style={{ ...t.caption, color: c.muted }}>引用原通知 · {title(`${source.featureId}-internal`)}</Text>
        <Text numberOfLines={4} style={{ ...t.detail, color: c.muted }}>{source.content}</Text>
      </View>}
      {notification && snapshot && !source && <Text accessibilityRole="alert" style={{ ...t.detail, color: c.danger }}>原通知已失效，不能继续发送。已有讨论仍可查看。</Text>}
      {snapshot && !rows.length && !busy && (!notification || !!source) && <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ ...t.detail, color: c.muted }}>{notification ? '想如何处理这条通知？' : '有什么想聊的？'}</Text></View>}
      {rows.map((row) => <View key={row.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[8] }}>
        {row.sender && <Pressable accessibilityRole="button" accessibilityLabel={`查看${title(row.sender)}的智能体设置`} onPress={() => { Keyboard.dismiss(); onAgentSettings(row.sender!); }} style={{ width: l.smallControl, minHeight: l.smallControl, alignItems: 'center', justifyContent: 'center' }}>
          <MemberAvatar agentId={row.sender} size={l.groupAvatar} />
        </Pressable>}
        <View style={{ flex: 1, minWidth: 0, gap: spacing[2] }}>
          {row.sender && <Text style={{ ...t.caption, color: c.muted }}>{title(row.sender)}{row.notification ? ' · 通知' : ''}</Text>}
          <Message message={row.message} layout="group" recipient={row.target && row.target !== 'local-main' && (!notification || !!row.sender) ? `@${title(row.target)}` : undefined} />
          {row.notification && <Pressable accessibilityRole="button" accessibilityLabel={`继续处理${title(row.sender!)}通知`}
            onPress={() => { Keyboard.dismiss(); setChoosing(false); onOpenNotification(row.notification!); }}
            style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing[12] }}>
            <Text style={{ ...t.caption, color: c.accentText }}>{discussionTurns(combined, row.notification).length ? '查看讨论与处理结果' : '继续处理'} · {title(row.sender!)}</Text>
          </Pressable>}
          {row.status && <Text style={{ ...t.caption, color: row.status === 'failed' ? c.danger : c.muted }}>{row.status === 'cancelled' ? '已停止' : '处理失败，不会自动重试'}</Text>}
        </View>
      </View>)}
      {!notification && suggestion && <View style={{ padding: spacing[16], gap: spacing[12], borderRadius: r.card, backgroundColor: c.surface }}>
        <Text style={{ ...t.itemTitle, color: c.ink }}>这条消息交给谁？</Text>
        <Text style={{ ...t.caption, color: c.muted }}>{suggestion.reason || '有多个可能的对象，请选择一个。选择前不会发送给任何智能体。'}</Text>
        <Text selectable style={{ ...t.detail, color: c.ink }}>{suggestion.content}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] }}>
          {suggestion.targetAgentIds.map((id) => <ActionButton key={id} label={`确认转交给${title(id)}`} text={`@${title(id)}`} disabled={busy || uncertain || loading || !snapshot?.memberIds.includes(id)} onPress={() => void send(id)} />)}
          <ActionButton label="取消本次转交" text="取消" disabled={busy} onPress={composer.cancelSuggestion} />
        </View>
        <Text style={{ ...t.caption, color: c.muted }}>确认后只发送这段原文；输入框的新草稿不受影响。</Text>
      </View>}
      {pendingDraft && !selectedTurns.some((turn) => turn.id === pendingDraft.id) && <View style={{ gap: spacing[8] }}>
        <Message message={{ id: pendingDraft.id, role: 'user', text: pendingDraft.content, toolCalls: [], feedbackAvailable: false }} layout="group" />
        <Text style={{ ...t.caption, color: c.muted }}>{pendingDraft.absent ? '服务器未接收这条消息。原内容已保留，请先处理当前草稿后恢复，或明确丢弃。' : '正在发送；原内容已保留，未确认时不会重复发送。'}</Text>
        {pendingDraft.absent && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] }}>
          <ActionButton label="恢复未接收消息到输入框" text="恢复草稿" disabled={!!draft || !!target} onPress={() => { composer.restore(); }} />
          <ActionButton label="丢弃未接收消息" text="丢弃旧消息" tone="danger" onPress={() => Alert.alert('丢弃未接收消息？', '只丢弃这条未接收消息，不影响输入框中的新草稿。', [
            { text: '取消', style: 'cancel' }, { text: '丢弃', style: 'destructive', onPress: composer.discard },
          ])} />
        </View>}
      </View>}
      {busy && <Text accessibilityLabel="全部视图正在回复" style={{ ...t.caption, color: c.muted }}>{activeHere ? '正在回复…' : '其他讨论正在处理，请稍候…'}</Text>}
      {!!error && <Text accessibilityRole="alert" style={{ ...t.caption, color: c.danger }}>{error}</Text>}
      {(!!error || uncertain || (!!snapshot?.running && !running)) && <ActionButton label="重新同步全部消息" text="同步核对" onPress={() => void reload()} />}
    </ScrollView>
    {pendingApprovals.length > 0 && <ActionButton label="查看全部视图待处理审批" text={`待处理审批（${pendingApprovals.length}）`} onPress={() => onApprovals(pendingApprovals[0].agentId!)} style={{ marginHorizontal: l.sidePadding }} />}
    {!notification && choosing && <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200, marginHorizontal: l.sidePadding, borderRadius: r.card, backgroundColor: c.surface }}>
      {availableMembers.map((member) => <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`全部视图艾特${member.name}`} onPress={() => { composer.setTarget(member.id); setChoosing(false); composer.setDraft(draft.endsWith('@') ? draft.slice(0, -1) : draft); }} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', padding: spacing[12], gap: spacing[12] }}>
        <MemberAvatar agentId={member.id} size={30} /><Text style={{ ...t.detail, color: c.ink }}>{member.name}</Text>
      </Pressable>)}
    </ScrollView>}
    {!notification && !!target && <Pressable accessibilityRole="button" accessibilityLabel="取消全部视图艾特" onPress={() => composer.setTarget(undefined)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[8], alignSelf: 'flex-start', marginHorizontal: l.sidePadding, padding: spacing[10] }}><Text style={{ ...t.caption, color: c.accentText }}>@{title(target)}</Text><X size={16} color={c.muted} /></Pressable>}
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: l.composerHeight, padding: l.composerPadding, marginHorizontal: l.sidePadding, marginBottom: l.composerBottom, borderRadius: r.round, backgroundColor: c.surface }}>
      {!notification && <IconControl icon={AtSign} label="选择全部视图回复成员" onPress={() => setChoosing(!choosing)} />}
      <TextInput accessibilityLabel={notification ? '通知讨论输入框' : '全部消息输入框'} placeholder={notification ? (source ? `回复${title(`${source.featureId}-internal`)}…` : '通知已失效') : '消息'} placeholderTextColor={c.faint} multiline value={draft} editable={!notification || !!source}
        onChangeText={(text) => { composer.setDraft(text); if (!notification && text.endsWith('@')) setChoosing(true); }}
        style={{ ...t.input, flex: 1, minWidth: 0, minHeight: 44, maxHeight: l.composerMaxHeight, padding: spacing[8], color: c.ink }} />
      <IconControl icon={busy ? Square : ArrowUp} label={busy ? (activeHere ? '停止全部视图回复' : '等待其他讨论结束') : notification ? '发送通知讨论消息' : '发送全部视图消息'} disabled={busy ? !activeHere : !draft.trim() || !!suggestion || uncertain || !!pendingDraft || !snapshot || loading || (!!notification && !source)}
        onPress={() => { if (busy) { const id = pending.current?.id ?? snapshot?.running; if (id) void api.stopGroup(id).catch((failure) => setError((failure as Error).message)); } else void send(); }} />
    </View>
  </View>;
}
