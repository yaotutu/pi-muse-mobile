import { BookOpen, Check, ChevronRight, Download, Menu, MessageCircle, Moon, PanelsTopLeft, Search, Server, Shapes, ShieldCheck, Square, SquareCheck, SquarePen, UserRound, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { Animated, BackHandler, Easing, Keyboard, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
import { TasksPage } from './JobsPanel';
import { useJobs } from '../jobs/JobProvider';
import { useMonitors } from '../monitors/MonitorProvider';
import { GoalsPanel } from './GoalsPanel';
import { useGoals } from '../goals/GoalProvider';
import { FilesProvider } from '../files/FilesProvider';
import { MemoryPanel } from './MemoryPanel';
import { ProfilePanel } from './ProfilePanel';
import { ProfileProvider, useProfile } from '../profile/ProfileProvider';
import { DreamProvider } from '../dream/DreamProvider';
import { DreamPanel } from './DreamPanel';
import { ConversationView } from './ConversationView';
import { SessionPanel, type SessionTab } from './SessionPanel';
import { SpaceSettings } from './SpaceSettings';
import { useTheme } from '../theme/ThemeProvider';
import { ThemePicker } from '../theme/ThemePicker';
import { ThemeToggle } from '../theme/ThemeToggle';
import { IconControl, MuseAvatar, StatusPill, useReducedMotion } from './primitives';

type WorkspacePage = 'chat' | 'activity' | 'goals' | 'apps';
type WorkspaceNotice = { text: string; tone: 'success' | 'error' };
const { layout: l, radius: r, typography: t } = workspaceTheme;
const NAV: { id: WorkspacePage; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: '聊天', icon: MessageCircle }, { id: 'activity', label: '任务', icon: PanelsTopLeft },
  { id: 'goals', label: '目标', icon: SquareCheck }, { id: 'apps', label: '应用', icon: Shapes },
];
function useStyles() { const { colors } = useTheme(); return useMemo(() => createStyles(colors), [colors]); }
function RoundButton({ icon: Icon, label, onPress, testID }: { icon: LucideIcon; label: string; onPress: () => void; testID?: string }) {
  return <IconControl icon={Icon} label={label} onPress={onPress} testID={testID} />;
}

/** 新版是唯一入口；连接配置只从应用页打开，不改变会话信息区职责。 */
export function WorkspaceScreen() {
  return <ConnectedWorkspace />;
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
      {/* 资料与空间同属当前连接；Provider 先于页面挂载，主会话名称可直接消费已读取身份。 */}
      <DreamProvider><ProfileProvider><SpaceProvider><RuntimeProvider><LiveWorkspace manager={connection.manager} snapshot={connection.snapshot} openConnection={openConnection} /></RuntimeProvider></SpaceProvider></ProfileProvider></DreamProvider>
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
function AppsPage({ snapshot, openConnection, memoryAvailable = false, profileAvailable = false, dreamAvailable = false, currentSpaceId }: Pick<WorkspaceConnectionProps, 'snapshot' | 'openConnection'> & { memoryAvailable?: boolean; profileAvailable?: boolean; dreamAvailable?: boolean; currentSpaceId?: string }) {
  const styles = useStyles(); const { colors } = useTheme(); const update = useAppUpdate();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [dreamOpen, setDreamOpen] = useState(false);
  if (memoryOpen && memoryAvailable) return <ScrollView key="memory" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.otherPage}><MemoryPanel onBack={() => setMemoryOpen(false)} /></ScrollView>;
  if (profileOpen && profileAvailable) return <ScrollView key="profile" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.otherPage}><ProfilePanel onBack={() => setProfileOpen(false)} /></ScrollView>;
  if (dreamOpen && dreamAvailable && currentSpaceId) return <ScrollView key="dream" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.otherPage}><DreamPanel currentSpaceId={currentSpaceId} onBack={() => setDreamOpen(false)} /></ScrollView>;
  return <ScrollView key="apps" contentContainerStyle={styles.otherPage}>
    <View style={styles.appIntro}><MuseAvatar size={l.sessionAvatar} /><View style={styles.threadText}><Text style={styles.pageTitle}>Pi Muse</Text><Text style={styles.mutedText}>你的灵感，一起实现。</Text></View></View>
    <Text style={styles.sectionLabel}>连接与设备</Text>
    <View style={styles.settingsGroup}>
    <Pressable accessibilityRole="button" accessibilityLabel="服务器连接" onPress={openConnection} style={styles.settingsRow}>
      <View style={styles.rowIcon}><Server size={l.iconSize} strokeWidth={1.6} color={colors.ink} /></View><View style={styles.threadText}>
        <Text style={styles.itemTitle}>服务器连接</Text><Text style={styles.caption}>{connectionLabel(snapshot)}</Text>
        {!!snapshot.serverUrl && <Text numberOfLines={1} style={styles.caption}>{snapshot.serverUrl}</Text>}
      </View><ChevronRight size={sizing[18]} color={colors.faint} />
    </Pressable>
    {update && <Pressable accessibilityRole="button" accessibilityLabel="应用更新" onPress={update.open} style={styles.settingsRow}>
      <View style={styles.rowIcon}><Download size={l.iconSize} strokeWidth={1.6} color={colors.ink} /></View><View style={styles.threadText}><Text style={styles.itemTitle}>应用更新</Text>
        <Text style={styles.caption}>{update.snapshot.status === 'unsupported' ? '当前环境不支持自动安装' : '检查版本、下载与安装进度'}</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
    </Pressable>}
    </View>
    <Text style={styles.sectionLabel}>助手与个人资料</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="打开助手与用户资料" accessibilityState={{ disabled: !profileAvailable }} disabled={!profileAvailable} onPress={() => setProfileOpen(true)} style={[styles.settingsRow, !profileAvailable && styles.settingsDisabled]}>
      <View style={styles.rowIcon}><UserRound size={l.iconSize} strokeWidth={1.6} color={colors.ink} /></View><View style={styles.threadText}><Text style={styles.itemTitle}>助手与用户资料</Text><Text style={styles.caption}>{profileAvailable ? '设置全空间共用的名字、语气、人设与用户资料' : '连接真实服务后可用'}</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
    </Pressable>
    <Text style={styles.sectionLabel}>助手记忆</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="打开长期记忆" accessibilityState={{ disabled: !memoryAvailable }} disabled={!memoryAvailable} onPress={() => setMemoryOpen(true)} style={styles.settingsRow}>
      <View style={styles.rowIcon}><BookOpen size={l.iconSize} strokeWidth={1.6} color={colors.ink} /></View><View style={styles.threadText}><Text style={styles.itemTitle}>长期记忆</Text><Text style={styles.caption}>{memoryAvailable ? '查询、搜索与管理所有空间共用的记忆' : '连接真实服务后管理全局记忆'}</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="打开Dream记忆整理" accessibilityState={{ disabled: !dreamAvailable }} disabled={!dreamAvailable} onPress={() => setDreamOpen(true)} style={[styles.settingsRow, !dreamAvailable && styles.settingsDisabled]}>
      <View style={styles.rowIcon}><Moon size={l.iconSize} strokeWidth={1.6} color={colors.ink} /></View><View style={styles.threadText}><Text style={styles.itemTitle}>Dream 记忆整理</Text><Text style={styles.caption}>{dreamAvailable ? '查看整理状态、编辑提示词与处理待决建议' : '连接真实服务后可用'}</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
    </Pressable>
    <ThemePicker />
    <View style={styles.privacyNote}><ShieldCheck size={sizing[18]} color={colors.faint} /><Text style={[styles.caption, styles.threadText]}>连接你自己的服务，数据归你所有。助手资料、长期记忆与 Dream 已接入；其他应用能力尚未接入。</Text></View>
  </ScrollView>;
}
function DisconnectedWorkspace({ snapshot, openConnection }: WorkspaceConnectionProps) {
  const [page, setPage] = useState<WorkspacePage>('chat');
  const styles = useStyles();
  return <View style={styles.root} testID="workspace-screen"><ThemeStatusBar />
    <SafeAreaView style={styles.disconnected}>
      <View style={styles.disconnectedHeader}><Text style={styles.itemTitle}>Pi Muse</Text><ThemeToggle /></View>
      {page === 'apps' ? <AppsPage snapshot={snapshot} openConnection={openConnection} /> : <View style={styles.welcome}>
        <MuseAvatar size={l.sessionAvatar} /><Text style={styles.eyebrow}>HELLO, PI MUSE</Text><Text style={styles.emptyTitle}>{connectionLabel(snapshot)}</Text>
        <Text style={styles.mutedText}>{snapshot.error ?? '连接自己的 Pi Muse 服务器后即可恢复会话、聊天与真实执行状态。'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="配置服务器连接" onPress={openConnection} style={styles.actionButton}><Text style={styles.actionText}>服务器连接</Text></Pressable>
        <Text style={styles.caption}>从一次连接开始。应用更新可独立使用。</Text>
      </View>}
      <Navigation page={page} onPage={setPage} />
    </SafeAreaView>
  </View>;
}
function Navigation({ page, onPage }: { page: WorkspacePage; onPage: (page: WorkspacePage) => void }) {
  const styles = useStyles(); const { colors } = useTheme();
  return <View accessibilityRole="tablist" accessibilityLabel="主要页面" style={styles.navigation}>
    {NAV.map(({ id, label, icon: Icon }) => <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: page === id }} aria-selected={page === id} onPress={() => onPage(id)} style={({ pressed }) => [styles.navigationItem, pressed && styles.pressed]}>
      <Icon size={l.navigationIconSize} strokeWidth={1.8} color={page === id ? colors.ink : colors.faint} fill={id === 'chat' && page === id ? colors.ink : 'none'} />
      <Text style={[styles.navigationLabel, page === id && styles.navigationLabelSelected]}>{label}</Text>
    </Pressable>)}
  </View>;
}

function LiveWorkspace({ snapshot, openConnection }: WorkspaceConnectionProps) {
  const connection = useServiceConnection();
  const { snapshot: profile } = useProfile();
  const spaces = useSpaces(!!connection?.enabled, snapshot.refreshVersion);
  const session = useSpaceState(spaces.currentSpace);
  const sessions = useSpaceStore(); const runtimeStore = useRuntimeStore();
  const activities = useActivityStore();
  const { store: jobs } = useJobs();
  const { store: monitors } = useMonitors();
  const { store: approvals } = useApprovals();
  const { store: goals } = useGoals();
  const runtime = useSpaceRuntime(spaces.currentSpace);
  const [page, setPage] = useState<WorkspacePage>('chat');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionTab, setSessionTab] = useState<SessionTab>('activity');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [clearSchedules, setClearSchedules] = useState(false);
  const [notice, setNotice] = useState<WorkspaceNotice>();
  const reducedMotion = useReducedMotion();
  const [spaceQuery, setSpaceQuery] = useState('');
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const { colors } = useTheme(); const styles = useStyles();
  const { width } = useWindowDimensions(); const contentWidth = Math.min(width, l.maxWidth);
  const drawerWidth = Math.min(contentWidth * l.drawerRatio, l.drawerMaxWidth);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const statusLabel = snapshot.status === 'authentication-required' || snapshot.status === 'reset-error' || snapshot.status === 'storage-error'
    ? connectionLabel(snapshot) : runtime.label;
  const name = spaces.currentSpace === MAIN_SPACE ? (profile.identity?.name ?? 'Pi Muse') : spaces.currentSpace;
  const ClearSchedulesIcon = clearSchedules ? SquareCheck : Square;
  const reloadSpaces = spaces.reload;
  const refresh = useCallback(() => { void reloadSpaces(); activities.invalidate(); jobs.invalidate(); monitors.invalidate(); goals.invalidate(); setHistoryRefresh((value) => value + 1); }, [reloadSpaces, activities, jobs, monitors, goals]);
  useEffect(() => {
    // 原生键盘出现时让出阅读空间；系统 Back 收起键盘也必须恢复完整顶栏与主导航。
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (notice?.tone !== 'success') return;
    const timer = setTimeout(() => setNotice(undefined), workspaceTheme.motion.feedbackDuration);
    return () => clearTimeout(timer);
  }, [notice]);
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
      runtimeStore.forgetSpace(id); activities.forgetSpace(id); jobs.invalidate(); monitors.invalidate(); spaces.removeSpace(id); setSessionOpen(false); setDeleteConfirm(false); setNotice(undefined); await spaces.reload();
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
  const otherPage = page === 'chat' ? null : page === 'apps' ? <AppsPage snapshot={snapshot} openConnection={openConnection} memoryAvailable profileAvailable dreamAvailable currentSpaceId={spaces.currentSpace} /> : page === 'activity' ? !sessionOpen && <TasksPage spaceId={spaces.currentSpace} /> : !sessionOpen && <GoalsPanel />;
  // 文件状态留在当前真实连接内；会话面板关闭时只卸载可见 UI，不销毁草稿。
  return <FilesProvider currentSpaceId={spaces.currentSpace}><View style={styles.root} testID="workspace-screen"><ThemeStatusBar />
    <View style={[styles.viewport, { width: contentWidth }]} {...pan.panHandlers}>
      <View style={[styles.drawer, { width: drawerWidth }]} pointerEvents={drawerOpen ? 'auto' : 'none'} aria-hidden={!drawerOpen}
        {...(Platform.OS === 'web' && !drawerOpen ? { inert: true } : {})} accessibilityElementsHidden={!drawerOpen} importantForAccessibility={drawerOpen ? 'yes' : 'no-hide-descendants'}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left']}>
        <View style={styles.drawerHeading}><Text style={styles.drawerTitle}>Pi Muse</Text><RoundButton icon={X} label="关闭空间侧栏" onPress={() => setDrawerOpen(false)} /></View>
        <View style={styles.drawerSectionRow}><Text style={styles.drawerSection}>你的空间</Text><Text style={styles.caption}>{spaces.spaces.length}</Text></View>
        {!!spaces.error && <Text style={styles.error}>{spaces.error}</Text>}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.drawerList}>
          {spaces.spaces.filter((space) => (space.id === MAIN_SPACE ? `主空间 ${space.id}` : space.id).toLowerCase().includes(spaceQuery.toLowerCase().trim())).map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={space.id === MAIN_SPACE ? '主空间' : space.id} accessibilityState={{ selected: space.id === spaces.currentSpace }}
            onPress={() => select(space.id)} style={[styles.threadRow, space.id === spaces.currentSpace && styles.threadSelected]}>
            <MessageCircle size={l.navigationIconSize} color={colors.ink} /><View style={styles.threadText}>
              <Text numberOfLines={1} style={styles.itemTitle}>{space.id === MAIN_SPACE ? '主空间' : space.id}</Text><SpaceStatusCaption spaceId={space.id} />
            </View>{space.id === spaces.currentSpace && <Check size={sizing[18]} color={colors.muted} />}
          </Pressable>)}
        </ScrollView>
        <View style={styles.drawerFooter}><View style={styles.drawerSearch}><Search size={sizing[18]} color={colors.faint} /><TextInput accessibilityLabel="搜索空间" placeholder="搜索空间" placeholderTextColor={colors.faint} value={spaceQuery} onChangeText={setSpaceQuery} style={styles.searchInput} /></View><RoundButton icon={SquarePen} label="新建空间" testID="workspace-create-space" onPress={() => { spaces.createSpace(); setSpaceQuery(''); setDrawerOpen(false); setSessionOpen(false); setPage('chat'); setNotice(undefined); }} /></View>
        </SafeAreaView>
      </View>
      <Animated.View style={[styles.foreground, drawerOpen && styles.foregroundRounded, { transform: [{ translateX: drawerProgress.interpolate({ inputRange: [0, 1], outputRange: [0, drawerWidth] }) }] }]} accessibilityElementsHidden={drawerOpen} importantForAccessibility={drawerOpen ? 'no-hide-descendants' : 'auto'}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']} aria-hidden={drawerOpen} {...(Platform.OS === 'web' && drawerOpen ? { inert: true } : {})}>
          <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
            {page !== 'chat' && <View style={styles.pageHeader}><RoundButton icon={Menu} label="打开空间侧栏" onPress={openDrawer} /><Text style={styles.pageTitle}>{NAV.find((item) => item.id === page)?.label}</Text><ThemeToggle /></View>}
            {/* 会话信息区独立占位，长历史滚动与键盘收缩时都不能遮住正文。 */}
            {page === 'chat' && <View style={[styles.chatHeader, keyboardVisible && styles.chatHeaderCompact]}>
              <View style={styles.headerLeft}><RoundButton icon={Menu} label="打开空间侧栏" testID="workspace-open-drawer" onPress={openDrawer} /></View>
              <Pressable accessibilityRole="button" accessibilityLabel="打开当前会话面板" accessibilityHint="全屏显示当前会话的动态、审批、工作区和历史" testID="workspace-open-session" style={[styles.identity, keyboardVisible && styles.identityCompact]}
                onPress={() => { Keyboard.dismiss(); setDrawerOpen(false); setSessionOpen(true); }}>
                <MuseAvatar size={keyboardVisible ? l.compactHeaderAvatar : l.headerAvatar} />
                <View style={[styles.identityLabel, keyboardVisible && styles.identityLabelCompact]}><Text numberOfLines={1} style={styles.identityName}>{name}</Text><StatusPill label={statusLabel} tone={!runtime.synchronized ? 'warning' : runtime.running ? 'accent' : 'neutral'} /></View>
              </Pressable>
              <View style={styles.headerRight}><ThemeToggle testID="workspace-theme-toggle" /></View>
            </View>}
            <ConversationView key={`${spaces.currentSpace}:${session.epoch}`} spaceId={spaces.currentSpace} visible={page === 'chat'} otherPage={otherPage} refreshKey={historyRefresh} onSettled={refresh} openConnection={openConnection} />
            {!!notice && <Text accessibilityRole="alert" style={[styles.notice, notice.tone === 'error' && styles.error]}>{notice.text}</Text>}
            {!(page === 'chat' && keyboardVisible) && <Navigation page={page} onPage={(next) => { setPage(next); setSessionOpen(false); }} />}
          </KeyboardAvoidingView>
        </SafeAreaView>
        {drawerOpen && <Pressable accessibilityRole="button" accessibilityLabel="收起空间侧栏" onPress={() => setDrawerOpen(false)} style={styles.foregroundCover} />}
      </Animated.View>
    </View>
    {sessionOpen && <SessionPanel spaceId={spaces.currentSpace} spaceName={name} status={statusLabel} statusTone={!runtime.synchronized ? 'warning' : runtime.running ? 'accent' : 'neutral'} tab={sessionTab} onTab={(next) => { if (session.resetting || session.deleting) return; setSessionTab(next); setDeleteConfirm(false); setResetConfirm(false); }}
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
        <Pressable accessibilityRole="button" accessibilityLabel="取消重置会话" disabled={session.resetting} style={styles.secondaryButton} onPress={() => setResetConfirm(false)}><Text style={styles.mutedText}>取消</Text></Pressable>
        {notice?.tone === 'error' && <Text accessibilityRole="alert" style={styles.error}>{notice.text}</Text>}
      </View> : deleteConfirm ? <View style={styles.exampleCard}><Text style={styles.itemTitle}>确认删除当前空间？</Text><Text style={styles.mutedText}>空间的全部聊天历史、工作区文件、规则、技能和绑定的定时任务、监控将被彻底删除，无法撤销。</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="确认删除空间" disabled={session.deleting} style={styles.actionButton} onPress={() => void remove()}><Text style={styles.actionText}>确认删除</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="取消删除空间" disabled={session.deleting} style={styles.secondaryButton} onPress={() => setDeleteConfirm(false)}><Text style={styles.mutedText}>取消</Text></Pressable>
        {notice?.tone === 'error' && <Text accessibilityRole="alert" style={styles.error}>{notice.text}</Text>}
      </View> : <SpaceSettings spaceId={spaces.currentSpace} onSaved={refresh} />}</>} />}
  </View></FilesProvider>;
}
function SpaceStatusCaption({ spaceId }: { spaceId: string }) {
  const runtime = useSpaceRuntime(spaceId); const styles = useStyles();
  return <Text numberOfLines={1} style={styles.caption}>{runtime.label}</Text>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas }, viewport: { flex: 1, alignSelf: 'center', overflow: 'hidden', backgroundColor: c.canvas }, screen: { flex: 1 },
  foreground: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.canvas, overflow: 'hidden' }, foregroundRounded: { borderRadius: r.drawerForeground }, foregroundCover: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.overlay },
  chatHeader: { height: l.headerHeight, flexShrink: 0, marginTop: l.headerTop, marginHorizontal: l.sidePadding }, chatHeaderCompact: { height: l.controlSize }, headerLeft: { position: 'absolute', top: 0, left: 0 }, headerRight: { position: 'absolute', top: 0, right: 0 },
  pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  identity: { alignSelf: 'center', alignItems: 'center', maxWidth: l.identityMaxWidth },
  identityCompact: { height: l.controlSize, flexDirection: 'row', gap: spacing[8] },
  identityLabel: { paddingHorizontal: spacing[8], paddingTop: spacing[6], gap: spacing[3], alignItems: 'center', maxWidth: '100%' }, identityLabelCompact: { flexShrink: 1, minWidth: 0, paddingHorizontal: 0, paddingTop: 0, alignItems: 'flex-start' }, identityName: { ...t.name, color: c.ink, maxWidth: '100%', textAlign: 'center' },
  navigation: { flexDirection: 'row', height: l.navigationHeight, marginHorizontal: spacing[18], marginBottom: l.navigationBottom, alignItems: 'center' },
  navigationItem: { flex: 1, minHeight: l.controlSize, gap: l.navigationLabelGap, alignItems: 'center', justifyContent: 'center' }, navigationLabel: { ...t.navigation, color: c.faint }, navigationLabelSelected: { color: c.ink },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: l.sidePadding, paddingTop: l.drawerTop, backgroundColor: c.canvas }, drawerHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: l.drawerTop, marginBottom: l.drawerTitleBottom }, drawerTitle: { ...t.drawerTitle, color: c.ink }, drawerSection: { ...t.caption, color: c.faint }, drawerSectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], marginBottom: spacing[14] }, drawerList: { gap: spacing[6] },
  threadRow: { minHeight: l.drawerRowHeight, flexDirection: 'row', alignItems: 'center', gap: spacing[14], paddingHorizontal: spacing[14], paddingVertical: spacing[12], borderRadius: r.listItem }, threadSelected: { backgroundColor: c.surface }, threadText: { flex: 1, gap: spacing[4], minWidth: 0 }, drawerFooter: { height: l.drawerFooterHeight, flexDirection: 'row', alignItems: 'center', gap: spacing[12], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  drawerSearch: { flex: 1, minWidth: 0, height: l.controlSize, borderRadius: r.round, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[14], gap: spacing[8] }, searchInput: { ...t.status, color: c.ink, flex: 1, minWidth: 0, height: l.smallControl },
  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: l.sidePadding, paddingTop: spacing[12], paddingBottom: spacing[8] },
  otherPage: { paddingTop: l.pageTop, paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: spacing[18] }, pageTitle: { ...t.heroName, color: c.ink }, itemTitle: { ...t.itemTitle, color: c.ink }, mutedText: { ...t.detail, color: c.muted }, caption: { ...t.caption, color: c.faint }, error: { ...t.caption, color: c.danger },
  exampleCard: { padding: spacing[20], borderRadius: r.card, backgroundColor: c.surface, gap: spacing[16], marginBottom: spacing[16] }, settingsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[14], paddingVertical: spacing[16], paddingHorizontal: spacing[16] },
  settingsGroup: { borderRadius: r.card, backgroundColor: c.surface, overflow: 'hidden' }, settingsDisabled: { opacity: workspaceTheme.interaction.disabledOpacity }, rowIcon: { width: l.rowIcon, height: l.rowIcon, borderRadius: r.round, backgroundColor: c.control, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { ...t.caption, color: c.faint, marginTop: spacing[12], marginLeft: spacing[6] }, appIntro: { flexDirection: 'row', alignItems: 'center', gap: spacing[18], paddingVertical: spacing[12] },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[8], marginHorizontal: spacing[6], marginTop: spacing[16] }, eyebrow: { ...t.eyebrow, color: c.faint },
  emptyTitle: { ...t.heroName, color: c.ink, textAlign: 'center' }, notice: { position: 'absolute', left: l.sidePadding, right: l.sidePadding, top: l.headerHeight, ...t.caption, color: c.ink, backgroundColor: c.control, padding: spacing[12], borderRadius: r.listItem },
  disconnected: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: l.maxWidth }, disconnectedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: l.sidePadding }, welcome: { flex: 1, paddingHorizontal: l.sidePadding, gap: spacing[18], alignItems: 'center', justifyContent: 'center' },
  actionButton: { minHeight: l.smallControl, backgroundColor: c.blue, paddingHorizontal: spacing[18], paddingVertical: spacing[12], borderRadius: r.round, alignSelf: 'center' }, actionText: { ...t.status, color: c.onAccent },
  secondaryButton: { alignSelf: 'center', minHeight: l.smallControl, flexDirection: 'row', alignItems: 'center', gap: spacing[8], paddingHorizontal: spacing[20], backgroundColor: c.control, borderRadius: r.round }, actionLabel: { ...t.status, color: c.ink },
});
