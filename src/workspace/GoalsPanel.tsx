import { Card } from '../ui/Surfaces';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewInstance,
} from 'react-native';
import {
  Archive,
  ArrowUpDown,
  CheckCircle2,
  Menu,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Square,
  SquareCheck,
  Trash2,
} from 'lucide-react-native';
import { useGoals } from '../goals/GoalProvider';
import { goalStatusLabel, goalStatusTone } from '../goals/goal-store';
import type { GoalsQuery, GoalStatus } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { EmptyState, StatusPill } from './primitives';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { FeedbackNotice } from '../ui/Feedback';
import { IconControl } from '../ui/IconControl';
import {
  AnchoredFeedbackMenu,
  FeedbackMenuRow,
  FeedbackMenuRows,
} from '../ui/AnchoredFeedbackMenu';
import type { MenuRect } from '../ui/menu-position';

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

function localGoalTime(value?: string): string {
  if (!value) return '未知时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间格式异常' : date.toLocaleString();
}

const STATUS_TABS = [
  [undefined, '全部'],
  ['active', '进行'],
  ['paused', '暂停'],
  ['completed', '完成'],
  ['archived', '归档'],
] as const;

const STATUS_ACTIONS: readonly {
  status: GoalStatus;
  label: string;
  text: string;
  icon: typeof PlayCircle;
}[] = [
  { status: 'active', label: '标记为进行中', text: '设为进行中', icon: PlayCircle },
  { status: 'paused', label: '标记为已暂停', text: '设为已暂停', icon: PauseCircle },
  { status: 'completed', label: '标记为已完成', text: '设为已完成', icon: CheckCircle2 },
  { status: 'archived', label: '标记为已归档', text: '归档此目标', icon: Archive },
];

/**
 * 目标主页面：提供长期目标的查看、创建、状态更新、里程碑勾选与删除确认。
 * 顶部导航集成抽屉按钮、状态分段与操作图标，消除多层冗余工具栏；卡片内部采用紧凑操作菜单，避免按键爆炸。
 */
export function GoalsPanel({ openDrawer }: { openDrawer?: () => void } = {}) {
  const { store, snapshot: state } = useGoals();
  const styles = useStyles();
  const { colors } = useTheme();
  const window = useWindowDimensions();

  const [activeMenuGoalId, setActiveMenuGoalId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuRect | null>(null);
  const targetRefs = useRef<Record<string, ViewInstance | null>>({});

  useEffect(() => {
    store.open();
    return () => store.close();
  }, [store]);

  const disabled = !store.canWrite();
  const locked = state.writing || state.uncertain;
  const query = (patch: Partial<GoalsQuery>) => store.setQuery({ ...state.query, ...patch });

  const activeMenuGoal = useMemo(
    () => (activeMenuGoalId ? state.goals.find((g) => g.id === activeMenuGoalId) : null),
    [activeMenuGoalId, state.goals],
  );

  const openGoalMenu = (goalId: string) => {
    const target = targetRefs.current[goalId];
    if (target) {
      target.measureInWindow((x, y, width, height) => {
        setMenuAnchor({ x, y, width, height });
        setActiveMenuGoalId(goalId);
      });
    } else {
      setMenuAnchor({ x: window.width / 2, y: window.height / 3, width: 0, height: 0 });
      setActiveMenuGoalId(goalId);
    }
  };

  const closeGoalMenu = () => {
    setActiveMenuGoalId(null);
    setMenuAnchor(null);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* 顶部单栏导航：左侧侧栏抽屉、居中状态筛选分段、右侧快捷操作，彻底消除层叠工具条 */}
      <View style={styles.toolbar}>
        {openDrawer ? (
          <IconControl icon={Menu} label="打开智能体侧栏" onPress={openDrawer} />
        ) : (
          <View style={styles.headerSideButtonSpacer} />
        )}

        <View
          accessibilityRole="tablist"
          accessibilityLabel="目标状态筛选"
          style={[styles.viewTabs, { backgroundColor: colors.floatingSurface, borderColor: colors.floatingLine }]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.viewTabsScroll}
          >
            {STATUS_TABS.map(([status, label]) => {
              const selected = state.query.status === status;
              return (
                <Pressable
                  key={label}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected }}
                  aria-selected={selected}
                  disabled={locked || !!state.creator}
                  onPress={() => query({ status })}
                  style={({ pressed }) => [
                    styles.textTab,
                    selected && { backgroundColor: colors.selected },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      { color: selected ? colors.accentText : colors.muted },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.toolbarActions}>
          <IconControl
            small
            icon={ArrowUpDown}
            label={state.query.order === 'asc' ? '当前升序，点击切换降序' : '当前降序，点击切换升序'}
            selected={state.query.order === 'asc'}
            disabled={locked || !!state.creator}
            onPress={() => query({ order: state.query.order === 'asc' ? 'desc' : 'asc' })}
            testID="goals-sort-toggle"
          />
          <IconControl
            small
            icon={Plus}
            label="新建目标"
            disabled={disabled || !!state.creator}
            onPress={store.startCreate}
            testID="goals-create-toggle"
          />
          <IconControl
            small
            icon={RefreshCw}
            label="刷新目标"
            busy={state.loading}
            disabled={state.loading || state.writing}
            onPress={() => void store.refresh()}
            testID="goals-refresh"
          />
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.page}
        testID="goals-panel"
      >
        <View style={styles.root}>
          {state.loading && (
            <ActivityIndicator color={colors.muted} accessibilityLabel="正在读取目标" />
          )}
          {state.stale && state.loaded && (
            <FeedbackNotice text="显示上次读取的目标；刷新成功前不能操作。" tone="warning" />
          )}
          <FeedbackNotice text={state.notice} tone="success" />
          <FeedbackNotice text={state.error} tone="danger" />

          {state.uncertain && (
            <Card style={[styles.card, styles.warning]} tone="warning" testID="goals-uncertain">
              <Text style={styles.title}>提交结果待核对</Text>
              <Text style={styles.body}>
                请求中断不代表服务端未执行。草稿已保留，不会自动重发；请先刷新目标列表，核对后再解除锁定。
              </Text>
              <ActionButton
                label="已核对目标结果，解除锁定"
                disabled={!state.reviewed || state.loading || state.stale}
                onPress={store.acknowledgeReviewed}
              />
            </Card>
          )}

          {state.creator && (
            <Card style={styles.card} testID="goal-creator">
              <Text style={styles.title}>新建目标</Text>
              <Text style={styles.caption}>标题必填，其余内容可选。</Text>
              <Text style={styles.fieldLabel}>标题</Text>
              <FormInput
                accessibilityLabel="目标标题"
                value={state.creator.title}
                editable={!locked}
                maxLength={160}
                onChangeText={(title) => store.setCreator({ title })}
                style={styles.input}
                placeholder="目标标题（必填）"
                placeholderTextColor={colors.faint}
              />
              <Text style={styles.fieldLabel}>描述</Text>
              <FormInput
                accessibilityLabel="目标描述"
                value={state.creator.description}
                editable={!locked}
                multiline
                maxLength={2000}
                onChangeText={(description) => store.setCreator({ description })}
                style={[styles.input, styles.multilineInput]}
                placeholder="目标描述（可选）"
                placeholderTextColor={colors.faint}
              />
              <Text style={styles.fieldLabel}>分类</Text>
              <FormInput
                accessibilityLabel="目标分类"
                value={state.creator.category}
                editable={!locked}
                maxLength={40}
                onChangeText={(category) => store.setCreator({ category })}
                style={styles.input}
                placeholder="目标分类，如：学习、项目、健康（可选）"
                placeholderTextColor={colors.faint}
              />
              <Text style={styles.fieldLabel}>初始里程碑（每行一个）</Text>
              <FormInput
                accessibilityLabel="里程碑列表"
                value={state.creator.milestonesText}
                editable={!locked}
                multiline
                maxLength={2000}
                onChangeText={(milestonesText) => store.setCreator({ milestonesText })}
                style={[styles.input, styles.multilineInput]}
                placeholder="每行一个里程碑标题，如：&#10;完成需求调研&#10;完成前端开发&#10;完成联调测试"
                placeholderTextColor={colors.faint}
              />
              <View style={styles.row}>
                <ActionButton
                  label={state.writing ? '正在保存目标…' : '保存目标'}
                  disabled={disabled || !state.creator.title.trim()}
                  tone="primary"
                  onPress={() => void store.saveCreate()}
                />
                <ActionButton
                  label="取消新建目标"
                  disabled={locked}
                  onPress={store.cancelCreate}
                />
              </View>
            </Card>
          )}

          {state.deleteTarget && (
            <Card style={styles.confirmCard} tone="danger" accessibilityViewIsModal testID="goal-delete-confirm">
              <Text style={styles.title}>确认删除此目标？</Text>
              <Text selectable style={styles.body}>
                目标“{state.deleteTarget.title}”及其名下所有里程碑将被彻底删除，无法撤销。
              </Text>
              <View style={styles.row}>
                <ActionButton
                  label={state.writing ? '正在删除目标…' : '确认删除目标'}
                  disabled={disabled}
                  tone="danger"
                  onPress={() => void store.confirmDelete()}
                />
                <ActionButton
                  label="取消删除目标"
                  disabled={state.writing}
                  onPress={store.cancelDelete}
                />
              </View>
            </Card>
          )}

          {state.loaded && !state.loading && !state.error && !state.goals.length && !state.creator && (
            <EmptyState
              compact
              icon={SquareCheck}
              title="还没有长期目标"
              description="可新建目标，或在聊天中告诉 Pi Muse 你的长期计划。"
            />
          )}

          {state.goals.map((goal) => {
            const doneCount = goal.milestones.filter((m) => m.done).length;
            return (
              <Card key={goal.id} style={styles.card} testID={`goal-card-${goal.id}`}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderInfo}>
                    {!!goal.category && (
                      <View style={[styles.categoryTag, { backgroundColor: colors.floatingSurface, borderColor: colors.line }]}>
                        <Text style={[styles.categoryText, { color: colors.muted }]}>{goal.category}</Text>
                      </View>
                    )}
                    <Text selectable style={styles.cardTitle}>{goal.title}</Text>
                  </View>
                  <View style={styles.cardHeaderActions}>
                    <Pressable
                      ref={(node) => { targetRefs.current[goal.id] = node; }}
                      accessibilityRole="button"
                      accessibilityLabel={`目标状态：${goalStatusLabel(goal.status)}，点击更改状态或操作`}
                      onPress={() => openGoalMenu(goal.id)}
                      style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}
                    >
                      <StatusPill
                        label={goalStatusLabel(goal.status)}
                        tone={goalStatusTone(goal.status)}
                      />
                    </Pressable>
                    <IconControl
                      small
                      icon={MoreHorizontal}
                      label={`操作目标：${goal.title}`}
                      onPress={() => openGoalMenu(goal.id)}
                      testID={`goal-actions-${goal.id}`}
                    />
                  </View>
                </View>

                {!!goal.description && (
                  <Text selectable style={styles.body}>
                    {goal.description}
                  </Text>
                )}

                {goal.milestones.length > 0 && (
                  <View style={styles.milestonesSection}>
                    <View style={styles.milestonesHeader}>
                      <Text style={styles.caption}>里程碑</Text>
                      <Text style={styles.caption}>
                        {doneCount} / {goal.milestones.length}
                      </Text>
                    </View>
                    {goal.milestones.map((milestone) => {
                      const MilestoneIcon = milestone.done ? SquareCheck : Square;
                      return (
                        <Pressable
                          key={milestone.id}
                          testID={`milestone-toggle-${milestone.id}`}
                          accessibilityRole="checkbox"
                          accessibilityLabel={`里程碑：${milestone.title}${milestone.done ? '，已完成' : '，未完成'}`}
                          accessibilityState={{ checked: milestone.done, disabled }}
                          disabled={disabled}
                          onPress={() => void store.toggleMilestone(goal.id, milestone.id)}
                          style={({ pressed }) => [
                            styles.milestoneRow,
                            pressed && !disabled && styles.pressed,
                          ]}
                        >
                          <MilestoneIcon
                            size={workspaceTheme.layout.iconSize}
                            color={milestone.done ? colors.blue : colors.faint}
                          />
                          <View style={styles.flex}>
                            <Text
                              style={[
                                styles.milestoneText,
                                milestone.done && styles.milestoneDoneText,
                              ]}
                            >
                              {milestone.title}
                            </Text>
                            {milestone.done && !!milestone.doneAt && (
                              <Text style={styles.caption}>
                                完成于：{localGoalTime(milestone.doneAt)}
                              </Text>
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                <View style={styles.cardFooter}>
                  <Text selectable style={[styles.caption, styles.footerTime]}>
                    更新于 {localGoalTime(goal.updatedAt)}
                  </Text>
                </View>
              </Card>
            );
          })}
        </View>
      </ScrollView>

      {/* 目标操作弹出菜单 */}
      {activeMenuGoal && (
        <Modal
          transparent
          visible
          animationType="none"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={closeGoalMenu}
        >
          <ThemeStatusBar />
          <AnchoredFeedbackMenu
            anchor={menuAnchor}
            align="right"
            dismissLabel="关闭目标操作"
            onDismiss={closeGoalMenu}
            testID={`goal-menu-${activeMenuGoal.id}`}
          >
            <FeedbackMenuRows>
              {STATUS_ACTIONS.map(({ status, label, text, icon: ActionIcon }) => (
                <FeedbackMenuRow
                  key={status}
                  icon={ActionIcon}
                  label={label}
                  text={text}
                  selected={activeMenuGoal.status === status}
                  disabled={disabled || activeMenuGoal.status === status}
                  onPress={() => {
                    closeGoalMenu();
                    void store.setStatus(activeMenuGoal.id, status);
                  }}
                  testID={`goal-status-option-${status}`}
                />
              ))}
              <FeedbackMenuRow
                icon={Trash2}
                label="删除此目标"
                text="删除目标"
                disabled={disabled}
                onPress={() => {
                  closeGoalMenu();
                  store.requestDelete(activeMenuGoal.id);
                }}
                testID={`goal-delete-option-${activeMenuGoal.id}`}
              />
            </FeedbackMenuRows>
          </AnchoredFeedbackMenu>
        </Modal>
      )}
    </View>
  );
}

const createStyles = (colors: WorkspaceColors) =>
  StyleSheet.create({
    container: { flex: 1, minHeight: 0 },
    headerSideButtonSpacer: {
      width: workspaceTheme.layout.controlSize,
      height: workspaceTheme.layout.controlSize,
    },
    toolbar: {
      minHeight: workspaceTheme.layout.controlSize,
      paddingHorizontal: workspaceTheme.layout.sidePadding,
      paddingTop: spacing[12],
      paddingBottom: spacing[8],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[8],
    },
    viewTabs: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing[2],
      borderRadius: workspaceTheme.radius.field,
      borderWidth: StyleSheet.hairlineWidth,
    },
    viewTabsScroll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingHorizontal: spacing[2],
    },
    textTab: {
      minHeight: workspaceTheme.layout.smallControl,
      paddingHorizontal: spacing[8],
      paddingVertical: spacing[6],
      borderRadius: workspaceTheme.radius.field,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabText: {
      ...workspaceTheme.typography.caption,
      fontWeight: '600',
    },
    toolbarActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[6],
    },
    page: {
      paddingHorizontal: workspaceTheme.layout.sidePadding,
      paddingTop: spacing[8],
      paddingBottom: spacing[34],
    },
    root: { gap: spacing[12], paddingBottom: spacing[24] },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing[8],
    },
    card: {
      padding: spacing[16],
      borderRadius: workspaceTheme.radius.card,
      backgroundColor: colors.surface,
      gap: spacing[10],
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing[8],
    },
    cardHeaderInfo: {
      flex: 1,
      minWidth: 0,
      gap: spacing[4],
    },
    cardHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[6],
    },
    statusButton: {
      borderRadius: workspaceTheme.radius.round,
    },
    categoryTag: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing[6],
      paddingVertical: spacing[2],
      borderRadius: workspaceTheme.radius.field,
      borderWidth: StyleSheet.hairlineWidth,
    },
    categoryText: {
      ...workspaceTheme.typography.caption,
      fontSize: 11,
      fontWeight: '500',
    },
    cardTitle: {
      ...workspaceTheme.typography.itemTitle,
      color: colors.ink,
      fontSize: 16,
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingTop: spacing[6],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    footerTime: {
      fontSize: 11,
      color: colors.faint,
    },
    flex: { flex: 1, gap: spacing[4], minWidth: 0 },
    title: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
    body: { ...workspaceTheme.typography.detail, color: colors.muted },
    caption: { ...workspaceTheme.typography.caption, color: colors.faint },
    warning: {
      padding: spacing[12],
      borderRadius: workspaceTheme.radius.field,
      backgroundColor: colors.warningSoft,
    },
    confirmCard: {
      padding: spacing[20],
      borderRadius: workspaceTheme.radius.card,
      backgroundColor: colors.dangerSoft,
      gap: spacing[12],
    },
    pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
    input: { minHeight: workspaceTheme.layout.inputMinHeight },
    multilineInput: {
      minHeight: workspaceTheme.layout.composerMaxHeight,
    },
    fieldLabel: { ...workspaceTheme.typography.status, color: colors.muted },
    milestonesSection: {
      gap: spacing[6],
      marginTop: spacing[4],
      paddingTop: spacing[8],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    milestonesHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    milestoneRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[10],
      minHeight: workspaceTheme.layout.smallControl,
      paddingVertical: spacing[4],
    },
    milestoneText: { ...workspaceTheme.typography.detail, color: colors.ink },
    milestoneDoneText: { textDecorationLine: 'line-through', color: colors.faint },
  });
