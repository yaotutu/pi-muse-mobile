import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Plus, RefreshCw, Search, SquarePen, Trash2 } from 'lucide-react-native';
import { useMemories } from '../memories/MemoryProvider';
import { MEMORY_QUERY_LIMIT, MEMORY_TEXT_LIMIT } from '../memories/memory-store';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { ChoiceChip } from '../ui/ChoiceChip';
import { FormInput } from '../ui/FormInput';

/** 设置页内平级内容；四主 Tab 和会话面板结构不变，记忆属于服务全局而非当前空间。 */
export function MemoryPanel({ onBack }: { onBack: () => void }) {
  const { store, snapshot } = useMemories(); const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState(snapshot.query);
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  const submitSearch = () => { Keyboard.dismiss(); store.search(query); };
  const locked = !store.canWrite();
  return <View style={styles.root} testID="memory-panel">
    <View style={styles.topRow}>
      <ActionButton label="返回设置" text="返回设置" onPress={onBack} icon={ArrowLeft} />
      <ActionButton label="刷新记忆" text="刷新" onPress={() => void store.refresh()} disabled={snapshot.loading || snapshot.writing} icon={RefreshCw} />
    </View>
    <View style={styles.heading}><Text accessibilityRole="header" style={styles.pageTitle}>长期记忆</Text>
      <Text style={styles.intro}>所有空间共用，按需检索使用。</Text></View>
    <View style={styles.search}><Search size={workspaceTheme.layout.iconSize} color={colors.faint} />
      <FormInput variant="search" accessibilityLabel="记忆搜索关键词" value={query} onChangeText={setQuery} placeholder="搜索记忆关键词" placeholderTextColor={colors.faint}
        editable={!snapshot.writing} maxLength={MEMORY_QUERY_LIMIT + 1} returnKeyType="search" onSubmitEditing={submitSearch} style={styles.searchInput} />
    </View>
    <View style={styles.filterRow}>
      <View style={styles.segments}>
        <ChoiceChip label="搜索记忆" text="搜索" onPress={submitSearch} disabled={snapshot.writing} selected={!!snapshot.query} />
        <ChoiceChip label="全部记忆" text="全部" onPress={() => { Keyboard.dismiss(); setQuery(''); store.search(''); }} disabled={snapshot.writing} selected={!snapshot.query} />
      </View>
      <ActionButton label="新增记忆" text="新增记忆" onPress={store.newMemory} disabled={locked} icon={Plus} tone="primary" />
    </View>
    <Text style={styles.caption}>{snapshot.loaded ? `${snapshot.query ? '搜索结果' : '全部记忆'} · 显示 ${snapshot.memories.length} 条${snapshot.query ? '，最多返回 10 条匹配记忆' : '，最多返回 500 条'}` : '正在等待服务端记忆'}</Text>
    {snapshot.loading && <ActivityIndicator accessibilityLabel="正在读取记忆" color={colors.muted} />}
    {!!snapshot.error && <FeedbackNotice text={snapshot.error} tone="danger" />}
    {!!snapshot.notice && <FeedbackNotice text={snapshot.notice} tone="success" />}
    {snapshot.stale && snapshot.loaded && <Text style={styles.caption}>以下为最后观测内容，最新状态待核对。请刷新后再修改。</Text>}
    {snapshot.uncertain && <Card style={styles.card} tone="warning" testID="memory-uncertain">
      <Text style={styles.title}>提交结果未明，暂时锁定修改</Text>
      <Text style={styles.body}>请求中断不代表服务端未执行。请先点击“全部记忆”回读并核对，避免重复新增或再次覆盖；我们不会自动重试。</Text>
      {snapshot.reviewed && <ActionButton label="已核对，解除提交锁定" onPress={store.acknowledgeReviewed} disabled={snapshot.loading || snapshot.stale} />}
    </Card>}
    {snapshot.editor && <Card style={styles.card} testID="memory-editor">
      <Text style={styles.title}>{snapshot.editor.id ? '编辑记忆' : '新增记忆'}</Text>
      <FormInput accessibilityLabel="记忆内容" multiline textAlignVertical="top" value={snapshot.editor.text} onChangeText={store.setText} editable={!snapshot.writing && !snapshot.uncertain}
        maxLength={MEMORY_TEXT_LIMIT + 1} placeholder="值得记住的一件事…" placeholderTextColor={colors.faint} style={styles.input} />
      <Text style={styles.caption}>{snapshot.editor.text.length} / {MEMORY_TEXT_LIMIT} · 保存到全局长期记忆</Text>
      <View style={styles.formActions}><ActionButton label={snapshot.writing ? '正在保存记忆' : '保存记忆'} onPress={() => { Keyboard.dismiss(); void store.save(); }} disabled={locked} tone="primary" wide />
        <ActionButton label="取消编辑记忆" onPress={store.cancelEdit} disabled={snapshot.writing || snapshot.uncertain} wide /></View>
    </Card>}
    {snapshot.deleteTarget && <Card style={styles.card} tone="danger" testID="memory-delete-confirmation">
      <Text style={styles.title}>确认删除这条全局记忆？</Text><Text selectable style={styles.body}>{snapshot.deleteTarget.text}</Text>
      <Text style={styles.caption}>删除会影响全部空间，无法撤销；不会删除聊天历史。</Text>
      <View style={styles.formActions}><ActionButton label="确认删除记忆" onPress={() => void store.confirmDelete()} disabled={locked} tone="danger" wide /><ActionButton label="取消删除记忆" onPress={store.cancelDelete} disabled={snapshot.writing} wide /></View>
    </Card>}
    {snapshot.loaded && !snapshot.loading && !snapshot.error && !snapshot.memories.length && <View style={styles.empty}>
      <Text style={styles.title}>{snapshot.query ? '没有匹配的记忆' : '还没有长期记忆'}</Text>
      <Text style={styles.caption}>{snapshot.query ? '换个关键词，或查看全部记忆。' : '可以在这里新增，或在聊天中告诉助手值得记住的事。'}</Text>
    </View>}
    {snapshot.memories.map((memory) => <Card key={memory.id} style={styles.memory} testID={`memory-item-${memory.id}`}>
      <Text selectable style={styles.body}>{memory.text}</Text><Text style={styles.caption}>来源：{memory.source || '未标注'} · 更新：{memory.updatedAt}</Text>
      <View style={styles.row}><ActionButton label={`编辑记忆 ${memory.id}`} text="编辑" icon={SquarePen} onPress={() => store.edit(memory.id)} disabled={locked} />
        <ActionButton label={`删除记忆 ${memory.id}`} text="删除" icon={Trash2} onPress={() => store.requestDelete(memory.id)} disabled={locked} tone="danger" /></View>
    </Card>)}
  </View>;
}
const createStyles = (colors: WorkspaceColors) => StyleSheet.create({
  root: { gap: spacing[16], paddingBottom: spacing[24], minWidth: 0 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing[8] },
  heading: { gap: spacing[4] }, pageTitle: { ...workspaceTheme.typography.section, color: colors.ink }, intro: { ...workspaceTheme.typography.status, color: colors.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing[8] },
  segments: { flexDirection: 'row', padding: spacing[4], borderRadius: workspaceTheme.radius.round, backgroundColor: colors.surface },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing[10], paddingHorizontal: spacing[16], borderRadius: workspaceTheme.radius.field, backgroundColor: colors.surface },
  searchInput: { flex: 1, minWidth: 0, minHeight: workspaceTheme.layout.controlSize },
  card: { padding: spacing[16], gap: spacing[12], minWidth: 0, borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface },
  title: { ...workspaceTheme.typography.itemTitle, color: colors.ink }, body: { ...workspaceTheme.typography.detail, color: colors.ink },
  caption: { ...workspaceTheme.typography.caption, color: colors.faint },
  input: { height: workspaceTheme.layout.profileTextHeight },
  formActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8], marginTop: spacing[8] },
  empty: { gap: spacing[6], padding: spacing[16], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface },
  memory: { gap: spacing[12], minWidth: 0, padding: spacing[16], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface },

});
