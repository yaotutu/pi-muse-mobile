import { ChatSwipeArea } from '../ui/ChatSwipeArea';
import { ArrowUp, AtSign, Square, X } from 'lucide-react-native';
import { type ScrollViewInstance, AppState, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useApi } from '../api/ApiProvider';
import { useApprovals } from '../approvals/ApprovalProvider';
import { useTheme } from '../theme/ThemeProvider';
import { useRuntimeStore } from '../runtime/RuntimeProvider';
import { ActionButton } from '../ui/ActionButton';
import { IconControl } from '../ui/IconControl';
import { spacing, workspaceTheme } from '../ui/tokens';
import { MemberAvatar } from '../workspace/MemberAvatar';
import { Message } from '../workspace/ConversationView';
import { groupRows, resolveGroupTarget, type GroupSnapshot, type GroupTurn } from './contracts';

let groupSequence = 0;
const { layout: l, typography: t, radius: r } = workspaceTheme;
/** 连接内只挂一份群聊所有者；换页面不重发、不把私聊草稿或历史带进群里。 */
export function GroupChat({ visible, members, onAgentSettings, onApprovals, onPrivateChat, onSwipe }: {
  visible: boolean; members: { id: string; name: string }[];
  onAgentSettings: (id: string) => void; onApprovals: (agentId: string) => void;
  onPrivateChat: (agentId: string) => void; onSwipe?: (direction: -1 | 1) => void;
}) {
  const api = useApi(); const { colors: c } = useTheme(); const approvals = useApprovals();
  const runtimeStore = useRuntimeStore();
  const runtime = useSyncExternalStore(runtimeStore.subscribe, runtimeStore.getSnapshot, runtimeStore.getSnapshot);
  const [snapshot, setSnapshot] = useState<GroupSnapshot>();
  const [live, setLive] = useState<GroupTurn[]>([]);
  const [draft, setDraft] = useState(''); const [target, setTarget] = useState<string>();
  const [choosing, setChoosing] = useState(false); const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false); const [uncertain, setUncertain] = useState(false); const [error, setError] = useState('');
  const mounted = useRef(true); const request = useRef<AbortController | null>(null);
  const pending = useRef<string | null>(null); const readVersion = useRef(0); const scroll = useRef<ScrollViewInstance>(null);
  const following = useRef(true);
  const reload = useCallback(async () => {
    const version = ++readVersion.current;
    setLoading(true);
    try {
      const next = await api.getGroup();
      if (!mounted.current || version !== readVersion.current) return;
      setSnapshot(next); setError('');
      if (!request.current && next.running !== pending.current) {
        const accepted = next.turns.find((turn) => turn.id === pending.current);
        if (accepted?.messages.some((message) => message.role === 'user')) { setDraft(''); setTarget(undefined); }
        pending.current = null; setUncertain(false); setLive([]);
      }
    } catch (failure) {
      if (mounted.current && version === readVersion.current) {
        const message = failure instanceof Error ? failure.message : '「全部」消息读取失败';
        setError(message);
      }
    }
    finally { if (mounted.current && version === readVersion.current) setLoading(false); }
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  // 隐藏时也同步群聊；共用现有通知流，重复/读中失效以最后一轮权威 GET 为准。
  // 发送期间不抢写 live；收口的 reload 会消费期间积累的所有通知。
  const notificationVersion = runtime.conversationInvalidations.at(-1)?.version ?? 0;
  useEffect(() => { if (!request.current) void reload(); }, [visible, runtime.conversationSyncVersion, notificationVersion, reload]);
  useEffect(() => { const sub = AppState.addEventListener('change', (state) => { if (state === 'active' && !request.current) void reload(); }); return () => sub.remove(); }, [reload]);
  const combined = [...(snapshot?.turns ?? []).filter((turn) => !live.some((item) => item.id === turn.id)), ...live];
  const rows = groupRows(combined, snapshot?.notifications);
  const busy = running || !!snapshot?.running;
  const send = async () => {
    if (!draft.trim() || busy || uncertain || !snapshot || loading) return;
    let input: ReturnType<typeof resolveGroupTarget>;
    try { input = resolveGroupTarget(draft, members, target); if (!input.content.trim()) throw new Error('请输入要发送的消息'); }
    catch (failure) { setError((failure as Error).message); return; }
    const id = `group-${Date.now()}-${++groupSequence}`; const controller = new AbortController();
    request.current = controller; pending.current = id; setRunning(true); setError(''); setChoosing(false);
    following.current = true; ++readVersion.current;
    try {
      await api.sendGroup({ id, ...input }, (event) => {
        if (!mounted.current) return;
        if (event.type === 'turn') setLive((items) => [...items, { ...event.turn, messages: event.turn.id === id ? [{ id, role: 'user', content: input.content }] : [] }]);
        if (event.type === 'delta') setLive((items) => items.map((turn) => turn.id !== event.id ? turn : { ...turn, messages: turn.messages.some((message) => message.role === 'assistant')
          ? turn.messages.map((message) => message.role === 'assistant' ? { ...message, content: message.content + event.text } : message)
          : [...turn.messages, { id: `reply-${turn.id}`, role: 'assistant', content: event.text }] }));
      }, controller.signal);
    } catch (failure) { if (mounted.current) { setUncertain(true); setError(failure instanceof Error ? failure.message : '结果未明，请同步核对，不要重复发送'); } }
    finally {
      request.current = null;
      if (mounted.current) { setRunning(false); await reload(); }
    }
  };
  const pendingApprovals = approvals.snapshot.pendingIds.map((id) => approvals.snapshot.records[id]).filter((item) => item && item.agentId && combined.some((turn) => turn.rootId === item.runId));
  const title = (id: string) => members.find((member) => member.id === id)?.name ?? id;
  const anchor = () => { if (visible && following.current) scroll.current?.scrollToEnd({ animated: false }); };
  return <View style={{ flex: 1, minHeight: 0, display: visible ? 'flex' : 'none' }} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
    <ChatSwipeArea onSwipe={onSwipe}><ScrollView ref={scroll} keyboardShouldPersistTaps="handled" onContentSizeChange={anchor} onLayout={anchor} scrollEventThrottle={16}
      onScroll={(event) => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; following.current = contentSize.height - contentOffset.y - layoutMeasurement.height < l.scrollThreshold; }}
      contentContainerStyle={{ flexGrow: 1, paddingTop: spacing[12], paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: l.groupMessageGap }}>
      {!snapshot && loading && <Text style={{ ...t.caption, color: c.muted }}>正在读取消息…</Text>}
      {snapshot && !rows.length && !busy && <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ ...t.detail, color: c.muted }}>有什么想聊的？</Text></View>}
      {rows.map((row) => <View key={row.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[8] }}>
        {row.sender && <Pressable accessibilityRole="button" accessibilityLabel={`查看${title(row.sender)}的智能体设置`} onPress={() => { Keyboard.dismiss(); onAgentSettings(row.sender!); }} style={{ width: l.smallControl, minHeight: l.smallControl, alignItems: 'center', justifyContent: 'center' }}>
          <MemberAvatar agentId={row.sender} size={l.groupAvatar} />
        </Pressable>}
        <View style={{ flex: 1, minWidth: 0, gap: spacing[2] }}>
          {row.sender && <Text style={{ ...t.caption, color: c.muted }}>{title(row.sender)}{row.notification ? ' · 通知' : ''}</Text>}
          <Message message={row.message} layout="group" recipient={row.target && row.target !== 'local-main' ? `@${title(row.target)}` : undefined} />
          {row.notification && <Pressable accessibilityRole="button" accessibilityLabel={`在${title(row.notification.targetAgentId)}私聊中处理通知`}
            onPress={() => { Keyboard.dismiss(); onPrivateChat(row.notification!.targetAgentId); }}
            style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing[12] }}>
            <Text style={{ ...t.caption, color: c.accentText }}>由 {title(row.notification.targetAgentId)} 承接 · 查看私聊</Text>
          </Pressable>}
          {row.status && <Text style={{ ...t.caption, color: row.status === 'failed' ? c.danger : c.muted }}>{row.status === 'cancelled' ? '已停止' : '处理失败，不会自动重试'}</Text>}
        </View>
      </View>)}
      {busy && <Text accessibilityLabel="全部视图正在回复" style={{ ...t.caption, color: c.muted }}>正在回复…</Text>}
      {!!error && <Text accessibilityRole="alert" style={{ ...t.caption, color: c.danger }}>{error}</Text>}
      {(!!error || uncertain || (!!snapshot?.running && !running)) && <ActionButton label="重新同步全部消息" text="同步核对" onPress={() => void reload()} />}
    </ScrollView></ChatSwipeArea>
    {pendingApprovals.length > 0 && <ActionButton label="查看全部视图待处理审批" text={`待处理审批（${pendingApprovals.length}）`} onPress={() => onApprovals(pendingApprovals[0].agentId!)} style={{ marginHorizontal: l.sidePadding }} />}
    {choosing && <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200, marginHorizontal: l.sidePadding, borderRadius: r.card, backgroundColor: c.surface }}>
      {members.map((member) => <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`全部视图艾特${member.name}`} onPress={() => { setTarget(member.id); setChoosing(false); setDraft((text) => text.endsWith('@') ? text.slice(0, -1) : text); }} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', padding: spacing[12], gap: spacing[12] }}>
        <MemberAvatar agentId={member.id} size={30} /><Text style={{ ...t.detail, color: c.ink }}>{member.name}</Text>
      </Pressable>)}
    </ScrollView>}
    {!!target && <Pressable accessibilityRole="button" accessibilityLabel="取消全部视图艾特" onPress={() => setTarget(undefined)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[8], alignSelf: 'flex-start', marginHorizontal: l.sidePadding, padding: spacing[10] }}><Text style={{ ...t.caption, color: c.accentText }}>@{title(target)}</Text><X size={16} color={c.muted} /></Pressable>}
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: l.composerHeight, padding: l.composerPadding, marginHorizontal: l.sidePadding, marginBottom: l.composerBottom, borderRadius: r.round, backgroundColor: c.surface }}>
      <IconControl icon={AtSign} label="选择全部视图回复成员" disabled={busy || uncertain} onPress={() => setChoosing(!choosing)} />
      <TextInput accessibilityLabel="全部消息输入框" placeholder="消息" placeholderTextColor={c.faint} multiline value={draft} editable={!running && !uncertain}
        onChangeText={(text) => { setDraft(text); if (text.endsWith('@')) setChoosing(true); }}
        style={{ ...t.input, flex: 1, minWidth: 0, minHeight: 44, maxHeight: l.composerMaxHeight, padding: spacing[8], color: c.ink }} />
      <IconControl icon={busy ? Square : ArrowUp} label={busy ? '停止全部视图回复' : '发送全部视图消息'} disabled={!busy && (!draft.trim() || uncertain || !snapshot || loading)}
        onPress={() => { if (busy) { const id = pending.current ?? snapshot?.running; if (id) void api.stopGroup(id).catch((failure) => setError((failure as Error).message)); } else void send(); }} />
    </View>
  </View>;
}
