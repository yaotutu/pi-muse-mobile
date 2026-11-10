import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiProvider, useApi } from '../api/ApiProvider';
import { ConnectionProvider, useServiceConnection } from '../connection/ConnectionProvider';
import { useConnection } from '../connection/useConnection';
import { RuntimeProvider, useRuntimeStore, useSessionRuntime } from '../runtime/RuntimeProvider';
import { SessionProvider, useSessionState, useChatSessionStore } from '../sessions/SessionProvider';
import { useSessions } from '../sessions/useSessions';
import { SmsProvider } from '../information/SmsProvider';
import { SmsSettingsCard } from '../information/SmsSettingsCard';
import { FilesProvider, useFiles } from '../files/FilesProvider';
import { ProfileProvider } from '../profile/ProfileProvider';
import { DreamProvider } from '../dream/DreamProvider';
import { createNewsStore } from '../news/news-store';
import { useNews } from '../news/useNews';
import { NewsPreferencesStore } from '../news/news-preferences-store';
import { NewsPreferencesCard } from '../news/NewsPreferencesCard';
import { appendNewsQuote, newsDiscussionQuote } from '../news/discussion';
import { mainProgressLabel } from '../chat/message-delivery';
import { createBrowserStore } from '../browser/browser-store';
import { BrowserPanel } from '../browser/BrowserPanel';
import { useApprovals } from '../approvals/ApprovalProvider';
import { useJobs } from '../jobs/JobProvider';
import { useMonitors } from '../monitors/MonitorProvider';
import { useGoals } from '../goals/GoalProvider';
import { useAppUpdate } from '../update/UpdateProvider';
import { useTheme } from '../theme/ThemeProvider';
import { ThemePicker } from '../theme/ThemePicker';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { ActionButton } from '../ui/ActionButton';
import { Sheet } from '../ui/Sheet';
import { spacing, workspaceTheme } from '../ui/tokens';
import { ConnectionPanel } from './ConnectionPanel';
import { ConversationHost } from './ConversationHost';
import { PageHeader } from './PageHeader';
import { PrimaryTabBar } from './PrimaryTabBar';
import { SessionSettings } from './SessionSettings';
import { SessionPanel, type SessionTab } from './SessionPanel';
import { ResetSessionDialog } from './ResetSessionDialog';
import { NewsPage, NewsSourcesPage } from './NewsPage';
import { MemoryPanel } from './MemoryPanel';
import { ProfilePanel } from './ProfilePanel';
import { DreamPanel } from './DreamPanel';
import { GoalsPanel } from './GoalsPanel';
import { FilesScreen } from './FilesScreen';
import { SchedulePanel } from './SchedulePanel';
import { SettingsHome, SETTINGS_PAGE_TITLES, type SettingsPage } from './SettingsHome';
import { MuseCompanion } from './MuseCompanion';
import { COMPANION_OUTCOME_MS, companionState } from './companion-state';
import { filesBackAction } from './settings-navigation';
import { isRootWorkspacePage, notificationContinuationNotice, chatReturnForEntry, type ChatReturn, type PrimaryTabId } from './primary-nav';


/** 换服务器才销毁连接子树；切换主题、页面与会话不停止隐藏中的聊天流。 */
export function WorkspaceScreen() {
  const connection = useConnection(true); const [connectionOpen, setConnectionOpen] = useState(false);
  const openConnection = useCallback(() => setConnectionOpen(true), []);
  const value = useMemo(() => ({ snapshot: connection.snapshot, enabled: connection.enabled,
    retry: () => { void connection.manager.retry(); }, changeServer: openConnection,
  }), [connection.snapshot, connection.enabled, connection.manager, openConnection]);
  return <ConnectionProvider value={value}>
    {connection.client && connection.snapshot.workspaceReady
      ? <ApiProvider client={connection.client} key={connection.snapshot.workspaceKey}><DreamProvider><ProfileProvider><SessionProvider><RuntimeProvider><SmsProvider><FilesProvider><ConnectedWorkspace openConnection={openConnection} /></FilesProvider></SmsProvider></RuntimeProvider></SessionProvider></ProfileProvider></DreamProvider></ApiProvider>
      : <DisconnectedWorkspace openConnection={openConnection} />}
    {connectionOpen && <ConnectionPanel manager={connection.manager} snapshot={connection.snapshot} onClose={() => setConnectionOpen(false)} />}
  </ConnectionProvider>;
}
function DisconnectedWorkspace({ openConnection }: { openConnection: () => void }) {
  const [tab, setTab] = useState<PrimaryTabId>('messages'); const [appearanceOpen, setAppearanceOpen] = useState(false);
  const { colors } = useTheme(); const update = useAppUpdate();
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab !== 'settings' || !appearanceOpen) return false;
      setAppearanceOpen(false); return true;
    });
    return () => sub.remove();
  }, [tab, appearanceOpen]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}><ThemeStatusBar />
    {tab === 'settings' ? appearanceOpen ? <>
      <PageHeader title="外观主题" backLabel="返回设置" onBack={() => setAppearanceOpen(false)} />
      <ScrollView contentContainerStyle={{ padding: spacing[20] }}><ThemePicker /></ScrollView>
    </> : <SettingsHome notice="尚未连接服务器，助手与资料设置需先连接；外观和应用更新可独立使用。"
      onOpen={(target) => { if (target === 'appearance') setAppearanceOpen(true); else openConnection(); }}
      onConnection={openConnection} onBrowser={openConnection} onUpdate={update?.open} /> :
      <View style={{ flex: 1, padding: spacing[24], justifyContent: 'center', alignItems: 'center', gap: spacing[16] }}><MuseCompanion state="idle" size={88} offline />
        <Text style={{ ...workspaceTheme.typography.section, color: colors.ink }}>{tab === 'news' ? '新闻' : '消息'}</Text>
        <Text style={{ color: colors.muted, textAlign: 'center' }}>连接自己的 Pi Muse 服务器后开始聊天或阅读新闻。</Text><ActionButton label="服务器连接" onPress={openConnection} />
      </View>}
    {!(tab === 'settings' && appearanceOpen) && <PrimaryTabBar currentTab={tab} onSelectTab={(next) => { setAppearanceOpen(false); setTab(next); }} />}
  </SafeAreaView>;
}
function ConnectedWorkspace({ openConnection }: { openConnection: () => void }) {
  const api = useApi(); const insets = useSafeAreaInsets(); const connection = useServiceConnection(); const directory = useSessions(); const store = directory.store; const chats = useChatSessionStore();
  const { colors } = useTheme(); const update = useAppUpdate(); const runtime = useRuntimeStore(); const approvals = useApprovals();
  const { store: files } = useFiles(); const { store: jobs } = useJobs(); const { store: monitors } = useMonitors(); const { store: goals } = useGoals();
  const [news] = useState(() => createNewsStore(api)); const newsState = useNews(news).snapshot; const [newsPreferences] = useState(() => new NewsPreferencesStore(api));
  const [browser] = useState(() => createBrowserStore(api, connection?.snapshot.serverUrl ?? '')); const [browserOpen, setBrowserOpen] = useState(false);
  const [page, setPage] = useState<PrimaryTabId>('messages'); const [chatReturn, setChatReturn] = useState<ChatReturn>('messages');
  // 新近终态：运行从 running 回落时短时驱动成功/失败/停止姿态，随后清除；setState 全部异步调度避免级联渲染。
  const [recentOutcome, setRecentOutcome] = useState<'succeeded' | 'failed' | 'cancelled'>();
  const currentState = useSessionState('main'); const mainRuntime = useSessionRuntime('main'); const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const wasRunning = useRef(false);
  useEffect(() => {
    const falling = wasRunning.current && !mainRuntime.running;
    wasRunning.current = mainRuntime.running;
    if (!falling) return;
    const outcome = mainRuntime.runs.at(-1)?.status;
    if (outcome !== 'succeeded' && outcome !== 'failed' && outcome !== 'cancelled') return;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const setTimer = setTimeout(() => {
      setRecentOutcome(outcome);
      clearTimer = setTimeout(() => setRecentOutcome(undefined), COMPANION_OUTCOME_MS);
    }, 0);
    return () => { clearTimeout(setTimer); if (clearTimer) clearTimeout(clearTimer); };
  }, [mainRuntime.running, mainRuntime.runs]);
  const [newsManaging, setNewsManaging] = useState(false); const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [resetTarget, setResetTarget] = useState<string>(); const [resetError, setResetError] = useState<string>();
  const [sessionTab, setSessionTab] = useState<SessionTab>('activity'); const [panelOpen, setPanelOpen] = useState(false);
  const [refreshVersions, setRefreshVersions] = useState<Record<string, number>>({});
  const refresh = useCallback((id: string) => { void store.reload(); goals.invalidate(); setRefreshVersions((old) => ({ ...old, [id]: (old[id] ?? 0) + 1 })); }, [store, goals]);
  useEffect(() => {
    news.setActive(AppState.currentState === 'active'); newsPreferences.setActive(AppState.currentState === 'active'); const sub = AppState.addEventListener('change', (state) => { news.setActive(state === 'active'); newsPreferences.setActive(state === 'active'); });
    return () => { sub.remove(); news.dispose(); newsPreferences.dispose(); browser.dispose(); };
  }, [news, newsPreferences, browser]);
  useEffect(() => { if (page === 'news' || settingsPage === 'news-sources') news.open(); else news.close(); }, [news, page, settingsPage]);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false)); return () => { show.remove(); hide.remove(); };
  }, []);
  // main 由服务端常驻保证；进入主聊天不等待会话目录，历史错误由聊天视图展示。
  const openMain = (source: 'messages' | 'news' | 'notification') => {
    setChatReturn(chatReturnForEntry(source)); setSettingsPage(null); setPage('messages'); Keyboard.dismiss();
  };
  const returnToArticle = () => { Keyboard.dismiss(); setChatReturn('messages'); setPage('news'); };
  const backSettings = () => {
    if (settingsPage === 'files') {
      const action = filesBackAction(files.getSnapshot());
      if (action === 'locked') { Alert.alert('文件操作未收口', '请先回读核对，不能通过返回解除锁定。'); return; }
      if (action === 'preview') { files.cancelSavePreview(); return; } if (action === 'delete') { files.cancelDelete(); return; }
      if (action === 'draft') { Alert.alert('文件草稿尚未保存', '保留在当前连接中，或明确丢弃。', [{ text: '继续编辑', style: 'cancel' }, { text: '保留并返回', onPress: () => setSettingsPage(null) }, { text: '丢弃修改', style: 'destructive', onPress: files.cancelEditor }]); return; }
      if (action === 'detail') { files.closeFile(); return; } if (action === 'directory') { files.goUp(); return; }
    }
    if (settingsPage === 'goals' && goals.getSnapshot().creator) { if (!goals.getSnapshot().writing) goals.cancelCreate(); return; } setSettingsPage(null);
  };
  const back = () => {
    if (keyboardVisible) { Keyboard.dismiss(); return true; } if (browserOpen) { browser.close(); setBrowserOpen(false); return true; }
    if (panelOpen) { setPanelOpen(false); return true; } if (settingsPage) { backSettings(); return true; }
    if (page === 'news' && newsState.selectedArticleId) { news.closeArticle(); return true; } if (page === 'news' && newsManaging) { setNewsManaging(false); return true; }
    if (page === 'messages' && chatReturn === 'news') { returnToArticle(); return true; } return false;
  };
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', back); return () => sub.remove(); });
  const checkReset = async () => {
    try { await chats.verifyReset('main'); } catch (error) { setNotice(error instanceof Error ? error.message : '重置结果核对失败'); }
  };
  let settingsContent: ReactNode;
  // 过程只集中到形象；仅统计当前主聊天的审批，断线不把缓存当成新事实。
  const mainPendingApprovals = approvals.snapshot.pendingIds
    .filter((id) => approvals.snapshot.records[id]?.sessionId === 'main' && approvals.snapshot.records[id]?.status === 'pending').length;
  const mainStatusLabel = mainProgressLabel({
    synchronized: mainRuntime.synchronized,
    running: mainRuntime.running,
    label: mainRuntime.label,
    pendingApprovals: mainPendingApprovals,
    pending: currentState.pendingSubmission?.status,
    runObserved: mainRuntime.runs.some((run) => run.runId === currentState.pendingSubmission?.runId),
  });
  // 形象状态机直接消费同一路运行事实；终态姿态只在新近结束时短暂出现。
  const activeRun = mainRuntime.runs.find((run) => run.status === 'running');
  const companion = companionState({
    synchronized: mainRuntime.synchronized,
    running: mainRuntime.running,
    phase: activeRun?.phase ?? null,
    pendingApprovals: mainPendingApprovals,
    pendingStatus: currentState.pendingSubmission?.status,
    lastOutcome: !mainRuntime.running && recentOutcome ? recentOutcome : undefined,
  });
  if (settingsPage === 'appearance') settingsContent = <ThemePicker />;
  else if (settingsPage === 'news-preferences') settingsContent = <NewsPreferencesCard store={newsPreferences} />;
  else if (settingsPage === 'profile') settingsContent = <ProfilePanel />;
  else if (settingsPage === 'memory') settingsContent = <MemoryPanel />;
  else if (settingsPage === 'dream') settingsContent = <DreamPanel />;
  else if (settingsPage === 'sms') settingsContent = <SmsSettingsCard />;
  else if (settingsPage === 'goals') settingsContent = <GoalsPanel />;
  else if (settingsPage === 'jobs' || settingsPage === 'monitors') settingsContent = <SchedulePanel kind={settingsPage} />;
  else if (settingsPage === 'rules' || settingsPage === 'skills') settingsContent = <><Text style={{ color: colors.muted }}>主聊天</Text><SessionSettings sessionId="main" section={settingsPage} onSaved={() => refresh('main')} /></>;
  else if (settingsPage === 'activity') settingsContent = <SessionPanel sessionId="main" tab={sessionTab} onTab={setSessionTab} />;
  const rootSettings = <SettingsHome onOpen={setSettingsPage} onConnection={openConnection}
    onBrowser={() => { Keyboard.dismiss(); browser.open(); setBrowserOpen(true); }} onUpdate={update?.open} />;
  const otherPage = page === 'settings' ? settingsPage === 'files' ? <FilesScreen onBack={backSettings} /> : settingsPage === 'news-sources' ? <NewsSourcesPage store={news} onBack={backSettings} />
      : settingsPage ? <><PageHeader title={SETTINGS_PAGE_TITLES[settingsPage]} backLabel="返回设置" onBack={backSettings} />
        {settingsPage === 'goals' || settingsPage === 'activity' ? settingsContent : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing[20], gap: spacing[12] }}>{settingsContent}</ScrollView>}</> : rootSettings : null;
  const root = isRootWorkspacePage({ page, settingsSubpage: settingsPage, newsDetailOpen: !!newsState.selectedArticleId, newsManaging, sessionMounted: panelOpen || browserOpen || !!resetTarget });
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} testID="workspace-screen"><ThemeStatusBar />
    {/* 键盘 screenY 是窗口坐标，避让布局在 SafeAreaView 内；补上顶部安全区才能对齐，不能在 composer 再减一次键盘高度。 */}
    <View style={{ flex: 1 }} pointerEvents={browserOpen ? 'none' : 'auto'} accessibilityElementsHidden={browserOpen} importantForAccessibility={browserOpen ? 'no-hide-descendants' : 'auto'}><KeyboardAvoidingView style={{ flex: 1 }} keyboardVerticalOffset={insets.top} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
      {page === 'messages' && <>
        {/* 形象居中：状态机驱动企鹅姿态与动效，操作入口收在形象点击里。 */}
        <View style={{ alignItems: 'center', paddingVertical: spacing[12], gap: spacing[4] }}>
          <MuseCompanion state={companion} size={64} offline={!mainRuntime.synchronized}
            onPress={() => { Keyboard.dismiss(); setSessionTab('activity'); setPanelOpen(true); }} testID="workspace-avatar-status" />
          <Text numberOfLines={1} style={{ color: colors.muted, ...workspaceTheme.typography.caption }}>{mainStatusLabel}</Text>
        </View>
        {chatReturn === 'news' && <ActionButton label="返回文章" onPress={returnToArticle} />}
      </>}
      <View style={{ flex: 1, display: page === 'news' ? 'none' : 'flex' }}><ConversationHost chatVisible={page === 'messages'} otherPage={otherPage} refreshVersions={refreshVersions}
        onSettled={refresh} onBindingMismatch={store.reload} openConnection={openConnection} onOpenApprovals={() => { setSessionTab('approvals'); setPanelOpen(true); }} onContinueNotification={(reference) => {
          const unavailable = notificationContinuationNotice(reference.sessionId);
          if (unavailable) { setNotice(unavailable); return; }
          if (!chats.canWrite('main')) { setNotice('主聊天正在维护或结果待核对，暂不能追加通知引用。'); return; }
          chats.setDraft('main', appendNewsQuote(chats.get('main').draft, `请继续处理这条来源通知（消息 ID：${reference.messageId}）。`)); openMain('notification');
        }} /></View>
      <View style={{ flex: 1, display: page === 'news' ? 'flex' : 'none' }} pointerEvents={page === 'news' ? 'auto' : 'none'} accessibilityElementsHidden={page !== 'news'} importantForAccessibility={page === 'news' ? 'auto' : 'no-hide-descendants'}>
        <NewsPage store={news} visible={page === 'news'} managing={newsManaging} onManaging={setNewsManaging} onDiscuss={(id) => {
          const snapshot = news.getSnapshot(); const article = snapshot.article?.id === id ? snapshot.article : snapshot.articles.find((item) => item.id === id);
          if (!article) { setNotice('文章已不存在，请刷新核对。'); return; }
          if (!chats.canWrite('main')) { setNotice('主聊天正在维护或结果待核对，暂不能追加文章引用。'); return; }
          chats.setDraft('main', appendNewsQuote(chats.get('main').draft, newsDiscussionQuote(article))); openMain('news');
        }} />
      </View>
      {notice && <View style={{ padding: spacing[12] }}><Text accessibilityRole="alert" style={{ color: colors.warning }}>{notice}</Text><ActionButton label="关闭提示" onPress={() => setNotice(undefined)} /></View>}
      {!keyboardVisible && root && <PrimaryTabBar currentTab={page} onSelectTab={(tab) => { Keyboard.dismiss(); setChatReturn('messages'); setSettingsPage(null); setPage(tab); }} />}
    </KeyboardAvoidingView></View>
    {panelOpen && <Sheet title="主聊天操作" onClose={() => setPanelOpen(false)}>
      <ActionButton label="重置会话" disabled={currentState.resetting || currentState.resetUncertain} onPress={() => { setResetError(undefined); setPanelOpen(false); setResetTarget('main'); }} />
      {currentState.resetUncertain && <ActionButton label="回读核对会话操作" onPress={() => void checkReset()} />}{currentState.resetUncertain && currentState.resetReviewed && <ActionButton label="已核对重置结果，恢复此会话" onPress={() => chats.acknowledgeReset('main')} />}
      <ActionButton label="编辑此会话指令" onPress={() => { setPanelOpen(false); setPage('settings'); setSettingsPage('rules'); }} /><ActionButton label="管理此会话技能" onPress={() => { setPanelOpen(false); setPage('settings'); setSettingsPage('skills'); }} />
      <View style={{ minHeight: 300 }}><SessionPanel sessionId="main" tab={sessionTab} onTab={setSessionTab} /></View>
    </Sheet>}
    {resetTarget && <ResetSessionDialog sessionId={resetTarget} available={!!connection?.enabled} error={resetError} onCancel={() => setResetTarget(undefined)} onConfirm={async (id, clearSchedules) => {
      try { const result = await chats.resetSession(id, clearSchedules); if (!result) return; store.update(result.session); runtime.forgetSession(id); jobs.invalidate(); monitors.invalidate(); await approvals.store.refreshPending(); setResetTarget(undefined); refresh(id); }
      catch (error) { setResetError(error instanceof Error ? error.message : '重置失败'); }
    }} />}
    {browserOpen && <BrowserPanel store={browser} baseUrl={connection?.snapshot.serverUrl ?? ''} onClose={() => { browser.close(); setBrowserOpen(false); }} />}
  </SafeAreaView>;
}
