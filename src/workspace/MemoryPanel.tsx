import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, BookOpen, Plus, RefreshCw, Search, SquarePen, Trash2 } from 'lucide-react-native';
import { useMemories } from '../memories/MemoryProvider';
import { MEMORY_QUERY_LIMIT, MEMORY_TEXT_LIMIT } from '../memories/memory-store';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { EmptyState, SectionHeading } from './primitives';

/** 应用页内平级内容；四主 Tab 和会话面板结构不变，记忆属于服务全局而非当前空间。 */
export function MemoryPanel({ onBack }: { onBack: () => void }) {
  const { store, snapshot } = useMemories(); const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState(snapshot.query);
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  const submitSearch = () => { Keyboard.dismiss(); store.search(query); };
  const locked = !store.canWrite();
  return <View style={styles.root} testID="memory-panel">
    <Pressable accessibilityRole="button" accessibilityLabel="返回应用设置" onPress={onBack} style={styles.button}><ArrowLeft size={workspaceTheme.layout.iconSize} color={colors.ink} /><Text style={styles.buttonText}>返回应用</Text></Pressable>
    <SectionHeading title="长期记忆" eyebrow="KEEP WHAT MATTERS" description="所有空间共用的长期记忆，按需检索使用，不会整库拼入每轮对话。这里只展示真实服务数据。" />
    <View style={styles.search}><Search size={workspaceTheme.layout.iconSize} color={colors.faint} />
      <TextInput accessibilityLabel="记忆搜索关键词" value={query} onChangeText={setQuery} placeholder="搜索记忆关键词" placeholderTextColor={colors.faint}
        editable={!snapshot.writing} maxLength={MEMORY_QUERY_LIMIT + 1} returnKeyType="search" onSubmitEditing={submitSearch} style={styles.searchInput} />
    </View>
    <View style={styles.row}>
      <Action label="搜索记忆" onPress={submitSearch} disabled={snapshot.writing} />
      <Action label="全部记忆" onPress={() => { Keyboard.dismiss(); setQuery(''); store.search(''); }} disabled={snapshot.writing} />
      <Action label="刷新记忆" onPress={() => void store.refresh()} disabled={snapshot.loading || snapshot.writing} icon="refresh" />
      <Action label="新增记忆" onPress={store.newMemory} disabled={locked} icon="plus" primary />
    </View>
    <Text style={styles.caption}>{snapshot.query ? `搜索“${snapshot.query}”：最多返回 10 条匹配记忆，按服务端顺序展示。` : '全部记忆最多 500 条。打开、回前台或操作后回读，也可手动刷新；没有实时推送。'}</Text>
    {snapshot.loading && <ActivityIndicator accessibilityLabel="正在读取记忆" color={colors.muted} />}
    {!!snapshot.error && <Text accessibilityRole="alert" style={styles.error}>{snapshot.error}</Text>}
    {!!snapshot.notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{snapshot.notice}</Text>}
    {snapshot.stale && snapshot.loaded && <Text style={styles.caption}>以下为最后观测内容，最新状态待核对。请刷新后再修改。</Text>}
    {snapshot.uncertain && <View style={styles.card} testID="memory-uncertain">
      <Text style={styles.title}>提交结果未明，暂时锁定修改</Text>
      <Text style={styles.body}>请求中断不代表服务端未执行。请先点击“全部记忆”回读并核对，避免重复新增或再次覆盖；我们不会自动重试。</Text>
      {snapshot.reviewed && <Action label="已核对，解除提交锁定" onPress={store.acknowledgeReviewed} disabled={snapshot.loading || snapshot.stale} />}
    </View>}
    {snapshot.editor && <View style={styles.card} testID="memory-editor">
      <Text style={styles.title}>{snapshot.editor.id ? '编辑记忆' : '新增记忆'}</Text>
      <TextInput accessibilityLabel="记忆内容" multiline value={snapshot.editor.text} onChangeText={store.setText} editable={!snapshot.writing && !snapshot.uncertain}
        maxLength={MEMORY_TEXT_LIMIT + 1} placeholder="值得记住的一件事…" placeholderTextColor={colors.faint} style={styles.input} />
      <Text style={styles.caption}>{snapshot.editor.text.length} / {MEMORY_TEXT_LIMIT} · 保存到全局长期记忆</Text>
      <View style={styles.row}><Action label={snapshot.writing ? '正在保存记忆' : '保存记忆'} onPress={() => { Keyboard.dismiss(); void store.save(); }} disabled={locked} primary />
        <Action label="取消编辑记忆" onPress={store.cancelEdit} disabled={snapshot.writing || snapshot.uncertain} /></View>
    </View>}
    {snapshot.deleteTarget && <View style={styles.card} testID="memory-delete-confirmation">
      <Text style={styles.title}>确认删除这条全局记忆？</Text><Text selectable style={styles.body}>{snapshot.deleteTarget.text}</Text>
      <Text style={styles.caption}>删除会影响全部空间，无法撤销；不会删除聊天历史。</Text>
      <View style={styles.row}><Action label="确认删除记忆" onPress={() => void store.confirmDelete()} disabled={locked} /><Action label="取消删除记忆" onPress={store.cancelDelete} disabled={snapshot.writing} /></View>
    </View>}
    {snapshot.loaded && !snapshot.loading && !snapshot.error && !snapshot.memories.length && <EmptyState icon={BookOpen} title={snapshot.query ? '没有匹配的记忆' : '还没有长期记忆'} description={snapshot.query ? '换个关键词，或查看全部记忆。' : '你可以在这里新增，也可以在聊天中明确告诉助手值得记住的事。'} />}
    {snapshot.memories.map((memory) => <View key={memory.id} style={styles.memory} testID={`memory-item-${memory.id}`}>
      <Text selectable style={styles.body}>{memory.text}</Text><Text style={styles.caption}>来源：{memory.source || '未标注'} · 更新：{memory.updatedAt}</Text>
      <View style={styles.row}><Action label={`编辑记忆 ${memory.id}`} text="编辑" icon="edit" onPress={() => store.edit(memory.id)} disabled={locked} />
        <Action label={`删除记忆 ${memory.id}`} text="删除" icon="delete" onPress={() => store.requestDelete(memory.id)} disabled={locked} /></View>
    </View>)}
  </View>;
}
function Action({ label, text, onPress, disabled, primary, icon }: { label: string; text?: string; onPress: () => void; disabled?: boolean; primary?: boolean; icon?: 'refresh' | 'plus' | 'edit' | 'delete' }) {
  const { colors } = useTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const Icon = icon === 'refresh' ? RefreshCw : icon === 'plus' ? Plus : icon === 'edit' ? SquarePen : icon === 'delete' ? Trash2 : undefined;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, primary && styles.primary, disabled && styles.disabled, pressed && styles.pressed]}>
    {Icon && <Icon size={workspaceTheme.layout.iconSize - spacing[6]} color={primary ? colors.onAccent : colors.muted} />}<Text style={[styles.buttonText, primary && styles.primaryText]}>{text ?? label}</Text>
  </Pressable>;
}
const createStyles = (colors: WorkspaceColors) => StyleSheet.create({
  root: { gap: spacing[18], paddingBottom: spacing[24] }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing[10], paddingHorizontal: spacing[16], borderRadius: workspaceTheme.radius.field, backgroundColor: colors.surface },
  searchInput: { flex: 1, minHeight: workspaceTheme.layout.controlSize, color: colors.ink, ...workspaceTheme.typography.detail },
  card: { padding: spacing[20], gap: spacing[14], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface },
  title: { ...workspaceTheme.typography.itemTitle, color: colors.ink }, body: { ...workspaceTheme.typography.detail, color: colors.ink },
  caption: { ...workspaceTheme.typography.caption, color: colors.faint }, error: { ...workspaceTheme.typography.detail, color: colors.danger }, notice: { ...workspaceTheme.typography.detail, color: colors.success },
  input: { minHeight: workspaceTheme.layout.composerMaxHeight, padding: spacing[16], borderRadius: workspaceTheme.radius.field, backgroundColor: colors.canvas, color: colors.ink, textAlignVertical: 'top', ...workspaceTheme.typography.detail },
  memory: { gap: spacing[12], paddingVertical: spacing[20], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[6], minHeight: workspaceTheme.layout.smallControl, paddingHorizontal: spacing[14], paddingVertical: spacing[8], borderRadius: workspaceTheme.radius.round, backgroundColor: colors.surface, alignSelf: 'flex-start' },
  buttonText: { ...workspaceTheme.typography.status, color: colors.ink }, primary: { backgroundColor: colors.blue }, primaryText: { color: colors.onAccent },
  disabled: { opacity: workspaceTheme.interaction.disabledOpacity }, pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
});
