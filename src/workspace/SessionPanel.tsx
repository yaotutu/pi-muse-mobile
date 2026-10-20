/**
 * 全屏当前会话面板；同层 Tab 切换不重建会话。
 *
 * 边界：不持服务端/存储；仅消费 props；切 Tab 不重建 Modal/Header；
 * 颜色来自 WorkspaceTheme context（亮/暗双套），布局/字号/圆角仍取 src/ui/tokens.ts 的 workspaceTheme 静态值。
 */

import { useMemo, useState, type ReactNode } from 'react';
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
  RotateCcw,
  Sun,
  X,
} from 'lucide-react-native';

import { workspaceTheme, spacing, type WorkspaceColors } from '../ui/tokens';
import { useWorkspaceTheme } from './WorkspaceTheme';
import { CurrentExecution } from './CurrentExecution';
import { ApprovalPanel } from './ApprovalPanel';
import { ActivityPanel } from './ActivityPanel';
import { MAIN_SPACE } from '../spaces/space-state';

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
  spaceId: string;
  spaceName: string;
  status: string;
  tab: SessionTab;
  onTab: (tab: SessionTab) => void;
  onClose: () => void;
  onDelete?: () => void;
  onReset?: () => void;
  onSettled?: () => void;
  settings?: ReactNode;
  deleting?: boolean;
  resetting?: boolean;
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
    // 操作区独立定位，新增重置按钮也不能把头像和空间名称推离面板中线。
    headerClose: { position: 'absolute', top: workspaceTheme.layout.sessionTop, left: workspaceTheme.layout.sidePadding },
    headerActions: { position: 'absolute', top: workspaceTheme.layout.sessionTop, right: workspaceTheme.layout.sidePadding, flexDirection: 'row', gap: spacing.xs },
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
    card: {
      backgroundColor: colors.surface,
      borderRadius: workspaceTheme.radius.card,
      padding: workspaceTheme.layout.sidePadding,
      marginBottom: workspaceTheme.layout.listItemGap,
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
  spaceId,
  spaceName,
  status,
  tab,
  onTab,
  onClose,
  onDelete,
  onReset,
  onSettled,
  settings,
  deleting,
  resetting,
  reducedMotion,
}: SessionPanelProps) {
  const styles = usePanelStyles();
  const { mode, toggle, colors } = useWorkspaceTheme();
  const [historyActivityId, setHistoryActivityId] = useState<string>();

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
              style={[styles.headerSideButton, styles.headerClose]}
              testID="workspace-session-close"
            >
              <X
                size={workspaceTheme.layout.navigationIconSize}
                color={colors.ink}
                strokeWidth={2}
              />
            </Pressable>

            <View style={styles.headerCenter} pointerEvents="none">
              <View
                style={styles.avatarRing}
                accessibilityLabel="会话头像"
                accessibilityRole="image"
              >
                <Bot size={workspaceTheme.layout.sessionAvatar / 2} color={colors.ink} strokeWidth={1.5} />
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {spaceName}
              </Text>
              <Text style={styles.status} numberOfLines={1}>
                {status}
              </Text>
            </View>

            <View style={styles.headerActions}>
            {onReset && <Pressable accessibilityRole="button" accessibilityLabel="重置当前会话"
              disabled={deleting || resetting} onPress={onReset} style={styles.headerSideButton} testID="workspace-reset-conversation">
              <RotateCcw size={workspaceTheme.layout.navigationIconSize} color={colors.ink} />
            </Pressable>}
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
                    onPress={() => { if (t === 'history') setHistoryActivityId(undefined); onTab(t); }}
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
            {tab === 'activity' && <CurrentExecution spaceId={spaceId} onSettled={onSettled} onApprovals={() => onTab('approvals')} onHistory={(id) => { setHistoryActivityId(id); onTab('history'); }} />}
            {tab === 'approvals' && <ApprovalPanel key={spaceId} spaceId={spaceId} />}
            {tab === 'workspace' && <>
              {settings}
              <EmptyState text="工作区文件尚未接入" />
              {spaceId !== MAIN_SPACE && onDelete && <Pressable accessibilityRole="button" accessibilityLabel="删除当前空间"
                disabled={deleting || resetting} onPress={onDelete} style={styles.card}>
                <Text style={[styles.rowTitle, { color: colors.danger }]}>{deleting ? '正在删除空间…' : '删除当前空间'}</Text>
                <Text style={styles.rowDetail}>彻底删除空间的历史、工作区文件、规则、技能及绑定任务，不可恢复；仅翻篇请使用重置会话。</Text>
              </Pressable>}
            </>}
            {tab === 'history' && <ActivityPanel key={spaceId} spaceId={spaceId} initialActivityId={historyActivityId} />}
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
