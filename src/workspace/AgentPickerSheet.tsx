/**
 * 完整智能体选择面板（"更多"面板）。
 *
 * 契约与交互边界：
 * 1. 列表稳定排序：展示全部 Agent 列表，严格按传入顺序渲染，不做动态重排或随选中态跳动。
 * 2. 本地搜索：本地大小写不敏感子串搜索，同时匹配智能体名称与 ID；搜索时仍保持稳定原序。
 * 3. 固定状态与上限：已固定项标记"已固定"；当固定数达到 pinLimit（默认 3）时，未固定项的操作禁用并提示"底部固定已满"；已固定项可自由取消固定。
 * 4. 入口与回调：支持直接选择切换聊天、单独进入设置、打开智能体管理（如提供）、关闭面板。
 * 5. 形态与无障碍：近全屏 Modal Sheet 形态，与现有面板规范一致，具备完整中文读屏标签与 44dp 触控区。
 */

import { useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pin, Search, Settings, X } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { sizing, spacing, themeTokens } from '../theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { IconControl } from '../ui/IconControl';
import { useReducedMotion } from '../ui/use-reduced-motion';
import { MemberAvatar } from './MemberAvatar';
import { DOCK_PIN_LIMIT } from './dock-preferences';

export type AgentPickerItem = {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
};

export type AgentPickerSheetProps = {
  agents: readonly AgentPickerItem[];
  currentId?: string;
  pinnedIds: readonly string[];
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onOpenManage?: () => void;
  onClose: () => void;
  pinLimit?: number;
};

/**
 * 纯函数：本地大小写不敏感子串匹配（同时匹配 id 与 name）。
 * 保持原数组顺序不变，不进行动态重排。
 */
export function filterAgents<T extends { id: string; name: string }>(
  agents: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...agents];
  return agents.filter(
    (item) => item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q),
  );
}

export function AgentPickerSheet({
  agents,
  currentId,
  pinnedIds,
  onSelect,
  onTogglePin,
  onOpenSettings,
  onOpenManage,
  onClose,
  pinLimit = DOCK_PIN_LIMIT,
}: AgentPickerSheetProps) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const compact = width < themeTokens.layout.sheetCompactBreakpoint;

  const [query, setQuery] = useState('');
  const isFull = pinnedIds.length >= pinLimit;
  const filtered = useMemo(() => filterAgents(agents, query), [agents, query]);

  return (
    <Modal
      testID="agent-picker-sheet"
      accessibilityLabel="智能体选择与固定管理"
      accessibilityViewIsModal
      transparent
      animationType={reducedMotion ? 'none' : compact ? 'slide' : 'fade'}
      visible
      onRequestClose={onClose}
    >
      <ThemeStatusBar />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.shade, { backgroundColor: c.scrim }, compact && styles.shadeCompact]}
        enabled={Platform.OS !== 'web'}
      >
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.canvas, borderColor: c.line },
            compact && {
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          {compact && <View style={[styles.grabber, { backgroundColor: c.control }]} />}

          {/* 顶栏：标题、管理入口、关闭按钮 */}
          <View style={[styles.header, { borderBottomColor: c.line }]}>
            <View style={styles.titleArea}>
              <Text accessibilityRole="header" style={[styles.title, { color: c.ink }]}>
                选择智能体
              </Text>
              <Text style={[styles.subtitle, { color: c.muted }]}>
                已固定 {pinnedIds.length}/{pinLimit} 个
              </Text>
            </View>
            <View style={styles.headerActions}>
              {onOpenManage && (
                <ActionButton
                  testID="agent-picker-manage"
                  label="管理智能体"
                  text="管理"
                  icon={Settings}
                  tone="secondary"
                  onPress={onOpenManage}
                />
              )}
              <IconControl
                testID="agent-picker-close"
                icon={X}
                label="关闭智能体选择面板"
                onPress={onClose}
                small
              />
            </View>
          </View>

          {/* 搜索栏：大小写不敏感本地搜索 */}
          <View style={styles.searchSection}>
            <View
              style={[
                styles.searchBox,
                { backgroundColor: c.surface, borderColor: c.line },
              ]}
            >
              <Search size={18} color={c.faint} />
              <FormInput
                testID="agent-picker-search"
                variant="search"
                accessibilityLabel="搜索智能体"
                placeholder="搜索智能体名称或 ID"
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
              />
              {query ? (
                <IconControl
                  icon={X}
                  label="清空搜索"
                  onPress={() => setQuery('')}
                  small
                />
              ) : null}
            </View>
            {isFull && (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.limitNotice, { color: c.warning }]}
              >
                底部固定已满（最多 {pinLimit} 个），需先取消固定才能添加新项
              </Text>
            )}
          </View>

          {/* 列表：稳定顺序展示 */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {filtered.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, { color: c.muted }]}>未找到匹配的智能体</Text>
              </View>
            ) : (
              filtered.map((agent) => {
                const isPinned = pinnedIds.includes(agent.id);
                const isSelected = currentId === agent.id;
                const pinDisabled = !isPinned && isFull;

                return (
                  <View
                    key={agent.id}
                    testID={`agent-picker-item-${agent.id}`}
                    style={[
                      styles.agentRow,
                      { backgroundColor: c.surface, borderColor: isSelected ? c.accentText : c.line },
                    ]}
                  >
                    {/* 点击主体切换会话并关闭面板 */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`选择${agent.name}`}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => {
                        onSelect(agent.id);
                        onClose();
                      }}
                      style={({ pressed }) => [
                        styles.agentInfo,
                        { opacity: pressed ? themeTokens.interaction.pressedOpacity : 1 },
                      ]}
                    >
                      <View style={styles.avatarContainer}>
                        {agent.avatar ? (
                          <Image
                            source={{ uri: agent.avatar }}
                            resizeMode="cover"
                            style={styles.avatarImage}
                          />
                        ) : (
                          <MemberAvatar agentId={agent.id} size={36} />
                        )}
                      </View>
                      <View style={styles.textContainer}>
                        <View style={styles.nameRow}>
                          <Text numberOfLines={1} style={[styles.agentName, { color: c.ink }]}>
                            {agent.name}
                          </Text>
                          {isSelected && (
                            <Text style={[styles.currentBadge, { color: c.accentText }]}>当前</Text>
                          )}
                        </View>
                        <Text numberOfLines={1} style={[styles.agentId, { color: c.faint }]}>
                          {agent.id}
                        </Text>
                      </View>
                    </Pressable>

                    {/* 操作区：固定/取消固定 + 设置 */}
                    <View style={styles.rowActions}>
                      <ActionButton
                        testID={`agent-picker-pin-${agent.id}`}
                        label={isPinned ? '取消固定' : pinDisabled ? '底部固定已满' : '固定到底部'}
                        text={isPinned ? '已固定' : '固定'}
                        accessibilityLabel={isPinned ? `取消固定${agent.name}` : pinDisabled ? '底部固定已满' : `固定${agent.name}到底部`}
                        icon={Pin}
                        tone={isPinned ? 'primary' : 'secondary'}
                        disabled={pinDisabled}
                        onPress={() => onTogglePin(agent.id)}
                      />
                      <ActionButton
                        testID={`agent-picker-settings-${agent.id}`}
                        label={`打开${agent.name}设置`}
                        text="设置"
                        tone="secondary"
                        onPress={() => onOpenSettings(agent.id)}
                      />
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[20],
  },
  shadeCompact: {
    padding: 0,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderRadius: themeTokens.radius.card,
    width: themeTokens.layout.fullWidth,
    maxWidth: themeTokens.layout.sheetMaxWidth,
    maxHeight: themeTokens.layout.sheetMaxHeight,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  grabber: {
    alignSelf: 'center',
    width: sizing[34],
    height: sizing[4],
    borderRadius: themeTokens.radius.round,
    marginTop: spacing[10],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[20],
    paddingVertical: spacing[16],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleArea: {
    flex: 1,
    gap: spacing[2],
  },
  title: {
    ...themeTokens.typography.section,
  },
  subtitle: {
    ...themeTokens.typography.caption,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
  },
  searchSection: {
    paddingHorizontal: spacing[16],
    paddingTop: spacing[12],
    paddingBottom: spacing[8],
    gap: spacing[6],
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[8],
    paddingHorizontal: spacing[12],
    borderRadius: themeTokens.radius.field,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: sizing.inputMinHeight,
  },
  limitNotice: {
    ...themeTokens.typography.caption,
    paddingHorizontal: spacing[4],
  },
  listContent: {
    paddingHorizontal: spacing[16],
    paddingBottom: spacing[24],
    gap: spacing[8],
  },
  emptyContainer: {
    paddingVertical: spacing[34],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...themeTokens.typography.detail,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[10],
    borderRadius: themeTokens.radius.listItem,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[8],
  },
  agentInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[10],
    minWidth: 0,
    minHeight: sizing.touchTarget,
  },
  avatarContainer: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 13,
  },
  textContainer: {
    flex: 1,
    minWidth: 0,
    gap: spacing[2],
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[6],
  },
  agentName: {
    ...themeTokens.typography.itemTitle,
    flexShrink: 1,
  },
  currentBadge: {
    ...themeTokens.typography.caption,
    fontWeight: '600',
  },
  agentId: {
    ...themeTokens.typography.caption,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[6],
  },
});
