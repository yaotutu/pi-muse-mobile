/**
 * App 骨架： 4 tab 状态机 + 顶栏 + 底部 pill tab bar + Sheet 层。
 *
 * 职责边界：
 * - 无导航库（技术定稿）：View 状态机切换四个页面，详情/弹层走 Sheet。
 * - 布局对照 OpenMuse App.tsx 的 WorkspaceShell 模式（顶栏三段式、
 *   内容区居中窄栏、底部悬浮胶囊 tab bar），视觉常量全部取自 tokens。
 * - 快照与会话由 App 注入真实 HTTP 数据；本组件仅负责界面状态。
 */

import {
  Bell,
  Menu,
  MessageCircle,
  PanelsTopLeft,
  type LucideIcon,
  Shapes,
  SquareCheck,
} from 'lucide-react-native';
import { useState } from 'react';
import { Avatar } from '../ui/Avatar';
import { ConnectionBanner } from '../connection/ConnectionBanner';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { DemoBanner } from '../demo/DemoBanner';
import { useDemo } from '../demo/DemoProvider';
import {
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityScreen } from '../activity/ActivityScreen';
import { ApprovalsSheet } from '../approvals/ApprovalsSheet';
import { AppsScreen } from '../apps/AppsScreen';
import { ChatScreen } from '../chat/ChatScreen';
import { GoalsScreen } from '../goals/GoalsScreen';
import type { ThreadInfo, WorkspaceSnapshot } from '../api/types';
import { ErrorNotice } from '../ui/Feedback';
import { IconButton } from '../ui/Buttons';
import { ThreadsSheet } from '../threads/ThreadsSheet';
import { useApprovalDecisions } from '../approvals/useApprovalDecisions';
import { colors, layout, radius, shadows, sizing, spacing, typography } from '../ui/tokens';
import { useUiStore, type TabView } from '../ui/ui-store';

/** 四个主 tab（技术定稿：状态机切换，不引导航库）。HANDOFF 原文称 View，因与 RN View 重名改为 TabView。 */
export type { TabView };

const NAV: { id: TabView; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: '聊天', icon: MessageCircle },
  { id: 'activity', label: '任务', icon: PanelsTopLeft },
  { id: 'goals', label: '目标', icon: SquareCheck },
  { id: 'apps', label: '应用', icon: Shapes },
];

/** 非 chat 页的标题与副标题（chat 页顶栏直接展示 agent 名） */
const PAGE_TITLES: Record<Exclude<TabView, 'chat'>, { title: string; subtitle: string }> = {
  activity: { title: '任务', subtitle: '定时任务、后台任务与网页监控。' },
  goals: { title: '目标', subtitle: '长期目标、里程碑与进度。' },
  apps: { title: '应用', subtitle: '助手身份、记忆与人设。' },
};

/**
 * 主界面骨架：顶栏（汉堡 / agent 名+状态 / 铃铛）+ 当前 tab 页 + 底部 tab bar。
 * 顶栏数据（agent 名/状态行/审批未读）与工作台三页共用快照轮询结果。
 */
export function AppShell({
  snapshot,
  snapshotError,
  refresh,
  threads,
  currentThread,
  onSelectThread,
  onCreateThread,
  threadsError,
  reloadThreads,
  onDemo,
  onPreview,
}: {
  /** /api/agent 快照（App 层轮询下发）；未就绪时顶栏回落默认文案 */
  snapshot: WorkspaceSnapshot | undefined;
  snapshotError?: string;
  /** 操作后立即刷新快照（不等下一个轮询周期） */
  refresh: () => void;
  threads: ThreadInfo[];
  currentThread: string;
  onSelectThread: (id: string) => void;
  onCreateThread: () => void;
  threadsError?: string;
  reloadThreads: () => void;
  onDemo: () => void;
  onPreview: () => void;
}) {
  const view = useUiStore((s) => s.currentTab);
  const setView = useUiStore((s) => s.setCurrentTab);
  const threadsOpen = useUiStore((s) => s.threadsOpen);
  const setThreadsOpen = useUiStore((s) => s.setThreadsOpen);
  const approvalsOpen = useUiStore((s) => s.approvalsOpen);
  const setApprovalsOpen = useUiStore((s) => s.setApprovalsOpen);
  const demo = useDemo();
  const connection = useServiceConnection();
  const { notifications: liveNotifications, recordDecision } = useApprovalDecisions(snapshot?.notifications);
  const notifications = demo ? [...(snapshot?.notifications ?? []), ...demo.client.approvalHistory()] : liveNotifications;
  const [chatRunning, setChatRunning] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktopBreakpoint;

  const pendingCount = notifications.filter((n) => n.status === 'pending').length;
  const runningTask = snapshot?.tasks.find((t) => t.status === 'running');
  const agentName = snapshot?.identity.name ?? 'Pi Muse';
  const statusText = pendingCount > 0
    ? `${pendingCount} 项待审批`
    : runningTask
      ? `任务进行中 · ${runningTask.title}`
      : chatRunning ? '思考中…' : snapshot ? '随时在这里，陪你完成下一步' : '连接中…';

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.column} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} enabled={Platform.OS !== 'web'}>
        {/* 顶栏：左汉堡（会话 Sheet）/ 中 agent 名+状态 / 右铃铛（未读点） */}
        <View style={[styles.topBar, { height: desktop ? layout.topBarDesktopHeight : layout.topBarHeight, paddingTop: desktop ? spacing[14] : spacing.xxs }]}>
          <View style={styles.topBarLeft}>
            <IconButton icon={Menu} label="打开会话列表" onPress={() => setThreadsOpen(true)} />
          </View>
          <Pressable accessibilityRole="button" accessibilityHint="查看任务与进展" onPress={() => setView('activity')} style={styles.topBarCenter}>
            <Avatar variant={snapshot?.identity.avatar} size={desktop ? sizing.avatarDesktop : sizing.avatar} />
            <Text style={styles.agentName} numberOfLines={1}>{agentName}</Text>
            <Text style={{ ...typography.small, color: colors.muted, marginBottom: spacing[6] }} numberOfLines={1}>{statusText}</Text>
          </Pressable>
          <View style={styles.topBarRight}>
            <IconButton
              icon={Bell}
              label={`通知，${pendingCount} 项待处理`}
              onPress={() => setApprovalsOpen(true)}
            />
            {pendingCount > 0 && <View style={styles.unreadDot} pointerEvents="none" />}
          </View>
        </View>

        <DemoBanner />
        <ConnectionBanner />
        <ErrorNotice error={snapshotError && !['offline', 'connecting'].includes(connection?.snapshot.status ?? '') ? `工作区刷新失败：${snapshotError}` : undefined} />
        {/* 单会话 chat 在 tab 间常驻；切换 thread 用 key 卸载，阻断旧流回写。 */}
        <View style={{ flex: 1, minHeight: 0 }}>
          {view !== 'chat' && (
            <ScrollView
              key={view}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingHorizontal: desktop ? layout.contentDesktopPadding : layout.contentPadding,
                paddingBottom: spacing[28],
              }}
            >
              <Text style={{ ...typography.pageTitle, fontWeight: '600', color: colors.ink, marginBottom: spacing.xl }}>{PAGE_TITLES[view].title}</Text>
              {!snapshot && <Text style={{ ...typography.muted, color: colors.muted }}>{snapshotError ? '暂时无法连接工作区，请重试刷新。' : '正在载入工作区…'}</Text>}
              {snapshot && view === 'activity' && <ActivityScreen snapshot={snapshot} refresh={refresh} />}
              {snapshot && view === 'goals' && <GoalsScreen snapshot={snapshot} refresh={refresh} />}
              {view === 'apps' && <AppsScreen snapshot={snapshot} refresh={refresh} onPreview={onPreview} />}
            </ScrollView>
          )}
          <View
            style={{
              display: view === 'chat' ? 'flex' : 'none',
              flex: 1,
              paddingHorizontal: desktop ? layout.contentDesktopPadding : layout.chatPadding,
            }}
          >
            <ChatScreen key={currentThread} threadId={currentThread} onRunningChange={setChatRunning}
              toolActions={{ onNavigate: setView, onOpenApprovals: () => setApprovalsOpen(true) }} />
          </View>
        </View>

        {/* 底部悬浮 pill tab bar（OpenMuse 同款白胶囊软阴影） */}
        <View style={[styles.tabBarWrap, desktop && { paddingBottom: spacing.xl }]}>
          <View accessibilityRole="tablist" accessibilityLabel="主要页面" style={styles.tabBar}>
            {NAV.map((item) => {
              const active = view === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityLabel={item.label}
                  aria-selected={active}
                  onPress={() => setView(item.id)}
                  style={({ pressed }) => [
                    styles.tabItem,
                    active && { backgroundColor: colors.tabActive },
                    pressed && { transform: [{ scale: 0.96 }] },
                  ]}
                >
                  <item.icon size={sizing[23]} strokeWidth={1.8} color={colors.ink} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Sheet 层：会话列表 + 审批队列 */}
      {approvalsOpen && (
        <ApprovalsSheet
          notifications={notifications}
          onDecided={recordDecision}
          onClose={() => setApprovalsOpen(false)}
          refresh={refresh}
        />
      )}
      {threadsOpen && (
        <ThreadsSheet threads={threads} currentThread={currentThread}
          error={threadsError} onRetry={reloadThreads} onNavigate={setView} refresh={refresh} onDemo={onDemo}
          onClose={() => setThreadsOpen(false)}
          onSelectThread={(id) => { onSelectThread(id); setView('chat'); }}
          onCreateThread={() => { onCreateThread(); setView('chat'); }} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.canvas },
  column: { flex: 1, width: layout.fullWidth, maxWidth: layout.contentMaxWidth, alignSelf: 'center' },

  topBar: {
    marginHorizontal: spacing[20],
  },
  topBarLeft: { position: 'absolute', top: spacing.lg, left: 0, zIndex: 1 },
  topBarRight: { position: 'absolute', top: spacing.lg, right: 0, zIndex: 1 },
  topBarCenter: { alignItems: 'center', gap: spacing[1], alignSelf: 'center', width: layout.topBarTitleWidth },
  agentName: { ...typography.heading, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  unreadDot: {
    width: sizing[6],
    height: sizing[6],
    borderRadius: radius[4],
    position: 'absolute',
    top: spacing[7],
    right: spacing[9],
    backgroundColor: colors.accent,
  },

  tabBarWrap: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing[10],
    paddingBottom: spacing[7],
    alignItems: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    width: layout.fullWidth,
    maxWidth: layout.tabBarMaxWidth,
    padding: spacing[5],
    backgroundColor: colors.card,
    borderRadius: radius.tab,
    ...shadows.tabBar,
    borderWidth: sizing.borderWidth,
    borderColor: colors.tabBarLine,
  },
  tabItem: {
    flex: 1,
    height: sizing[47],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.tabItem,
  },

});
