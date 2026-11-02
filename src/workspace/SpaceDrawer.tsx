import { useMemo, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, MessageCircle, Plus, Search, Settings, X } from 'lucide-react-native';
import type { SpaceEntry } from '../api/types';
import { useSpaceRuntime } from '../runtime/RuntimeProvider';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { IconControl } from '../ui/IconControl';
import { spacing, sizing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { type SpaceLabels, spaceTime } from './space-labels';

const { layout: l, radius: r, typography: t } = workspaceTheme;

/** 侧栏只组织入口与本地搜索；切空间、文件草稿保护和创建仍由工作区统一执行。 */
export function SpaceDrawer({ spaces, currentSpace, labels, error, onReload, onSelect, onCreate, onSettings, onClose }: {
  spaces: SpaceEntry[]; currentSpace: string; labels: SpaceLabels; error?: string;
  onReload: () => void; onSelect: (id: string) => void; onCreate: () => void; onSettings: () => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // null 表示搜索收起；父级在开关侧栏时重置此展示组件，不保留隐藏筛选。
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const query = searchQuery?.toLowerCase().trim() ?? '';
  const filtered = spaces.filter((space) => `${labels.title(space.id)} ${space.id}`.toLowerCase().includes(query));
  const leave = (action: () => void) => { Keyboard.dismiss(); action(); };

  return <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left']} testID="space-drawer">
    <View style={styles.header} testID="space-drawer-toolbar">
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>空间</Text>
      <View style={styles.utilities}>
        <IconControl small icon={Search} label={searchQuery === null ? '展开空间搜索' : '收起空间搜索'} selected={searchQuery !== null}
          style={[styles.utility, searchQuery !== null && styles.utilitySelected]} testID="workspace-search-spaces"
          onPress={() => { if (searchQuery !== null) Keyboard.dismiss(); setSearchQuery(searchQuery === null ? '' : null); }} />
        <IconControl small icon={Settings} label="打开设置" style={styles.utility} testID="workspace-settings" onPress={() => leave(onSettings)} />
        <IconControl small icon={X} label="关闭空间侧栏" style={styles.utility} onPress={() => leave(onClose)} />
      </View>
    </View>
    {searchQuery !== null && <View style={styles.search} testID="space-drawer-search">
      <FormInput autoFocus variant="search" accessibilityLabel="搜索空间" placeholder="搜索名称或 ID" value={searchQuery} onChangeText={setSearchQuery}
        autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} />
      {!!searchQuery && <IconControl small icon={X} label="清空空间搜索" style={styles.utility} onPress={() => setSearchQuery('')} />}
    </View>}
    <ActionButton label="新建空间" icon={Plus} style={styles.create} testID="workspace-create-space" onPress={() => leave(onCreate)} />
    <View style={styles.listHeading}>
      <Text style={styles.caption}>{query ? '搜索结果' : '全部空间'}</Text>
      <Text accessibilityLabel={`${filtered.length} 个空间`} style={styles.count}>{filtered.length}</Text>
    </View>
    {!!error && <View style={styles.failure}>
      <FeedbackNotice tone="danger" text={error} />
      <ActionButton label="重新读取空间列表" text="重试" onPress={onReload} />
    </View>}
    <FlatList style={styles.list} data={filtered} extraData={currentSpace} keyExtractor={(space) => space.id}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => <SpaceRow space={item} title={labels.title(item.id)} selected={item.id === currentSpace} onPress={() => leave(() => onSelect(item.id))} />}
      ListEmptyComponent={<View style={styles.empty}><Search size={sizing[24]} color={colors.faint} />
        <Text style={styles.emptyTitle}>没有找到空间</Text><Text style={styles.caption}>试试其他名称或空间 ID</Text>
      </View>} />
  </SafeAreaView>;
}

function SpaceRow({ space, title, selected, onPress }: { space: SpaceEntry; title: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme(); const runtime = useSpaceRuntime(space.id);
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}>
    <MessageCircle size={sizing[22]} color={selected ? colors.accentText : colors.muted} strokeWidth={1.7} />
    <View style={styles.rowText}>
      <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>
      <Text numberOfLines={1} style={styles.caption}>{runtime.label} · {spaceTime(space.updatedAt)}</Text>
    </View>
    {selected && <Check size={sizing[18]} color={colors.accentText} />}
  </Pressable>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { flex: 1, paddingHorizontal: l.sidePadding },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[8], paddingTop: spacing[16], paddingBottom: spacing[20] },
  title: { ...t.heroName, flex: 1, color: c.ink },
  utilities: { flexDirection: 'row', gap: spacing[2] },
  utility: { backgroundColor: 'transparent', borderColor: 'transparent' },
  utilitySelected: { backgroundColor: c.surface },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing[4], paddingLeft: spacing[14], paddingRight: spacing[4], marginBottom: spacing[12], backgroundColor: c.surface, borderRadius: r.field },
  create: { alignSelf: 'stretch', minHeight: l.inputMinHeight, justifyContent: 'flex-start', gap: spacing[12], paddingHorizontal: spacing[18], borderRadius: r.field, backgroundColor: c.blueSoft, borderColor: c.blueSoft },
  listHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[12], marginTop: spacing[26], marginBottom: spacing[10] },
  caption: { ...t.caption, color: c.muted }, count: { ...t.caption, color: c.faint, fontVariant: ['tabular-nums'] },
  failure: { gap: spacing[4], paddingBottom: spacing[12] },
  list: { flex: 1, minHeight: 0 }, listContent: { gap: spacing[6], paddingBottom: spacing[20] },
  row: { minHeight: l.drawerRowHeight, flexDirection: 'row', alignItems: 'center', gap: spacing[12], paddingHorizontal: spacing[14], paddingVertical: spacing[14], borderRadius: r.listItem },
  selected: { backgroundColor: c.surface }, rowText: { flex: 1, minWidth: 0, gap: spacing[4] }, rowTitle: { ...t.itemTitle, color: c.ink },
  pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  empty: { alignItems: 'center', paddingVertical: spacing[40], paddingHorizontal: spacing[12], gap: spacing[10] }, emptyTitle: { ...t.detail, color: c.ink },
});
