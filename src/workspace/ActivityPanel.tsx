/**
 * 活动中心 - 历史活动时间线
 * 对标 OpenMuse 极简时间线与 iOS 设计风格，去除割裂及冗余操作按钮
 */
import { FeedbackNotice } from "../ui/Feedback";
import { Card } from "../ui/Surfaces";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ArrowLeft, Check, ChevronRight, CirclePause, Clock3, Workflow, X } from "lucide-react-native";
import { useActivities } from "../activities/ActivityProvider";
import { activityStepKey } from "../activities/contracts";
import { activityStatusLabel, stepKindLabel, stepStatusLabel } from "../activities/presentation";
import { activityStatuses, type ActivityFilter, type ActivityOverview, type ActivityStatus } from "../activities/types";
import { spacing, workspaceTheme, type WorkspaceColors } from "../ui/tokens";
import { useTheme } from "../theme/ThemeProvider";
import { EmptyState, StatusPill, type StatusTone } from "./primitives";
import { ActionButton } from "../ui/ActionButton";
import { ChoiceChip } from "../ui/ChoiceChip";

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

export function ActivityPanel({
  spaceId,
  defaultScope = "space",
  initialActivityId,
  showHeading = false,
}: {
  spaceId: string;
  defaultScope?: "space" | "all";
  initialActivityId?: string;
  showHeading?: boolean;
}) {
  const { store, snapshot } = useActivities();
  const styles = useStyles();
  const { colors } = useTheme();
  const [scope, setScope] = useState(defaultScope);
  const [status, setStatus] = useState<ActivityStatus>();
  const filter = useMemo<ActivityFilter>(
    () => ({ ...(scope === "space" ? { spaceId } : {}), ...(status ? { status } : {}) }),
    [scope, spaceId, status]
  );

  useEffect(() => {
    store.open(filter);
  }, [store, filter]);

  useEffect(() => () => store.close(), [store]);
  useEffect(() => {
    if (initialActivityId) store.select(initialActivityId);
  }, [store, initialActivityId]);

  const matches = snapshot.filter.spaceId === filter.spaceId && snapshot.filter.status === filter.status;
  const detail = matches ? snapshot.detail : undefined;

  return (
    <View style={styles.root} testID="activity-panel">
      {showHeading && <Text accessibilityRole="header" style={styles.heading}>活动历史</Text>}

      {matches && snapshot.selectedId ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回活动列表"
            onPress={() => store.select()}
            style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
          >
            <ArrowLeft size={18} color={colors.ink} />
            <Text style={styles.backText}>返回活动列表</Text>
          </Pressable>

          {snapshot.detailLoading && <ActivityIndicator accessibilityLabel="正在读取活动详情" color={colors.muted} />}
          {snapshot.detailStale && detail && (
            <View style={styles.warning}>
              <Text style={styles.warningText}>详情为最后观测内容，可下拉核对最新进展。</Text>
            </View>
          )}
          {!!snapshot.detailError && <FeedbackNotice text={snapshot.detailError} tone="danger" />}

          {detail && (
            <>
              <Overview activity={detail.activity} />
              <Text style={styles.title}>执行步骤 · {detail.steps.length}</Text>
              {detail.steps.length === 0 && <Text style={styles.body}>服务端尚未记录执行步骤</Text>}
              {detail.steps.map((step, index) => {
                const Icon =
                  step.status === "succeeded"
                    ? Check
                    : step.status === "failed" || step.status === "denied"
                    ? X
                    : step.status === "running"
                    ? Workflow
                    : CirclePause;
                return (
                  <View
                    key={activityStepKey(step)}
                    style={styles.step}
                    testID={`activity-step-${step.runId}-${step.id}`}
                  >
                    <View style={styles.timelineRail}>
                      <View style={styles.timelineNode}>
                        <Icon
                          size={workspaceTheme.layout.iconSize - spacing[6]}
                          color={
                            step.status === "failed" || step.status === "denied"
                              ? colors.danger
                              : step.status === "succeeded"
                              ? colors.success
                              : colors.muted
                          }
                        />
                      </View>
                      <View style={styles.timelineLine} />
                    </View>
                    <View style={styles.stepBody}>
                      <Text style={styles.caption}>
                        {index + 1} · {stepKindLabel(step.kind)} · {stepStatusLabel(step.status)}
                      </Text>
                      <Text selectable style={styles.title}>{step.title}</Text>
                      <Text selectable style={styles.caption}>执行：{step.runId}</Text>
                      <Text style={styles.caption}>开始：{step.startedAt}</Text>
                      <Text style={styles.caption}>
                        {step.finishedAt === null
                          ? step.status === "running"
                            ? "尚未结束"
                            : "未记录可信结束时间"
                          : `结束：${step.finishedAt}`}
                      </Text>
                      {step.result !== null && <Text selectable style={styles.body}>{step.result}</Text>}
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </>
      ) : (
        <>
          {defaultScope === "all" && (
            <View style={styles.scopeRow}>
              <ChoiceChip label="全部空间" selected={scope === "all"} onPress={() => setScope("all")} />
              <ChoiceChip label="当前空间" selected={scope === "space"} onPress={() => setScope("space")} />
            </View>
          )}

          {matches && snapshot.activities.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
              accessibilityLabel="活动状态筛选"
            >
              <ChoiceChip label="全部活动状态" text="全部" selected={!status} onPress={() => setStatus(undefined)} />
              {activityStatuses.map((value) => (
                <ChoiceChip
                  key={value}
                  label={activityStatusLabel(value)}
                  selected={status === value}
                  onPress={() => setStatus(value)}
                />
              ))}
            </ScrollView>
          )}

          {snapshot.loading && <ActivityIndicator accessibilityLabel="正在读取活动列表" color={colors.muted} />}
          {matches && !!snapshot.error && <FeedbackNotice text={snapshot.error} tone="danger" />}
          {matches && snapshot.stale && snapshot.loaded && (
            <View style={styles.warning}>
              <Text style={styles.warningText}>以下为最后观测列表，最新状态待核对。</Text>
            </View>
          )}

          {matches && snapshot.loaded && !snapshot.activities.length && !snapshot.error && !snapshot.loading && (
            <EmptyState
              compact
              icon={Clock3}
              title="还没有已登记的活动"
              description="模型登记的复合任务与长期工作会沉淀在这里。"
            />
          )}

          {matches &&
            snapshot.activities.map((activity) => (
              <Pressable
                key={activity.id}
                accessibilityRole="button"
                accessibilityLabel={`查看活动 ${activity.title}`}
                testID={`activity-open-${activity.id}`}
                onPress={() => store.select(activity.id)}
                style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}
              >
                <View style={styles.activityIcon}>
                  <Workflow size={workspaceTheme.layout.iconSize} strokeWidth={1.5} color={colors.muted} />
                </View>
                <View style={styles.activityBody}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, styles.flex]}>{activity.title}</Text>
                    <ChevronRight size={workspaceTheme.layout.iconSize - spacing[8]} color={colors.faint} />
                  </View>
                  <View style={styles.statusRow}>
                    <StatusPill label={activityStatusLabel(activity.status)} tone={activityTone(activity.status)} />
                    <Text style={styles.caption}>{activity.createdAt}</Text>
                  </View>
                  {!!activity.progress && <Text style={styles.body}>{activity.progress}</Text>}
                </View>
              </Pressable>
            ))}

          {matches && snapshot.hasMore && (
            <ActionButton
              label="加载更多活动"
              text="加载更多"
              disabled={snapshot.loading || snapshot.stale}
              onPress={store.loadMore}
            />
          )}
        </>
      )}
    </View>
  );
}

function Overview({ activity }: { activity: ActivityOverview }) {
  const styles = useStyles();
  return (
    <Card style={styles.card} testID="activity-detail">
      <View style={styles.titleRow}>
        <Text selectable style={[styles.title, styles.flex]}>{activity.title}</Text>
      </View>
      <View style={styles.statusRow}>
        <StatusPill label={activityStatusLabel(activity.status)} tone={activityTone(activity.status)} />
      </View>
      <Text selectable style={styles.body}>目标：{activity.goal}</Text>
      <Text selectable style={styles.body}>交付：{activity.deliverable}</Text>
      <Text selectable style={styles.body}>进展：{activity.progress}</Text>
      {activity.result !== null && <Text selectable style={styles.body}>结果：{activity.result}</Text>}
      <Text style={styles.caption}>创建时间：{activity.createdAt}</Text>
      {activity.finishedAt !== null && <Text style={styles.caption}>完成时间：{activity.finishedAt}</Text>}
      {activity.status === "awaiting_continuation" && (
        <Text style={styles.body}>本轮已结束，但工作未完成；如需继续，请回聊天页明确提出。</Text>
      )}
    </Card>
  );
}

function activityTone(status: ActivityStatus): StatusTone {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "waiting_approval" || status === "waiting_user" || status === "awaiting_continuation") return "warning";
  return status === "running" ? "accent" : "neutral";
}

const createStyles = (colors: WorkspaceColors) =>
  StyleSheet.create({
    root: { gap: spacing[14], paddingBottom: spacing[24] },
    heading: { ...workspaceTheme.typography.section, color: colors.ink },
    title: { fontSize: 16, fontWeight: "600", color: colors.ink },
    body: { ...workspaceTheme.typography.detail, color: colors.muted },
    caption: { ...workspaceTheme.typography.caption, color: colors.faint },

    backRow: { flexDirection: "row", alignItems: "center", gap: spacing[8], paddingVertical: spacing[6] },
    backText: { fontSize: 15, fontWeight: "500", color: colors.ink },

    scopeRow: { flexDirection: "row", gap: spacing[8], alignItems: "center" },
    filters: { gap: spacing[8], paddingVertical: spacing[4] },
    card: { borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface, padding: spacing[16], gap: spacing[10] },
    warning: { padding: spacing[12], borderRadius: workspaceTheme.radius.field, backgroundColor: colors.warningSoft },
    warningText: { ...workspaceTheme.typography.status, color: colors.warning },

    pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
    activityRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing[12],
      paddingVertical: spacing[12],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    activityIcon: {
      width: workspaceTheme.layout.rowIcon,
      height: workspaceTheme.layout.rowIcon,
      backgroundColor: colors.surface,
      borderRadius: workspaceTheme.radius.round,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    activityBody: { flex: 1, gap: spacing[6], minWidth: 0 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
    flex: { flex: 1 },
    statusRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[8] },
    step: { flexDirection: "row", gap: spacing[14] },
    stepBody: { flex: 1, gap: spacing[8], paddingBottom: spacing[20] },
    timelineRail: { width: workspaceTheme.layout.timelineIconWidth, alignItems: "center" },
    timelineNode: {
      width: workspaceTheme.layout.timelineIconWidth,
      height: workspaceTheme.layout.timelineIconWidth,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderRadius: workspaceTheme.radius.round,
    },
    timelineLine: { width: StyleSheet.hairlineWidth, backgroundColor: colors.line, flex: 1, marginTop: spacing[8] },
  });
