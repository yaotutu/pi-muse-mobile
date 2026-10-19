/**
 * 全屏当前会话面板；同层 Tab 切换不重建会话。
 *
 * 边界：不持服务端/存储；仅消费 props；切 Tab 不重建 Modal/Header；
 * 颜色来自 WorkspaceTheme context（亮/暗双套），布局/字号/圆角仍取 src/ui/tokens.ts 的 workspaceTheme 静态值。
 */

import { useMemo, type ReactNode } from 'react';
import {
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
  Bot,
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
import { CurrentExecution } from './CurrentExecution';
import { MAIN_THREAD } from '../threads/thread-state';

export type SessionTab = 'activity' | 'approvals' | 'workspace' | 'history';

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

export interface SessionPanelProps {
  threadId: string;
  threadName: string;
  status: string;
  tab: SessionTab;
  onTab: (tab: SessionTab) => void;
  onClose: () => void;
  onDelete?: () => void;
  onSettled?: () => void;
  settings?: ReactNode;
  deleting?: boolean;
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
      alignItems: 'center',
      justifyContent: 'center',
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
  threadId,
  threadName,
  status,
  tab,
  onTab,
  onClose,
  onDelete,
  onSettled,
  settings,
  deleting,
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
                <Bot size={workspaceTheme.layout.sessionAvatar / 2} color={colors.ink} strokeWidth={1.5} />
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {threadName}
              </Text>
              <Text style={styles.status} numberOfLines={1}>
                {status}
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
            {tab === 'activity' && <CurrentExecution threadId={threadId} onSettled={onSettled} />}
            {tab === 'approvals' && <EmptyState text="审批尚未接入；当前执行中的等待审批状态仍可查看。" />}
            {tab === 'workspace' && <>
              {settings}
              <EmptyState text="工作区文件尚未接入" />
              {threadId !== MAIN_THREAD && onDelete && <Pressable accessibilityRole="button" accessibilityLabel="删除当前会话"
                disabled={deleting} onPress={onDelete} style={styles.card}>
                <Text style={[styles.rowTitle, { color: colors.danger }]}>{deleting ? '正在删除会话…' : '删除当前会话'}</Text>
                <Text style={styles.rowDetail}>删除此会话及其绑定的定时任务与监控，不可恢复。</Text>
              </Pressable>}
            </>}
            {tab === 'history' && <EmptyState text="活动与执行历史尚未接入；聊天记录已在聊天页同步。" />}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
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
