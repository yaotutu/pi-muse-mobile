import { useMemo, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { Plus, Search, Settings, X } from 'lucide-react-native';
import type { SpaceEntry } from '../api/types';
import { useSpaceRuntime } from '../runtime/RuntimeProvider';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { IconControl } from '../ui/IconControl';
import { spacing, workspaceTheme } from '../ui/tokens';
import { MemberAvatar } from './MemberAvatar';
import { memberDescription, type SpaceLabels } from './space-labels';

/** 列表不另建聊天存储；点头像看主页，点消息行才进入对应 Space 的真实私聊。 */
export function MemberDirectory({ mode, spaces, labels, error, onReload, onChat, onProfile, onCreate, onSettings }: {
  mode: 'inbox' | 'members'; spaces: SpaceEntry[]; labels: SpaceLabels; error?: string;
  onReload: () => void; onChat: (id: string) => void; onProfile: (id: string) => void; onCreate: () => void; onSettings: () => void;
}) {
  const { colors } = useTheme();
  const [query, setQuery] = useState<string | null>(null);
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1 }, header: { paddingHorizontal: workspaceTheme.layout.sidePadding, paddingVertical: spacing[12], flexDirection: 'row', alignItems: 'center', gap: spacing[6] },
    title: { ...workspaceTheme.typography.heroName, color: colors.ink, flex: 1 },
    intro: { paddingHorizontal: workspaceTheme.layout.sidePadding, paddingBottom: spacing[18], gap: spacing[4] },
    eyebrow: { ...workspaceTheme.typography.eyebrow, color: colors.accentText }, caption: { ...workspaceTheme.typography.caption, color: colors.muted },
    search: { marginHorizontal: workspaceTheme.layout.sidePadding, marginBottom: spacing[12] },
    content: { paddingHorizontal: workspaceTheme.layout.sidePadding, paddingBottom: spacing[24] },
    utility: { backgroundColor: 'transparent', borderColor: 'transparent' },
  }), [colors]);
  const filtered = spaces.filter((space) => `${labels.title(space.id)} ${space.id}`.toLowerCase().includes(query?.trim().toLowerCase() ?? ''));
  return <View style={styles.root} testID={`member-${mode}`}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>{mode === 'inbox' ? '消息' : '成员'}</Text>
      <IconControl icon={query === null ? Search : X} label={query === null ? '搜索成员' : '收起成员搜索'} style={styles.utility} onPress={() => { Keyboard.dismiss(); setQuery(query === null ? '' : null); }} />
      <IconControl icon={Plus} label="添加成员" style={styles.utility} onPress={onCreate} />
      <IconControl icon={Settings} label="打开全局设置" style={styles.utility} onPress={onSettings} />
    </View>
    {query !== null && <FormInput autoFocus accessibilityLabel="搜索成员名称" placeholder="搜索成员" value={query} onChangeText={setQuery} style={styles.search} />}
    <View style={styles.intro}>
      <Text style={styles.eyebrow}>{mode === 'inbox' ? 'YOUR DAILY COMPANY' : 'EVERYONE HAS THEIR OWN SPACE'}</Text>
      <Text style={styles.caption}>{mode === 'inbox' ? '找谁聊，就点开谁。点头像了解这位成员。' : '各自专注，也可以彼此协作。'}</Text>
    </View>
    {!!error && <View style={styles.search}><FeedbackNotice tone="danger" text={error} /><ActionButton label="重新读取成员" text="重试" onPress={onReload} /></View>}
    <FlatList data={filtered} keyExtractor={(space) => space.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.content}
      renderItem={({ item }) => <MemberRow space={item} name={labels.title(item.id)} onProfile={() => onProfile(item.id)} onPress={() => mode === 'members' ? onProfile(item.id) : onChat(item.id)} />}
      ListEmptyComponent={<Text style={styles.caption}>没有找到成员</Text>} />
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
