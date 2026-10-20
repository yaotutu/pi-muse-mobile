import { ArrowUp, Bot, Check, Download, Menu, MessageCircle, Moon, PanelsTopLeft, Plus, Server, Shapes, Square, SquareCheck, SquarePen, Sun, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AccessibilityInfo, Animated, BackHandler, Easing, Keyboard, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiProvider, useApi } from '../api/ApiProvider';
import { useConversation } from '../chat/useConversation';
import type { MessageView } from '../chat/chat-state';
import { ConnectionProvider, useServiceConnection } from '../connection/ConnectionProvider';
import { useConnection } from '../connection/useConnection';
import type { ConnectionManager } from '../connection/connection-manager';
import type { ConnectionSnapshot } from '../connection/types';
import { RuntimeProvider, useRuntimeStore, useThreadRuntime } from '../runtime/RuntimeProvider';
import { useActivityStore } from '../activities/ActivityProvider';
import { ThreadSessionProvider, useThreadSession, useThreadSessionStore } from '../threads/ThreadSessionProvider';
import { MAIN_THREAD } from '../threads/thread-state';
import { useThreads } from '../threads/useThreads';
import { useAppUpdate } from '../update/UpdateProvider';
import { spacing, sizing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { ConnectionPanel } from './ConnectionPanel';
import { ActivityPanel } from './ActivityPanel';
import { SessionPanel, type SessionTab } from './SessionPanel';
import { ThreadSettings } from './ThreadSettings';
import { WorkspaceThemeProvider, useWorkspaceTheme } from './WorkspaceTheme';

type WorkspacePage = 'chat' | 'activity' | 'goals' | 'apps';
const { layout: l, radius: r, typography: t } = workspaceTheme;
const NAV: { id: WorkspacePage; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: '聊天', icon: MessageCircle }, { id: 'activity', label: '任务', icon: PanelsTopLeft },
  { id: 'goals', label: '目标', icon: SquareCheck }, { id: 'apps', label: '应用', icon: Shapes },
];
function useStyles() { const { colors } = useWorkspaceTheme(); return useMemo(() => createStyles(colors), [colors]); }
function RoundButton({ icon: Icon, label, onPress, testID }: { icon: LucideIcon; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useWorkspaceTheme(); const styles = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}>
    <Icon size={l.iconSize} strokeWidth={1.7} color={colors.ink} />
  </Pressable>;
}

/** 新版是唯一入口；连接配置只从应用页打开，不改变会话信息区职责。 */
export function WorkspaceScreen() {
  return <WorkspaceThemeProvider><ConnectedWorkspace /></WorkspaceThemeProvider>;
}
function ConnectedWorkspace() {
  const connection = useConnection(true);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const openConnection = useCallback(() => setConnectionOpen(true), []);
  const value = useMemo(() => ({ snapshot: connection.snapshot, enabled: connection.enabled,
    retry: () => { void connection.manager.retry(); }, changeServer: openConnection,
  }), [connection.snapshot, connection.enabled, connection.manager, openConnection]);
  const content = connection.client && connection.snapshot.workspaceReady
    ? <ApiProvider client={connection.client} key={connection.snapshot.workspaceKey}>
      <ThreadSessionProvider><RuntimeProvider><LiveWorkspace manager={connection.manager} snapshot={connection.snapshot} openConnection={openConnection} /></RuntimeProvider></ThreadSessionProvider>
    </ApiProvider>
    : <DisconnectedWorkspace manager={connection.manager} snapshot={connection.snapshot} openConnection={openConnection} />;
  return <ConnectionProvider value={value}>
    {content}
    {connectionOpen && <ConnectionPanel manager={connection.manager} snapshot={connection.snapshot} onClose={() => setConnectionOpen(false)} />}
  </ConnectionProvider>;
}

type WorkspaceConnectionProps = { manager: ConnectionManager; snapshot: ConnectionSnapshot; openConnection: () => void };
function connectionLabel(snapshot: ConnectionSnapshot) {
  return { loading: '正在读取连接配置', unconfigured: '未连接服务器', connecting: '正在连接服务器', online: '已连接', offline: '服务器暂时不可用', 'authentication-required': '需要重新认证', resetting: '正在清理本地数据', 'reset-error': '本地数据清理未完成', 'storage-error': '连接配置读取失败' }[snapshot.status];
}
function AppsPage({ snapshot, openConnection }: Pick<WorkspaceConnectionProps, 'snapshot' | 'openConnection'>) {
  const styles = useStyles(); const { colors } = useWorkspaceTheme(); const update = useAppUpdate();
  return <ScrollView contentContainerStyle={styles.otherPage}>
    <Text style={styles.pageTitle}>应用</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="服务器连接" onPress={openConnection} style={styles.settingsRow}>
      <Server size={l.iconSize} color={colors.ink} /><View style={styles.threadText}>
        <Text style={styles.itemTitle}>服务器连接</Text><Text style={styles.caption}>{connectionLabel(snapshot)}</Text>
        {!!snapshot.serverUrl && <Text numberOfLines={1} style={styles.caption}>{snapshot.serverUrl}</Text>}
      </View>
    </Pressable>
    {update && <Pressable accessibilityRole="button" accessibilityLabel="应用更新" onPress={update.open} style={styles.settingsRow}>
      <Download size={l.iconSize} color={colors.ink} /><View style={styles.threadText}><Text style={styles.itemTitle}>应用更新</Text>
        <Text style={styles.caption}>{update.snapshot.status === 'unsupported' ? '当前环境不支持自动安装' : '检查版本、下载与安装进度'}</Text></View>
    </Pressable>}
    <Text style={styles.caption}>记忆、人设与其他应用能力尚未接入。</Text>
  </ScrollView>;
}
function DisconnectedWorkspace({ snapshot, openConnection }: WorkspaceConnectionProps) {
  const [page, setPage] = useState<WorkspacePage>('chat');
  const styles = useStyles(); const { colors, mode, toggle } = useWorkspaceTheme();
  return <View style={styles.root} testID="workspace-screen"><StatusBar style={mode === 'light' ? 'dark' : 'light'} />
    <SafeAreaView style={styles.disconnected}>
      <View style={styles.disconnectedHeader}><Text style={styles.itemTitle}>Pi Muse</Text><RoundButton icon={mode === 'light' ? Moon : Sun} label={mode === 'light' ? '切换到暗色主题' : '切换到亮色主题'} onPress={toggle} /></View>
      {page === 'apps' ? <AppsPage snapshot={snapshot} openConnection={openConnection} /> : <View style={styles.welcome}>
        <Bot size={l.sessionAvatar} color={colors.muted} /><Text style={styles.emptyTitle}>{connectionLabel(snapshot)}</Text>
        <Text style={styles.mutedText}>{snapshot.error ?? '连接自己的 Pi Muse 服务器后即可恢复会话、聊天与真实执行状态。'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="配置服务器连接" onPress={openConnection} style={styles.actionButton}><Text style={styles.actionText}>服务器连接</Text></Pressable>
        <Text style={styles.caption}>当前未加载会话或示例数据，应用更新可独立使用。</Text>
      </View>}
      <Navigation page={page} onPage={setPage} />
    </SafeAreaView>
  </View>;
}
function Navigation({ page, onPage }: { page: WorkspacePage; onPage: (page: WorkspacePage) => void }) {
  const styles = useStyles(); const { colors } = useWorkspaceTheme();
  return <View accessibilityRole="tablist" accessibilityLabel="主要页面" style={styles.navigation}>
    {NAV.map(({ id, label, icon: Icon }) => <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: page === id }} aria-selected={page === id} onPress={() => onPage(id)} style={styles.navigationItem}>
      <Icon size={l.navigationIconSize} strokeWidth={1.8} color={page === id ? colors.ink : colors.faint} fill={id === 'chat' && page === id ? colors.ink : 'none'} />
    </Pressable>)}
  </View>;
}

function LiveWorkspace({ snapshot, openConnection }: WorkspaceConnectionProps) {
  const connection = useServiceConnection();
  const threads = useThreads(!!connection?.enabled, snapshot.refreshVersion);
  const session = useThreadSession(threads.currentThread);
  const sessions = useThreadSessionStore(); const runtimeStore = useRuntimeStore();
  const activities = useActivityStore();
  const runtime = useThreadRuntime(threads.currentThread);
  const [page, setPage] = useState<WorkspacePage>('chat');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionTab, setSessionTab] = useState<SessionTab>('activity');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const { colors, mode, toggle } = useWorkspaceTheme(); const styles = useStyles();
  const { width } = useWindowDimensions(); const contentWidth = Math.min(width, l.maxWidth);
  const drawerWidth = Math.min(contentWidth * l.drawerRatio, l.drawerMaxWidth);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const statusLabel = snapshot.status === 'authentication-required' || snapshot.status === 'reset-error' || snapshot.status === 'storage-error'
    ? connectionLabel(snapshot) : runtime.label;
  const name = threads.currentThread === MAIN_THREAD ? 'Pi Muse' : threads.currentThread;
  const reloadThreads = threads.reload;
  const refresh = useCallback(() => { void reloadThreads(); activities.invalidate(); setHistoryRefresh((value) => value + 1); }, [reloadThreads, activities]);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (active) setReducedMotion(enabled); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (drawerOpen) Keyboard.dismiss();
    const animation = Animated.timing(drawerProgress, { toValue: drawerOpen ? 1 : 0, duration: reducedMotion ? 0 : workspaceTheme.motion.drawerDuration, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [drawerOpen, drawerProgress, reducedMotion]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (!drawerOpen) return false; setDrawerOpen(false); return true; });
    return () => subscription.remove();
  }, [drawerOpen]);
  const openDrawer = () => { Keyboard.dismiss(); setSessionOpen(false); setDrawerOpen(true); void threads.reload(); };
  const select = (id: string) => { threads.selectThread(id); setSessionOpen(false); setDrawerOpen(false); setPage('chat'); setDeleteConfirm(false); setNotice(''); };
  const remove = async () => {
    const id = threads.currentThread;
    try {
      const result = await sessions.deleteThread(id);
      if (!result) return;
      runtimeStore.forgetThread(id); activities.forgetThread(id); threads.removeThread(id); setSessionOpen(false); setDeleteConfirm(false); setNotice(''); await threads.reload();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); setDeleteConfirm(false); }
  };
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => Math.abs(gesture.dx) > l.gestureThreshold && Math.abs(gesture.dx) > Math.abs(gesture.dy) * l.gestureAxisRatio && (drawerOpen ? gesture.dx < 0 : event.nativeEvent.pageX - gesture.dx < l.edgeGestureWidth && gesture.dx > 0),
    onPanResponderRelease: (_event, gesture) => { if (gesture.dx < -l.gestureThreshold) setDrawerOpen(false); if (gesture.dx > l.gestureThreshold) openDrawer(); },
  });
  const otherPage = page === 'apps' ? <AppsPage snapshot={snapshot} openConnection={openConnection} /> : page === 'activity' ? !sessionOpen && <ScrollView contentContainerStyle={styles.otherPage}><ActivityPanel key={threads.currentThread} threadId={threads.currentThread} defaultScope="all" /><Text style={styles.caption}>定时任务管理尚未接入。</Text></ScrollView> : <View style={styles.otherPage}>
    <Text style={styles.pageTitle}>{page === 'goals' ? '目标' : '任务'}</Text><Text style={styles.mutedText}>{page === 'goals' ? '目标尚未接入。' : '活动历史与定时任务管理尚未接入；当前执行可在会话面板“动态”中查看。'}</Text>
  </View>;
  return <View style={styles.root} testID="workspace-screen"><StatusBar style={mode === 'light' ? 'dark' : 'light'} />
    <View style={[styles.viewport, { width: contentWidth }]} {...pan.panHandlers}>
      <SafeAreaView style={[styles.drawer, { width: drawerWidth }]} edges={['top', 'bottom', 'left']} pointerEvents={drawerOpen ? 'auto' : 'none'} aria-hidden={!drawerOpen}
        {...(Platform.OS === 'web' && !drawerOpen ? { inert: true } : {})} accessibilityElementsHidden={!drawerOpen} importantForAccessibility={drawerOpen ? 'yes' : 'no-hide-descendants'}>
        <View style={styles.drawerHeading}><Text style={styles.drawerTitle}>Pi Muse</Text><RoundButton icon={X} label="关闭会话侧栏" onPress={() => setDrawerOpen(false)} /></View>
        <Text style={styles.drawerSection}>会话</Text>
        {!!threads.error && <Text style={styles.error}>{threads.error}</Text>}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.drawerList}>
          {threads.threads.map((thread) => <Pressable key={thread.id} accessibilityRole="button" accessibilityLabel={thread.id === MAIN_THREAD ? '主会话' : thread.id} accessibilityState={{ selected: thread.id === threads.currentThread }}
            onPress={() => select(thread.id)} style={[styles.threadRow, thread.id === threads.currentThread && styles.threadSelected]}>
            <MessageCircle size={l.navigationIconSize} color={colors.ink} /><View style={styles.threadText}>
              <Text numberOfLines={1} style={styles.itemTitle}>{thread.id === MAIN_THREAD ? '主会话' : thread.id}</Text><ThreadStatusCaption threadId={thread.id} />
            </View>{thread.id === threads.currentThread && <Check size={sizing[18]} color={colors.muted} />}
          </Pressable>)}
        </ScrollView>
        <View style={styles.drawerFooter}><RoundButton icon={SquarePen} label="新建会话" testID="workspace-create-thread" onPress={() => { threads.createThread(); setDrawerOpen(false); setSessionOpen(false); setPage('chat'); }} /></View>
      </SafeAreaView>
      <Animated.View style={[styles.foreground, drawerOpen && styles.foregroundRounded, { transform: [{ translateX: drawerProgress.interpolate({ inputRange: [0, 1], outputRange: [0, drawerWidth] }) }] }]} accessibilityElementsHidden={drawerOpen} importantForAccessibility={drawerOpen ? 'no-hide-descendants' : 'auto'}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']} aria-hidden={drawerOpen} {...(Platform.OS === 'web' && drawerOpen ? { inert: true } : {})}>
          <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
            <View style={styles.connectionLabel}><Text style={styles.caption}>{runtime.synchronized && snapshot.hasToken ? '已连接真实服务' : statusLabel}</Text></View>
            <ConversationView key={threads.currentThread} threadId={threads.currentThread} visible={page === 'chat'} otherPage={otherPage} refreshKey={historyRefresh} onSettled={refresh} openConnection={openConnection} />
            <View style={styles.floatingHeader} pointerEvents="box-none">
              <View style={styles.headerLeft}><RoundButton icon={Menu} label="打开会话侧栏" testID="workspace-open-drawer" onPress={openDrawer} /></View>
              <Pressable accessibilityRole="button" accessibilityLabel="打开当前会话面板" accessibilityHint="全屏显示当前会话的动态、审批、工作区和历史" testID="workspace-open-session" style={styles.identity}
                onPress={() => { Keyboard.dismiss(); setDrawerOpen(false); setSessionOpen(true); }}>
                <View style={styles.headerAvatar}><Bot size={l.headerAvatar / 2} color={colors.ink} /></View>
                <View style={styles.identityLabel}><Text numberOfLines={1} style={styles.identityName}>{name}</Text><Text numberOfLines={1} style={styles.identityStatus}>{statusLabel}</Text></View>
              </Pressable>
              <View style={styles.headerRight}><RoundButton icon={mode === 'light' ? Moon : Sun} label={mode === 'light' ? '切换到暗色主题' : '切换到亮色主题'} testID="workspace-theme-toggle" onPress={toggle} /></View>
            </View>
            {!!notice && <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text>}
            <Navigation page={page} onPage={(next) => { setPage(next); setSessionOpen(false); }} />
          </KeyboardAvoidingView>
        </SafeAreaView>
        {drawerOpen && <Pressable accessibilityRole="button" accessibilityLabel="收起会话侧栏" onPress={() => setDrawerOpen(false)} style={styles.foregroundCover} />}
      </Animated.View>
    </View>
    {sessionOpen && <SessionPanel threadId={threads.currentThread} threadName={name} status={statusLabel} tab={sessionTab} onTab={(next) => { setSessionTab(next); setDeleteConfirm(false); }}
      onClose={() => { if (!session.deleting) setSessionOpen(false); }} onDelete={() => setDeleteConfirm(true)} deleting={session.deleting} reducedMotion={reducedMotion} onSettled={refresh}
      settings={<>{deleteConfirm ? <View style={styles.exampleCard}><Text style={styles.itemTitle}>确认删除当前会话？</Text><Text style={styles.mutedText}>会话历史和绑定的定时任务、监控将被删除，无法撤销。</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="确认删除会话" disabled={session.deleting} style={styles.actionButton} onPress={() => void remove()}><Text style={styles.actionText}>确认删除</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="取消删除会话" disabled={session.deleting} onPress={() => setDeleteConfirm(false)}><Text style={styles.mutedText}>取消</Text></Pressable>
        {!!notice && <Text accessibilityRole="alert" style={styles.error}>{notice}</Text>}
      </View> : <ThreadSettings threadId={threads.currentThread} onSaved={refresh} />}</>} />}
  </View>;
}
function ThreadStatusCaption({ threadId }: { threadId: string }) {
  const runtime = useThreadRuntime(threadId); const styles = useStyles();
  return <Text numberOfLines={1} style={styles.caption}>{runtime.label}</Text>;
}
function ConversationView({ threadId, visible, otherPage, refreshKey, onSettled, openConnection }: { threadId: string; visible: boolean; otherPage: ReactNode; refreshKey: number; onSettled: () => void; openConnection: () => void }) {
  const api = useApi();
  const conversation = useConversation(threadId, refreshKey);
  const sessions = useThreadSessionStore(); const session = useThreadSession(threadId);
  const runtime = useThreadRuntime(threadId); const connection = useServiceConnection();
  const styles = useStyles(); const { colors } = useWorkspaceTheme();
  const scroll = useRef<ScrollView>(null); const nearBottom = useRef(true);
  const previousRunning = useRef(false); const lastRun = useRef('');
  const [stopError, setStopError] = useState('');
  const [inputHeight, setInputHeight] = useState(l.composerHeight - l.composerPadding * 2);
  useEffect(() => {
    if (previousRunning.current && !conversation.running) onSettled();
    previousRunning.current = conversation.running;
  }, [conversation.running, onSettled]);
  const recentTerminal = runtime.runs.filter((run) => run.status !== 'running').map((run) => `${run.runId}:${run.revision}`).join('|');
  useEffect(() => {
    if (recentTerminal && recentTerminal !== lastRun.current) {
      lastRun.current = recentTerminal;
      if (!conversation.running) conversation.reload();
    }
  }, [recentTerminal, conversation]);
  const busy = conversation.running || runtime.running;
  const canSend = !!connection?.enabled && runtime.synchronized && !busy && !conversation.loading && !conversation.historyFailed && !session.deleted && !session.deleting;
  const stop = async () => {
    setStopError('');
    if (conversation.running) { await conversation.stop(); return; }
    const run = runtime.runs.find((item) => item.status === 'running' && item.threadId === threadId);
    if (!run || !runtime.synchronized) return;
    try {
      const stopped = await api.stopRun(threadId, run.runId);
      if (!stopped) { setStopError('该运行已结束或已变化，正在重新同步'); runtime.retry(); }
    } catch (error) { setStopError(error instanceof Error ? error.message : '停止失败，请重试'); }
  };
  const send = () => {
    if (!canSend || !session.draft.trim()) return;
    setStopError('');
    void conversation.send(session.draft, () => sessions.setDraft(threadId, ''), (text) => { if (!sessions.get(threadId).draft) sessions.setDraft(threadId, text); });
  };
  return <>
    <View style={[styles.chatBody, !visible && styles.hidden]}>
      <ScrollView ref={scroll} style={styles.chatScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.messageList} showsVerticalScrollIndicator={false}
        onScroll={(event) => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < l.headerHeight; }}
        scrollEventThrottle={spacing[16]} onContentSizeChange={() => { if (nearBottom.current) scroll.current?.scrollToEnd({ animated: false }); }}>
        {conversation.loading && !conversation.views.length ? <Text style={styles.mutedText}>正在读取聊天记录…</Text> : !conversation.views.length && <View style={styles.emptyChat}><Text style={styles.emptyTitle}>开始一段新的对话</Text><Text style={styles.mutedText}>消息会发送到你配置的 Pi Muse 服务器。</Text></View>}
        {conversation.views.map((message) => <Message key={message.id} message={message} />)}
        {conversation.running && <Text accessibilityLabel="正在生成回复" style={styles.mutedText}>正在生成回复…</Text>}
        {!!stopError && <Text accessibilityRole="alert" style={styles.error}>{stopError}</Text>}
        {!!conversation.error && <Text accessibilityRole="alert" style={styles.error}>{conversation.error}</Text>}
        {(conversation.historyFailed || connection?.snapshot.status === 'authentication-required') && <Pressable accessibilityRole="button" accessibilityLabel="重新同步会话" style={styles.actionButton} onPress={() => { if (connection?.snapshot.status === 'authentication-required') openConnection(); else { conversation.reload(); connection?.retry(); } }}><Text style={styles.actionText}>重新同步</Text></Pressable>}
      </ScrollView>
    </View>
    {!visible && <View style={styles.chatBody}>{otherPage}</View>}
    {visible && <View style={styles.composer}>
      <Pressable accessibilityRole="button" accessibilityLabel="附件尚未接入" style={styles.composerControl} disabled><Plus size={l.iconSize} color={colors.faint} /></Pressable>
      <TextInput accessibilityLabel="消息输入框" placeholder="消息" placeholderTextColor={colors.faint} value={session.draft} onChangeText={(text) => sessions.setDraft(threadId, text)} editable={!session.deleting && !session.deleted} multiline
        onContentSizeChange={(event) => setInputHeight(Math.max(l.composerHeight - l.composerPadding * 2, Math.min(l.composerMaxHeight, event.nativeEvent.contentSize.height)))}
        onKeyPress={Platform.OS === 'web' ? (event) => { const key = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean; isComposing?: boolean; keyCode?: number }; if (key.key === 'Enter' && !key.shiftKey && !key.isComposing && key.keyCode !== 229) { event.preventDefault(); send(); } } : undefined}
        style={[styles.input, { height: session.draft ? inputHeight : l.composerHeight - l.composerPadding * 2 }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as unknown as TextStyle)]} />
      <Pressable accessibilityRole="button" accessibilityLabel={busy ? '停止当前运行' : '发送消息'} disabled={busy ? !runtime.synchronized || session.deleting : !canSend || !session.draft.trim()}
        style={[styles.sendButton, (!canSend && !busy || !busy && !session.draft.trim()) && styles.disabled]} onPress={() => void (busy ? stop() : send())}>
        {busy ? <Square size={sizing[16]} color={colors.onAccent} fill={colors.onAccent} /> : <ArrowUp size={l.iconSize} color={colors.onAccent} />}
      </Pressable>
    </View>}
  </>;
}
function Message({ message }: { message: MessageView }) {
  const styles = useStyles();
  return <View style={styles.messageBlock}>
    {!!message.text && <View style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}><Text selectable style={[styles.messageText, message.role === 'user' && styles.userMessageText]}>{message.text}</Text></View>}
    {message.toolCalls.map((tool) => <View style={styles.toolCard} key={tool.id}><Text style={styles.caption}>{tool.name}</Text><Text selectable style={styles.mutedText}>{tool.result ?? '工具执行中…'}</Text></View>)}
  </View>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas }, viewport: { flex: 1, alignSelf: 'center', overflow: 'hidden', backgroundColor: c.canvas }, screen: { flex: 1 },
  foreground: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.canvas, overflow: 'hidden' }, foregroundRounded: { borderRadius: r.drawerForeground }, foregroundCover: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.overlay },
  connectionLabel: { alignItems: 'center', paddingTop: l.sampleLabelTop }, chatBody: { flex: 1, minHeight: 0 }, hidden: { display: 'none' }, chatScroll: { flex: 1 },
  messageList: { paddingTop: l.chatContentTop, paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: l.messageGap }, messageBlock: { gap: l.messageGap },
  message: { padding: l.messagePadding, borderRadius: r.message }, assistantMessage: { backgroundColor: c.surface, borderTopLeftRadius: l.bubbleTail, alignSelf: 'flex-start', maxWidth: '100%' }, userMessage: { backgroundColor: c.blue, alignSelf: 'flex-end', maxWidth: l.userMessageWidth },
  messageText: { ...t.message, color: c.ink }, userMessageText: { color: c.onAccent }, toolCard: { backgroundColor: c.surface, padding: spacing[14], borderRadius: r.card, gap: spacing[8] },
  floatingHeader: { position: 'absolute', top: l.headerTop, left: l.sidePadding, right: l.sidePadding, height: l.headerHeight }, headerLeft: { position: 'absolute', top: 0, left: 0 }, headerRight: { position: 'absolute', top: 0, right: 0 },
  roundButton: { width: l.controlSize, height: l.controlSize, borderRadius: r.round, backgroundColor: c.control, alignItems: 'center', justifyContent: 'center' }, pressed: { opacity: 0.7 },
  identity: { alignSelf: 'center', alignItems: 'center', maxWidth: '56%' }, headerAvatar: { width: l.headerAvatar, height: l.headerAvatar, borderRadius: r.round, backgroundColor: c.avatar, alignItems: 'center', justifyContent: 'center' },
  identityLabel: { paddingHorizontal: spacing[14], paddingVertical: spacing[6], marginTop: -spacing[10], zIndex: -1, borderRadius: r.message, backgroundColor: c.control, alignItems: 'center', maxWidth: '100%' }, identityName: { ...t.name, color: c.ink }, identityStatus: { ...t.status, color: c.muted },
  composer: { flexDirection: 'row', alignItems: 'center', minHeight: l.composerHeight, padding: l.composerPadding, marginHorizontal: l.sidePadding, marginBottom: l.composerBottom, borderRadius: r.round, backgroundColor: c.surface },
  composerControl: { width: l.smallControl, height: l.smallControl, alignItems: 'center', justifyContent: 'center' }, input: { flex: 1, minWidth: 0, ...t.input, color: c.ink, paddingHorizontal: spacing[6], paddingVertical: spacing[8], textAlignVertical: 'center', maxHeight: l.composerMaxHeight, backgroundColor: c.surface, borderWidth: 0, overflow: 'hidden' },
  sendButton: { width: l.smallControl, height: l.smallControl, borderRadius: r.round, alignItems: 'center', justifyContent: 'center', backgroundColor: c.blue }, disabled: { opacity: 0.4 },
  navigation: { flexDirection: 'row', height: l.navigationHeight, marginHorizontal: spacing[26], marginBottom: l.navigationBottom, alignItems: 'center' }, navigationItem: { flex: 1, height: l.controlSize, alignItems: 'center', justifyContent: 'center' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: l.sidePadding, paddingTop: l.drawerTop, backgroundColor: c.canvas }, drawerHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: l.drawerTop, marginBottom: l.drawerTitleBottom }, drawerTitle: { ...t.drawerTitle, color: c.ink }, drawerSection: { ...t.caption, color: c.faint, marginBottom: spacing[12], marginLeft: spacing[4] }, drawerList: { gap: spacing[6] },
  threadRow: { minHeight: l.drawerRowHeight, flexDirection: 'row', alignItems: 'center', gap: spacing[14], paddingHorizontal: spacing[14], paddingVertical: spacing[8], borderRadius: r.listItem }, threadSelected: { backgroundColor: c.surface }, threadText: { flex: 1, gap: spacing[2] }, drawerFooter: { height: l.drawerFooterHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  otherPage: { paddingTop: l.headerHeight, paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: spacing[16] }, pageTitle: { ...t.heroName, color: c.ink }, itemTitle: { ...t.itemTitle, color: c.ink }, mutedText: { ...t.detail, color: c.muted }, caption: { ...t.caption, color: c.faint }, error: { ...t.caption, color: c.danger },
  exampleCard: { padding: spacing[18], borderRadius: r.card, backgroundColor: c.surface, gap: spacing[8], marginBottom: spacing[16] }, settingsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[14], padding: spacing[18], borderRadius: r.card, backgroundColor: c.surface },
  emptyChat: { alignItems: 'center', paddingVertical: spacing[24], gap: spacing[12] }, emptyTitle: { ...t.heroName, color: c.ink, textAlign: 'center' }, notice: { position: 'absolute', left: l.sidePadding, right: l.sidePadding, top: l.headerHeight, ...t.caption, color: c.danger, backgroundColor: c.control, padding: spacing[12], borderRadius: r.listItem },
  disconnected: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: l.maxWidth }, disconnectedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: l.sidePadding }, welcome: { flex: 1, paddingHorizontal: l.sidePadding, gap: spacing[18], alignItems: 'center', justifyContent: 'center' },
  actionButton: { backgroundColor: c.blue, paddingHorizontal: spacing[18], paddingVertical: spacing[12], borderRadius: r.round, alignSelf: 'center' }, actionText: { ...t.status, color: c.onAccent },
});
