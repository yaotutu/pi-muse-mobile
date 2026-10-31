/**
 * 全屏当前会话面板；同层 Tab 切换不重建会话。
 *
 * 边界：不持服务端/存储；仅消费 props；会话信息区由 WorkspaceScreen 持续挂载；
 * 颜色来自主题 context（三套配色），布局/字号/圆角仍取 src/ui/tokens.ts 的 workspaceTheme 静态值。
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import {
  Clock,
  List,
  Monitor,
  ShieldCheck,
} from 'lucide-react-native';

import { workspaceTheme, spacing, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { CurrentExecution } from './CurrentExecution';
import { FilesPanel } from './FilesPanel';
import { ApprovalPanel } from './ApprovalPanel';
import { ActivityPanel } from './ActivityPanel';
import { MAIN_SPACE } from '../spaces/space-state';
import { SegmentedControl } from '../ui/SegmentedControl';

export type SessionTab = 'activity' | 'approvals' | 'workspace' | 'history';

const TABS: readonly { value: SessionTab; label: string; icon: LucideIcon; testID: string }[] = [
  { value: 'activity', label: '动态', icon: List, testID: 'workspace-session-tab-activity' },
  { value: 'approvals', label: '审批', icon: ShieldCheck, testID: 'workspace-session-tab-approvals' },
  { value: 'workspace', label: '工作区', icon: Monitor, testID: 'workspace-session-tab-workspace' },
  { value: 'history', label: '历史', icon: Clock, testID: 'workspace-session-tab-history' },
];

export interface SessionPanelProps {
  spaceId: string;
  tab: SessionTab;
  onTab: (tab: SessionTab) => void;
  onDelete?: () => void;
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
      paddingHorizontal: spacing[16],
      marginBottom: spacing[12],
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: spacing[16],
      paddingBottom: spacing[28],
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
      padding: spacing[16],
      marginBottom: spacing[12],
    },
  });
}

export function SessionPanel({
  spaceId,
  tab,
  onTab,
  onDelete,
  onSettled,
  settings,
  deleting,
  resetting,
}: SessionPanelProps) {
  const styles = usePanelStyles();
  const { colors } = useTheme();
  const [historyActivityId, setHistoryActivityId] = useState<string>();

  return (
    <View style={styles.root} testID="workspace-session-panel">
        <View style={styles.column}>
          <View style={styles.tablistWrap}>
            <SegmentedControl value={tab} options={TABS} label="会话内容" busy={!!(deleting || resetting)}
              onChange={(next) => { if (next === 'history') setHistoryActivityId(undefined); onTab(next); }} />
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
                <Text style={styles.rowDetail}>彻底删除空间的历史、工作区文件、规则、技能及绑定任务，不可恢复；仅需开启新对话时请到设置页重置会话。</Text>
              </Pressable>}
            </>}
            {tab === 'history' && <ActivityPanel key={spaceId} spaceId={spaceId} initialActivityId={historyActivityId} showHeading={false} />}
          </ScrollView>
        </View>
    </View>
  );
}
