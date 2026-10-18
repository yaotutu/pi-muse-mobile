// 编辑器按入口互斥挂载，关闭弹层即丢弃未保存草稿。

import { Bot, Brain, ChevronRight, FileText, PanelsTopLeft, Server, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MemoryItem, WorkspaceSnapshot } from '../api/types';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { Sheet } from '../ui/Sheet';
import { Card, IconBox } from '../ui/Surfaces';
import { colors, sizing, spacing, typography } from '../ui/tokens';
import { UpdateEntry } from '../update/UpdateEntry';
import { useAppUpdate } from '../update/UpdateProvider';
import { IdentityCard } from './IdentityCard';
import { MemoryCard } from './MemoryCard';
import { ProfileCard } from './ProfileCard';

/** 三个入口的键：与 Sheet 当前打开项一一对应。 */
type Entry = 'identity' | 'memory' | 'profile';

/** 行摘要文案：列表每行第二行的小字，让用户不打开就知道现状。 */
const TONE_LABELS: Record<string, string> = { warm: '温和', concise: '简洁', thoughtful: '周到' };
const identitySummary = (name?: string, tone?: string) => {
  const parts = [name?.trim() ? name : '未设置名字', tone ? `语气 ${TONE_LABELS[tone] ?? tone}` : undefined];
  return parts.filter(Boolean).join(' · ');
};

const memorySummary = (memories: MemoryItem[]) =>
  memories.length === 0 ? '还没有记忆' : `${memories.length} 条记忆`;

/** SOUL/USER 走独立接口，本页拿不到其内容，摘要只说明这一段能做什么。 */
const PROFILE_SUMMARY = 'SOUL 助手人设 / USER 用户画像';

export function AppsScreen({
  snapshot,
  refresh,
  onPreview,
}: {
  snapshot: WorkspaceSnapshot | undefined;
  refresh: () => void;
  onPreview?: () => void;
}) {
  const [open, setOpen] = useState<Entry>();
  const connection = useServiceConnection();
  const update = useAppUpdate();
  const memories = snapshot?.memories ?? [];
  const identity = snapshot?.identity;

  const rows: {
    key: Entry;
    icon: LucideIcon;
    tint: string;
    title: string;
    detail: string;
  }[] = [
    {
      key: 'identity',
      icon: Bot,
      tint: colors.avatarSky,
      title: '助手偏好',
      detail: identitySummary(identity?.name, identity?.tone),
    },
    {
      key: 'memory',
      icon: Brain,
      tint: colors.avatarSand,
      title: '记忆',
      detail: memorySummary(memories),
    },
    {
      key: 'profile',
      icon: FileText,
      tint: colors.avatarLilac,
      title: '人设',
      detail: PROFILE_SUMMARY,
    },
  ];

  return (
    <View style={{ gap: spacing.lg }}>
      {onPreview && <Card>
        <Pressable accessibilityRole="button" accessibilityLabel="新 UI 预览" onPress={onPreview} style={styles.row}>
          <IconBox icon={PanelsTopLeft} size={sizing[36]} tint={colors.avatarLilac} />
          <View style={styles.rowText}>
            <Text style={{ ...typography.text, fontWeight: '600', color: colors.ink }}>新 UI 预览</Text>
            <Text style={{ ...typography.small, color: colors.muted }}>截图还原 · 独立假数据，不影响当前工作区</Text>
          </View>
          <ChevronRight size={sizing[15]} color={colors.muted} />
        </Pressable>
      </Card>}
      {connection?.snapshot.serverUrl && <Card>
        <Pressable accessibilityRole="button" onPress={connection.changeServer} style={styles.row}>
          <IconBox icon={Server} size={sizing[36]} tint={colors.sky} />
          <View style={styles.rowText}>
            <Text style={{ ...typography.text, fontWeight: '600', color: colors.ink }}>服务器连接</Text>
            <Text style={{ ...typography.small, color: colors.muted }} numberOfLines={2}>{connection.snapshot.serverUrl}</Text>
            <Text style={{ ...typography.small, color: colors.muted }}>{connection.snapshot.status === 'offline' ? '连接失败，可原址重试或主动更改' : '当前唯一服务器 · 点击更改'}</Text>
          </View>
          <ChevronRight size={sizing[15]} color={colors.muted} />
        </Pressable>
      </Card>}
      {update && <UpdateEntry snapshot={update.snapshot} onPress={update.open} />}
      {/* 入口列表装在一张卡里：行间用发丝线分隔，卡外不再套第二层卡。 */}
      {snapshot && <Card style={{ paddingVertical: spacing[6] }}>
        {rows.map((row, index) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            onPress={() => setOpen(row.key)}
            style={({ pressed }) => [
              styles.row,
              index > 0 && { borderTopWidth: sizing.borderWidth, borderTopColor: colors.line },
              pressed && { opacity: 0.6 },
            ]}
          >
            <IconBox icon={row.icon} size={sizing[36]} tint={row.tint} iconColor={colors.ink} />
            <View style={styles.rowText}>
              <Text style={{ ...typography.text, fontWeight: '600', color: colors.ink }}>
                {row.title}
              </Text>
              <Text style={{ ...typography.small, color: colors.muted }} numberOfLines={1}>
                {row.detail}
              </Text>
            </View>
            <ChevronRight size={sizing[15]} color={colors.muted} />
          </Pressable>
        ))}
      </Card>}

      {/* Sheet 统一关闭：任一入口关闭都只回到列表页，弹层内草稿状态随之卸载。 */}
      {open === 'identity' && (
        <Sheet title="助手偏好" subtitle="名字、语气、头像与进度更新" onClose={() => setOpen(undefined)}>
          <IdentityCard identity={identity} refresh={refresh} embedded />
        </Sheet>
      )}
      {open === 'memory' && (
        <Sheet title="记忆" subtitle="检索、编辑与遗忘" onClose={() => setOpen(undefined)}>
          <MemoryCard memories={memories} refresh={refresh} embedded />
        </Sheet>
      )}
      {open === 'profile' && (
        <Sheet title="人设" subtitle="SOUL 与 USER 文本" onClose={() => setOpen(undefined)}>
          <ProfileCard embedded />
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    minHeight: sizing.touchTarget,
  },
  rowText: { flex: 1, gap: spacing[2] },
});
