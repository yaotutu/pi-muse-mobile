import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Square, SquareCheck } from 'lucide-react-native';
import { useGoals } from '../goals/GoalProvider';
import { goalStatusLabel, goalStatusTone } from '../goals/goal-store';
import type { GoalsQuery } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { EmptyState, StatusPill } from './primitives';

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

function Button({
  label,
  onPress,
  selected,
  disabled,
  primary,
  shortLabel,
  danger,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  primary?: boolean;
  shortLabel?: string;
  danger?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && styles.selected,
        primary && styles.primary,
        danger && styles.dangerButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText, danger && styles.dangerText]}>{shortLabel ?? label}</Text>
    </Pressable>
  );
}

function localGoalTime(value?: string): string {
  if (!value) return '未知时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间格式异常' : date.toLocaleString();
}

/**
 * 目标主页面：提供长期目标的查看、创建、状态更新、里程碑勾选与删除确认。
 * 仅在页面打开且连接前台时读取真实数据，没有专属 SSE；操作前若数据过期需先刷新。
 */
export function GoalsPanel() {
  const { store, snapshot: state } = useGoals();
  const styles = useStyles();
  const { colors } = useTheme();

  useEffect(() => {
    store.open();
    return () => store.close();
  }, [store]);

  const disabled = !store.canWrite();
  const locked = state.writing || state.uncertain;
  const query = (patch: Partial<GoalsQuery>) => store.setQuery({ ...state.query, ...patch });

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      <View style={styles.root} testID="goals-panel">
        {/* 主 Tab 已提供页标题；这里只展示全局目标数量和直接操作。 */}
        <View style={styles.toolbar}>
          <Text style={[styles.caption, styles.toolbarCount]}>{state.loaded ? `${state.goals.length} 项目标` : '目标列表'}</Text>
          <Button
            label="刷新目标"
            shortLabel="刷新"
            disabled={state.loading || state.writing}
            onPress={() => void store.refresh()}
          />
          <Button
            label="新建目标"
            shortLabel="新建"
            disabled={disabled || !!state.creator}
            primary
            onPress={store.startCreate}
          />
        </View>

        {/* 五个状态作为同一组胶囊；短文案适配窄屏，完整名称留给读屏。 */}
        <View accessibilityRole="tablist" accessibilityLabel="目标状态筛选" style={styles.tablist}>
          {([
            [undefined, '全部', '全部'],
            ['active', '进行中', '进行'],
            ['paused', '已暂停', '暂停'],
            ['completed', '已完成', '完成'],
            ['archived', '已归档', '归档'],
          ] as const).map(([status, label, shortLabel]) => (
            <Pressable
              key={label}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: state.query.status === status, disabled: locked || !!state.creator }}
              disabled={locked || !!state.creator}
              onPress={() => query({ status })}
              style={({ pressed }) => [styles.tab, state.query.status === status && styles.tabSelected, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={[styles.tabText, state.query.status === status && styles.tabTextSelected]}>
                {shortLabel}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.sortRow}>
          <Text style={styles.groupLabel}>排序</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator style={styles.sortScroll} contentContainerStyle={styles.sortOptions} accessibilityLabel="目标排序">
            {([
              ['updatedAt', '按更新时间', '更新时间'],
              ['createdAt', '按创建时间', '创建时间'],
            ] as const).map(([sort, label, shortLabel]) => (
              <Button
                key={sort}
                label={label}
                shortLabel={shortLabel}
                selected={state.query.sort === sort}
                disabled={locked || !!state.creator}
                onPress={() => query({ sort })}
              />
            ))}
          </ScrollView>
          <Button
            label={state.query.order === 'asc' ? '升序' : '降序'}
            disabled={locked || !!state.creator}
            onPress={() => query({ order: state.query.order === 'asc' ? 'desc' : 'asc' })}
          />
        </View>

        {state.loading && (
          <ActivityIndicator color={colors.muted} accessibilityLabel="正在读取目标" />
        )}
        {state.stale && state.loaded && (
          <View style={styles.warning}><Text style={styles.warningText}>显示上次读取的目标；刷新成功前不能操作。</Text></View>
        )}
        {!!state.notice && (
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {state.notice}
          </Text>
        )}
        {!!state.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {state.error}
          </Text>
        )}

        {state.uncertain && (
          <View style={[styles.card, styles.warning]} testID="goals-uncertain">
            <Text style={styles.title}>提交结果待核对</Text>
            <Text style={styles.body}>
              请求中断不代表服务端未执行。草稿已保留，不会自动重发；请先刷新目标列表，核对后再解除锁定。
            </Text>
            <Button
              label="已核对目标结果，解除锁定"
              disabled={!state.reviewed || state.loading || state.stale}
              onPress={store.acknowledgeReviewed}
            />
          </View>
        )}

        {state.creator && (
          <View style={styles.card} testID="goal-creator">
            <Text style={styles.title}>新建目标</Text>
            <Text style={styles.caption}>标题必填，其余内容可选。</Text>
            <Text style={styles.fieldLabel}>标题</Text>
            <TextInput
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
            <TextInput
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
            <TextInput
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
            <TextInput
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
              <Button
                label={state.writing ? '正在保存目标…' : '保存目标'}
                disabled={disabled || !state.creator.title.trim()}
                primary
                onPress={() => void store.saveCreate()}
              />
              <Button
                label="取消新建目标"
                disabled={locked}
                onPress={store.cancelCreate}
              />
            </View>
          </View>
        )}

        {state.deleteTarget && (
          <View style={styles.confirmCard} accessibilityViewIsModal testID="goal-delete-confirm">
            <Text style={styles.title}>确认删除此目标？</Text>
            <Text selectable style={styles.body}>
              目标“{state.deleteTarget.title}”及其名下所有里程碑将被彻底删除，无法撤销。
            </Text>
            <View style={styles.row}>
              <Button
                label={state.writing ? '正在删除目标…' : '确认删除目标'}
                disabled={disabled}
                danger
                onPress={() => void store.confirmDelete()}
              />
              <Button
                label="取消删除目标"
                disabled={state.writing}
                onPress={store.cancelDelete}
              />
            </View>
          </View>
        )}

        {state.loaded && !state.loading && !state.error && !state.goals.length && !state.creator && (
          <EmptyState compact
            icon={SquareCheck}
            title="还没有长期目标"
            description="可新建目标，或在聊天中告诉 Pi Muse 你的长期计划。"
          />
        )}

        {state.goals.map((goal) => {
          const doneCount = goal.milestones.filter((m) => m.done).length;
          return (
            <View key={goal.id} style={styles.card} testID={`goal-card-${goal.id}`}>
              <View style={styles.titleRow}>
                <Text selectable style={[styles.title, styles.titleFlex]}>{goal.title}</Text>
                <StatusPill
                  label={goalStatusLabel(goal.status)}
                  tone={goalStatusTone(goal.status)}
                />
              </View>
              {!!goal.category && <Text style={styles.caption}>{goal.category}</Text>}
              {!!goal.description && (
                <Text selectable style={styles.body}>
                  {goal.description}
                </Text>
              )}

              {goal.milestones.length > 0 && (
                <View style={styles.milestonesSection}>
                  <Text style={styles.caption}>
                    里程碑（{doneCount} / {goal.milestones.length}）
                  </Text>
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

              <View style={styles.statusSection}>
                <Text style={styles.groupLabel}>状态</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator style={styles.statusScroll} contentContainerStyle={styles.sortOptions} accessibilityLabel={`切换目标“${goal.title}”的状态`}>
                  {(['active', 'paused', 'completed', 'archived'] as const).map((status) => (
                    <Button
                      key={status}
                      label={goalStatusLabel(status)}
                      shortLabel={status === 'active' ? '进行' : status === 'paused' ? '暂停' : status === 'completed' ? '完成' : '归档'}
                      selected={goal.status === status}
                      disabled={disabled || goal.status === status}
                      onPress={() => void store.setStatus(goal.id, status)}
                    />
                  ))}
                </ScrollView>
              </View>

              <View style={styles.cardFooter}>
                <Button
                  label="删除目标"
                  shortLabel="删除"
                  danger
                  disabled={disabled}
                  onPress={() => store.requestDelete(goal.id)}
                />
                <Text selectable style={[styles.caption, styles.footerTime]}>更新：{localGoalTime(goal.updatedAt)} · 创建：{localGoalTime(goal.createdAt)}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: WorkspaceColors) =>
  StyleSheet.create({
    page: {
      paddingHorizontal: workspaceTheme.layout.sidePadding,
      paddingTop: spacing[12],
      paddingBottom: spacing[24],
    },
    root: { gap: spacing[12], paddingBottom: spacing[24] },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing[8],
    },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] },
    toolbarCount: { flex: 1, minWidth: 0 },
    tablist: {
      height: workspaceTheme.layout.sessionTabsHeight,
      flexDirection: 'row',
      alignItems: 'center',
      padding: workspaceTheme.layout.sessionTabInset,
      backgroundColor: colors.surface,
      borderRadius: workspaceTheme.radius.tab,
    },
    tab: { flex: 1, minWidth: 0, height: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: workspaceTheme.radius.round },
    tabSelected: { backgroundColor: colors.control },
    tabText: { ...workspaceTheme.typography.status, color: colors.faint },
    tabTextSelected: { color: colors.ink },
    sortRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] },
    sortScroll: { flex: 1, minWidth: 0 },
    sortOptions: { gap: spacing[8], paddingRight: spacing[8] },
    groupLabel: { ...workspaceTheme.typography.caption, color: colors.muted },
    titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
    titleFlex: { flex: 1, minWidth: 0 },
    cardFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
    footerTime: { flex: 1, minWidth: 0 },
    statusScroll: { flex: 1, minWidth: 0 },
    flex: { flex: 1, gap: spacing[4], minWidth: 0 },
    title: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
    body: { ...workspaceTheme.typography.detail, color: colors.muted },
    caption: { ...workspaceTheme.typography.caption, color: colors.faint },
    error: { ...workspaceTheme.typography.detail, color: colors.danger },
    notice: { ...workspaceTheme.typography.detail, color: colors.success },
    warning: { padding: spacing[12], borderRadius: workspaceTheme.radius.field, backgroundColor: colors.warningSoft },
    warningText: { ...workspaceTheme.typography.status, color: colors.warning },
    confirmCard: { padding: spacing[20], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.dangerSoft, gap: spacing[12] },
    card: {
      padding: spacing[16],
      borderRadius: workspaceTheme.radius.card,
      backgroundColor: colors.surface,
      gap: spacing[8],
    },
    button: {
      minHeight: workspaceTheme.layout.smallControl,
      paddingHorizontal: spacing[12],
      paddingVertical: spacing[8],
      justifyContent: 'center',
      borderRadius: workspaceTheme.radius.round,
      backgroundColor: colors.control,
      alignSelf: 'flex-start',
    },
    buttonText: { ...workspaceTheme.typography.status, color: colors.ink },
    selected: { backgroundColor: colors.blueSoft },
    primary: { backgroundColor: colors.blue },
    primaryText: { color: colors.onAccent },
    dangerButton: { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 1 },
    dangerText: { color: colors.danger },
    disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
    pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
    input: {
      ...workspaceTheme.typography.input,
      color: colors.ink,
      backgroundColor: colors.canvas,
      minHeight: workspaceTheme.layout.inputMinHeight,
      borderRadius: workspaceTheme.radius.field,
      padding: spacing[14],
    },
    multilineInput: {
      minHeight: workspaceTheme.layout.composerMaxHeight,
      textAlignVertical: 'top',
    },
    fieldLabel: { ...workspaceTheme.typography.status, color: colors.muted },
    milestonesSection: { gap: spacing[8], marginTop: spacing[4] },
    milestoneRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[10],
      paddingVertical: spacing[6],
    },
    milestoneText: { ...workspaceTheme.typography.detail, color: colors.ink },
    milestoneDoneText: { textDecorationLine: 'line-through', color: colors.faint },
    statusSection: { flexDirection: 'row', alignItems: 'center', gap: spacing[8], marginTop: spacing[4] },
  });
