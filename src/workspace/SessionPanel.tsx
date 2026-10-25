/**
 * 全屏当前会话面板；同层 Tab 切换不重建会话。
 *
 * 边界：不持服务端/存储；仅消费 props；会话信息区由 WorkspaceScreen 持续挂载；
 * 颜色来自主题 context（三套配色），布局/字号/圆角仍取 src/ui/tokens.ts 的 workspaceTheme 静态值。
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import {
  Clock,
  List,
  Monitor,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react-native';

import { workspaceTheme, spacing, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { CurrentExecution } from './CurrentExecution';
import { FilesPanel } from './FilesPanel';
import { ApprovalPanel } from './ApprovalPanel';
import { ActivityPanel } from './ActivityPanel';
import { MAIN_SPACE } from '../spaces/space-state';
import { IconControl } from '../ui/IconControl';

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
  tab: SessionTab;
  onTab: (tab: SessionTab) => void;
  onDelete?: () => void;
  onReset?: () => void;
  onSettled?: () => void;
  settings?: ReactNode;
  deleting?: boolean;
  resetting?: boolean;
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
    },
    column: {
      flex: 1,
      width: '100%',
      maxWidth: workspaceTheme.layout.maxWidth,
      alignSelf: 'center',
    },

    tablistWrap: {
      paddingHorizontal: workspaceTheme.layout.sidePadding,
      marginBottom: workspaceTheme.layout.sessionPanelTabsBottom,
    },
    actionRow: { minHeight: workspaceTheme.layout.smallControl, alignItems: 'flex-end', paddingHorizontal: workspaceTheme.layout.sidePadding, marginBottom: spacing[8] },
    tablist: {
      height: workspaceTheme.layout.sessionTabsHeight,
      flexDirection: 'row',
      backgroundColor: colors.floatingSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.floatingLine,
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
  });
}

export function SessionPanel({
  spaceId,
  tab,
  onTab,
  onDelete,
  onReset,
  onSettled,
  settings,
  deleting,
  resetting,
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
    <View style={styles.root} testID="workspace-session-panel">
        <View style={styles.column}>
          <View style={styles.actionRow}>{onReset && <IconControl icon={RotateCcw} label="重置当前会话" testID="workspace-reset-conversation"
            onPress={onReset} disabled={deleting} busy={resetting} small />}</View>
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
                    disabled={deleting || resetting}
                    onPress={() => { if (t === 'history') setHistoryActivityId(undefined); onTab(t); }}
                    accessibilityRole="tab"
                    accessibilityLabel={TAB_LABELS[t]}
                    accessibilityState={{ selected, disabled: !!(deleting || resetting), busy: !!(deleting || resetting) }}
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
                accessibilityState={{ disabled: !!(deleting || resetting), busy: !!deleting }}
                disabled={deleting || resetting} onPress={onDelete} style={styles.card}>
                <Text style={[styles.rowTitle, { color: colors.danger }]}>{deleting ? '正在删除空间…' : '删除当前空间'}</Text>
                <Text style={styles.rowDetail}>彻底删除空间的历史、工作区文件、规则、技能及绑定任务，不可恢复；仅翻篇请使用重置会话。</Text>
              </Pressable>}
            </>}
            {tab === 'history' && <ActivityPanel key={spaceId} spaceId={spaceId} initialActivityId={historyActivityId} showHeading />}
          </ScrollView>
        </View>
    </View>
  );
}
