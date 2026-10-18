/**
 * 全屏当前会话面板；同层 Tab 切换不重建会话。
 *
 * 边界：不持服务端/存储；仅消费 props；切 Tab 不重建 Modal/Header；
 * 颜色来自 WorkspaceTheme context（亮/暗双套），布局/字号/圆角仍取 src/ui/tokens.ts 的 workspaceTheme 静态值。
 */

import { useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { LucideIcon } from 'lucide-react-native';
import {
  Check,
  Clock,
  List,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react-native';

import { workspaceTheme, sizing, spacing, type WorkspaceColors } from '../ui/tokens';
import { useWorkspaceTheme } from './WorkspaceTheme';
import type {
  SampleActivity,
  SampleApproval,
  SampleFile,
  SampleHistory,
  SessionTab,
  SampleThread,
} from './sample-state';

const TAB_ORDER: readonly SessionTab[] = ['activity', 'approvals', 'workspace', 'history'] as const;

const TAB_ICONS: Record<SessionTab, LucideIcon> = {
  activity: List,
  approvals: ShieldCheck,
  workspace: Monitor,
  history: Clock,
};

const TAB_LABELS: Record<SessionTab, string> = {
  activity: '动态',
  approvals: '审批',
  workspace: '工作区',
  history: '历史',
};

const TAB_NOTICE: Record<SessionTab, string> = {
  activity: '示例数据 · 尚未连接服务端',
  approvals: '本地示例 · 不会真正授权',
  workspace: '示例文件，仅用于布局演示',
  history: '示例历史 · 不计入统计',
};

const AVATAR_SOURCE: ImageSourcePropType = require('../../assets/sample/reference-avatar.png');

export interface SessionPanelProps {
  thread: SampleThread;
  tab: SessionTab;
  onTab: (tab: SessionTab) => void;
  onClose: () => void;
  onDecide: (id: string, decision: 'approved' | 'denied') => void;
  reducedMotion: boolean;
}

// 子组件共用：读 context -> useMemo 出当前主题下的 StyleSheet。颜色覆盖来自 WorkspaceTheme，布局/字号仍走 workspaceTheme 静态值。
function usePanelStyles() {
  const { colors } = useWorkspaceTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

function createStyles(colors: WorkspaceColors) {
  const tabInnerHeight =
    workspaceTheme.layout.sessionTabsHeight - workspaceTheme.layout.sessionTabInset * 2;
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.canvas,
    },
    column: {
      flex: 1,
      width: '100%',
      maxWidth: workspaceTheme.layout.maxWidth,
      alignSelf: 'center',
    },

    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: workspaceTheme.layout.sidePadding,
      paddingTop: workspaceTheme.layout.sessionTop,
      paddingBottom: workspaceTheme.layout.sessionHeaderBottom,
    },
    headerSideButton: {
      width: workspaceTheme.layout.controlSize,
      height: workspaceTheme.layout.controlSize,
      borderRadius: workspaceTheme.layout.controlSize / 2,
      backgroundColor: colors.control,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xs,
    },
    headerCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-start',
    },
    avatarRing: {
      width: workspaceTheme.layout.sessionAvatar,
      height: workspaceTheme.layout.sessionAvatar,
      borderRadius: workspaceTheme.layout.sessionAvatar / 2,
      backgroundColor: colors.avatar,
      overflow: 'hidden',
    },
    avatar: {
      width: '100%',
      height: '100%',
    },
    name: {
      marginTop: workspaceTheme.layout.sessionNameTop,
      ...workspaceTheme.typography.heroName,
      color: colors.ink,
    },
    status: {
      marginTop: spacing.xs,
      ...workspaceTheme.typography.heroStatus,
      color: colors.muted,
    },

    tablistWrap: {
      paddingHorizontal: workspaceTheme.layout.sidePadding,
      marginBottom: workspaceTheme.layout.contentTop,
    },
    tablist: {
      height: workspaceTheme.layout.sessionTabsHeight,
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: workspaceTheme.radius.tab,
      padding: workspaceTheme.layout.sessionTabInset,
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    tab: {
      flex: 1,
      height: tabInnerHeight,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tabInnerHeight / 2,
    },
    tabSelected: {
      backgroundColor: colors.selected,
    },

    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: workspaceTheme.layout.sidePadding,
      paddingBottom: workspaceTheme.layout.sessionHeaderBottom,
    },

    section: {
      ...workspaceTheme.typography.section,
      color: colors.ink,
      fontWeight: '600',
    },
    sampleLabel: {
      ...workspaceTheme.typography.caption,
      color: colors.faint,
      marginTop: workspaceTheme.layout.sampleLabelTop,
      marginBottom: spacing.lg,
    },

    timelineRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: workspaceTheme.layout.listItemGap,
    },
    timelineIcon: {
      width: workspaceTheme.layout.timelineIconWidth,
      height: workspaceTheme.layout.timelineIconWidth,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.md,
    },
    rowBody: {
      flex: 1,
    },
    rowTitle: {
      ...workspaceTheme.typography.itemTitle,
      color: colors.ink,
      fontWeight: '500',
    },
    rowDetail: {
      ...workspaceTheme.typography.detail,
      color: colors.muted,
      marginTop: spacing.xxs,
    },
    rowTime: {
      ...workspaceTheme.typography.detail,
      color: colors.faint,
      marginTop: spacing.xs,
    },

    card: {
      backgroundColor: colors.surface,
      borderRadius: workspaceTheme.radius.card,
      padding: workspaceTheme.layout.sidePadding,
      marginBottom: workspaceTheme.layout.listItemGap,
    },
    approvalButtons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: spacing.md,
      gap: spacing.sm,
    },
    approvalButton: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: workspaceTheme.radius.round,
      minHeight: workspaceTheme.layout.smallControl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    approvalButtonDeny: {
      backgroundColor: 'transparent',
      borderWidth: sizing.borderWidth,
      borderColor: colors.danger,
    },
    approvalButtonDenyText: {
      color: colors.danger,
      ...workspaceTheme.typography.detail,
      fontWeight: '500',
    },
    approvalButtonApprove: {
      backgroundColor: colors.blue,
    },
    approvalButtonApproveText: {
      // 蓝底按钮字色固定白，不随 ink 翻转；WorkspaceColors.onAccent 由 WorkspaceTheme 提供。
      color: colors.onAccent,
      ...workspaceTheme.typography.detail,
      fontWeight: '600',
    },
    approvalState: {
      marginTop: spacing.md,
      color: colors.faint,
      ...workspaceTheme.typography.detail,
    },

    historyRow: {
      paddingVertical: spacing.md,
      marginBottom: spacing.sm,
      borderBottomWidth: sizing.borderWidth,
      borderBottomColor: colors.line,
    },

    emptyBox: {
      paddingVertical: spacing.xl,
      alignItems: 'center',
    },
    emptyText: {
      color: colors.faint,
      ...workspaceTheme.typography.detail,
    },
  });
}

export function SessionPanel({
  thread,
  tab,
  onTab,
  onClose,
  onDecide,
  reducedMotion,
}: SessionPanelProps) {
  const styles = usePanelStyles();
  const { mode, toggle, colors } = useWorkspaceTheme();

  // Web 类型约束：RN View 类型不包含 onKeyDown，必须以断言方式注入；原生端忽略。
  const webKeyProps = useMemo(() => {
    if (Platform.OS !== 'web') return null;
    return {
      onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
        const key = (event?.key ?? '').toString();
        if (
          key !== 'ArrowLeft' &&
          key !== 'ArrowRight' &&
          key !== 'Home' &&
          key !== 'End'
        ) {
          return;
        }
        event.preventDefault?.();
        const idx = TAB_ORDER.indexOf(tab);
        if (idx < 0) return;
        let next = idx;
        if (key === 'ArrowLeft') next = (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
        else if (key === 'ArrowRight') next = (idx + 1) % TAB_ORDER.length;
        else if (key === 'Home') next = 0;
        else next = TAB_ORDER.length - 1;
        onTab(TAB_ORDER[next]);
      },
    };
  }, [tab, onTab]);

  // 亮色面板需要暗字 statusBar；暗色面板需要亮字。主题切换不卸载 Modal（依赖 provider，不依赖 key）。
  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';
  const isDark = mode === 'dark';
  const ThemeIcon = isDark ? Sun : Moon;
  const themeToggleLabel = isDark ? '切换到亮色主题' : '切换到暗色主题';

  return (
    <Modal
      visible
      presentationStyle="fullScreen"
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      testID="workspace-session-modal"
    >
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.column}>
          <View style={styles.header}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="关闭会话面板"
              hitSlop={spacing.md}
              style={styles.headerSideButton}
              testID="workspace-session-close"
            >
              <X
                size={workspaceTheme.layout.navigationIconSize}
                color={colors.ink}
                strokeWidth={2}
              />
            </Pressable>

            <View style={styles.headerCenter}>
              <View
                style={styles.avatarRing}
                accessibilityLabel="会话头像"
                accessibilityRole="image"
              >
                <Image source={AVATAR_SOURCE} style={styles.avatar} resizeMode="cover" />
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {thread.name}
              </Text>
              <Text style={styles.status} numberOfLines={1}>
                {'🔬 '}
                {thread.status}
              </Text>
            </View>

            <Pressable
              onPress={toggle}
              accessibilityRole="button"
              accessibilityLabel={themeToggleLabel}
              hitSlop={spacing.md}
              style={styles.headerSideButton}
              testID="workspace-session-theme-toggle"
            >
              <ThemeIcon
                size={workspaceTheme.layout.navigationIconSize}
                color={colors.ink}
                strokeWidth={2}
              />
            </Pressable>
          </View>

          <View
            accessibilityRole="tablist"
            {...((webKeyProps ?? {}) as object)}
            style={styles.tablistWrap}
          >
            <View style={styles.tablist}>
              {TAB_ORDER.map((t) => {
                const Icon = TAB_ICONS[t];
                const selected = t === tab;
                return (
                  <Pressable
                    key={t}
                    onPress={() => onTab(t)}
                    accessibilityRole="tab"
                    accessibilityLabel={TAB_LABELS[t]}
                    accessibilityState={{ selected }}
                    aria-selected={selected}
                    style={[styles.tab, selected && styles.tabSelected]}
                    testID={`workspace-session-tab-${t}`}
                  >
                    <Icon
                      size={workspaceTheme.layout.iconSize}
                      color={colors.ink}
                      strokeWidth={selected ? 2 : 1.6}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {tab === 'activity' && <ActivityPanel thread={thread} />}
            {tab === 'approvals' && (
              <ApprovalsPanel thread={thread} onDecide={onDecide} />
            )}
            {tab === 'workspace' && <WorkspacePanel thread={thread} />}
            {tab === 'history' && <HistoryPanel thread={thread} />}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ActivityPanel({ thread }: { thread: SampleThread }) {
  const styles = usePanelStyles();
  return (
    <View>
      <Text style={styles.section}>{'今天'}</Text>
      <Text style={styles.sampleLabel}>{TAB_NOTICE.activity}</Text>
      {thread.activities.length === 0 ? (
        <EmptyState text="暂无动态" />
      ) : (
        thread.activities.map((item) => (
          <ActivityRow key={item.id} item={item} />
        ))
      )}
    </View>
  );
}

function ActivityRow({ item }: { item: SampleActivity }) {
  const styles = usePanelStyles();
  const { colors } = useWorkspaceTheme();
  const isRunning = item.status === 'running';
  return (
    <View style={styles.timelineRow} accessibilityRole="text">
      <View style={styles.timelineIcon}>
        {isRunning ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : (
          <Check
            size={sizing[22]}
            color={colors.success}
            strokeWidth={2}
          />
        )}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowDetail}>{item.detail}</Text>
        <Text style={styles.rowTime}>{item.time}</Text>
      </View>
    </View>
  );
}

function ApprovalsPanel({
  thread,
  onDecide,
}: {
  thread: SampleThread;
  onDecide: SessionPanelProps['onDecide'];
}) {
  const styles = usePanelStyles();
  return (
    <View>
      <Text style={styles.section}>{'审批'}</Text>
      <Text style={styles.sampleLabel}>{TAB_NOTICE.approvals}</Text>
      {thread.approvals.length === 0 ? (
        <EmptyState text="暂无审批请求" />
      ) : (
        thread.approvals.map((item) => (
          <ApprovalRow key={item.id} item={item} onDecide={onDecide} />
        ))
      )}
    </View>
  );
}

function ApprovalRow({
  item,
  onDecide,
}: {
  item: SampleApproval;
  onDecide: SessionPanelProps['onDecide'];
}) {
  const styles = usePanelStyles();
  const decided = item.status !== 'pending';
  return (
    <View style={styles.card}>
      <Text style={styles.rowTitle}>{item.title}</Text>
      <Text style={styles.rowDetail}>{item.detail}</Text>
      {decided ? (
        <Text style={styles.approvalState}>
          {item.status === 'approved' ? '已批准' : '已拒绝'}
        </Text>
      ) : (
        <View style={styles.approvalButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`拒绝 ${item.title}`}
            onPress={() => onDecide(item.id, 'denied')}
            style={[styles.approvalButton, styles.approvalButtonDeny]}
          >
            <Text style={styles.approvalButtonDenyText}>{'拒绝'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`批准 ${item.title}`}
            onPress={() => onDecide(item.id, 'approved')}
            style={[styles.approvalButton, styles.approvalButtonApprove]}
          >
            <Text style={styles.approvalButtonApproveText}>{'批准'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function WorkspacePanel({ thread }: { thread: SampleThread }) {
  const styles = usePanelStyles();
  return (
    <View>
      <Text style={styles.section}>{'工作区'}</Text>
      <Text style={styles.sampleLabel}>{TAB_NOTICE.workspace}</Text>
      {thread.files.length === 0 ? (
        <EmptyState text="暂无文件" />
      ) : (
        thread.files.map((item) => <FileRow key={item.id} item={item} />)
      )}
    </View>
  );
}

// 仅展示假文件，不附加 onPress，避免伪造"打开文件"的副作用。
function FileRow({ item }: { item: SampleFile }) {
  const styles = usePanelStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.rowTitle}>{item.name}</Text>
      <Text style={styles.rowDetail}>{item.detail}</Text>
    </View>
  );
}

function HistoryPanel({ thread }: { thread: SampleThread }) {
  const styles = usePanelStyles();
  return (
    <View>
      <Text style={styles.section}>{'历史'}</Text>
      <Text style={styles.sampleLabel}>{TAB_NOTICE.history}</Text>
      {thread.history.length === 0 ? (
        <EmptyState text="暂无历史" />
      ) : (
        thread.history.map((item) => (
          <HistoryRow key={item.id} item={item} />
        ))
      )}
    </View>
  );
}

function HistoryRow({ item }: { item: SampleHistory }) {
  const styles = usePanelStyles();
  return (
    <View style={styles.historyRow}>
      <Text style={styles.rowTitle}>{item.title}</Text>
      <Text style={styles.rowTime}>{item.time}</Text>
      <Text style={styles.rowDetail}>{item.detail}</Text>
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  const styles = usePanelStyles();
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}
