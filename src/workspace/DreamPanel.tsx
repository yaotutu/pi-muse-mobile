import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useDream } from '../dream/DreamProvider';
import { DREAM_PROMPT_LIMIT, type DreamTarget } from '../dream/types';
import { useSessionDirectoryStore } from '../sessions/SessionProvider';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { ChoiceChip } from '../ui/ChoiceChip';
import { FormInput } from '../ui/FormInput';
import { spacing } from '../ui/tokens';

const targets: readonly [DreamTarget, string][] = [['user', '用户资料'], ['soul', '助手人设'], ['instructions', '来源会话指令'], ['memory', '长期记忆']];
/** 全局整理页面不切换会话、不建立额外上下文；待决项完整正文与实际目标先确认再提交。 */
export function DreamPanel() {
  const { store, snapshot } = useDream(); const directory = useSessionDirectoryStore(); const { colors } = useTheme();
  const [chosen, setChosen] = useState<Record<string, DreamTarget>>({}); const [confirm, setConfirm] = useState<{ id: string; action: 'apply' | 'dismiss' }>();
  const [showDefault, setShowDefault] = useState(false);
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  const overview = snapshot.overview;
  return <View style={{ gap: spacing[12] }} testID="dream-panel">
    <ActionButton label="刷新 Dream 概览" onPress={() => void store.refresh()} disabled={snapshot.loading || snapshot.writing} />
    {snapshot.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{snapshot.error}</Text>}
    {snapshot.stale && <Text style={{ color: colors.warning }}>状态待核对，读取失败保留上次内容；请求中断不表示远端停止。</Text>}
    {snapshot.uncertain && <ActionButton label="已回读核对 Dream 结果，解除锁定" disabled={!snapshot.reviewed} onPress={store.acknowledgeReviewed} />}
    {overview && <>
      <Text style={{ color: colors.ink }}>实例全局整理 · 每 {overview.intervalHours} 小时检查 · {overview.running ? '整理中' : '未运行'}</Text>
      <ChoiceChip label="启用定期记忆整理" selected={snapshot.enabled} onPress={() => store.setDraft({ enabled: !snapshot.enabled })} disabled={snapshot.writing} />
      <FormInput accessibilityLabel="全局 Dream 提示词" value={snapshot.prompt} multiline maxLength={DREAM_PROMPT_LIMIT} editable={!snapshot.writing} onChangeText={(prompt) => store.setDraft({ prompt })} />
      <ActionButton label="保存 Dream 设置" disabled={!store.canWrite() || !snapshot.dirty} onPress={() => void store.save()} />
      <ActionButton label="放弃 Dream 设置草稿" disabled={snapshot.writing} onPress={store.discard} />
      <ActionButton label="查看内置默认提示词" onPress={() => setShowDefault(!showDefault)} />{showDefault && <Text selectable style={{ color: colors.muted }}>{overview.defaultPrompt}</Text>}
      <ActionButton label="立即整理" disabled={!store.canRun()} onPress={() => void store.runNow()} />
      {overview.lastRun && <Text selectable style={{ color: colors.muted }}>最近整理：{overview.lastRun.status} · {overview.lastRun.processed} 条消息 · {overview.lastRun.error ?? ''}</Text>}
      {overview.pending.map((item) => {
        const target = chosen[item.id] ?? item.suggestedTarget;
        const sourceMissing = !!item.sourceSessionId && !directory.records.some((session) => session.id === item.sourceSessionId);
        return <View key={item.id} style={{ gap: spacing[8], paddingVertical: spacing[12] }}>
          <Text selectable style={{ color: colors.ink }}>{item.text}</Text><Text style={{ color: colors.muted }}>来源会话：{item.sourceSessionId ?? '未提供'} · {item.reason}</Text>
          {sourceMissing && <Text style={{ color: colors.warning }}>来源会话已不存在，不会重建；不能应用到已删除会话的指令。</Text>}
          {targets.map(([value, label]) => <ChoiceChip key={value} label={label} selected={target === value} disabled={!store.canWrite() || (sourceMissing && value === 'instructions')} onPress={() => { setChosen({ ...chosen, [item.id]: value }); setConfirm(undefined); }} />)}
          <ActionButton label="应用建议" disabled={!store.canWrite() || (sourceMissing && target === 'instructions')} onPress={() => setConfirm({ id: item.id, action: 'apply' })} />
          <ActionButton label="忽略建议" disabled={!store.canWrite()} onPress={() => setConfirm({ id: item.id, action: 'dismiss' })} />
          {confirm?.id === item.id && <><Text style={{ color: colors.warning }}>确认{confirm.action === 'apply' ? `将完整正文写入${targets.find(([value]) => value === target)?.[1]}？全局资料影响所有会话。` : '忽略此建议？'}</Text>
            <ActionButton label="确认处理建议" disabled={!store.canWrite() || (confirm.action === 'apply' && sourceMissing && target === 'instructions')} onPress={() => { void store.resolvePending(item.id, confirm.action, target); setConfirm(undefined); }} /><ActionButton label="取消处理建议" onPress={() => setConfirm(undefined)} /></>}
        </View>;
      })}
    </>}
  </View>;
}
