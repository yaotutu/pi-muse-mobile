/** 会话重置只在设置页发起；独立原生窗口隔离背景触控与读屏，并固定本次操作的目标空间。 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Square, SquareCheck } from 'lucide-react-native';
import { useSpaceState, useSpaceStore } from '../spaces/SpaceProvider';
import { MAIN_SPACE } from '../spaces/space-state';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { ActionButton } from '../ui/ActionButton';
import { Card } from '../ui/Surfaces';
import { useReducedMotion } from './primitives';

export function ResetSessionDialog({ spaceId, available, error, onCancel, onConfirm }: {
  spaceId: string;
  available: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (spaceId: string, clearSchedules: boolean) => Promise<void>;
}) {
  const [clearSchedules, setClearSchedules] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const session = useSpaceState(spaceId);
  const sessions = useSpaceStore();
  const reducedMotion = useReducedMotion();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const busy = submitting || session.resetting;
  const disabled = busy || !available || session.resetUncertain || !sessions.canWrite(spaceId) || sessions.hasSettingsWrite(spaceId);
  const CheckIcon = clearSchedules ? SquareCheck : Square;
  const cancel = () => { if (!busy) onCancel(); };
  const confirm = async () => {
    if (disabled) return;
    setSubmitting(true);
    try { await onConfirm(spaceId, clearSchedules); } finally { setSubmitting(false); }
  };

  return <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={cancel} testID="workspace-reset-dialog">
    <ThemeStatusBar />
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭重置确认" disabled={busy} onPress={cancel} />
      <Card style={styles.dialog} tone="warning" accessibilityViewIsModal>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text accessibilityRole="header" style={styles.title}>重置当前会话？</Text>
          <Text selectable style={styles.target}>目标空间：{spaceId === MAIN_SPACE ? '主空间' : spaceId}</Text>
          <Text style={styles.detail}>重置将停止当前运行，清空聊天历史与未完成的审批，开启全新对话。空间规则、技能开关与已保存的工作区文件都会保留。</Text>
          <Pressable accessibilityRole="checkbox" accessibilityLabel="同时清理定时任务与网页监控"
            accessibilityState={{ checked: clearSchedules, disabled: busy }} disabled={busy}
            onPress={() => setClearSchedules((value) => !value)} style={styles.option}>
            <CheckIcon size={workspaceTheme.layout.iconSize} color={clearSchedules ? colors.blue : colors.faint} />
            <Text style={styles.optionText}>{clearSchedules ? '已选择：' : '未选择：'}同时清理此空间下的定时任务与网页监控</Text>
          </Pressable>
          <Text style={styles.caption}>默认保留定时任务与监控，并由服务端绑定到新会话。清空的聊天历史无法恢复。</Text>
          {session.resetUncertain && <Text accessibilityRole="alert" style={styles.error}>重置结果未确认，请关闭对话框并刷新空间列表核对；不会自动重试。</Text>}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <ActionButton label="确认重置会话" text={busy ? '正在重置…' : '确认重置'} tone="primary" busy={busy} disabled={disabled} onPress={() => void confirm()} />
            <ActionButton label="取消重置会话" text="取消" disabled={busy} onPress={cancel} />
          </View>
        </ScrollView>
      </Card>
    </View>
  </Modal>;
}

function createStyles(c: WorkspaceColors) {
  const { layout: l, typography: t } = workspaceTheme;
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: l.sidePadding, backgroundColor: c.overlay },
    dialog: { width: '100%', maxWidth: l.resetDialogMaxWidth, maxHeight: '100%', padding: 0 },
    scroll: { flexShrink: 1 },
    content: { padding: spacing[20], gap: spacing[16] },
    title: { ...t.itemTitle, color: c.ink },
    target: { ...t.detail, color: c.ink },
    detail: { ...t.detail, color: c.muted },
    option: { flexDirection: 'row', alignItems: 'center', gap: spacing[14], paddingVertical: spacing[12] },
    optionText: { ...t.detail, color: c.muted, flex: 1 },
    caption: { ...t.caption, color: c.faint },
    error: { ...t.caption, color: c.danger },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
  });
}
