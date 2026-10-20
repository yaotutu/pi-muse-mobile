import { Bot, Check, Download, Menu, MessageCircle, Moon, PanelsTopLeft, Server, Shapes, Square, SquareCheck, SquarePen, Sun, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AccessibilityInfo, Animated, BackHandler, Easing, Keyboard, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiProvider } from '../api/ApiProvider';
import { ConnectionProvider, useServiceConnection } from '../connection/ConnectionProvider';
import { useConnection } from '../connection/useConnection';
import type { ConnectionManager } from '../connection/connection-manager';
import type { ConnectionSnapshot } from '../connection/types';
import { RuntimeProvider, useRuntimeStore, useSpaceRuntime } from '../runtime/RuntimeProvider';
import { useActivityStore } from '../activities/ActivityProvider';
import { useApprovals } from '../approvals/ApprovalProvider';
import { SpaceProvider, useSpaceState, useSpaceStore } from '../spaces/SpaceProvider';
import { MAIN_SPACE } from '../spaces/space-state';
import { useSpaces } from '../spaces/useSpaces';
import { useAppUpdate } from '../update/UpdateProvider';
import { spacing, sizing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { ConnectionPanel } from './ConnectionPanel';
import { ActivityPanel } from './ActivityPanel';
import { ConversationView } from './ConversationView';
import { SessionPanel, type SessionTab } from './SessionPanel';
import { SpaceSettings } from './SpaceSettings';
import { WorkspaceThemeProvider, useWorkspaceTheme } from './WorkspaceTheme';

type WorkspacePage = 'chat' | 'activity' | 'goals' | 'apps';
type WorkspaceNotice = { text: string; tone: 'success' | 'error' };
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
      <SpaceProvider><RuntimeProvider><LiveWorkspace manager={connection.manager} snapshot={connection.snapshot} openConnection={openConnection} /></RuntimeProvider></SpaceProvider>
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
  const spaces = useSpaces(!!connection?.enabled, snapshot.refreshVersion);
  const session = useSpaceState(spaces.currentSpace);
  const sessions = useSpaceStore(); const runtimeStore = useRuntimeStore();
  const activities = useActivityStore();
  const { store: approvals } = useApprovals();
  const runtime = useSpaceRuntime(spaces.currentSpace);
  const [page, setPage] = useState<WorkspacePage>('chat');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionTab, setSessionTab] = useState<SessionTab>('activity');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [clearSchedules, setClearSchedules] = useState(false);
  const [notice, setNotice] = useState<WorkspaceNotice>();
  const [reducedMotion, setReducedMotion] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const { colors, mode, toggle } = useWorkspaceTheme(); const styles = useStyles();
  const { width } = useWindowDimensions(); const contentWidth = Math.min(width, l.maxWidth);
  const drawerWidth = Math.min(contentWidth * l.drawerRatio, l.drawerMaxWidth);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const statusLabel = snapshot.status === 'authentication-required' || snapshot.status === 'reset-error' || snapshot.status === 'storage-error'
    ? connectionLabel(snapshot) : runtime.label;
  const name = spaces.currentSpace === MAIN_SPACE ? 'Pi Muse' : spaces.currentSpace;
  const ClearSchedulesIcon = clearSchedules ? SquareCheck : Square;
  const reloadSpaces = spaces.reload;
  const refresh = useCallback(() => { void reloadSpaces(); activities.invalidate(); setHistoryRefresh((value) => value + 1); }, [reloadSpaces, activities]);
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
  const openDrawer = useCallback(() => { Keyboard.dismiss(); setSessionOpen(false); setDrawerOpen(true); void reloadSpaces(); }, [reloadSpaces]);
  const select = (id: string) => { spaces.selectSpace(id); setSessionOpen(false); setDrawerOpen(false); setPage('chat'); setDeleteConfirm(false); setNotice(undefined); };
  const remove = async () => {
    const id = spaces.currentSpace;
    try {
      const result = await sessions.deleteSpace(id);
      if (!result) return;
      runtimeStore.forgetSpace(id); activities.forgetSpace(id); spaces.removeSpace(id); setSessionOpen(false); setDeleteConfirm(false); setNotice(undefined); await spaces.reload();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), tone: 'error' }); }
  };
  const reset = async () => {
    const id = spaces.currentSpace;
    try {
      const result = await sessions.resetSpace(id, clearSchedules);
      if (!result) return;
      // 重置不删除空间或活动历史；通知重连获取权威审批集合，不凭 cancelledApprovals 猜具体审批 ID。
      runtimeStore.forgetSpace(id);
      activities.invalidate(id);
      await approvals.refreshPending();
      setResetConfirm(false); setClearSchedules(false); setSessionOpen(false); setPage('chat');
      setNotice({ text: '会话已重置，可开启全新对话。空间规则、技能与工作区文件已保留。', tone: 'success' });
      refresh();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), tone: 'error' });
      // 列表回读仅核对新 sessionId，不重发 reset；未确认期间禁止继续发送旧上下文。
      void spaces.reload();
    }
  };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => Math.abs(gesture.dx) > l.gestureThreshold && Math.abs(gesture.dx) > Math.abs(gesture.dy) * l.gestureAxisRatio && (drawerOpen ? gesture.dx < 0 : event.nativeEvent.pageX - gesture.dx < l.edgeGestureWidth && gesture.dx > 0),
    onPanResponderRelease: (_event, gesture) => { if (gesture.dx < -l.gestureThreshold) setDrawerOpen(false); if (gesture.dx > l.gestureThreshold) openDrawer(); },
  }), [drawerOpen, openDrawer]);
  const otherPage = page === 'chat' ? null : page === 'apps' ? <AppsPage snapshot={snapshot} openConnection={openConnection} /> : page === 'activity' ? !sessionOpen && <ScrollView contentContainerStyle={styles.otherPage}><ActivityPanel key={spaces.currentSpace} spaceId={spaces.currentSpace} defaultScope="all" /><Text style={styles.caption}>定时任务管理尚未接入。</Text></ScrollView> : <View style={styles.otherPage}>
    <Text style={styles.pageTitle}>目标</Text><Text style={styles.mutedText}>目标尚未接入。</Text>
  </View>;
  return <View style={styles.root} testID="workspace-screen"><StatusBar style={mode === 'light' ? 'dark' : 'light'} />
    <View style={[styles.viewport, { width: contentWidth }]} {...pan.panHandlers}>
      <SafeAreaView style={[styles.drawer, { width: drawerWidth }]} edges={['top', 'bottom', 'left']} pointerEvents={drawerOpen ? 'auto' : 'none'} aria-hidden={!drawerOpen}
        {...(Platform.OS === 'web' && !drawerOpen ? { inert: true } : {})} accessibilityElementsHidden={!drawerOpen} importantForAccessibility={drawerOpen ? 'yes' : 'no-hide-descendants'}>
        <View style={styles.drawerHeading}><Text style={styles.drawerTitle}>Pi Muse</Text><RoundButton icon={X} label="关闭空间侧栏" onPress={() => setDrawerOpen(false)} /></View>
        <Text style={styles.drawerSection}>空间</Text>
        {!!spaces.error && <Text style={styles.error}>{spaces.error}</Text>}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.drawerList}>
          {spaces.spaces.map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={space.id === MAIN_SPACE ? '主空间' : space.id} accessibilityState={{ selected: space.id === spaces.currentSpace }}
            onPress={() => select(space.id)} style={[styles.threadRow, space.id === spaces.currentSpace && styles.threadSelected]}>
            <MessageCircle size={l.navigationIconSize} color={colors.ink} /><View style={styles.threadText}>
              <Text numberOfLines={1} style={styles.itemTitle}>{space.id === MAIN_SPACE ? '主空间' : space.id}</Text><SpaceStatusCaption spaceId={space.id} />
            </View>{space.id === spaces.currentSpace && <Check size={sizing[18]} color={colors.muted} />}
          </Pressable>)}
        </ScrollView>
        <View style={styles.drawerFooter}><RoundButton icon={SquarePen} label="新建空间" testID="workspace-create-space" onPress={() => { spaces.createSpace(); setDrawerOpen(false); setSessionOpen(false); setPage('chat'); setNotice(undefined); }} /></View>
      </SafeAreaView>
      <Animated.View style={[styles.foreground, drawerOpen && styles.foregroundRounded, { transform: [{ translateX: drawerProgress.interpolate({ inputRange: [0, 1], outputRange: [0, drawerWidth] }) }] }]} accessibilityElementsHidden={drawerOpen} importantForAccessibility={drawerOpen ? 'no-hide-descendants' : 'auto'}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']} aria-hidden={drawerOpen} {...(Platform.OS === 'web' && drawerOpen ? { inert: true } : {})}>
          <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
            <View style={styles.connectionLabel}><Text style={styles.caption}>{runtime.synchronized && snapshot.hasToken ? '已连接真实服务' : statusLabel}</Text></View>
            <ConversationView key={`${spaces.currentSpace}:${session.epoch}`} spaceId={spaces.currentSpace} visible={page === 'chat'} otherPage={otherPage} refreshKey={historyRefresh} onSettled={refresh} openConnection={openConnection} />
            <View style={styles.floatingHeader} pointerEvents="box-none">
              <View style={styles.headerLeft}><RoundButton icon={Menu} label="打开空间侧栏" testID="workspace-open-drawer" onPress={openDrawer} /></View>
              <Pressable accessibilityRole="button" accessibilityLabel="打开当前会话面板" accessibilityHint="全屏显示当前会话的动态、审批、工作区和历史" testID="workspace-open-session" style={styles.identity}
                onPress={() => { Keyboard.dismiss(); setDrawerOpen(false); setSessionOpen(true); }}>
                <View style={styles.headerAvatar}><Bot size={l.headerAvatar / 2} color={colors.ink} /></View>
                <View style={styles.identityLabel}><Text numberOfLines={1} style={styles.identityName}>{name}</Text><Text numberOfLines={1} style={styles.identityStatus}>{statusLabel}</Text></View>
              </Pressable>
              <View style={styles.headerRight}><RoundButton icon={mode === 'light' ? Moon : Sun} label={mode === 'light' ? '切换到暗色主题' : '切换到亮色主题'} testID="workspace-theme-toggle" onPress={toggle} /></View>
            </View>
            {!!notice && <Text accessibilityRole="alert" style={[styles.notice, notice.tone === 'error' && styles.error]}>{notice.text}</Text>}
            <Navigation page={page} onPage={(next) => { setPage(next); setSessionOpen(false); }} />
          </KeyboardAvoidingView>
        </SafeAreaView>
        {drawerOpen && <Pressable accessibilityRole="button" accessibilityLabel="收起空间侧栏" onPress={() => setDrawerOpen(false)} style={styles.foregroundCover} />}
      </Animated.View>
    </View>
    {sessionOpen && <SessionPanel spaceId={spaces.currentSpace} spaceName={name} status={statusLabel} tab={sessionTab} onTab={(next) => { if (session.resetting || session.deleting) return; setSessionTab(next); setDeleteConfirm(false); setResetConfirm(false); }}
      onClose={() => { if (!session.deleting && !session.resetting) { setSessionOpen(false); setResetConfirm(false); } }} onDelete={() => { setDeleteConfirm(true); setResetConfirm(false); }} deleting={session.deleting} resetting={session.resetting} reducedMotion={reducedMotion} onSettled={refresh}
      onReset={() => { setSessionTab('workspace'); setDeleteConfirm(false); setClearSchedules(false); setResetConfirm(true); setNotice(undefined); }}
      settings={<>{resetConfirm ? <View style={styles.exampleCard} accessibilityViewIsModal>
        <Text style={styles.itemTitle}>重置当前会话？</Text>
        <Text style={styles.mutedText}>重置将停止当前运行，清空聊天历史与未完成的审批，开启全新对话。空间规则、技能开关与已保存的工作区文件都会保留。</Text>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="同时清理定时任务与网页监控" accessibilityState={{ checked: clearSchedules, disabled: session.resetting }}
          disabled={session.resetting} onPress={() => setClearSchedules((value) => !value)} style={styles.settingsRow}>
          <ClearSchedulesIcon size={l.iconSize} color={clearSchedules ? colors.blue : colors.faint} /><Text style={[styles.mutedText, styles.threadText]}>{clearSchedules ? '已选择：' : '未选择：'}同时清理此空间下的定时任务与网页监控</Text>
        </Pressable>
        <Text style={styles.caption}>默认保留定时任务与监控，并由服务端绑定到新会话。清空的聊天历史无法恢复。</Text>
        {session.resetUncertain && <Text accessibilityRole="alert" style={styles.error}>重置结果未确认，请关闭面板并刷新空间列表核对；不会自动重试。</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="确认重置会话" disabled={session.resetting || session.resetUncertain || !connection?.enabled || sessions.hasSettingsWrite(spaces.currentSpace)} style={styles.actionButton} onPress={() => void reset()}><Text style={styles.actionText}>{session.resetting ? '正在重置…' : '确认重置'}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="取消重置会话" disabled={session.resetting} onPress={() => setResetConfirm(false)}><Text style={styles.mutedText}>取消</Text></Pressable>
        {notice?.tone === 'error' && <Text accessibilityRole="alert" style={styles.error}>{notice.text}</Text>}
      </View> : deleteConfirm ? <View style={styles.exampleCard}><Text style={styles.itemTitle}>确认删除当前空间？</Text><Text style={styles.mutedText}>空间的全部聊天历史、工作区文件、规则、技能和绑定的定时任务、监控将被彻底删除，无法撤销。</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="确认删除空间" disabled={session.deleting} style={styles.actionButton} onPress={() => void remove()}><Text style={styles.actionText}>确认删除</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="取消删除空间" disabled={session.deleting} onPress={() => setDeleteConfirm(false)}><Text style={styles.mutedText}>取消</Text></Pressable>
        {notice?.tone === 'error' && <Text accessibilityRole="alert" style={styles.error}>{notice.text}</Text>}
      </View> : <SpaceSettings spaceId={spaces.currentSpace} onSaved={refresh} />}</>} />}
  </View>;
}
function SpaceStatusCaption({ spaceId }: { spaceId: string }) {
  const runtime = useSpaceRuntime(spaceId); const styles = useStyles();
  return <Text numberOfLines={1} style={styles.caption}>{runtime.label}</Text>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas }, viewport: { flex: 1, alignSelf: 'center', overflow: 'hidden', backgroundColor: c.canvas }, screen: { flex: 1 },
  foreground: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.canvas, overflow: 'hidden' }, foregroundRounded: { borderRadius: r.drawerForeground }, foregroundCover: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.overlay },
  connectionLabel: { alignItems: 'center', paddingTop: l.sampleLabelTop },
  floatingHeader: { position: 'absolute', top: l.headerTop, left: l.sidePadding, right: l.sidePadding, height: l.headerHeight }, headerLeft: { position: 'absolute', top: 0, left: 0 }, headerRight: { position: 'absolute', top: 0, right: 0 },
  roundButton: { width: l.controlSize, height: l.controlSize, borderRadius: r.round, backgroundColor: c.control, alignItems: 'center', justifyContent: 'center' }, pressed: { opacity: 0.7 },
  identity: { alignSelf: 'center', alignItems: 'center', maxWidth: '56%' }, headerAvatar: { width: l.headerAvatar, height: l.headerAvatar, borderRadius: r.round, backgroundColor: c.avatar, alignItems: 'center', justifyContent: 'center' },
  identityLabel: { paddingHorizontal: spacing[14], paddingVertical: spacing[6], marginTop: -spacing[10], zIndex: -1, borderRadius: r.message, backgroundColor: c.control, alignItems: 'center', maxWidth: '100%' }, identityName: { ...t.name, color: c.ink }, identityStatus: { ...t.status, color: c.muted },
  navigation: { flexDirection: 'row', height: l.navigationHeight, marginHorizontal: spacing[26], marginBottom: l.navigationBottom, alignItems: 'center' }, navigationItem: { flex: 1, height: l.controlSize, alignItems: 'center', justifyContent: 'center' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: l.sidePadding, paddingTop: l.drawerTop, backgroundColor: c.canvas }, drawerHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: l.drawerTop, marginBottom: l.drawerTitleBottom }, drawerTitle: { ...t.drawerTitle, color: c.ink }, drawerSection: { ...t.caption, color: c.faint, marginBottom: spacing[12], marginLeft: spacing[4] }, drawerList: { gap: spacing[6] },
  threadRow: { minHeight: l.drawerRowHeight, flexDirection: 'row', alignItems: 'center', gap: spacing[14], paddingHorizontal: spacing[14], paddingVertical: spacing[8], borderRadius: r.listItem }, threadSelected: { backgroundColor: c.surface }, threadText: { flex: 1, gap: spacing[2] }, drawerFooter: { height: l.drawerFooterHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  otherPage: { paddingTop: l.headerHeight, paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: spacing[16] }, pageTitle: { ...t.heroName, color: c.ink }, itemTitle: { ...t.itemTitle, color: c.ink }, mutedText: { ...t.detail, color: c.muted }, caption: { ...t.caption, color: c.faint }, error: { ...t.caption, color: c.danger },
  exampleCard: { padding: spacing[18], borderRadius: r.card, backgroundColor: c.surface, gap: spacing[8], marginBottom: spacing[16] }, settingsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[14], padding: spacing[18], borderRadius: r.card, backgroundColor: c.surface },
  emptyTitle: { ...t.heroName, color: c.ink, textAlign: 'center' }, notice: { position: 'absolute', left: l.sidePadding, right: l.sidePadding, top: l.headerHeight, ...t.caption, color: c.ink, backgroundColor: c.control, padding: spacing[12], borderRadius: r.listItem },
  disconnected: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: l.maxWidth }, disconnectedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: l.sidePadding }, welcome: { flex: 1, paddingHorizontal: l.sidePadding, gap: spacing[18], alignItems: 'center', justifyContent: 'center' },
  actionButton: { backgroundColor: c.blue, paddingHorizontal: spacing[18], paddingVertical: spacing[12], borderRadius: r.round, alignSelf: 'center' }, actionText: { ...t.status, color: c.onAccent },
});
