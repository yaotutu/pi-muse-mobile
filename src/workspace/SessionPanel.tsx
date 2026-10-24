/**
 * 全屏当前会话面板；同层 Tab 切换不重建会话。
 *
 * 边界：不持服务端/存储；仅消费 props；切 Tab 不重建 Modal/Header；
 * 颜色来自主题 context（三套配色），布局/字号/圆角仍取 src/ui/tokens.ts 的 workspaceTheme 静态值。
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
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import type { LucideIcon } from 'lucide-react-native';
import {
  Clock,
  List,
  Monitor,
  ShieldCheck,
  RotateCcw,
  X,
} from 'lucide-react-native';

import { workspaceTheme, spacing, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeToggle } from '../theme/ThemeToggle';
import { CurrentExecution } from './CurrentExecution';
import { FilesPanel } from './FilesPanel';
import { ApprovalPanel } from './ApprovalPanel';
import { ActivityPanel } from './ActivityPanel';
import { MAIN_SPACE } from '../spaces/space-state';
import { MuseAvatar, StatusPill, type StatusTone } from './primitives';

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
  statusTone: StatusTone;
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

// 子组件共用：读 context -> useMemo 出当前主题下的 StyleSheet。颜色覆盖来自主题 context，布局/字号仍走 workspaceTheme 静态值。
function usePanelStyles() {
  const { colors } = useTheme();
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
      paddingBottom: workspaceTheme.layout.sessionPanelHeaderBottom,
    },
    headerSideButton: {
      width: workspaceTheme.layout.smallControl,
      height: workspaceTheme.layout.smallControl,
      borderRadius: workspaceTheme.radius.round,
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
    name: {
      marginTop: workspaceTheme.layout.sessionPanelNameTop,
      ...workspaceTheme.typography.heroName,
      color: colors.ink,
      maxWidth: workspaceTheme.layout.sessionNameMaxWidth,
    },
    status: {
      marginTop: spacing.sm,
    },

    tablistWrap: {
      paddingHorizontal: workspaceTheme.layout.sidePadding,
      marginBottom: workspaceTheme.layout.sessionPanelTabsBottom,
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
      gap: workspaceTheme.layout.tabLabelGap,
    },
    tabSelected: {
      backgroundColor: colors.selected,
    },
    tabLabel: { ...workspaceTheme.typography.navigation, color: colors.faint },
    tabLabelSelected: { color: colors.ink },

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
  statusTone,
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
  const { colors } = useTheme();
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
      <ThemeStatusBar />
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
              <MuseAvatar size={workspaceTheme.layout.sessionAvatar} />
              <Text style={styles.name} numberOfLines={1}>
                {spaceName}
              </Text>
              <View style={styles.status}><StatusPill label={status} tone={statusTone} /></View>
            </View>

            <View style={styles.headerActions}>
            {onReset && <Pressable accessibilityRole="button" accessibilityLabel="重置当前会话"
              disabled={deleting || resetting} onPress={onReset} style={styles.headerSideButton} testID="workspace-reset-conversation">
              <RotateCcw size={workspaceTheme.layout.navigationIconSize} color={colors.ink} />
            </Pressable>}
            <ThemeToggle style={styles.headerSideButton} testID="workspace-session-theme-toggle" />
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
                      color={selected ? colors.ink : colors.faint}
                      strokeWidth={selected ? 2 : 1.6}
                    />
                    <Text style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{TAB_LABELS[t]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 内容长度随 Tab 改变；从顶部阅读新内容，不继承其他 Tab 的滚动偏移。领域草稿仍由 store 保留。 */}
          <ScrollView
            key={tab}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {tab === 'activity' && <CurrentExecution spaceId={spaceId} onSettled={onSettled} onApprovals={() => onTab('approvals')} onHistory={(id) => { setHistoryActivityId(id); onTab('history'); }} />}
            {tab === 'approvals' && <ApprovalPanel key={spaceId} spaceId={spaceId} />}
            {tab === 'workspace' && <>
              {settings}
              <FilesPanel currentSpaceId={spaceId} />
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
