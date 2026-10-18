import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../ui/Buttons';
import { Sheet } from '../ui/Sheet';
import { colors, radius, spacing, typography } from '../ui/tokens';
import { useDemo } from './DemoProvider';

export function DemoBanner() {
  const demo = useDemo();
  const [open, setOpen] = useState(false);
  if (!demo) return null;
  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}
        style={{ marginHorizontal: spacing[20], marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing[7], borderRadius: radius.notice, backgroundColor: colors.waiting }}>
        <Text style={{ ...typography.small, color: colors.ink, textAlign: 'center' }}>演示数据 · 不执行真实操作　管理演示</Text>
      </Pressable>
      {open && <Sheet title="演示工作区" subtitle="与真实服务完全隔离，退出或重置后不保留更改。" onClose={() => setOpen(false)}>
        <View style={{ gap: spacing.md }}>
          <Text style={{ ...typography.muted, color: colors.muted }}>可以体验聊天工具卡、审批、任务和目标。批准演示审批不会写文件或执行真实任务。</Text>
          {demo.preview && <Button primary onPress={() => { setOpen(false); demo.preview?.(); }}>新 UI 预览</Button>}
          <Button onPress={() => demo.reset()}>重置为示例工作区</Button>
          <Button onPress={() => demo.reset(true)}>重置为空工作区</Button>
          <Button primary onPress={demo.exit}>退出演示，返回服务连接</Button>
        </View>
      </Sheet>}
    </>
  );
}
