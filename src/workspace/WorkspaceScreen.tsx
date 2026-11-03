import { GroupChat } from '../group/GroupChat';
import type { GroupPreview } from '../group/contracts';
import { GroupInfo } from '../group/GroupInfo';
import { useNewsDiscussion } from '../features/useNewsDiscussion';
import { SmsProvider } from '../information/SmsProvider';
import { FeaturePage, type FeatureSection } from '../features/FeaturePage';
import { Card } from '../ui/Surfaces';
import { BookOpen, ChevronRight, Download, ArrowLeft, Users, Ellipsis, Moon, RotateCcw, Server, Settings, UserRound, X, Globe, type LucideIcon } from 'lucide-react-native';
import { BlurTargetView } from 'expo-blur';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { AgentLabels, headerAgentNames, isBuiltinMember } from './agent-labels';
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
import { MemberDirectory } from './MemberDirectory';
import { MemberAvatar } from './MemberAvatar';
import { BrowserPanel } from '../browser/BrowserPanel';
import { createBrowserStore } from '../browser/browser-store';

type WorkspacePage = 'group' | 'group-info' | 'inbox' | 'chat' | 'news' | 'goals' | 'settings' | 'agent' | 'feature';
type SettingsSubpage = 'memory' | 'profile' | 'dream' | 'news-sources' | FeatureSection | null;
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

function SettingsPage({ snapshot, openConnection, openBrowser, memoryAvailable = false, profileAvailable = false, dreamAvailable = false, currentAgentId, subpage, onSubpage }: Pick<WorkspaceConnectionProps, 'snapshot' | 'openConnection'> & { openBrowser?: () => void; memoryAvailable?: boolean; profileAvailable?: boolean; dreamAvailable?: boolean; currentAgentId?: string; subpage: SettingsSubpage; onSubpage: (page: SettingsSubpage) => void }) {
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
  return <SmsProvider><FilesProvider currentAgentId={agents.currentAgent}><WorkspaceContent {...props} agents={agents} /></FilesProvider></SmsProvider>;
}

function WorkspaceContent({ snapshot, openConnection, agents }: WorkspaceConnectionProps & { agents: ReturnType<typeof useAgents> }) {
  const api = useApi();
  // 连接键改变会卸载整层；新闻 Store 在此持续挂载，切智能体与重置会话不会丢草稿。
  const [news] = useState(() => createNewsStore(api));
  const [newsPreferences] = useState(() => new NewsPreferencesStore(api));
  // Store 随 ApiProvider 的连接键创建和销毁，票据不会跨服务地址复用。
  const [browser] = useState(() => createBrowserStore(api, snapshot.serverUrl ?? ''));
  const [browserOpen, setBrowserOpen] = useState(false);
  const connection = useServiceConnection();
  const { store: files } = useFiles();
  const [agentView, setAgentView] = useState<'profile' | 'settings'>('profile');
  const [agentSection, setAgentSection] = useState<AgentSection>('home');
  const session = useAgentState(agents.currentAgent);
  const sessions = useAgentStore(); const runtimeStore = useRuntimeStore();
  const activities = useActivityStore();
  const { store: jobs } = useJobs();
  const { store: monitors } = useMonitors();
  const { store: approvals } = useApprovals();
  const { store: goals } = useGoals();
  const runtime = useAgentRuntime(agents.currentAgent);
  const [page, setPage] = useState<WorkspacePage>('group');
  const [groupPreview, setGroupPreview] = useState<GroupPreview>({});
  const [newsManaging, setNewsManaging] = useState(false);
  const [settingsSubpage, setSettingsSubpage] = useState<SettingsSubpage>(null);
  const [profileReturn, setProfileReturn] = useState<'chat' | 'inbox' | 'group' | 'group-info'>('inbox');
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
  const headerNames = headerAgentNames(labels, agents.currentAgent, keyboardVisible);
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
    // 原生键盘出现时让出阅读智能体；系统 Back 收起键盘后恢复完整头像浮层。
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
  const leaveAgentChild = useCallback(() => {
    if (sessions.hasSettingsWrite(agents.currentAgent)) return;
    if ((agentSection === 'rules' && session.instructions.draft !== session.instructions.saved) || (agentSection === 'skills' && !equalSwitches(session.skills.draft, session.skills.saved))) {
      Alert.alert('有未保存的智能体设置', '草稿只保留在本次连接中。', [
        { text: '继续编辑', style: 'cancel' },
        { text: '保留草稿并返回', onPress: () => setAgentSection('home') },
        { text: '丢弃并返回', style: 'destructive', onPress: () => { sessions.discardSettings(agents.currentAgent, agentSection === 'rules' ? 'instructions' : 'skills'); setAgentSection('home'); } },
      ]);
    } else setAgentSection('home');
  }, [sessions, agents.currentAgent, agentSection, session.instructions.draft, session.instructions.saved, session.skills.draft, session.skills.saved]);
  const backAgent = useCallback(() => {
    if (agentSection === 'home') { setPage(profileReturn); return; }
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
  }, [files, leaveAgentChild, agentSection, profileReturn]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const action = workspaceBackAction({ keyboardVisible, browserOpen, sessionMounted, page, newsArticleOpen: !!news.getSnapshot().selectedArticleId,
        newsManaging, settingsSubpage, goalCreating: !!goals.getSnapshot().creator });
      if (action === 'keyboard') { pendingSessionOpen.current = false; Keyboard.dismiss(); }
      else if (action === 'browser') closeBrowser();
      else if (action === 'session') closeSession();
      else if (action === 'news-article') news.closeArticle();
      else if (action === 'news-sources') setNewsManaging(false);
      else if (action === 'news-owner') setPage('agent');
      else if (action === 'group') setPage('group');
      else if (action === 'inbox') setPage('inbox');
      else if (action === 'feature') { if (settingsSubpage === 'news-sources') setSettingsSubpage('news-feature'); else { setPage('agent'); setSettingsSubpage(null); } }
      else if (action === 'settings') setSettingsSubpage(settingsSubpage === 'news-sources' ? 'news-feature' : null);
      else if (action === 'agent') backAgent();
      else if (action === 'goal' && !goals.getSnapshot().writing) goals.cancelCreate();
      return action !== 'none';
    });
    return () => subscription.remove();
  }, [keyboardVisible, browserOpen, closeBrowser, sessionMounted, closeSession, page, news, newsManaging, settingsSubpage, goals, backAgent]);
  const openSession = useCallback((tab?: unknown) => {
    if (typeof tab === 'string') setSessionTab(tab as SessionTab);
    if (keyboardVisible) { pendingSessionOpen.current = true; Keyboard.dismiss(); return; }
    setSessionMounted(true); setSessionOpen(true);
  }, [keyboardVisible]);
  const openInbox = useCallback(() => { Keyboard.dismiss(); setPage('inbox'); void reloadAgents(); }, [reloadAgents]);
  const changeAgent = (action: () => void) => {
    const state = files.getSnapshot();
    if (!hasFileWork(state)) { action(); return; }
    const busy = state.writing !== false || state.uncertain;
    Alert.alert('请先处理当前智能体文件', busy ? '文件操作进行中或结果未明，请进入文件页核对后再切换。' : '切换智能体前请保存或丢弃文件草稿，避免混淆文件归属。', [
      { text: '取消', style: 'cancel' },
      { text: '返回文件', onPress: () => { setPage('agent'); setAgentSection('files'); } },
      ...(!busy ? [{ text: '丢弃并继续', style: 'destructive' as const, onPress: () => { files.cancelSavePreview(); files.cancelDelete(); files.cancelEditor(); action(); } }] : []),
    ]);
  };
  const select = (id: string) => changeAgent(() => { Keyboard.dismiss(); agents.selectAgent(id); setSessionOpen(false); setPage('chat'); setAgentSection('home'); setDeleteConfirm(false); setNotice(undefined); });
  // 主页与智能体设置共用同一批领域状态；只区分入口呈现，子页返回不丢当前智能体。
  const openGroup = () => changeAgent(() => { Keyboard.dismiss(); setSessionOpen(false); setPage('group'); });
  const openProfile = (id: string, view: 'profile' | 'settings' = 'profile') => changeAgent(() => { Keyboard.dismiss(); agents.selectAgent(id); setAgentView(view); setProfileReturn(page === 'chat' || page === 'group' || page === 'group-info' ? page : 'inbox'); setPage('agent'); setAgentSection('home'); setSessionOpen(false); setDeleteConfirm(false); });
  const openNews = () => { Keyboard.dismiss(); setNewsManaging(false); news.closeArticle(); setPage('news'); };
  const discussion = useNewsDiscussion((agentId) => { refresh(agentId); select(agentId); });
  const remove = async () => {
    const id = agents.currentAgent;
    try {
      const result = await sessions.deleteAgent(id);
      if (!result) return;
      runtimeStore.forgetAgent(id); activities.forgetAgent(id); jobs.invalidate(); monitors.invalidate(); agents.removeAgent(id);
      setSessionOpen(false); setDeleteConfirm(false); setNotice(undefined); setAgentSection('home'); setPage('inbox');
      await agents.reload();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), tone: 'error' }); }
  };
  const reset = async (id: string, clearSchedules: boolean) => {
    if (!connection?.enabled) { setResetError('服务器连接不可用，请重新连接后再操作。'); return; }
    try {
      const result = await sessions.resetAgent(id, clearSchedules);
      if (!result) { setResetError('当前无法重置此会话，请核对连接与智能体状态。'); return; }
      // 重置不删除智能体或活动历史；通知重连获取权威审批集合，不凭 cancelledApprovals 猜具体审批 ID。
      runtimeStore.forgetAgent(id);
      activities.invalidate(id);
      await approvals.refreshPending();
      setResetTarget(undefined); setResetError(undefined); setSessionOpen(false); setPage('chat');
      setNotice({ text: '会话已重置，可开启全新对话。智能体规则、技能与工作区文件已保留。', tone: 'success' });
      refresh();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : String(error));
      // 列表回读仅核对新 sessionId，不重发 reset；未确认期间禁止继续发送旧上下文。
      void agents.reload();
    }
  };
  const maintenance = <>
    <Card style={styles.exampleCard}><Text style={styles.itemTitle}>重置当前会话</Text><Text style={styles.mutedText}>开启全新对话，保留这个智能体的文件、规则与技能。</Text>
      <ActionButton label="重置当前会话" text="重置会话" icon={RotateCcw} disabled={!connection?.enabled || hasFileWork(files.getSnapshot())} onPress={() => { setResetError(undefined); setResetTarget(agents.currentAgent); }} />
    </Card>
    {agents.currentAgent !== MAIN_AGENT && !isBuiltinMember(agents.currentAgent) && <Card style={styles.exampleCard} tone="danger">
      <Text style={styles.itemTitle}>{deleteConfirm ? '确认删除当前智能体？' : '删除当前智能体'}</Text>
      <Text style={styles.mutedText}>本成员的私聊历史、群聊讨论与显示记录、消息反馈、工作区文件、规则、技能及绑定任务将被彻底删除，无法撤销；其他成员的历史不受影响。</Text>
      <View style={styles.confirmActions}>
        <ActionButton label={deleteConfirm ? '确认删除智能体' : '删除当前智能体'} text={deleteConfirm ? '确认删除' : '删除智能体'} tone="danger" busy={session.deleting} disabled={hasFileWork(files.getSnapshot())} onPress={() => deleteConfirm ? void remove() : setDeleteConfirm(true)} />
        {deleteConfirm && <ActionButton label="取消删除智能体" text="取消" disabled={session.deleting} onPress={() => setDeleteConfirm(false)} />}
      </View>
    </Card>}
  </>;
  // 页面只组织入口；会话所有者与领域 Store 持续挂载，成员主页不会复制状态。
  let otherPage: ReactNode = null;
  if (page === 'inbox') {
    otherPage = <MemberDirectory agents={agents.agents} labels={labels} error={agents.error}
      onReload={() => void reloadAgents()} onChat={select} onProfile={openProfile} onGroup={openGroup}
      onSettings={() => { setPage('settings'); setSettingsSubpage(null); }}
      creating={agents.creating} groupPreview={groupPreview}
      onCreate={() => changeAgent(() => { void agents.createAgent().then((id) => { if (!id) return; setAgentView('profile'); setProfileReturn('inbox'); setPage('agent'); setAgentSection('home'); }); })} />;
  } else if (page === 'group-info') {
    otherPage = <GroupInfo members={groupMembers} onBack={() => setPage('group')} onProfile={openProfile} />;
  } else if (page === 'feature' && settingsSubpage === 'news-sources') {
    otherPage = <NewsSourcesPage store={news} onBack={() => setSettingsSubpage('news-feature')} />;
  } else if (page === 'feature' && (settingsSubpage === 'sms' || settingsSubpage === 'news-feature')) {
    otherPage = <FeaturePage newsPreferences={newsPreferences} section={settingsSubpage} backLabel={agentView === 'settings' ? '返回智能体设置' : '返回成员主页'} onBack={() => { setSettingsSubpage(null); setPage('agent'); }}
      agents={agents.sourceAgents.filter((agent) => !!agent.sessionId).map((agent) => ({ id: agent.id, title: labels.title(agent.id) }))}
      onNewsSettings={() => setSettingsSubpage('news-sources')} />;
  } else if (page === 'agent') {
    otherPage = <AgentPage view={agentView} agentId={agents.currentAgent} name={labels.title(agents.currentAgent)} section={agentSection}
      onSection={(next) => { setDeleteConfirm(false); setAgentSection(next); }} onBack={backAgent}
      onChat={() => select(agents.currentAgent)} onActivity={() => openSession('activity')}
      onFeatureSettings={() => { setPage('feature'); setSettingsSubpage(agents.currentAgent === 'sms-internal' ? 'sms' : 'news-feature'); }}
      onReadNews={openNews} onSaved={refresh} maintenance={maintenance} />;
  } else if (page === 'settings') {
    otherPage = <SettingsPage snapshot={snapshot} openConnection={openConnection} memoryAvailable profileAvailable dreamAvailable
      currentAgentId={agents.currentAgent} openBrowser={openBrowser} subpage={settingsSubpage} onSubpage={setSettingsSubpage} />;
  } else if (page === 'news') {
    otherPage = <NewsPage store={news} managing={newsManaging} onManaging={setNewsManaging} onBack={() => setPage('agent')}
      onDiscuss={(id) => changeAgent(() => void discussion.discuss(id))} discussing={discussion.busy} discussionError={discussion.error}
      uncertainDiscussion={!!discussion.uncertainTarget} onCheckDiscussion={() => { if (discussion.uncertainTarget) select(discussion.uncertainTarget); }}
      onConfirmDiscussion={() => Alert.alert('确认已核对承接会话？', '恢复后不会重发上一次讨论。请先确认会话里是否已经收到这条新闻。', [
        { text: '取消', style: 'cancel' }, { text: '已核对', onPress: () => void discussion.confirmChecked() },
      ])} />;
  } else if (page === 'goals' && !sessionOpen) {
    otherPage = <GoalsPanel openDrawer={openInbox} />;
  }
  // 文件 Provider 与聊天所有者随连接持有；页面切换不销毁草稿或运行。
  return <View style={styles.root} testID="workspace-screen"><ThemeStatusBar />
    <View style={[styles.viewport, { width: contentWidth }]}
      pointerEvents={browserOpen ? 'none' : 'auto'} accessibilityElementsHidden={browserOpen} importantForAccessibility={browserOpen ? 'no-hide-descendants' : 'auto'}>
      <View style={styles.foreground}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
          {/* 唯一键盘避让层：Android 按真实重叠缩小阅读区，iOS 保留 padding；不再另算键盘高度。 */}
          <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'} accessibilityViewIsModal={sessionMounted}>
            {page === 'settings' && !inSettingsSubpage && <View style={styles.pageHeader}><IconControl icon={ArrowLeft} label="返回消息列表" onPress={openInbox} /><Text style={styles.pageTitle}>设置</Text><View style={styles.headerSideButtonSpacer} /></View>}
            {/* 头像与左右操作浮在聊天层上方，不占正文高度；触控只落在实际控件。 */}
            {page === 'chat' && <View pointerEvents="box-none" style={[styles.chatHeader, keyboardVisible && styles.chatHeaderCompact]}>
              <View style={styles.headerLeft}><IconControl icon={ArrowLeft} label="返回消息列表" testID="workspace-back-inbox" onPress={openInbox} /></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`查看${labels.title(agents.currentAgent)}的主页`} accessibilityHint={`当前智能体：${labels.title(agents.currentAgent)}；当前状态：${statusLabel}。查看成员资料、发消息与管理专属文件`} accessibilityState={{ disabled: sessionMounted }} disabled={sessionMounted} testID="workspace-open-member" style={[styles.identity, keyboardVisible && styles.identityCompact]}
                onPress={() => openProfile(agents.currentAgent)}>
                <MemberAvatar agentId={agents.currentAgent} size={keyboardVisible ? l.compactHeaderAvatar : l.headerAvatar} />
                {headerNames.chat && <View style={[styles.identityLabel, styles.identityLabelSurface]}><Text numberOfLines={1} style={styles.identityName}>{headerNames.chat}</Text></View>}
              </Pressable>
              <View style={styles.headerRight}><IconControl icon={Settings} label={`打开${labels.title(agents.currentAgent)}的智能体设置`} testID="workspace-open-agent-settings" onPress={() => openProfile(agents.currentAgent, 'settings')} /></View>
            </View>}
            {/* 群聊顶栏占据正常文档流；历史再长也不会穿过标题和操作按钮。 */}
            {page === 'group' && <View style={styles.groupHeader}>
              <IconControl icon={ArrowLeft} label="返回消息列表" onPress={openInbox} />
              <Pressable accessibilityRole="button" accessibilityLabel="查看群组信息" style={styles.groupIdentity} onPress={() => { Keyboard.dismiss(); setPage('group-info'); }}>
                <Users size={22} color={colors.accentText} /><Text style={styles.identityName}>群聊</Text>
              </Pressable>
              <IconControl icon={Ellipsis} label="打开群组信息" onPress={() => { Keyboard.dismiss(); setPage('group-info'); }} />
            </View>}
            <View style={styles.bodyStage}>
              <BlurTargetView ref={chatBlurTarget} style={styles.bodyStage}>
                {/* Expo 的原生 BlurTargetView 仅负责采样；普通 RN View 承担触控和读屏隔离。 */}
                <View style={styles.bodyStage} testID="workspace-chat-accessibility-layer"
                  pointerEvents={sessionMounted ? 'none' : 'auto'} aria-hidden={sessionMounted}
                  {...(Platform.OS === 'web' && sessionMounted ? { inert: true } : {})}
                  accessibilityElementsHidden={sessionMounted} importantForAccessibility={sessionMounted ? 'no-hide-descendants' : 'auto'}>
                  <View style={[styles.bodyStage, page === 'group' && { display: 'none' }]}><ConversationHost currentAgentId={agents.currentAgent} agentIds={agents.agents.map((agent) => agent.id)} chatVisible={page === 'chat'} compactHeader={keyboardVisible} otherPage={otherPage}
                    refreshVersions={historyRefresh} onSettled={refresh} onBindingMismatch={reloadAgents} openConnection={openConnection} onOpenApprovals={() => openSession('approvals')} /></View>
                  <GroupChat visible={page === 'group'} members={groupMembers} onProfile={openProfile} onPrivateChat={select} onSummary={setGroupPreview} onApprovals={(agentId) => { agents.selectAgent(agentId); openSession('approvals'); }} />
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
                    <MemberAvatar agentId={agents.currentAgent} size={l.headerAvatar} />
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
                <SessionPanel agentId={agents.currentAgent}
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
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: l.sidePadding, paddingVertical: spacing[8], backgroundColor: c.canvas },
  groupIdentity: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[8], minHeight: l.controlSize, flexShrink: 1 },
  identityCompact: { height: l.controlSize, flexDirection: 'row', gap: spacing[8] },
  identityLabel: { paddingHorizontal: spacing[8], paddingTop: spacing[6], gap: spacing[3], alignItems: 'center', maxWidth: '100%' },
  // 只覆盖非主智能体聊天名称自身，不给透明顶栏增加整条背景或正文占位。
  identityLabelSurface: { backgroundColor: c.floatingSurface, borderColor: c.floatingLine, borderWidth: StyleSheet.hairlineWidth, borderRadius: r.field, paddingBottom: spacing[6] },
  identityName: { ...t.name, color: c.ink, maxWidth: '100%', textAlign: 'center' },
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
