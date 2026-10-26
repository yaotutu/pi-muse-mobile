/**
 * 实时执行时间线；对标 OpenMuse 极简设计。
 *
 * 规范：
 * - 顶部使用"今天"时间线分组，贴合 iOS / OpenMuse 呼吸感
 * - 去除割裂冗余的操作与说明按钮，历史与审批由同层 Tab 直接承载
 * - 运行中的工具与子代理以精简内嵌条目呈现，待审批轻量提示直达
 */

import { useEffect, useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Check, ChevronRight, CirclePause, Radio, ShieldAlert, Workflow, Wrench, X } from "lucide-react-native";
import { workspaceTheme, spacing } from "../ui/tokens";
import { useTheme } from "../theme/ThemeProvider";
import { useSpaceRuntime } from "../runtime/RuntimeProvider";
import type { AgentStatus } from "../runtime/types";
import { useServiceConnection } from "../connection/ConnectionProvider";
import { ActionButton } from "../ui/ActionButton";

export function CurrentExecution({
  spaceId,
  onSettled,
  onApprovals,
  onHistory,
}: {
  spaceId: string;
  onSettled?: () => void;
  onApprovals?: () => void;
  onHistory?: (activityId?: string) => void;
}) {
  const runtime = useSpaceRuntime(spaceId);
  const connection = useServiceConnection();
  const { colors } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    root: { gap: spacing[16] },
    sectionHeading: { fontSize: 17, fontWeight: "600", color: colors.ink, marginBottom: spacing[4] },
    syncCard: { backgroundColor: colors.warningSoft, borderRadius: workspaceTheme.radius.card, padding: spacing[16], gap: spacing[10], marginBottom: spacing[12] },
    syncTitle: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
    syncCaption: { ...workspaceTheme.typography.caption, color: colors.faint },
    timelineItem: { flexDirection: "row", alignItems: "flex-start", gap: spacing[14], paddingVertical: spacing[8] },
    node: { width: 28, height: 28, alignItems: "center", justifyContent: "center", marginTop: 2 },
    nodeCircle: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.faint },
    body: { flex: 1, gap: spacing[4] },
    title: { fontSize: 16, fontWeight: "600", color: colors.ink, lineHeight: 22 },
    subtitle: { fontSize: 14, color: colors.muted, lineHeight: 20 },
    meta: { fontSize: 13, color: colors.faint, marginTop: spacing.xxs },
    danger: { color: colors.danger },
    sublist: { gap: spacing[8], paddingTop: spacing[8], paddingLeft: spacing[4] },
    subRow: { flexDirection: "row", alignItems: "center", gap: spacing[8] },
    subText: { fontSize: 13, color: colors.muted },
    subCaption: { fontSize: 12, color: colors.faint },
    approvalNotice: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[6],
      backgroundColor: colors.warningSoft,
      paddingHorizontal: spacing[12],
      paddingVertical: spacing[8],
      borderRadius: workspaceTheme.radius.round,
      alignSelf: "flex-start",
      marginTop: spacing[6],
    },
    approvalText: { fontSize: 13, fontWeight: "500", color: colors.warning },
    pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  }), [colors]);

  const settled = runtime.runs.some((run) => run.status !== "running");
  const signature = runtime.runs.map((run) => `${run.runId}:${run.status}`).join("|");
  useEffect(() => {
    if (settled) onSettled?.();
  }, [settled, signature, onSettled]);

  return (
    <View style={styles.root}>
      {!runtime.synchronized && <View style={styles.syncCard}>
        <Text accessibilityRole="alert" style={styles.syncTitle}>{runtime.label}</Text>
        <Text style={styles.syncCaption}>以下为最后观测状态，不表示运行已停止。</Text>
        <ActionButton label="重新同步运行状态" text="重新同步" tone="primary" onPress={() => { runtime.retry(); connection?.retry(); }} />
      </View>}

      <Text style={styles.sectionHeading}>今天</Text>

      {runtime.synchronized && runtime.runs.length === 0 && (
        <View style={styles.timelineItem}>
          <View style={styles.node}>
            <View style={styles.nodeCircle} />
          </View>
          <View style={styles.body}>
            <Text style={styles.title}>当前没有进行中的执行</Text>
            <Text style={styles.subtitle}>新运行开始后，此处显示执行、工具与子代理进展。</Text>
          </View>
        </View>
      )}

      {runtime.runs.map((run) => {
        const Icon = run.status === "succeeded" ? Check : run.status === "failed" ? X : CirclePause;
        const canOpenHistory = run.activityId !== null && onHistory;

        const content = (
          <View key={run.runId} style={styles.timelineItem}>
            <View style={styles.node}>
              {run.status === "running" ? (
                runtime.synchronized ? (
                  <ActivityIndicator color={colors.ink} size="small" />
                ) : (
                  <Radio size={20} color={colors.muted} />
                )
              ) : (
                <Icon
                  size={20}
                  color={run.status === 'failed' ? colors.danger : run.status === 'succeeded' ? colors.success : colors.muted}
                />
              )}
            </View>
            <View style={styles.body}>
              <Text style={styles.title}>{run.title}</Text>
              <Text style={[styles.subtitle, run.status === 'failed' && styles.danger]}>{run.label}</Text>
              <Text style={styles.meta}>
                {run.source === "job" ? "定时任务执行" : "聊天执行"}
                {run.status !== "running" ? " · 最近观测结果" : ""}
              </Text>

              {!!run.tools.length && (
                <View style={styles.sublist}>
                  {run.tools.map((tool) => (
                    <View key={`${tool.subagentId ?? "parent"}:${tool.toolCallId}`} style={styles.subRow}>
                      <Wrench size={14} color={colors.faint} />
                      <Text style={styles.subText}>{tool.label}</Text>
                      <Text style={styles.subCaption}>
                        {tool.subagentId ? "子代理" : "主会话"} · {tool.status === "waiting_approval" ? "待审批" : "执行中"}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {!!run.subagents.length && (
                <View style={styles.sublist}>
                  {run.subagents.map((child) => (
                    <View key={child.id} style={styles.subRow}>
                      <Workflow size={14} color={colors.faint} />
                      <Text style={styles.subText}>{child.role} · {child.label}</Text>
                      <Text style={styles.subCaption}>{subagentStatus(child.status)}</Text>
                    </View>
                  ))}
                </View>
              )}

              {!!run.pendingApprovalIds.length && onApprovals && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="查看待审批"
                  onPress={onApprovals}
                  style={({ pressed }) => [styles.approvalNotice, pressed && styles.pressed]}
                >
                  <ShieldAlert size={14} color={colors.warning} />
                  <Text style={styles.approvalText}>等待 {run.pendingApprovalIds.length} 项审批</Text>
                  <ChevronRight size={14} color={colors.warning} />
                </Pressable>
              )}
            </View>
          </View>
        );

        if (canOpenHistory) {
          return (
            <Pressable
              key={run.runId}
              onPress={() => onHistory(run.activityId!)}
              style={({ pressed }) => [pressed && styles.pressed]}
            >
              {content}
            </Pressable>
          );
        }
        return content;
      })}
    </View>
  );
}

function subagentStatus(status: AgentStatus["subagents"][number]["status"]) {
  return { queued: "等待执行名额", running: "执行中", succeeded: "已完成", failed: "执行失败", cancelled: "已停止" }[status];
}
