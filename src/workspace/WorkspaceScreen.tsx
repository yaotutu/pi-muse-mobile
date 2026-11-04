import { AgentViewPreferences, agentHomePage, defaultAgentView } from './agent-view-preferences';
import { deviceAgentViews } from './device-agent-views';
import { GroupChat } from '../group/GroupChat';
import { AgentManagement } from './AgentManagement';
import { useNewsDiscussion } from '../features/useNewsDiscussion';
import { SmsProvider } from '../information/SmsProvider';
import { FeaturePage, type FeatureSection } from '../features/FeaturePage';
import { Card } from '../ui/Surfaces';
import { BookOpen, ChevronRight, Download, Moon, RotateCcw, Server, Settings, Users, UserRound, X, Globe, type LucideIcon } from 'lucide-react-native';
import { BlurTargetView } from 'expo-blur';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { Alert, Animated, AppState, BackHandler, Easing, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewInstance, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiProvider, useApi } from '../api/ApiProvider';
import { ConnectionProvider, useServiceConnection } from '../connection/ConnectionProvider';
import { useConnection } from '../connection/useConnection';
import type { ConnectionManager } from '../connection/connection-manager';
import type { ConnectionSnapshot } from '../connection/types';
import { RuntimeProvider, useRuntimeStore, useAgentRuntime } from '../runtime/RuntimeProvider';
import { useActivityStore } from '../activities/ActivityProvider';
import { useApprovals } from '../approvals/ApprovalProvider';
import { AgentProvider, useAgentState, useAgentStore } from '../agents/AgentProvider';
import { equalSwitches } from '../agents/agent-store';
import { MAIN_AGENT } from '../agents/agent-state';
import { useAgents } from '../agents/useAgents';
import { useAppUpdate } from '../update/UpdateProvider';
import { spacing, sizing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { ConnectionPanel } from './ConnectionPanel';
import { NewsPage, NewsSourcesPage } from './NewsPage';
import { createNewsStore } from '../news/news-store';
import { NewsPreferencesStore } from '../features/news-preferences-store';
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
import { AgentLabels, isBuiltinMember } from './agent-labels';
import { workspaceBackAction } from './workspace-back';
import { SessionPanel, type SessionTab } from './SessionPanel';
import { ResetSessionDialog } from './ResetSessionDialog';
import { AvatarBloomTransition } from './AvatarBloomTransition';
import { AgentPage } from './AgentPage';
import { AgentHeader } from './AgentHeader';
import { filesBackAction, hasFileWork, type AgentSection } from './agent-navigation';
import { useTheme } from '../theme/ThemeProvider';
import { ThemePicker } from '../theme/ThemePicker';
import { IconControl, MuseAvatar, StatusPill, useReducedMotion } from './primitives';
import { FrostedSurface } from '../ui/FrostedSurface';
import { ActionButton } from '../ui/ActionButton';
import { AgentAvatarStrip } from './AgentAvatarStrip';
import { adjacentAvatar, avatarTargets } from './avatar-navigation';
import { MemberAvatar } from './MemberAvatar';
import { BrowserPanel } from '../browser/BrowserPanel';
import { createBrowserStore } from '../browser/browser-store';

type WorkspacePage = 'group' | 'chat' | 'news' | 'goals' | 'settings' | 'agent' | 'feature';
type SettingsSubpage = 'agents' | 'memory' | 'profile' | 'dream' | 'news-sources' | FeatureSection | null;
type WorkspaceNotice = { text: string; tone: 'success' | 'error' };
const { layout: l, radius: r, typography: t } = workspaceTheme;
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
      {/* 资料与智能体同属当前连接；Provider 先于页面挂载，主会话名称可直接消费已读取身份。 */}
      <DreamProvider><ProfileProvider><AgentProvider><RuntimeProvider><LiveWorkspace manager={connection.manager} snapshot={connection.snapshot} openConnection={openConnection} /></RuntimeProvider></AgentProvider></ProfileProvider></DreamProvider>
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

function SettingsPage({ snapshot, openConnection, openBrowser, openAgents, memoryAvailable = false, profileAvailable = false, dreamAvailable = false, currentAgentId, subpage, onSubpage }: Pick<WorkspaceConnectionProps, 'snapshot' | 'openConnection'> & { openBrowser?: () => void; openAgents?: () => void; memoryAvailable?: boolean; profileAvailable?: boolean; dreamAvailable?: boolean; currentAgentId?: string; subpage: SettingsSubpage; onSubpage: (page: SettingsSubpage) => void }) {
  const styles = useStyles(); const update = useAppUpdate();
  const management = subpage === 'memory' && memoryAvailable ? { title: '长期记忆', content: <MemoryPanel /> }
    : subpage === 'profile' && profileAvailable ? { title: '助手与用户资料', content: <ProfilePanel /> }
    : subpage === 'dream' && dreamAvailable && currentAgentId ? { title: 'Dream 记忆整理', content: <DreamPanel currentAgentId={currentAgentId} /> }
    : undefined;
  // 返回属于页面层级，不随表单滚走；领域面板仍只负责自己的读取、草稿和保存。
  if (management) return <AnimatedSubpage key={subpage}>
    <AgentHeader title={management.title} backLabel="返回设置" onBack={() => onSubpage(null)} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.otherPage}>{management.content}</ScrollView>
  </AnimatedSubpage>;
  return <ScrollView key="settings" contentContainerStyle={[styles.otherPage, styles.settingsPage]}>
    <View style={styles.appSection}><Text accessibilityRole="header" style={styles.appSectionTitle}>连接与设备</Text>
      <View style={styles.appSettingsGroup}>
        <SettingRow title="服务器连接" label="服务器连接" description={connectionLabel(snapshot)} address={snapshot.serverUrl ?? undefined} icon={Server} onPress={openConnection} />
        {openBrowser && <SettingRow title="浏览器" label="打开浏览器" description="使用服务端同一 Chrome" icon={Globe} onPress={openBrowser} testID="viewer-open" />}
        {update && <SettingRow title="应用更新" label="应用更新" description={update.snapshot.status === 'unsupported' ? '当前环境不支持自动安装' : '检查版本、下载与安装进度'} icon={Download} onPress={update.open} />}
      </View>
    </View>
    {openAgents && <View style={styles.appSettingsGroup}><SettingRow title="智能体管理" label="打开智能体管理" description="添加、删除与设置智能体" icon={Users} onPress={openAgents} /></View>}
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
      {!inSettingsSubpage && <View style={styles.disconnectedHeader}><Text style={styles.itemTitle}>Pi Muse</Text><IconControl icon={Settings} label="设置" onPress={() => setPage(page === 'settings' ? 'chat' : 'settings')} /></View>}
      {page === 'settings' ? <SettingsPage snapshot={snapshot} openConnection={openConnection} subpage={settingsSubpage} onSubpage={setSettingsSubpage} /> : <View style={styles.welcome}>
        <MuseAvatar size={l.welcomeAvatar} /><Text style={styles.eyebrow}>HELLO, PI MUSE</Text><Text style={styles.emptyTitle}>{connectionLabel(snapshot)}</Text>
        <Text style={styles.mutedText}>{snapshot.error ?? '连接自己的 Pi Muse 服务器后即可恢复会话、聊天与真实执行状态。'}</Text>
        <ActionButton label="配置服务器连接" text="服务器连接" tone="primary" onPress={openConnection} />
        <Text style={styles.caption}>从一次连接开始。应用更新可独立使用。</Text>
      </View>}
    </SafeAreaView>
  </View>;
}
function LiveWorkspace(props: WorkspaceConnectionProps) {
  const connection = useServiceConnection();
  const agents = useAgents(!!connection?.enabled, props.snapshot.refreshVersion);
  // 设置对象和聊天对象独立；查看设置不会挂载另一个聊天或切走原来的草稿。
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  return <SmsProvider><FilesProvider currentAgentId={settingsAgentId ?? agents.currentAgent}><WorkspaceContent {...props} agents={agents} settingsAgentId={settingsAgentId} setSettingsAgentId={setSettingsAgentId} /></FilesProvider></SmsProvider>;
}

function WorkspaceContent({ snapshot, openConnection, agents, settingsAgentId, setSettingsAgentId }: WorkspaceConnectionProps & {
  agents: ReturnType<typeof useAgents>; settingsAgentId: string | null; setSettingsAgentId: (id: string | null) => void;
}) {
  const [views] = useState(() => new AgentViewPreferences(snapshot.serverUrl ?? '', deviceAgentViews));
  const viewState = useSyncExternalStore(views.subscribe, views.getSnapshot, views.getSnapshot);
  useEffect(() => { void views.load(); }, [views]);
  const homePage = useCallback((id: string) => agentHomePage(id, viewState.views[id] ?? defaultAgentView(id)), [viewState.views]);
  const focusedAgentId = settingsAgentId ?? agents.currentAgent;
  const api = useApi();
  // 连接键改变会卸载整层；新闻 Store 在此持续挂载，切智能体与重置会话不会丢草稿。
  const [news] = useState(() => createNewsStore(api));
  const [newsPreferences] = useState(() => new NewsPreferencesStore(api));
  // Store 随 ApiProvider 的连接键创建和销毁，票据不会跨服务地址复用。
  const [browser] = useState(() => createBrowserStore(api, snapshot.serverUrl ?? ''));
  const [browserOpen, setBrowserOpen] = useState(false);
  const connection = useServiceConnection();
  const { store: files } = useFiles();
  const [agentSection, setAgentSection] = useState<AgentSection>('home');
  const session = useAgentState(focusedAgentId);
  const sessions = useAgentStore(); const runtimeStore = useRuntimeStore();
  const activities = useActivityStore();
  const { store: jobs } = useJobs();
  const { store: monitors } = useMonitors();
  const { store: approvals } = useApprovals();
  const { store: goals } = useGoals();
  const runtime = useAgentRuntime(focusedAgentId);
  const [page, setPage] = useState<WorkspacePage>('group');
  const [newsManaging, setNewsManaging] = useState(false);
  const [settingsSubpage, setSettingsSubpage] = useState<SettingsSubpage>(null);
  const [chatReturn, setChatReturn] = useState<'chat' | 'group' | 'news'>('group');
  const [agentReturn, setAgentReturn] = useState<'chat' | 'management'>('chat');
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionMounted, setSessionMounted] = useState(false);
  const chatBlurTarget = useRef<ViewInstance | null>(null);
  const pendingSessionOpen = useRef(false);
  const [sessionTab, setSessionTab] = useState<SessionTab>('activity');
  const [deleting, setDeleting] = useState(false);
  const deleteBusy = useRef(false);
  const [deleteUncertain, setDeleteUncertain] = useState<string>();
  const [resetTarget, setResetTarget] = useState<string>();
  const [resetError, setResetError] = useState<string>();
  const [notice, setNotice] = useState<WorkspaceNotice>();
  const reducedMotion = useReducedMotion();
  const [historyRefresh, setHistoryRefresh] = useState<Record<string, number>>({});
  const [labelState, setLabelState] = useState(() => ({ ids: '', labels: new AgentLabels() }));
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const { colors } = useTheme(); const styles = useStyles();
  const { width, height } = useWindowDimensions(); const contentWidth = Math.min(width, l.maxWidth);
  const avatarCenterY = l.headerTop + l.headerAvatar / 2;
  const bloomRadius = 50;
  const targetScale = Math.max(25, Math.ceil((Math.hypot(contentWidth / 2, height - avatarCenterY) / bloomRadius) * 1.08));
  const inSettingsSubpage = page === 'settings' && settingsSubpage !== null;
  const newsVisible = page === 'news' || (page === 'feature' && settingsSubpage === 'news-sources');
  const statusLabel = snapshot.status === 'authentication-required' || snapshot.status === 'reset-error' || snapshot.status === 'storage-error'
    ? connectionLabel(snapshot) : runtime.label;
  const labelIds = agents.agents.map((agent) => agent.id).sort().join('|');
  if (labelState.ids !== labelIds) setLabelState({ ids: labelIds, labels: labelState.labels.sync(agents.agents) });
  const labels = labelState.ids === labelIds ? labelState.labels : labelState.labels.sync(agents.agents);
  const groupMembers = agents.agents.filter((agent) => agent.sessionId || agent.id === MAIN_AGENT || isBuiltinMember(agent.id)).map((agent) => ({ id: agent.id, name: labels.title(agent.id) }));
  const sessionName = focusedAgentId === MAIN_AGENT ? null : labels.title(focusedAgentId);
  const reloadAgents = agents.reload;
  const refresh = useCallback((agentId = agents.currentAgent) => { void reloadAgents(); activities.invalidate(); jobs.invalidate(); monitors.invalidate(); goals.invalidate(); setHistoryRefresh((value) => ({ ...value, [agentId]: (value[agentId] ?? 0) + 1 })); }, [reloadAgents, activities, jobs, monitors, goals, agents.currentAgent]);
  useEffect(() => {
    news.setActive(AppState.currentState === 'active');
    newsPreferences.setActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      news.setActive(state === 'active');
      newsPreferences.setActive(state === 'active');
    });
    return () => { subscription.remove(); news.dispose(); newsPreferences.dispose(); };
  }, [news, newsPreferences]);
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
    if (newsVisible) news.open();
    else news.close();
  }, [news, newsVisible]);
  useEffect(() => {
    // ready 不重放通知历史；智能体绑定与当前聊天都要回到服务端权威事实。
    if (runtime.synchronized) void reloadAgents();
  }, [runtime.synchronized, reloadAgents]);
  useEffect(() => {
    // 原生键盘出现时压缩头像栏；系统 Back 收起键盘后恢复名称。
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
  const onSessionCloseFinished = useCallback((finished = true) => {
    if (finished && !sessionOpen) setSessionMounted(false);
  }, [sessionOpen]);
  const closeSession = useCallback(() => {
    if (session.deleting || session.resetting) return;
    pendingSessionOpen.current = false;
    setSessionOpen(false);
  }, [session.deleting, session.resetting]);
  const changeAgent = useCallback((action: () => void) => {
    const state = files.getSnapshot();
    if (!hasFileWork(state)) { action(); return; }
    const busy = state.writing !== false || state.uncertain;
    Alert.alert('请先处理当前智能体文件', busy ? '文件操作进行中或结果未明，请进入文件页核对后再切换。' : '切换智能体前请保存或丢弃文件草稿，避免混淆文件归属。', [
      { text: '取消', style: 'cancel' },
      { text: '返回文件', onPress: () => { setPage('agent'); setAgentSection('files'); } },
      ...(!busy ? [{ text: '丢弃并继续', style: 'destructive' as const, onPress: () => { files.cancelSavePreview(); files.cancelDelete(); files.cancelEditor(); action(); } }] : []),
    ]);
  }, [files]);
  const returnChat = useCallback(() => changeAgent(() => { setSettingsAgentId(null); setPage(chatReturn === 'group' ? 'group' : homePage(agents.currentAgent)); }), [changeAgent, setSettingsAgentId, chatReturn, homePage, agents.currentAgent]);
  const leaveAgentChild = useCallback(() => {
    if (sessions.hasSettingsWrite(focusedAgentId)) return;
    if ((agentSection === 'rules' && session.instructions.draft !== session.instructions.saved) || (agentSection === 'skills' && !equalSwitches(session.skills.draft, session.skills.saved))) {
      Alert.alert('有未保存的智能体设置', '草稿只保留在本次连接中。', [
        { text: '继续编辑', style: 'cancel' },
        { text: '保留草稿并返回', onPress: () => setAgentSection('home') },
        { text: '丢弃并返回', style: 'destructive', onPress: () => { sessions.discardSettings(focusedAgentId, agentSection === 'rules' ? 'instructions' : 'skills'); setAgentSection('home'); } },
      ]);
    } else setAgentSection('home');
  }, [sessions, focusedAgentId, agentSection, session.instructions.draft, session.instructions.saved, session.skills.draft, session.skills.saved]);
  const backAgent = useCallback(() => {
    if (agentSection === 'home') { changeAgent(() => { setSettingsAgentId(null); if (agentReturn === 'management') { setPage('settings'); setSettingsSubpage('agents'); } else setPage(chatReturn === 'group' ? 'group' : homePage(agents.currentAgent)); }); return; }
    if (agentSection !== 'files') { leaveAgentChild(); return; }
    const action = filesBackAction(files.getSnapshot());
    if (action === 'locked') {
      Alert.alert('文件操作尚未收口', '写入期间请等待；结果未明时请先回读核对，不会自动重发。');
    } else if (action === 'preview') files.cancelSavePreview();
    else if (action === 'delete') files.cancelDelete();
    else if (action === 'draft') Alert.alert('保留文件草稿？', '草稿属于当前智能体，只保留在本次连接中。', [
      { text: '继续编辑', style: 'cancel' },
      { text: '保留草稿并返回', onPress: () => setAgentSection('home') },
      { text: '丢弃草稿', style: 'destructive', onPress: () => files.cancelEditor() },
    ]);
    else if (action === 'detail') files.closeFile();
    else if (action === 'directory') files.goUp();
    else setAgentSection('home');
  }, [files, leaveAgentChild, agentSection, changeAgent, setSettingsAgentId, agentReturn, chatReturn, homePage, agents.currentAgent]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (deleteBusy.current || agents.creating || views.getSnapshot().saving) return true;
      const action = workspaceBackAction({ keyboardVisible, browserOpen, sessionMounted, page, newsArticleOpen: !!news.getSnapshot().selectedArticleId,
        newsManaging, settingsSubpage, goalCreating: !!goals.getSnapshot().creator });
      if (action === 'keyboard') { pendingSessionOpen.current = false; Keyboard.dismiss(); }
      else if (action === 'browser') closeBrowser();
      else if (action === 'session') closeSession();
      else if (action === 'news-article') news.closeArticle();
      else if (action === 'news-sources') setNewsManaging(false);
      else if (action === 'group') setPage('group');
      else if (action === 'chat-return') returnChat();
      else if (action === 'feature') { if (settingsSubpage === 'news-sources') setSettingsSubpage('news-feature'); else { setPage('agent'); setSettingsSubpage(null); } }
      else if (action === 'settings') setSettingsSubpage(settingsSubpage === 'news-sources' ? 'news-feature' : null);
      else if (action === 'agent') backAgent();
      else if (action === 'goal' && !goals.getSnapshot().writing) goals.cancelCreate();
      return action !== 'none';
    });
    return () => subscription.remove();
  }, [keyboardVisible, browserOpen, closeBrowser, sessionMounted, closeSession, page, news, newsManaging, settingsSubpage, goals, backAgent, returnChat, agents.creating, views]);
  const openSession = useCallback((tab?: unknown) => {
    if (typeof tab === 'string') setSessionTab(tab as SessionTab);
    if (keyboardVisible) { pendingSessionOpen.current = true; Keyboard.dismiss(); return; }
    setSessionMounted(true); setSessionOpen(true);
  }, [keyboardVisible]);
  const select = (id: string, conversation = false) => changeAgent(() => { Keyboard.dismiss(); agents.selectAgent(id); setSettingsAgentId(null); setSessionOpen(false); setPage(conversation ? 'chat' : homePage(id)); setAgentSection('home'); setNotice(undefined); });
  // 通知与新闻讨论显式进入实际承接私聊，不改已保存的主视图偏好。
  const selectConversation = (id: string) => select(id, true);
  // 显式切换聊天才改变聊天所有者；查看设置只改变检查对象。
  const openGroup = () => changeAgent(() => { Keyboard.dismiss(); setSettingsAgentId(null); setSessionOpen(false); setPage('group'); });
  const targets = avatarTargets(groupMembers.map((member) => member.id));
  const selectedAvatar = page === 'group' ? 'group' : agents.currentAgent;
  const avatarTitle = (id: string) => id === 'group' ? '全部' : labels.title(id);
  const selectAvatar = (id: string) => id === 'group' ? openGroup() : select(id);
  const switchAdjacent = (direction: -1 | 1) => {
    const next = adjacentAvatar(targets, selectedAvatar, direction);
    if (next) selectAvatar(next);
  };
  const openAgentSettings = (id: string, fromManagement = false) => changeAgent(() => {
    Keyboard.dismiss();
    if (page === 'chat' || page === 'group' || page === 'news') setChatReturn(page);
    setSettingsAgentId(id); setAgentReturn(fromManagement ? 'management' : 'chat');
    setPage('agent'); setAgentSection('home'); setSessionOpen(false);
  });
  const openGlobalSettings = () => changeAgent(() => {
    Keyboard.dismiss();
    if (page === 'chat' || page === 'group' || page === 'news') setChatReturn(page);
    setSettingsAgentId(null); setPage('settings'); setSettingsSubpage(null);
  });
  const discussion = useNewsDiscussion((agentId) => { refresh(agentId); selectConversation(agentId); });
  const finishRemoval = (id: string) => {
    const deletedCurrentChat = id === agents.currentAgent;
    sessions.clear(id); runtimeStore.forgetAgent(id); activities.forgetAgent(id); jobs.invalidate(); monitors.invalidate(); agents.removeAgent(id);
    if (deletedCurrentChat) setChatReturn('group');
    setDeleteUncertain(undefined); setNotice(undefined);
  };
  const checkDeletion = async () => {
    if (deleteBusy.current) return;
    deleteBusy.current = true; setDeleting(true);
    try {
      const items = await api.listAgents();
      if (deleteUncertain && !items.some((item) => item.id === deleteUncertain)) finishRemoval(deleteUncertain);
      else setDeleteUncertain(undefined);
      await agents.reload(); setNotice(undefined);
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), tone: 'error' }); }
    finally { deleteBusy.current = false; setDeleting(false); }
  };
  const remove = async (id: string) => {
    if (deleteBusy.current || deleteUncertain || id === MAIN_AGENT || isBuiltinMember(id)) return;
    deleteBusy.current = true; setDeleting(true);
    try {
      const result = await sessions.deleteAgent(id);
      if (!result) { setNotice({ text: '当前无法删除，请确认连接与智能体写入状态。', tone: 'error' }); return; }
      finishRemoval(id); await agents.reload();
    } catch (error) {
      // 删除结果未明时只允许先读目录核对，绝不自动重发。
      setDeleteUncertain(id); setNotice({ text: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally { deleteBusy.current = false; setDeleting(false); }
  };
  const confirmRemoval = (id: string) => changeAgent(() => Alert.alert(`删除${labels.title(id)}？`, `智能体 ID：${id}\n私聊历史、「全部」中的讨论与显示记录、消息反馈、工作区文件、规则、技能及绑定任务将彻底删除，无法撤销。其他智能体不受影响。`, [
    { text: '取消', style: 'cancel' }, { text: '确认删除', style: 'destructive', onPress: () => void remove(id) },
  ]));
  const reset = async (id: string, clearSchedules: boolean) => {
    if (!connection?.enabled) { setResetError('服务器连接不可用，请重新连接后再操作。'); return; }
    try {
      const result = await sessions.resetAgent(id, clearSchedules);
      if (!result) { setResetError('当前无法重置此会话，请核对连接与智能体状态。'); return; }
      // 重置不删除智能体或活动历史；通知重连获取权威审批集合，不凭 cancelledApprovals 猜具体审批 ID。
      runtimeStore.forgetAgent(id);
      activities.invalidate(id);
      await approvals.refreshPending();
      setResetTarget(undefined); setResetError(undefined); setSessionOpen(false);
      setNotice({ text: '会话已重置，可开启全新对话。智能体规则、技能与工作区文件已保留。', tone: 'success' });
      refresh(id);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : String(error));
      // 列表回读仅核对新 sessionId，不重发 reset；未确认期间禁止继续发送旧上下文。
      void agents.reload();
    }
  };
  const maintenance = <>
    <Card style={styles.exampleCard}><Text style={styles.itemTitle}>重置当前会话</Text><Text style={styles.mutedText}>开启全新对话，保留这个智能体的文件、规则与技能。</Text>
      <ActionButton label="重置当前会话" text="重置会话" icon={RotateCcw} disabled={!connection?.enabled || hasFileWork(files.getSnapshot())} onPress={() => { setResetError(undefined); setResetTarget(focusedAgentId); }} />
    </Card>
  </>;
  // 页面只组织入口；会话所有者与领域 Store 持续挂载，设置页面不会复制状态。
  let otherPage: ReactNode = null;
  if (page === 'feature' && settingsSubpage === 'news-sources') {
    otherPage = <NewsSourcesPage store={news} onBack={() => setSettingsSubpage('news-feature')} />;
  } else if (page === 'feature' && (settingsSubpage === 'sms' || settingsSubpage === 'news-feature')) {
    otherPage = <FeaturePage newsPreferences={newsPreferences} section={settingsSubpage} backLabel="返回智能体设置" onBack={() => { setSettingsSubpage(null); setPage('agent'); }}
      agents={agents.sourceAgents.filter((agent) => !!agent.sessionId).map((agent) => ({ id: agent.id, title: labels.title(agent.id) }))}
      onNewsSettings={() => setSettingsSubpage('news-sources')} />;
  } else if (page === 'agent') {
    otherPage = <AgentPage agentId={focusedAgentId} name={labels.title(focusedAgentId)} section={agentSection}
      onSection={(next) => { setAgentSection(next); }} onBack={backAgent}
      onActivity={() => openSession('activity')}
      onFeatureSettings={() => { setPage('feature'); setSettingsSubpage(focusedAgentId === 'sms-internal' ? 'sms' : 'news-feature'); }}
      mainView={views.view(focusedAgentId)} viewSaving={viewState.saving} viewError={viewState.error}
      onMainView={(view) => views.save(focusedAgentId, view)} onSaved={() => refresh(focusedAgentId)} maintenance={maintenance} />;
  } else if (page === 'settings' && settingsSubpage === 'agents') {
    otherPage = <AgentManagement members={groupMembers} onBack={() => { if (!deleting && !agents.creating) setSettingsSubpage(null); }}
      onSettings={(id) => openAgentSettings(id, true)} creating={agents.creating} deleting={deleting} uncertain={deleteUncertain}
      error={notice?.tone === 'error' ? notice.text : agents.error} onReload={() => void checkDeletion()} onDelete={confirmRemoval}
      onCreate={() => { void agents.createAgent().then((id) => { if (id) openAgentSettings(id, true); }); }} />;
  } else if (page === 'settings') {
    otherPage = <SettingsPage snapshot={snapshot} openConnection={openConnection} memoryAvailable profileAvailable dreamAvailable
      currentAgentId={agents.currentAgent} openAgents={() => setSettingsSubpage('agents')} openBrowser={openBrowser} subpage={settingsSubpage} onSubpage={setSettingsSubpage} />;
  } else if (page === 'goals' && !sessionOpen) {
    otherPage = <GoalsPanel openDrawer={openGroup} />;
  }
  // 本地偏好完成读取前不挂载默认页面，避免先显示聊天再跳阅读。
  if (!viewState.ready) return <SafeAreaView style={styles.root}>
    <Text style={styles.mutedText}>{viewState.error ?? '正在读取主视图偏好…'}</Text>
    {viewState.error && <ActionButton label="重试读取主视图偏好" text="重试" onPress={() => { void views.load(); }} />}
  </SafeAreaView>;
  // 文件 Provider 与聊天所有者随连接持有；页面切换不销毁草稿或运行。
  return <View style={styles.root} testID="workspace-screen"><ThemeStatusBar />
    <View style={[styles.viewport, { width: contentWidth }]}
      pointerEvents={browserOpen ? 'none' : 'auto'} accessibilityElementsHidden={browserOpen} importantForAccessibility={browserOpen ? 'no-hide-descendants' : 'auto'}>
      <View style={styles.foreground}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
          {/* 唯一键盘避让层：Android 按真实重叠缩小阅读区，iOS 保留 padding；不再另算键盘高度。 */}
          <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'} accessibilityViewIsModal={sessionMounted}>
            {page === 'settings' && !inSettingsSubpage && <AgentHeader title="全局设置" backLabel="返回聊天" onBack={returnChat} />}
            {(page === 'chat' || page === 'group' || page === 'news') && <AgentAvatarStrip targets={targets} selected={selectedAvatar}
              title={avatarTitle} compact={keyboardVisible} disabled={sessionMounted} onSelect={selectAvatar}
              onSettings={(id) => id === 'group' ? openGlobalSettings() : openAgentSettings(id)} />}
            <View style={styles.bodyStage}>
              <BlurTargetView ref={chatBlurTarget} style={styles.bodyStage}>
                {/* Expo 的原生 BlurTargetView 仅负责采样；普通 RN View 承担触控和读屏隔离。 */}
                <View style={styles.bodyStage} testID="workspace-chat-accessibility-layer"
                  pointerEvents={sessionMounted ? 'none' : 'auto'} aria-hidden={sessionMounted}
                  {...(Platform.OS === 'web' && sessionMounted ? { inert: true } : {})}
                  accessibilityElementsHidden={sessionMounted} importantForAccessibility={sessionMounted ? 'no-hide-descendants' : 'auto'}>
                  <View style={[styles.bodyStage, (page === 'group' || page === 'news') && { display: 'none' }]}><ConversationHost currentAgentId={agents.currentAgent} agentIds={agents.agents.map((agent) => agent.id)} chatVisible={page === 'chat'} onSwipe={switchAdjacent} otherPage={otherPage}
                    refreshVersions={historyRefresh} onSettled={refresh} onBindingMismatch={reloadAgents} openConnection={openConnection} onOpenApprovals={() => openSession('approvals')} /></View>
                  {/* 阅读视图与聊天所有者并列保留，切头像不卸载文章或滚动现场。 */}
                  <View style={[styles.bodyStage, page !== 'news' && { display: 'none' }]} pointerEvents={page === 'news' ? 'auto' : 'none'}
                    accessibilityElementsHidden={page !== 'news'} importantForAccessibility={page === 'news' ? 'auto' : 'no-hide-descendants'}>
                    <NewsPage store={news} visible={page === 'news'} managing={newsManaging} onManaging={setNewsManaging} onSwipe={switchAdjacent}
                      onDiscuss={(id) => changeAgent(() => void discussion.discuss(id))} discussing={discussion.busy} discussionError={discussion.error}
                      uncertainDiscussion={!!discussion.uncertainTarget} onCheckDiscussion={() => { if (discussion.uncertainTarget) selectConversation(discussion.uncertainTarget); }}
                      onConfirmDiscussion={() => Alert.alert('确认已核对承接会话？', '恢复后不会重发上一次讨论。请先确认会话里是否已经收到这条新闻。', [
                        { text: '取消', style: 'cancel' }, { text: '已核对', onPress: () => void discussion.confirmChecked() },
                      ])} />
                  </View>
                  <GroupChat visible={page === 'group'} members={groupMembers} onAgentSettings={openAgentSettings} onPrivateChat={selectConversation} onSwipe={switchAdjacent} onApprovals={(agentId) => { setChatReturn('group'); setAgentReturn('chat'); setSettingsAgentId(agentId); setAgentSection('home'); setPage('agent'); openSession('approvals'); }} />
                  {!!notice && <Text accessibilityRole="alert" style={[styles.notice, notice.tone === 'error' && styles.error]}>{notice.text}</Text>}
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
                    <MemberAvatar agentId={focusedAgentId} size={l.headerAvatar} />
                    <View style={[styles.identityLabel, styles.sessionIdentityLabel]}>{sessionName && <Text numberOfLines={1} style={styles.identityName}>{sessionName}</Text>}<StatusPill label={statusLabel} testID="workspace-session-status" tone={!runtime.synchronized ? 'warning' : runtime.running ? 'accent' : 'neutral'} /></View>
                  </View>
                }
                headerRight={<View style={styles.headerSideButtonSpacer} />}
                renderSurface={(content) => (
                  <FrostedSurface blurTarget={chatBlurTarget}>
                    {content}
                  </FrostedSurface>
                )}
              >
                <SessionPanel agentId={focusedAgentId}
                  tab={sessionTab}
                  onTab={(next) => {
                    if (session.resetting || session.deleting) return;
                    setSessionTab(next);
                  }}
                  deleting={session.deleting}
                  resetting={session.resetting}
                  onSettled={() => refresh(focusedAgentId)}
                />
              </AvatarBloomTransition>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </View>
    {browserOpen && <BrowserPanel store={browser} baseUrl={snapshot.serverUrl ?? ''} onClose={closeBrowser} />}
    {resetTarget && <ResetSessionDialog key={resetTarget} agentId={resetTarget} available={!!connection?.enabled} error={resetError}
      onCancel={() => { setResetTarget(undefined); setResetError(undefined); }} onConfirm={reset} />}
  </View>;
}
const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas }, viewport: { flex: 1, alignSelf: 'center', overflow: 'hidden', backgroundColor: c.canvas }, screen: { flex: 1 },
  foreground: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.canvas, overflow: 'hidden' },
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
  identityLabel: { paddingHorizontal: spacing[8], paddingTop: spacing[6], gap: spacing[3], alignItems: 'center', maxWidth: '100%' },
  identityName: { ...t.name, color: c.ink, maxWidth: '100%', textAlign: 'center' },
  headerSideButtonSpacer: { width: l.controlSize, height: l.controlSize },
  otherPage: { paddingTop: l.pageTop, paddingHorizontal: l.sidePadding, paddingBottom: spacing[24], gap: spacing[18] }, itemTitle: { ...t.itemTitle, color: c.ink }, mutedText: { ...t.detail, color: c.muted }, caption: { ...t.caption, color: c.faint }, error: { ...t.caption, color: c.danger },
  exampleCard: { padding: spacing[20], borderRadius: r.card, backgroundColor: c.surface, gap: spacing[16], marginBottom: spacing[16] },
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
