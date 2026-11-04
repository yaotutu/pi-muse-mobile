/** 新闻阅读反馈直接呈现，只有喜欢／不喜欢／收藏；写入仍由连接级 Store 串行处理。
 * 不把点击或收藏伪装成兴趣学习，也不删除服务端返回的历史评论。
 */
import { Bookmark, ThumbsDown, ThumbsUp, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, themeTokens } from '../theme/tokens';
import { newsActionLocked } from './news-action-interaction';
import type { NewsStore } from './news-store';
import type { NewsArticle, NewsArticleWork } from './types';

export function NewsArticleActions({ article, work, store }: {
  article: NewsArticle; work?: NewsArticleWork; store: NewsStore;
}) {
  const { colors } = useTheme();
  const locked = newsActionLocked(work);
  const { reaction, saved } = article.feedback;
  const action = (id: string, Icon: LucideIcon, text: string, label: string, selected: boolean,
    busy: boolean, onPress: () => void) => <Pressable accessibilityRole="button" key={id}
    accessibilityLabel={`${label}，${article.title}`} accessibilityState={{ selected, disabled: locked, busy }}
    disabled={locked} onPress={onPress} testID={`news-${id}-${article.id}`}
    style={({ pressed }) => [styles.action, id === 'save' && styles.save,
      selected && { backgroundColor: colors.selected }, locked && styles.disabled, pressed && styles.pressed]}>
    <Icon size={themeTokens.newsReading.actionIconSize} color={selected ? colors.accentText : colors.muted}
      fill={selected ? colors.selected : 'none'} strokeWidth={selected ? 2.5 : 1.7} />
    <Text style={[styles.text, { color: selected ? colors.accentText : colors.muted, fontWeight: selected ? '600' : '400' }]}>{text}</Text>
  </Pressable>;
  return <View style={styles.row} testID={`news-actions-${article.id}`}
    onTouchStart={(event) => event.stopPropagation()}>
    {action('like', ThumbsUp, reaction === 'like' ? '已喜欢' : '喜欢', reaction === 'like' ? '撤销喜欢' : '喜欢',
      reaction === 'like', !!work?.reactionWriting, () => { void store.toggleReaction(article.id, 'like'); })}
    {action('dislike', ThumbsDown, reaction === 'dislike' ? '已不喜欢' : '不喜欢', reaction === 'dislike' ? '撤销不喜欢' : '不喜欢',
      reaction === 'dislike', !!work?.reactionWriting, () => { void store.toggleReaction(article.id, 'dislike'); })}
    {action('save', Bookmark, saved ? '已收藏' : '收藏', saved ? '取消收藏' : '收藏',
      saved, !!work?.savedWriting, () => { void store.toggleSaved(article.id); })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[4] },
  action: { minHeight: themeTokens.layout.smallControl, flexDirection: 'row', alignItems: 'center',
    gap: spacing[6], paddingHorizontal: spacing[8], paddingVertical: spacing[6], borderRadius: themeTokens.radius.field },
  save: { marginLeft: 'auto' },
  text: { ...themeTokens.typography.caption },
  disabled: { opacity: themeTokens.interaction.disabledOpacity },
  pressed: { opacity: themeTokens.interaction.pressedOpacity },
});
