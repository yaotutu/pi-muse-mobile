/**
 * 底部固定 Agent 导航栏组件。
 *
 * 产品契约与交互边界：
 * 1. 底栏五格布局：全部 + 3 个用户固定 Agent + 更多。位置完全静态：不随活跃度排序、不因当前对象变形、"更多"按钮永不变成头像。
 * 2. 顺序与上限：固定顺序即传入数组顺序，固定槽上限 3；超出数量不在此展示（收进"更多"面板）。
 * 3. 选中态呈现：当前聊天对象若不在固定槽内，底栏不高亮任何固定格，"全部"仅在当前为全部视图 (currentId === 'group') 时高亮。
 * 4. 状态角标：复用 AgentStatusBadge 状态语义（工作/待处理/问题/未知），空闲无角标，不加未读数。
 * 5. 尺寸与无障碍：44dp 最小命中区，等宽 flex 适配 320dp 窄屏，纯语义颜色消费，读屏 role/label/state 齐全。
 */

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MoreHorizontal, Users } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, themeTokens } from '../theme/tokens';
import { AgentStatusBadge, avatarStatusLabel, type AvatarStatus } from './AgentStatusBadge';
import { MemberAvatar } from './MemberAvatar';
import { DOCK_PIN_LIMIT } from './dock-preferences';

export const DOCK_SLOT_COUNT = 5;
export const DOCK_FIXED_SLOT_COUNT = DOCK_PIN_LIMIT;

export type DockAgent = {
  id: string;
  name: string;
  avatar?: string;
};

export type AgentDockProps = {
  agents: readonly DockAgent[];
  currentId: string;
  status: (id: string) => AvatarStatus;
  onSelect: (id: string) => void;
  onOpenMore: () => void;
  disabled?: boolean;
};

export function AgentDock({
  agents,
  currentId,
  status,
  onSelect,
  onOpenMore,
  disabled = false,
}: AgentDockProps) {
  const { colors: c } = useTheme();
  const isAllActive = currentId === 'group';

  // 固定槽位最多 3 格，按传入数组顺序静态展示，不做动态重排
  const fixedSlots = Array.from({ length: DOCK_FIXED_SLOT_COUNT }, (_, index) => agents[index]);

  return (
    <View
      testID="agent-dock"
      accessibilityRole="tablist"
      accessibilityLabel="底部导航栏"
      style={[styles.container, { backgroundColor: c.canvas, borderTopColor: c.line }]}
    >
      {/* 格 0: 全部视图 */}
      <Pressable
        testID="agent-dock-all"
        accessibilityRole="tab"
        accessibilityLabel="切换到全部"
        accessibilityState={{ selected: isAllActive, disabled }}
        accessibilityHint="点击切换到全部视图"
        disabled={disabled}
        onPress={() => {
          if (!isAllActive && !disabled) onSelect('group');
        }}
        style={({ pressed }) => [
          styles.slot,
          { opacity: disabled ? themeTokens.interaction.disabledOpacity : pressed ? themeTokens.interaction.pressedOpacity : 1 },
        ]}
      >
        <View
          style={[
            styles.avatarRing,
            { borderColor: isAllActive ? c.accentText : 'transparent' },
          ]}
        >
          <View
            style={[
              styles.allIconBox,
              { backgroundColor: isAllActive ? c.blueSoft : c.surface },
            ]}
          >
            <Users size={18} color={isAllActive ? c.accentText : c.muted} />
          </View>
        </View>
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            { color: isAllActive ? c.accentText : c.muted, fontWeight: isAllActive ? '600' : '400' },
          ]}
        >
          全部
        </Text>
      </Pressable>

      {/* 格 1~3: 用户固定 Agent 槽位；未固定的槽完全留白（不可点、读屏隐藏），固定操作只在「更多」面板 */}
      {fixedSlots.map((agent, index) => {
        const slotTestID = `agent-dock-slot-${index}`;
        if (!agent) {
          return (
            <View
              key={`empty-slot-${index}`}
              testID={slotTestID}
              style={styles.slot}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          );
        }

        const isActive = currentId === agent.id;
        const agentStatus = status(agent.id);

        return (
          <Pressable
            key={agent.id}
            testID={slotTestID}
            accessibilityRole="tab"
            accessibilityLabel={`切换到${agent.name}`}
            accessibilityState={{ selected: isActive, disabled }}
            accessibilityValue={{ text: avatarStatusLabel(agentStatus) }}
            accessibilityHint="点击切换到该智能体聊天"
            disabled={disabled}
            onPress={() => {
              if (!isActive && !disabled) onSelect(agent.id);
            }}
            style={({ pressed }) => [
              styles.slot,
              { opacity: disabled ? themeTokens.interaction.disabledOpacity : pressed ? themeTokens.interaction.pressedOpacity : 1 },
            ]}
          >
            <View
              style={[
                styles.avatarRing,
                { borderColor: isActive ? c.accentText : 'transparent' },
              ]}
            >
              {agent.avatar ? (
                <Image
                  source={{ uri: agent.avatar }}
                  resizeMode="cover"
                  style={styles.avatarImage}
                />
              ) : (
                <MemberAvatar agentId={agent.id} size={30} />
              )}
              <AgentStatusBadge state={agentStatus} />
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: isActive ? c.accentText : c.muted, fontWeight: isActive ? '600' : '400' },
              ]}
            >
              {agent.name}
            </Text>
          </Pressable>
        );
      })}

      {/* 格 4: 更多按钮（静态动作格，永不变成头像，不高亮当前对象） */}
      <Pressable
        testID="agent-dock-more"
        accessibilityRole="button"
        accessibilityLabel="更多智能体"
        accessibilityHint="打开全部智能体选择面板"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          if (!disabled) onOpenMore();
        }}
        style={({ pressed }) => [
          styles.slot,
          { opacity: disabled ? themeTokens.interaction.disabledOpacity : pressed ? themeTokens.interaction.pressedOpacity : 1 },
        ]}
      >
        <View style={[styles.avatarRing, { borderColor: 'transparent' }]}>
          <View style={[styles.allIconBox, { backgroundColor: c.surface }]}>
            <MoreHorizontal size={20} color={c.muted} />
          </View>
        </View>
        <Text numberOfLines={1} style={[styles.label, { color: c.muted, fontWeight: '400' }]}>
          更多
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  slot: {
    flex: 1,
    minWidth: 0,
    minHeight: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  avatarRing: {
    padding: spacing[2],
    borderRadius: themeTokens.radius.round,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 30,
    height: 30,
    borderRadius: 11,
  },
  allIconBox: {
    width: 30,
    height: 30,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...themeTokens.typography.navigation,
    maxWidth: '100%',
    textAlign: 'center',
  },
});
