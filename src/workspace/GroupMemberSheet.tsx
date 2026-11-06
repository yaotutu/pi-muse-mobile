import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { sizing, spacing, themeTokens } from '../theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { IconControl } from '../ui/IconControl';
import { useReducedMotion } from '../ui/use-reduced-motion';
import { MemberAvatar } from './MemberAvatar';
import { filterMembers } from './primary-nav';

export { filterMembers };

export type GroupMemberItem = {
  id: string;
  name: string;
};

export type GroupMemberSheetProps = {
  visible: boolean;
  agents: readonly GroupMemberItem[];
  memberIds: readonly string[];
  defaultAgentId?: string;
  onMention: (agentId: string) => void;
  onPrivateChat: (agentId: string) => void;
  onClose: () => void;
};

export function GroupMemberSheet({
  visible,
  agents,
  memberIds,
  defaultAgentId,
  onMention,
  onPrivateChat,
  onClose,
}: GroupMemberSheetProps) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const compact = width < themeTokens.layout.sheetCompactBreakpoint;

  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterMembers(agents, query), [agents, query]);

  if (!visible) return null;

  return (
    <Modal
      testID="group-member-sheet"
      accessibilityLabel="群聊成员面板"
      accessibilityViewIsModal
      transparent
      animationType={reducedMotion ? 'none' : compact ? 'slide' : 'fade'}
      visible={visible}
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

          {/* 顶栏：标题与关闭按钮 */}
          <View style={[styles.header, { borderBottomColor: c.line }]}>
            <View style={styles.titleArea}>
              <Text accessibilityRole="header" style={[styles.title, { color: c.ink }]}>
                群聊成员
              </Text>
              <Text style={[styles.subtitle, { color: c.muted }]}>
                共 {agents.length} 位成员
              </Text>
            </View>
            <IconControl
              icon={X}
              label="关闭成员面板"
              onPress={onClose}
              testID="group-member-sheet-close"
            />
          </View>

          {/* 搜索框 */}
          <View style={styles.searchRow}>
            <FormInput
              value={query}
              onChangeText={setQuery}
              placeholder="搜索成员名称或 ID"
              variant="search"
              accessibilityLabel="搜索成员"
              testID="group-member-search"
            />
          </View>

          {/* 成员列表 */}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            testID="group-member-list"
          >
            {filtered.length === 0 ? (
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: c.muted }]}>
                  {query.trim() ? '无匹配成员' : '暂无成员'}
                </Text>
              </View>
            ) : (
              filtered.map((agent) => {
                const inGroup = memberIds.includes(agent.id);
                const isDefault = agent.id === defaultAgentId;

                return (
                  <View
                    key={agent.id}
                    testID={`group-member-item-${agent.id}`}
                    style={[styles.memberRow, { borderBottomColor: c.line }]}
                  >
                    <MemberAvatar agentId={agent.id} size={sizing[36]} />
                    <View style={styles.memberInfo}>
                      <View style={styles.nameRow}>
                        <Text
                          numberOfLines={1}
                          style={[styles.memberName, { color: c.ink }]}
                        >
                          {agent.name}
                        </Text>
                        {isDefault && (
                          <View style={[styles.badge, { backgroundColor: c.blueSoft }]}>
                            <Text style={[styles.badgeText, { color: c.accentText }]}>
                              默认回复
                            </Text>
                          </View>
                        )}
                      </View>
                      {!inGroup && (
                        <Text style={[styles.caption, { color: c.muted }]}>
                          未加入组
                        </Text>
                      )}
                    </View>

                    <View style={styles.actionGroup}>
                      <ActionButton
                        label={inGroup ? `在群里@${agent.name}` : `${agent.name}未加入组，不可在群里@`}
                        text="在群里 @"
                        tone="secondary"
                        disabled={!inGroup}
                        onPress={() => onMention(agent.id)}
                        testID={`group-member-mention-${agent.id}`}
                      />
                      <ActionButton
                        label={`与${agent.name}单独聊`}
                        text="单独聊"
                        tone="primary"
                        onPress={() => onPrivateChat(agent.id)}
                        testID={`group-member-chat-${agent.id}`}
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
    padding: spacing.lg,
  },
  shadeCompact: {
    justifyContent: 'flex-end',
    padding: 0,
  },
  sheet: {
    width: '100%',
    maxWidth: themeTokens.layout.sheetMaxWidth,
    maxHeight: '85%',
    borderRadius: themeTokens.radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleArea: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...themeTokens.typography.section,
    fontWeight: '700',
  },
  subtitle: {
    ...themeTokens.typography.caption,
  },
  searchRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: spacing.sm,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  memberName: {
    ...themeTokens.typography.name,
    fontWeight: '600',
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: themeTokens.radius.round,
  },
  badgeText: {
    ...themeTokens.typography.caption,
    fontSize: 10,
    fontWeight: '600',
  },
  caption: {
    ...themeTokens.typography.caption,
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...themeTokens.typography.detail,
  },
});
