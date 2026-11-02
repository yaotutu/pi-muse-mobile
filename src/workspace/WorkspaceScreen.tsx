import { useNewsDiscussion } from '../features/useNewsDiscussion';
import { SmsProvider } from '../information/SmsProvider';
import { FeaturePage, type FeatureSection } from '../features/FeaturePage';
import { Card } from '../ui/Surfaces';
import { BookOpen, Check, ChevronRight, Download, FolderOpen, ArrowLeft, Menu, MessageCircle, Moon, Newspaper, RotateCcw, Search, Server, Settings, SlidersHorizontal, SquarePen, UserRound, X, Globe, type LucideIcon } from 'lucide-react-native';
import { BlurTargetView } from 'expo-blur';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { Alert, Animated, AppState, BackHandler, Easing, Keyboard, KeyboardAvoidingView, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewInstance, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiProvider, useApi } from '../api/ApiProvider';
import { ConnectionProvider, useServiceConnection } from '../connection/ConnectionProvider';
import { useConnection } from '../connection/useConnection';
import type { ConnectionManager } from '../connection/connection-manager';
import type { ConnectionSnapshot } from '../connection/types';
import { RuntimeProvider, useRuntimeStore, useSpaceRuntime } from '../runtime/RuntimeProvider';
import { useActivityStore } from '../activities/ActivityProvider';
import { useApprovals } from '../approvals/ApprovalProvider';
import { SpaceProvider, useSpaceState, useSpaceStore } from '../spaces/SpaceProvider';
import { equalSwitches } from '../spaces/space-store';
import { MAIN_SPACE } from '../spaces/space-state';
import { useSpaces } from '../spaces/useSpaces';
import { useAppUpdate } from '../update/UpdateProvider';
import { spacing, sizing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { ConnectionPanel } from './ConnectionPanel';
import { NewsPage } from './NewsPage';
import { createNewsStore } from '../news/news-store';
import { useNews } from '../news/useNews';
import { useJobs } from '../jobs/JobProvider';
import { useMonitors } from '../monitors/MonitorProvider';
import { GoalsPanel } from './GoalsPanel';
import { useGoals } from '../goals/GoalProvider';
import { FilesProvider, useFiles } from '../files/FilesProvider';
import { MemoryPanel } from './MemoryPanel';
import { ProfilePanel } from './ProfilePanel';
import { ProfileProvider } from '../profile/ProfileProvider';
import { DreamProvider } from '../dream/DreamProvider';
import { DreamPanel } from './DreamPanel';
import { ConversationHost } from './ConversationHost';
import { SpaceLabels, headerSpaceNames, spaceTime } from './space-labels';
import { workspaceBackAction } from './workspace-back';
import { SessionPanel, type SessionTab } from './SessionPanel';
import { ResetSessionDialog } from './ResetSessionDialog';
import { AvatarBloomTransition } from './AvatarBloomTransition';
import { SpacePage } from './SpacePage';
import { filesBackAction, hasFileWork, type SpaceSection } from './space-navigation';
import { useTheme } from '../theme/ThemeProvider';
import { ThemePicker } from '../theme/ThemePicker';
import { IconControl, MuseAvatar, StatusPill, useReducedMotion } from './primitives';
import { FrostedSurface } from '../ui/FrostedSurface';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { BrowserPanel } from '../browser/BrowserPanel';
import { createBrowserStore } from '../browser/browser-store';

type WorkspacePage = 'chat' | 'news' | 'goals' | 'settings' | 'space';
type SettingsSubpage = 'memory' | 'profile' | 'dream' | FeatureSection | null;
type WorkspaceNotice = { text: string; tone: 'success' | 'error' };
const { layout: l, radius: r, typography: t } = workspaceTheme;
const NAV: { id: WorkspacePage; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: '聊天', icon: MessageCircle },
  { id: 'news', label: '新闻', icon: Newspaper },
  { id: 'space', label: '空间', icon: FolderOpen },
];
function useStyles() { const { colors } = useTheme(); return useMemo(() => createStyles(colors), [colors]); }

/** 新版是唯一入口；连接配置和低频会话维护由设置页承载，不改变会话信息区职责。 */
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
/** 设置页入口共用命中区和禁用态；只显示调用方提供的真实状态，不参与业务判断。 */
function SettingRow({ title, label, description, address, icon: Icon, onPress, disabled = false, testID }: {
  title: string; label: string; description: string; address?: string; icon: LucideIcon; onPress: () => void; disabled?: boolean; testID?: string;
}) {
  const styles = useStyles(); const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.appSettingsRow, disabled && styles.settingsDisabled, pressed && styles.pressed]}>
    <View style={styles.appRowIcon}><Icon size={l.appSettingsIcon} strokeWidth={spacing[2]} color={colors.ink} /></View>
    <View style={styles.appRowText}><Text style={styles.itemTitle}>{title}</Text><Text style={styles.caption}>{description}</Text>
      {!!address && <Text numberOfLines={1} ellipsizeMode="middle" style={styles.appAddress}>{address}</Text>}
    </View>
    <ChevronRight size={sizing[18]} color={colors.faint} />
  </Pressable>;
}
function AnimatedSubpage({ children }: { children: ReactNode }) {
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: anim,
        transform: [
          {
            translateX: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [28, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function SettingsPage({ snapshot, openConnection, openBrowser, memoryAvailable = false, profileAvailable = false, dreamAvailable = false, currentSpaceId, subpage, onSubpage }: Pick<WorkspaceConnectionProps, 'snapshot' | 'openConnection'> & { openBrowser?: () => void; memoryAvailable?: boolean; profileAvailable?: boolean; dreamAvailable?: boolean; currentSpaceId?: string; subpage: SettingsSubpage; onSubpage: (page: SettingsSubpage) => void }) {
  const styles = useStyles(); const update = useAppUpdate();
  if (subpage === 'memory' && memoryAvailable) return <AnimatedSubpage key="memory"><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.otherPage}><MemoryPanel onBack={() => onSubpage(null)} /></ScrollView></AnimatedSubpage>;
  if (subpage === 'profile' && profileAvailable) return <AnimatedSubpage key="profile"><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.otherPage}><ProfilePanel onBack={() => onSubpage(null)} /></ScrollView></AnimatedSubpage>;
  if (subpage === 'dream' && dreamAvailable && currentSpaceId) return <AnimatedSubpage key="dream"><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.otherPage}><DreamPanel currentSpaceId={currentSpaceId} onBack={() => onSubpage(null)} /></ScrollView></AnimatedSubpage>;
  return <ScrollView key="settings" contentContainerStyle={[styles.otherPage, styles.settingsPage]}>
    <View style={styles.appSection}><Text accessibilityRole="header" style={styles.appSectionTitle}>连接与设备</Text>
      <View style={styles.appSettingsGroup}>
        <SettingRow title="服务器连接" label="服务器连接" description={connectionLabel(snapshot)} address={snapshot.serverUrl ?? undefined} icon={Server} onPress={openConnection} />
        {openBrowser && <SettingRow title="浏览器" label="打开浏览器" description="使用服务端同一 Chrome" icon={Globe} onPress={openBrowser} testID="viewer-open" />}
        {update && <SettingRow title="应用更新" label="应用更新" description={update.snapshot.status === 'unsupported' ? '当前环境不支持自动安装' : '检查版本、下载与安装进度'} icon={Download} onPress={update.open} />}
      </View>
    </View>
    <View style={styles.appSection}><Text accessibilityRole="header" style={styles.appSectionTitle}>助手与个人资料</Text>
      <View style={styles.appSettingsGroup}><SettingRow title="助手与用户资料" label="打开助手与用户资料" description={profileAvailable ? '名字、语气、人设与用户资料' : '连接真实服务后可用'} icon={UserRound} onPress={() => onSubpage('profile')} disabled={!profileAvailable} /></View>
    </View>
    <View style={styles.appSection}><Text accessibilityRole="header" style={styles.appSectionTitle}>助手记忆</Text>
      <View style={styles.appSettingsGroup}>
        <SettingRow title="长期记忆" label="打开长期记忆" description={memoryAvailable ? '查询、搜索与管理全局记忆' : '连接真实服务后管理全局记忆'} icon={BookOpen} onPress={() => onSubpage('memory')} disabled={!memoryAvailable} />
        <SettingRow title="Dream 记忆整理" label="打开Dream记忆整理" description={dreamAvailable ? '整理状态、提示词与待决建议' : '连接真实服务后可用'} icon={Moon} onPress={() => onSubpage('dream')} disabled={!dreamAvailable} />
      </View>
    </View>
    <ThemePicker />
  </ScrollView>;
}
function DisconnectedWorkspace({ snapshot, openConnection }: WorkspaceConnectionProps) {
  const [page, setPage] = useState<WorkspacePage>('chat');
  const [settingsSubpage, setSettingsSubpage] = useState<SettingsSubpage>(null);
  const styles = useStyles();
  const inSettingsSubpage = page === 'settings' && settingsSubpage !== null;
  return <View style={styles.root} testID="workspace-screen"><ThemeStatusBar />
    <SafeAreaView style={styles.disconnected}>
      {!inSettingsSubpage && <View style={styles.disconnectedHeader}><Text style={styles.itemTitle}>Pi Muse</Text><IconControl icon={Settings} label="全局设置" onPress={() => setPage(page === 'settings' ? 'chat' : 'settings')} /></View>}
      {page === 'settings' ? <SettingsPage snapshot={snapshot} openConnection={openConnection} subpage={settingsSubpage} onSubpage={setSettingsSubpage} /> : <View style={styles.welcome}>
        <MuseAvatar size={l.welcomeAvatar} /><Text style={styles.eyebrow}>HELLO, PI MUSE</Text><Text style={styles.emptyTitle}>{connectionLabel(snapshot)}</Text>
        <Text style={styles.mutedText}>{snapshot.error ?? '连接自己的 Pi Muse 服务器后即可恢复会话、聊天与真实执行状态。'}</Text>
        <ActionButton label="配置服务器连接" text="服务器连接" tone="primary" onPress={openConnection} />
        <Text style={styles.caption}>从一次连接开始。应用更新可独立使用。</Text>
      </View>}
      <Navigation page={page} onPage={(next) => { setPage(next); setSettingsSubpage(null); }} />
    </SafeAreaView>
  </View>;
}
function Navigation({ page, onPage }: { page: WorkspacePage; onPage: (page: WorkspacePage) => void }) {
  const styles = useStyles(); const { colors } = useTheme();
  return <View accessibilityRole="tablist" accessibilityLabel="主要页面" style={styles.navigation}>
    {NAV.map(({ id, label, icon: Icon }) => <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: page === id }} aria-selected={page === id} testID={`workspace-tab-${id}`} onPress={() => onPage(id)} style={({ pressed }) => [styles.navigationItem, pressed && styles.pressed]}>
      <Icon size={l.navigationIconSize} strokeWidth={1.8} color={page === id ? colors.ink : colors.faint} fill={id === 'chat' && page === id ? colors.ink : 'none'} />
      <Text style={[styles.navigationLabel, page === id && styles.navigationLabelSelected]}>{label}</Text>
    </Pressable>)}
  </View>;
}

function LiveWorkspace(props: WorkspaceConnectionProps) {
  const connection = useServiceConnection();
  const spaces = useSpaces(!!connection?.enabled, props.snapshot.refreshVersion);
  return <SmsProvider><FilesProvider currentSpaceId={spaces.currentSpace}><WorkspaceContent {...props} spaces={spaces} /></FilesProvider></SmsProvider>;
}

function WorkspaceContent({ snapshot, openConnection, spaces }: WorkspaceConnectionProps & { spaces: ReturnType<typeof useSpaces> }) {
  const api = useApi();
  // 连接键改变会卸载整层；新闻 Store 在此持续挂载，切空间与重置会话不会丢草稿。
  const [news] = useState(() => createNewsStore(api));
  // Store 随 ApiProvider 的连接键创建和销毁，票据不会跨服务地址复用。
  const [browser] = useState(() => createBrowserStore(api, snapshot.serverUrl ?? ''));
  const [browserOpen, setBrowserOpen] = useState(false);
  const connection = useServiceConnection();
  const { store: files } = useFiles();
  const [spaceSection, setSpaceSection] = useState<SpaceSection>('home');
  const session = useSpaceState(spaces.currentSpace);
  const sessions = useSpaceStore(); const runtimeStore = useRuntimeStore();
  const activities = useActivityStore();
  const { store: jobs } = useJobs();
  const { store: monitors } = useMonitors();
  const { store: approvals } = useApprovals();
  const { store: goals } = useGoals();
  const runtime = useSpaceRuntime(spaces.currentSpace);
  const [page, setPage] = useState<WorkspacePage>('chat');
  const [newsManaging, setNewsManaging] = useState(false);
  const [settingsSubpage, setSettingsSubpage] = useState<SettingsSubpage>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionMounted, setSessionMounted] = useState(false);
  const chatBlurTarget = useRef<ViewInstance | null>(null);
  const pendingSessionOpen = useRef(false);
  const [sessionTab, setSessionTab] = useState<SessionTab>('activity');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [resetTarget, setResetTarget] = useState<string>();
  const [resetError, setResetError] = useState<string>();
  const [notice, setNotice] = useState<WorkspaceNotice>();
  const reducedMotion = useReducedMotion();
  const [spaceQuery, setSpaceQuery] = useState('');
  const [historyRefresh, setHistoryRefresh] = useState<Record<string, number>>({});
  const [labelState, setLabelState] = useState(() => ({ ids: '', labels: new SpaceLabels() }));
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const { colors } = useTheme(); const styles = useStyles();
  const { width, height } = useWindowDimensions(); const contentWidth = Math.min(width, l.maxWidth);
  const avatarCenterY = l.headerTop + l.headerAvatar / 2;
  const bloomRadius = 50;
  const targetScale = Math.max(25, Math.ceil((Math.hypot(contentWidth / 2, height - avatarCenterY) / bloomRadius) * 1.08));
  const drawerWidth = Math.min(contentWidth * l.drawerRatio, l.drawerMaxWidth);
  const [drawerProgress] = useState(() => new Animated.Value(0));
  const { snapshot: newsSnapshot } = useNews(news);
  const isNewsArticleOpen = !!newsSnapshot.selectedArticleId;
  const inSettingsSubpage = page === 'settings' && settingsSubpage !== null;
  const inNewsSubpage = page === 'news' && (newsManaging || isNewsArticleOpen);
  const isSubpage = inSettingsSubpage || inNewsSubpage;
  const statusLabel = snapshot.status === 'authentication-required' || snapshot.status === 'reset-error' || snapshot.status === 'storage-error'
    ? connectionLabel(snapshot) : runtime.label;
  const labelIds = spaces.spaces.map((space) => space.id).sort().join('|');
  if (labelState.ids !== labelIds) setLabelState({ ids: labelIds, labels: labelState.labels.sync(spaces.spaces) });
  const labels = labelState.ids === labelIds ? labelState.labels : labelState.labels.sync(spaces.spaces);
  const headerNames = headerSpaceNames(labels, spaces.currentSpace, keyboardVisible);
  const reloadSpaces = spaces.reload;
  const refresh = useCallback((spaceId = spaces.currentSpace) => { void reloadSpaces(); activities.invalidate(); jobs.invalidate(); monitors.invalidate(); goals.invalidate(); setHistoryRefresh((value) => ({ ...value, [spaceId]: (value[spaceId] ?? 0) + 1 })); }, [reloadSpaces, activities, jobs, monitors, goals, spaces.currentSpace]);
  useEffect(() => {
    news.setActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => news.setActive(state === 'active'));
    return () => { subscription.remove(); news.dispose(); };
  }, [news]);
  useEffect(() => () => browser.dispose(), [browser]);
  const openBrowser = useCallback(() => {
    Keyboard.dismiss();
    setBrowserOpen(true);
    browser.open();
  }, [browser]);
  const closeBrowser = useCallback(() => {
    browser.close();
    setBrowserOpen(false);
  }, [browser]);
  useEffect(() => {
    if (page === 'news') news.open();
    else news.close();
  }, [news, page]);
  useEffect(() => {
    // ready 不重放通知历史；空间绑定与当前聊天都要回到服务端权威事实。
    if (runtime.synchronized) void reloadSpaces();
  }, [runtime.synchronized, reloadSpaces]);
  useEffect(() => {
    // 原生键盘出现时让出阅读空间；系统 Back 收起键盘也必须恢复完整顶栏与主导航。
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      if (pendingSessionOpen.current) { pendingSessionOpen.current = false; setSessionMounted(true); setSessionOpen(true); }
    });
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (notice?.tone !== 'success') return;
    const timer = setTimeout(() => setNotice(undefined), workspaceTheme.motion.feedbackDuration);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (drawerOpen) { pendingSessionOpen.current = false; Keyboard.dismiss(); }
    const animation = Animated.timing(drawerProgress, { toValue: drawerOpen ? 1 : 0, duration: reducedMotion ? 0 : workspaceTheme.motion.drawerDuration, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [drawerOpen, drawerProgress, reducedMotion]);
  const onSessionCloseFinished = useCallback((finished = true) => {
    if (finished && !sessionOpen) setSessionMounted(false);
  }, [sessionOpen]);
  const closeSession = useCallback(() => {
    if (session.deleting || session.resetting) return;
    pendingSessionOpen.current = false;
    setSessionOpen(false);
  }, [session.deleting, session.resetting]);
  const leaveSpaceChild = useCallback(() => {
    if (sessions.hasSettingsWrite(spaces.currentSpace)) return;
    if ((spaceSection === 'rules' && session.instructions.draft !== session.instructions.saved) || (spaceSection === 'skills' && !equalSwitches(session.skills.draft, session.skills.saved))) {
      Alert.alert('有未保存的空间设置', '草稿只保留在本次连接中。', [
        { text: '继续编辑', style: 'cancel' },
        { text: '保留草稿并返回', onPress: () => setSpaceSection('home') },
        { text: '丢弃并返回', style: 'destructive', onPress: () => { sessions.discardSettings(spaces.currentSpace, spaceSection === 'rules' ? 'instructions' : 'skills'); setSpaceSection('home'); } },
      ]);
    } else setSpaceSection('home');
  }, [sessions, spaces.currentSpace, spaceSection, session.instructions.draft, session.instructions.saved, session.skills.draft, session.skills.saved]);
  const backSpace = useCallback(() => {
    if (spaceSection === 'home') { setPage('chat'); return; }
    if (spaceSection !== 'files') { leaveSpaceChild(); return; }
    const action = filesBackAction(files.getSnapshot());
    if (action === 'locked') {
      Alert.alert('文件操作尚未收口', '写入期间请等待；结果未明时请先回读核对，不会自动重发。');
    } else if (action === 'preview') files.cancelSavePreview();
    else if (action === 'delete') files.cancelDelete();
    else if (action === 'draft') Alert.alert('保留文件草稿？', '草稿属于当前空间，只保留在本次连接中。', [
      { text: '继续编辑', style: 'cancel' },
      { text: '保留草稿并返回', onPress: () => setSpaceSection('home') },
      { text: '丢弃草稿', style: 'destructive', onPress: () => files.cancelEditor() },
    ]);
    else if (action === 'detail') files.closeFile();
    else if (action === 'directory') files.goUp();
    else setSpaceSection('home');
  }, [files, leaveSpaceChild, spaceSection]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const action = workspaceBackAction({ keyboardVisible, browserOpen, sessionMounted, drawerOpen, page, newsArticleOpen: !!news.getSnapshot().selectedArticleId,
        newsManaging, settingsSubpage, goalCreating: !!goals.getSnapshot().creator });
      if (action === 'keyboard') { pendingSessionOpen.current = false; Keyboard.dismiss(); }
      else if (action === 'browser') closeBrowser();
      else if (action === 'session') closeSession();
      else if (action === 'drawer') setDrawerOpen(false);
      else if (action === 'news-article') news.closeArticle();
      else if (action === 'news-sources') setNewsManaging(false);
      else if (action === 'chat') setPage('chat');
      else if (action === 'settings') { if (settingsSubpage === 'sms' || settingsSubpage === 'news-feature') setSettingsSubpage('features'); else if (settingsSubpage === 'features') { setSettingsSubpage(null); setPage('chat'); } else setSettingsSubpage(null); }
      else if (action === 'space') backSpace();
      else if (action === 'goal' && !goals.getSnapshot().writing) goals.cancelCreate();
      return action !== 'none';
    });
    return () => subscription.remove();
  }, [drawerOpen, keyboardVisible, browserOpen, closeBrowser, sessionMounted, closeSession, page, news, newsManaging, settingsSubpage, goals, backSpace]);
  const openSession = useCallback((tab?: unknown) => {
    if (typeof tab === 'string') setSessionTab(tab as SessionTab);
    setDrawerOpen(false);
    if (keyboardVisible) { pendingSessionOpen.current = true; Keyboard.dismiss(); return; }
    setSessionMounted(true); setSessionOpen(true);
  }, [keyboardVisible]);
  const openDrawer = useCallback(() => { Keyboard.dismiss(); setDrawerOpen(true); void reloadSpaces(); }, [reloadSpaces]);
  const changeSpace = (action: () => void) => {
    const state = files.getSnapshot();
    if (!hasFileWork(state)) { action(); return; }
    const busy = state.writing !== false || state.uncertain;
    Alert.alert('请先处理当前空间文件', busy ? '文件操作进行中或结果未明，请进入文件页核对后再切换。' : '切换空间前请保存或丢弃文件草稿，避免混淆文件归属。', [
      { text: '取消', style: 'cancel' },
      { text: '返回文件', onPress: () => { setPage('space'); setSpaceSection('files'); setDrawerOpen(false); } },
      ...(!busy ? [{ text: '丢弃并继续', style: 'destructive' as const, onPress: () => { files.cancelSavePreview(); files.cancelDelete(); files.cancelEditor(); action(); } }] : []),
    ]);
  };
  const select = (id: string) => changeSpace(() => { spaces.selectSpace(id); setSessionOpen(false); setDrawerOpen(false); setPage('chat'); setSpaceSection('home'); setDeleteConfirm(false); setNotice(undefined); });
  const discussion = useNewsDiscussion((spaceId) => { refresh(spaceId); select(spaceId); });
  const remove = async () => {
    const id = spaces.currentSpace;
    try {
      const result = await sessions.deleteSpace(id);
      if (!result) return;
      runtimeStore.forgetSpace(id); activities.forgetSpace(id); jobs.invalidate(); monitors.invalidate(); spaces.removeSpace(id); setSessionOpen(false); setDeleteConfirm(false); setNotice(undefined); await spaces.reload();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), tone: 'error' }); }
  };
  const reset = async (id: string, clearSchedules: boolean) => {
    if (!connection?.enabled) { setResetError('服务器连接不可用，请重新连接后再操作。'); return; }
    try {
      const result = await sessions.resetSpace(id, clearSchedules);
      if (!result) { setResetError('当前无法重置此会话，请核对连接与空间状态。'); return; }
      // 重置不删除空间或活动历史；通知重连获取权威审批集合，不凭 cancelledApprovals 猜具体审批 ID。
      runtimeStore.forgetSpace(id);
      activities.invalidate(id);
      await approvals.refreshPending();
      setResetTarget(undefined); setResetError(undefined); setSessionOpen(false); setPage('chat');
      setNotice({ text: '会话已重置，可开启全新对话。空间规则、技能与工作区文件已保留。', tone: 'success' });
      refresh();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : String(error));
      // 列表回读仅核对新 sessionId，不重发 reset；未确认期间禁止继续发送旧上下文。
      void spaces.reload();
    }
  };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (event, gesture) => !browserOpen && !sessionMounted && Math.abs(gesture.dx) > l.gestureThreshold && Math.abs(gesture.dx) > Math.abs(gesture.dy) * l.gestureAxisRatio && (drawerOpen ? gesture.dx < 0 : event.nativeEvent.pageX - gesture.dx < l.edgeGestureWidth && gesture.dx > 0),
    onPanResponderRelease: (_event, gesture) => { if (sessionMounted) return; if (gesture.dx < -l.gestureThreshold) setDrawerOpen(false); if (gesture.dx > l.gestureThreshold) openDrawer(); },
  }), [browserOpen, drawerOpen, openDrawer, sessionMounted]);
  const maintenance = <>
    <Card style={styles.exampleCard}><Text style={styles.itemTitle}>重置当前会话</Text><Text style={styles.mutedText}>开启全新对话，保留这个空间的文件、规则与技能。</Text>
      <ActionButton label="重置当前会话" text="重置会话" icon={RotateCcw} disabled={!connection?.enabled || hasFileWork(files.getSnapshot())} onPress={() => { setResetError(undefined); setResetTarget(spaces.currentSpace); }} />
    </Card>
    {spaces.currentSpace !== MAIN_SPACE && <Card style={styles.exampleCard} tone="danger">
      <Text style={styles.itemTitle}>{deleteConfirm ? '确认删除当前空间？' : '删除当前空间'}</Text>
      <Text style={styles.mutedText}>空间的聊天历史、消息反馈、工作区文件、规则、技能及绑定任务将被彻底删除，无法撤销。</Text>
      <View style={styles.confirmActions}>
        <ActionButton label={deleteConfirm ? '确认删除空间' : '删除当前空间'} text={deleteConfirm ? '确认删除' : '删除空间'} tone="danger" busy={session.deleting} disabled={hasFileWork(files.getSnapshot())} onPress={() => deleteConfirm ? void remove() : setDeleteConfirm(true)} />
        {deleteConfirm && <ActionButton label="取消删除空间" text="取消" disabled={session.deleting} onPress={() => setDeleteConfirm(false)} />}
      </View>
    </Card>}
  </>;
  const otherPage = page === 'settings' && (settingsSubpage === 'features' || settingsSubpage === 'sms' || settingsSubpage === 'news-feature') ? <FeaturePage section={settingsSubpage} onSection={setSettingsSubpage} onBack={() => { setSettingsSubpage(null); setPage('chat'); }} spaces={spaces.spaces.filter((space) => !!space.sessionId).map((space) => ({ id: space.id, title: labels.title(space.id) }))} onNewsSettings={() => { setPage('news'); setNewsManaging(true); news.closeArticle(); }} /> : page === 'chat' ? null : page === 'space' ? <SpacePage spaceId={spaces.currentSpace} name={labels.title(spaces.currentSpace)} section={spaceSection}
    onSection={(next) => { setDeleteConfirm(false); setSpaceSection(next); }} onBack={backSpace} openDrawer={openDrawer} onSaved={refresh} maintenance={maintenance} /> : page === 'settings' ? <SettingsPage snapshot={snapshot} openConnection={openConnection} memoryAvailable profileAvailable dreamAvailable currentSpaceId={spaces.currentSpace}
    openBrowser={openBrowser} subpage={settingsSubpage} onSubpage={setSettingsSubpage} /> : page === 'news' ? <NewsPage store={news} managing={newsManaging} onManaging={setNewsManaging} openDrawer={openDrawer} onDiscuss={(id) => changeSpace(() => void discussion.discuss(id))} discussing={discussion.busy} discussionError={discussion.error} uncertainDiscussion={!!discussion.uncertainTarget} onCheckDiscussion={() => { if (discussion.uncertainTarget) select(discussion.uncertainTarget); }} onConfirmDiscussion={() => Alert.alert('确认已核对承接会话？', '恢复后不会重发上一次讨论。请先确认会话里是否已经收到这条新闻。', [{ text: '取消', style: 'cancel' }, { text: '已核对', onPress: () => void discussion.confirmChecked() }])} /> : !sessionOpen && <GoalsPanel openDrawer={openDrawer} />;
  // 文件 Provider 与聊天所有者随连接持有；页面切换不销毁草稿或运行。
  return <View style={styles.root} testID="workspace-screen"><ThemeStatusBar />
    <View style={[styles.viewport, { width: contentWidth }]} {...pan.panHandlers}
      pointerEvents={browserOpen ? 'none' : 'auto'} accessibilityElementsHidden={browserOpen} importantForAccessibility={browserOpen ? 'no-hide-descendants' : 'auto'}>
      <View style={[styles.drawer, { width: drawerWidth }]} pointerEvents={drawerOpen ? 'auto' : 'none'} aria-hidden={!drawerOpen}
        {...(Platform.OS === 'web' && !drawerOpen ? { inert: true } : {})} accessibilityElementsHidden={!drawerOpen} importantForAccessibility={drawerOpen ? 'yes' : 'no-hide-descendants'}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left']}>
        <View style={styles.drawerHeading}><Text style={styles.drawerTitle}>Pi Muse</Text><IconControl icon={X} label="关闭空间侧栏" onPress={() => setDrawerOpen(false)} /></View>
        <View style={styles.drawerSectionRow}><Text style={styles.drawerSection}>你的空间</Text><Text style={styles.caption}>{spaces.spaces.length}</Text></View>
        {!!spaces.error && <Text style={styles.error}>{spaces.error}</Text>}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.drawerList}>
          {spaces.spaces.filter((space) => `${labels.title(space.id)} ${space.id}`.toLowerCase().includes(spaceQuery.toLowerCase().trim())).map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={labels.title(space.id)} accessibilityState={{ selected: space.id === spaces.currentSpace }}
            onPress={() => select(space.id)} style={[styles.threadRow, space.id === spaces.currentSpace && styles.threadSelected]}>
            <MessageCircle size={l.navigationIconSize} color={colors.ink} /><View style={styles.threadText}>
              <Text numberOfLines={1} style={styles.itemTitle}>{labels.title(space.id)}</Text><SpaceStatusCaption spaceId={space.id} updatedAt={space.updatedAt} />
            </View>{space.id === spaces.currentSpace && <Check size={sizing[18]} color={colors.muted} />}
          </Pressable>)}
        </ScrollView>
        <View style={styles.drawerFooter}><View style={styles.drawerSearch}><Search size={sizing[18]} color={colors.faint} /><FormInput variant="search" accessibilityLabel="搜索空间" placeholder="搜索空间" placeholderTextColor={colors.faint} value={spaceQuery} onChangeText={setSpaceQuery} style={styles.searchInput} /></View><IconControl icon={SquarePen} label="新建空间" testID="workspace-create-space" onPress={() => { changeSpace(() => { spaces.createSpace(); setSpaceQuery(''); setDrawerOpen(false); setSessionOpen(false); setPage('chat'); setSpaceSection('home'); setNotice(undefined); }); }} /></View>
        <SettingRow title="功能" label="打开功能管理" description="新闻、短信与交互承接空间" icon={Newspaper} onPress={() => { setDrawerOpen(false); setPage('settings'); setSettingsSubpage('features'); }} testID="workspace-features" />
        <SettingRow title="全局设置" label="打开全局设置" description="连接、资料、记忆与本机外观" icon={Settings} onPress={() => { setDrawerOpen(false); setPage('settings'); setSettingsSubpage(null); }} testID="workspace-global-settings" />
        </SafeAreaView>
      </View>
      <Animated.View style={[styles.foreground, drawerOpen && styles.foregroundRounded, { transform: [{ translateX: drawerProgress.interpolate({ inputRange: [0, 1], outputRange: [0, drawerWidth] }) }] }]} accessibilityElementsHidden={drawerOpen} importantForAccessibility={drawerOpen ? 'no-hide-descendants' : 'auto'}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']} aria-hidden={drawerOpen} {...(Platform.OS === 'web' && drawerOpen ? { inert: true } : {})}>
          {/* 唯一键盘避让层：Android 按真实重叠缩小阅读区，iOS 保留 padding；不再另算键盘高度。 */}
          <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'} accessibilityViewIsModal={sessionMounted}>
            {page !== 'chat' && page !== 'news' && page !== 'goals' && page !== 'space' && !isSubpage && <View style={styles.pageHeader}><IconControl icon={ArrowLeft} label="返回当前会话" onPress={() => setPage('chat')} /><Text style={styles.pageTitle}>全局设置</Text><View style={styles.headerSideButtonSpacer} /></View>}
            {/* 头像与左右操作浮在聊天层上方，不占正文高度；触控只落在实际控件。 */}
            {page === 'chat' && <View pointerEvents="box-none" style={[styles.chatHeader, keyboardVisible && styles.chatHeaderCompact]}>
              <View style={styles.headerLeft}><IconControl icon={Menu} label="打开空间侧栏" testID="workspace-open-drawer" onPress={openDrawer} /></View>
              <Pressable accessibilityRole="button" accessibilityLabel="打开当前会话面板" accessibilityHint={`当前空间：${labels.title(spaces.currentSpace)}；当前状态：${statusLabel}。全屏显示当前会话的动态、审批和执行历史`} accessibilityState={{ disabled: sessionMounted }} disabled={sessionMounted} testID="workspace-open-session" style={[styles.identity, keyboardVisible && styles.identityCompact]}
                onPress={openSession}>
                <MuseAvatar size={keyboardVisible ? l.compactHeaderAvatar : l.headerAvatar} />
                {headerNames.chat && <View style={[styles.identityLabel, styles.identityLabelSurface]}><Text numberOfLines={1} style={styles.identityName}>{headerNames.chat}</Text></View>}
              </Pressable>
              <View style={styles.headerRight}><IconControl icon={SlidersHorizontal} label="打开当前空间" testID="workspace-open-console" onPress={() => { setPage('space'); setSpaceSection('home'); }} /></View>
            </View>}
            <View style={styles.bodyStage}>
              <BlurTargetView ref={chatBlurTarget} style={styles.bodyStage}>
                {/* Expo 的原生 BlurTargetView 仅负责采样；普通 RN View 承担触控和读屏隔离。 */}
                <View style={styles.bodyStage} testID="workspace-chat-accessibility-layer"
                  pointerEvents={sessionMounted ? 'none' : 'auto'} aria-hidden={sessionMounted}
                  {...(Platform.OS === 'web' && sessionMounted ? { inert: true } : {})}
                  accessibilityElementsHidden={sessionMounted} importantForAccessibility={sessionMounted ? 'no-hide-descendants' : 'auto'}>
                  <ConversationHost currentSpaceId={spaces.currentSpace} spaceIds={spaces.spaces.map((space) => space.id)} chatVisible={page === 'chat'} compactHeader={keyboardVisible} otherPage={otherPage}
                    refreshVersions={historyRefresh} onSettled={refresh} onBindingMismatch={reloadSpaces} openConnection={openConnection} onOpenApprovals={() => openSession('approvals')} />
                  {!!notice && <Text accessibilityRole="alert" style={[styles.notice, notice.tone === 'error' && styles.error]}>{notice.text}</Text>}
                  {!browserOpen && !(page === 'chat' && keyboardVisible) && !(page === 'space' && spaceSection !== 'home') && page !== 'settings' && <Navigation page={page} onPage={(next) => {
                    setPage(next);
                    setSpaceSection('home');
                    setSettingsSubpage(null);
                    setNewsManaging(false);
                    if (news.getSnapshot().selectedArticleId) {
                      news.closeArticle();
                    }
                    setSessionOpen(false);
                  }} />}
                </View>
              </BlurTargetView>
            </View>
            {sessionMounted && (
              <AvatarBloomTransition
                open={sessionOpen}
                reducedMotion={reducedMotion}
                avatarCenterX={contentWidth / 2}
                avatarCenterY={avatarCenterY}
                bloomRadius={bloomRadius}
                targetScale={targetScale}
                canvasColor={colors.panelVeil}
                headerHeight={l.headerHeight}
                headerTop={l.headerTop}
                sidePadding={l.sidePadding}
                onCloseComplete={onSessionCloseFinished}
                onBackdropPress={closeSession}
                headerLeft={
                  <IconControl
                    icon={X}
                    label={sessionOpen ? '关闭会话面板' : '重新打开会话面板'}
                    testID="workspace-session-close"
                    onPress={sessionOpen ? closeSession : openSession}
                    disabled={session.deleting || session.resetting}
                  />
                }
                headerCenter={
                  <View style={styles.identity}>
                    <MuseAvatar size={l.headerAvatar} />
                    <View style={[styles.identityLabel, styles.sessionIdentityLabel]}>{headerNames.session && <Text numberOfLines={1} style={styles.identityName}>{headerNames.session}</Text>}<StatusPill label={statusLabel} testID="workspace-session-status" tone={!runtime.synchronized ? 'warning' : runtime.running ? 'accent' : 'neutral'} /></View>
                  </View>
                }
                headerRight={<View style={styles.headerSideButtonSpacer} />}
                renderSurface={(content) => (
                  <FrostedSurface blurTarget={chatBlurTarget}>
                    {content}
                  </FrostedSurface>
                )}
              >
                <SessionPanel spaceId={spaces.currentSpace}
                  tab={sessionTab}
                  onTab={(next) => {
                    if (session.resetting || session.deleting) return;
                    setSessionTab(next);
                  }}
                  deleting={session.deleting}
                  resetting={session.resetting}
                  onSettled={refresh}
                />
              </AvatarBloomTransition>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
        {drawerOpen && <Pressable accessibilityRole="button" accessibilityLabel="收起空间侧栏" onPress={() => setDrawerOpen(false)} style={styles.foregroundCover} />}
      </Animated.View>
    </View>
    {browserOpen && <BrowserPanel store={browser} baseUrl={snapshot.serverUrl ?? ''} onClose={closeBrowser} />}
    {resetTarget && <ResetSessionDialog key={resetTarget} spaceId={resetTarget} available={!!connection?.enabled} error={resetError}
      onCancel={() => { setResetTarget(undefined); setResetError(undefined); }} onConfirm={reset} />}
  </View>;
}
function SpaceStatusCaption({ spaceId, updatedAt }: { spaceId: string; updatedAt: string }) {
  const runtime = useSpaceRuntime(spaceId); const styles = useStyles();
  return <Text numberOfLines={1} style={styles.caption}>{spaceTime(updatedAt)} · {runtime.label}</Text>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas }, viewport: { flex: 1, alignSelf: 'center', overflow: 'hidden', backgroundColor: c.canvas }, screen: { flex: 1 },
  foreground: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.canvas, overflow: 'hidden' }, foregroundRounded: { borderRadius: r.drawerForeground }, foregroundCover: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.overlay },
  chatHeader: { position: 'absolute', zIndex: 2, top: l.headerTop, left: l.sidePadding, right: l.sidePadding, height: l.headerHeight }, chatHeaderCompact: { height: l.controlSize }, headerLeft: { position: 'absolute', top: 0, left: 0 }, headerRight: { position: 'absolute', top: 0, right: 0, flexDirection: 'row', gap: spacing[4] },
  bodyStage: { flex: 1 },
  sessionLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  frostedWrap: { flex: 1 },
  sessionContentWrap: { flex: 1 },
  bloomCircle: { position: 'absolute', width: 100, height: 100, borderRadius: 50 },
  bloomRing: { borderWidth: 3, backgroundColor: 'transparent' },
  sessionHeader: { height: l.headerHeight, flexShrink: 0, marginTop: l.headerTop, marginHorizontal: l.sidePadding },
  sessionIdentityLabel: { maxWidth: l.identityMaxWidth },
  pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  identity: { alignSelf: 'center', alignItems: 'center', maxWidth: l.identityMaxWidth },
  identityCompact: { height: l.controlSize, flexDirection: 'row', gap: spacing[8] },
  identityLabel: { paddingHorizontal: spacing[8], paddingTop: spacing[6], gap: spacing[3], alignItems: 'center', maxWidth: '100%' },
  // 只覆盖非主空间聊天名称自身，不给透明顶栏增加整条背景或正文占位。
  identityLabelSurface: { backgroundColor: c.floatingSurface, borderColor: c.floatingLine, borderWidth: StyleSheet.hairlineWidth, borderRadius: r.field, paddingBottom: spacing[6] },
  identityName: { ...t.name, color: c.ink, maxWidth: '100%', textAlign: 'center' },
  navigation: { flexDirection: 'row', height: l.navigationHeight, marginHorizontal: spacing[18], marginBottom: l.navigationBottom, alignItems: 'center' },
  navigationItem: { flex: 1, minHeight: l.controlSize, gap: l.navigationLabelGap, alignItems: 'center', justifyContent: 'center' }, navigationLabel: { ...t.navigation, color: c.faint }, navigationLabelSelected: { color: c.ink },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: l.sidePadding, paddingTop: l.drawerTop, backgroundColor: c.canvas }, drawerHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: l.drawerTop, marginBottom: l.drawerTitleBottom }, drawerTitle: { ...t.drawerTitle, color: c.ink }, drawerSection: { ...t.caption, color: c.faint }, drawerSectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], marginBottom: spacing[14] }, drawerList: { gap: spacing[6] },
  threadRow: { minHeight: l.drawerRowHeight, flexDirection: 'row', alignItems: 'center', gap: spacing[14], paddingHorizontal: spacing[14], paddingVertical: spacing[12], borderRadius: r.listItem }, threadSelected: { backgroundColor: c.surface }, threadText: { flex: 1, gap: spacing[4], minWidth: 0 }, drawerFooter: { height: l.drawerFooterHeight, flexDirection: 'row', alignItems: 'center', gap: spacing[12], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  drawerSearch: { flex: 1, minWidth: 0, height: l.controlSize, borderRadius: r.round, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[14], gap: spacing[8] }, searchInput: { flex: 1, minWidth: 0, height: l.smallControl },
  headerSideButtonSpacer: { width: l.controlSize, height: l.controlSize },
  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: l.sidePadding, paddingTop: spacing[12], paddingBottom: spacing[8] },
  otherPage: { paddingTop: l.pageTop, paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: spacing[18] }, pageTitle: { ...t.heroName, color: c.ink }, itemTitle: { ...t.itemTitle, color: c.ink }, mutedText: { ...t.detail, color: c.muted }, caption: { ...t.caption, color: c.faint }, error: { ...t.caption, color: c.danger },
  exampleCard: { padding: spacing[20], borderRadius: r.card, backgroundColor: c.surface, gap: spacing[16], marginBottom: spacing[16] },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
  settingsPage: { gap: spacing[24] }, appSection: { gap: spacing[10] },
  appSectionTitle: { ...t.status, color: c.muted, marginLeft: spacing[6] },
  appSettingsGroup: { borderRadius: r.card, backgroundColor: c.surface, overflow: 'hidden' },
  appSettingsRow: { minHeight: l.appSettingsRowHeight, flexDirection: 'row', alignItems: 'center', gap: spacing[10], paddingHorizontal: spacing[14], paddingVertical: spacing[12] },
  appRowIcon: { width: l.appSettingsIconBox, height: l.appSettingsIconBox, borderRadius: r.round, backgroundColor: c.control, alignItems: 'center', justifyContent: 'center' },
  appRowText: { flex: 1, minWidth: 0, gap: spacing[2] }, appAddress: { ...t.caption, color: c.faint, minWidth: 0 },
  settingsDisabled: { opacity: workspaceTheme.interaction.disabledOpacity }, eyebrow: { ...t.eyebrow, color: c.faint },
  emptyTitle: { ...t.heroName, color: c.ink, textAlign: 'center' }, notice: { position: 'absolute', left: l.sidePadding, right: l.sidePadding, top: l.headerHeight, ...t.caption, color: c.ink, backgroundColor: c.control, padding: spacing[12], borderRadius: r.listItem },
  disconnected: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: l.maxWidth }, disconnectedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: l.sidePadding }, welcome: { flex: 1, paddingHorizontal: l.sidePadding, gap: spacing[18], alignItems: 'center', justifyContent: 'center' },

});
