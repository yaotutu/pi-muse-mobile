import { useMemo, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus, Search, Settings, Users, X } from 'lucide-react-native';
import type { SpaceEntry } from '../api/types';
import type { GroupPreview } from '../group/contracts';
import { useSpaceRuntime } from '../runtime/RuntimeProvider';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { IconControl } from '../ui/IconControl';
import { spacing, sizing, workspaceTheme } from '../ui/tokens';
import { MemberAvatar } from './MemberAvatar';
import { memberDescription, type SpaceLabels } from './space-labels';

const mainShortcutSize = 56;

/** 列表不另建聊天存储；点头像看主页，点消息行才进入对应 Space 的真实私聊。 */
export function MemberDirectory({ spaces, labels, error, creating, groupPreview, onReload, onChat, onProfile, onCreate, onSettings, onGroup }: {
  spaces: SpaceEntry[]; labels: SpaceLabels; error?: string; creating: boolean; groupPreview: GroupPreview;
  onReload: () => void; onChat: (id: string) => void; onProfile: (id: string) => void; onCreate: () => void; onSettings: () => void; onGroup: () => void;
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState<string | null>(null);
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1 }, header: { paddingHorizontal: workspaceTheme.layout.sidePadding, paddingVertical: spacing[12], flexDirection: 'row', alignItems: 'center', gap: spacing[6] },
    title: { ...workspaceTheme.typography.heroName, color: colors.ink, flex: 1 },
    intro: { paddingHorizontal: workspaceTheme.layout.sidePadding, paddingBottom: spacing[18], gap: spacing[4] },
    eyebrow: { ...workspaceTheme.typography.eyebrow, color: colors.accentText }, caption: { ...workspaceTheme.typography.caption, color: colors.muted },
    search: { marginHorizontal: workspaceTheme.layout.sidePadding, marginBottom: spacing[12] },
    // 列表底部留出快捷头像、外边距与行间隙，最后一行仍能完整滚出遮挡区。
    content: { paddingHorizontal: workspaceTheme.layout.sidePadding, paddingBottom: mainShortcutSize + spacing[8] * 2 + spacing[18] + spacing[22] },
    shortcut: { position: 'absolute', right: workspaceTheme.layout.sidePadding, bottom: spacing[18], padding: spacing[8], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface, borderWidth: sizing.borderWidth, borderColor: colors.line },
    utility: { backgroundColor: 'transparent', borderColor: 'transparent' },
  }), [colors]);
  const filtered = spaces.filter((space) => `${labels.title(space.id)} ${space.id}`.toLowerCase().includes(query?.trim().toLowerCase() ?? ''));
  const latest = groupPreview.latest;
  const groupDescription = latest ? `${latest.sender ? labels.title(latest.sender) : '我'}${latest.notification ? ' · 通知' : ''}：${latest.text}` : '默认 Muse 回复，@ 成员定向聊天';
  return <View style={styles.root} testID="conversation-list">
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>会话</Text>
      <IconControl icon={query === null ? Search : X} label={query === null ? '搜索成员' : '收起成员搜索'} style={styles.utility} onPress={() => { Keyboard.dismiss(); setQuery(query === null ? '' : null); }} />
      <IconControl icon={Plus} label={creating ? '正在添加成员' : '添加成员'} busy={creating} style={styles.utility} onPress={onCreate} />
      <IconControl icon={Settings} label="打开全局设置" style={styles.utility} onPress={onSettings} />
    </View>
    {query !== null && <FormInput autoFocus accessibilityLabel="搜索成员名称" placeholder="搜索成员" value={query} onChangeText={setQuery} style={styles.search} />}
    <View style={styles.intro}>
      <Text style={styles.eyebrow}>YOUR DAILY COMPANY</Text>
      <Text style={styles.caption}>一起聊，或找一位成员单独聊聊。</Text>
    </View>
    {!!error && <View style={styles.search}><FeedbackNotice tone="danger" text={error} /><ActionButton label="重新读取成员" text="重试" onPress={onReload} /></View>}
    <FlatList ListHeaderComponent={!query || '群聊'.includes(query.trim()) ? <Pressable accessibilityRole="button" accessibilityLabel="打开默认群聊" onPress={onGroup} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[14], paddingVertical: spacing[16], minHeight: 80 }}>
      <Users size={44} color={colors.accentText} />
      <View style={{ flex: 1, minWidth: 0, gap: spacing[6] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[8] }}>
          <Text numberOfLines={1} style={{ ...workspaceTheme.typography.itemTitle, color: colors.ink, flex: 1 }}>群聊</Text>
          {latest && <Text style={styles.caption}>{new Date(latest.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</Text>}
        </View>
        <Text numberOfLines={1} style={styles.caption}>{groupDescription}</Text>
        {groupPreview.error && <Text accessibilityRole="alert" style={{ ...workspaceTheme.typography.caption, color: colors.danger }}>群聊同步失败，进入群聊核对</Text>}
      </View>
    </Pressable> : undefined} data={filtered} keyExtractor={(space) => space.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}
      renderItem={({ item }) => <MemberRow space={item} name={labels.title(item.id)} onProfile={() => onProfile(item.id)} onPress={() => onChat(item.id)} />}
      ListEmptyComponent={<Text style={styles.caption}>没有找到成员</Text>} />
    <Pressable accessibilityRole="button" accessibilityLabel="回到群聊" testID="conversation-main-shortcut" onPress={onGroup} style={styles.shortcut}>
      <View style={{ width: mainShortcutSize, height: mainShortcutSize, alignItems: 'center', justifyContent: 'center' }}><Users size={30} color={colors.accentText} /></View>
    </Pressable>
  </View>;
}

function MemberRow({ space, name, onProfile, onPress }: { space: SpaceEntry; name: string; onProfile: () => void; onPress: () => void }) {
  const { colors } = useTheme(); const runtime = useSpaceRuntime(space.id);
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[14], paddingVertical: spacing[16] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`查看${name}的主页`} onPress={onProfile}><MemberAvatar spaceId={space.id} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`打开${name}`} onPress={onPress} style={{ flex: 1, minHeight: 52, justifyContent: 'center', gap: spacing[6] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[8] }}>
        <Text numberOfLines={1} style={{ ...workspaceTheme.typography.itemTitle, color: colors.ink, flex: 1 }}>{name}</Text>
        {runtime.running && <Text style={{ ...workspaceTheme.typography.caption, color: colors.accentText }}>处理中</Text>}
      </View>
      <Text numberOfLines={1} style={{ ...workspaceTheme.typography.caption, color: colors.muted }}>{memberDescription(space.id)}</Text>
    </Pressable>
  </View>;
}
