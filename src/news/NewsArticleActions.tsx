/** 新闻文章菜单只消费 NewsStore 的既有反馈状态；评论仍进入阅读详情。 */
import { Bookmark, MessageCircle } from 'lucide-react-native';
import { useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { spacing, themeTokens } from '../theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { AnchoredFeedbackMenu, FeedbackMenuRow, FeedbackMenuRows, FeedbackReactionPill } from '../ui/AnchoredFeedbackMenu';
import { FeedbackNotice } from '../ui/Feedback';
import type { MenuRect } from '../ui/menu-position';
import type { NewsStore } from './news-store';
import { newsActionPresentation } from './news-action-interaction';
import type { NewsArticle, NewsArticleWork } from './types';

export function NewsFeedbackBadge({ article, onOpen }: { article: NewsArticle; onOpen: (target: View | null) => void }) {
  const { colors } = useTheme();
  const ref = useRef<View>(null);
  const { reaction, saved, comments } = article.feedback;
  if (!newsActionPresentation(article.feedback).hasBadge) return null;
  return <Pressable ref={ref} accessibilityRole="button"
    accessibilityLabel={`打开文章操作，${reaction === 'like' ? '已喜欢' : reaction === 'dislike' ? '已不喜欢' : '无反应'}，${saved ? '已收藏' : '未收藏'}，${comments.length} 条评论`}
    onPress={() => onOpen(ref.current)} testID={`news-feedback-badge-${article.id}`}
    style={[styles.badge, { borderColor: colors.line, backgroundColor: colors.canvas }]}>
    {reaction && <Text style={styles.badgeEmoji}>{reaction === 'like' ? '👍' : '👎'}</Text>}
    {saved && <Bookmark size={themeTokens.layout.iconSize - spacing[4]} color={colors.accentText} />}
    {comments.length > 0 && <><MessageCircle size={themeTokens.layout.iconSize - spacing[4]} color={colors.ink} />
      <Text style={[styles.badgeCount, { color: colors.ink }]}>{comments.length}</Text></>}
  </Pressable>;
}

export function NewsArticleActions({ article, work, store, anchor, notice, onClose, onComments }: {
  article: NewsArticle; work?: NewsArticleWork; store: NewsStore; anchor: MenuRect;
  notice?: string; onClose: () => void; onComments: () => void;
}) {
  const { colors } = useTheme();
  const presentation = newsActionPresentation(article.feedback, work);
  const locked = presentation.locked;
  const busy = !!work && (work.reactionWriting || work.savedWriting || work.commentWriting);
  const uncertain = !!work && (work.reactionUncertain || work.savedUncertain || work.commentUncertain);
  const reviewed = !!work && (!work.reactionUncertain || work.reactionReviewed) &&
    (!work.savedUncertain || work.savedReviewed) && (!work.commentUncertain || work.commentReviewed);
  const chooseReaction = async (reaction: 'like' | 'dislike') => {
    if (!locked && await store.toggleReaction(article.id, reaction)) onClose();
  };
  const toggleSaved = async () => {
    if (!locked && await store.toggleSaved(article.id)) onClose();
  };

  return <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent
    onRequestClose={onClose}>
    <ThemeStatusBar />
    <AnchoredFeedbackMenu anchor={anchor} align="left" dismissLabel="关闭文章操作" onDismiss={onClose}
      testID={`news-article-menu-${article.id}`}>
      <FeedbackReactionPill reaction={presentation.reaction} locked={locked} busy={busy}
        subjectLabel="这篇文章" likeTestID={`news-like-${article.id}`}
        dislikeTestID={`news-dislike-${article.id}`} onReaction={(reaction) => void chooseReaction(reaction)} />
      <FeedbackMenuRows>
        <FeedbackMenuRow icon={Bookmark} label={presentation.saved ? '取消收藏这篇文章' : '收藏这篇文章'}
          text={presentation.saved ? '取消收藏' : '收藏'} selected={presentation.saved} disabled={locked}
          onPress={() => void toggleSaved()} testID={`news-save-${article.id}`} />
        <FeedbackMenuRow icon={MessageCircle} label={`查看文章评论，${article.feedback.comments.length} 条`}
          text={`评论${article.feedback.comments.length ? `  ${article.feedback.comments.length}` : ''}`}
          onPress={onComments} testID={`news-comments-open-${article.id}`} />
      </FeedbackMenuRows>
      {(notice || uncertain) && <ScrollView style={[styles.menuNotice, { backgroundColor: colors.canvas }]}
        contentContainerStyle={styles.menuNoticeContent}>
        <FeedbackNotice tone={uncertain ? 'warning' : 'danger'}
          text={uncertain ? '操作结果未明。回读文章和评论并核对实际状态；核对前不会重复发送。' : notice} />
        {uncertain && <View style={styles.recovery}>
          <ActionButton label="重新读取文章以核对" text="回读核对" onPress={() => void store.readbackArticle(article.id)}
            testID="news-article-menu-readback" />
          {reviewed && <ActionButton label="确认已核对文章状态并解锁操作" text="已核对，解锁"
            onPress={() => store.acknowledgeArticleReadback(article.id)} testID="news-article-menu-acknowledge" />}
        </View>}
      </ScrollView>}
    </AnchoredFeedbackMenu>
  </Modal>;
}

const styles = StyleSheet.create({
  badge: { minHeight: themeTokens.layout.smallControl, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    gap: spacing[4], paddingHorizontal: spacing[10], borderRadius: themeTokens.radius.round,
    borderWidth: StyleSheet.hairlineWidth },
  badgeEmoji: { fontSize: themeTokens.messageFeedback.badgeEmojiSize },
  badgeCount: { ...themeTokens.typography.caption },
  menuNotice: { flexShrink: 1, borderRadius: themeTokens.radius.field },
  menuNoticeContent: { padding: spacing[8], gap: spacing[8] },
  recovery: { gap: spacing[8] },
});
