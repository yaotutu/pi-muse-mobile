import { Bookmark, ChevronLeft, ExternalLink, RefreshCw, Rss, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, themeTokens } from '../theme/tokens';
import { ActionButton } from '../ui/ActionButton';
import { ChoiceChip } from '../ui/ChoiceChip';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { IconControl } from '../ui/IconControl';
import { Card } from '../ui/Surfaces';
import { safeMessageUrl } from '../chat/message-links';
import type { NewsStore } from '../news/news-store';
import type { NewsArticle, NewsArticleWork, NewsSnapshot } from '../news/types';
import { useNews } from '../news/useNews';

const { typography: t, layout: l, radius: r } = themeTokens;

/** Store 的 notice 含普通错误与成功文案；只把确知的成功提示移出阅读流。 */
function routineNotice(notice?: string): boolean {
  return !!notice && (notice.startsWith('RSS 抓取完成') || notice.startsWith('RSS 源已添加') || notice.startsWith('已解除'));
}

function NewsNotice({ notice, store, success = false }: { notice?: string; store: NewsStore; success?: boolean }) {
  if (!notice) return null;
  return <View style={styles.noticeWrap}>
    <FeedbackNotice tone={success ? 'success' : 'warning'} text={notice} />
    <ActionButton label="关闭新闻提示" text="关闭提示" icon={X} onPress={store.clearNotice} testID="news-notice-dismiss" />
  </View>;
}

function FeedFeedback({ snapshot, store }: { snapshot: NewsSnapshot; store: NewsStore }) {
  return <>
    <FeedbackNotice tone={snapshot.feedUncertain ? 'warning' : 'danger'} text={snapshot.feedError} />
    {snapshot.feedUncertain && <View style={styles.actionRow}>
      <ActionButton label="回读新闻状态以核对抓取" text="回读核对" onPress={() => void store.refreshStatus()} testID="news-feed-readback" />
      {snapshot.feedReviewed && <ActionButton label="确认已核对抓取结果" text="已核对，解锁" onPress={() => store.acknowledgeFeedReadback()} testID="news-feed-acknowledge" />}
    </View>}
  </>;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString();
}

function ArticleActions({ article, work, store }: { article: NewsArticle; work?: NewsArticleWork; store: NewsStore }) {
  // 服务端每次写入返回整份反馈；Store 串行写入时，整组操作同步显示不可提交。
  const locked = !!work && (work.reactionWriting || work.savedWriting || work.commentWriting ||
    work.reactionUncertain || work.savedUncertain || work.commentUncertain);
  return <View style={styles.actionRow}>
    <ChoiceChip label="喜欢" accessibilityLabel={`${article.title}，${article.feedback.reaction === 'like' ? '取消喜欢' : '喜欢'}`}
      selected={article.feedback.reaction === 'like'} disabled={locked} onPress={() => void store.toggleReaction(article.id, 'like')} testID={`news-like-${article.id}`} />
    <ChoiceChip label="不喜欢" accessibilityLabel={`${article.title}，${article.feedback.reaction === 'dislike' ? '取消不喜欢' : '不喜欢'}`}
      selected={article.feedback.reaction === 'dislike'} disabled={locked} onPress={() => void store.toggleReaction(article.id, 'dislike')} testID={`news-dislike-${article.id}`} />
    <ChoiceChip label="收藏" accessibilityLabel={`${article.title}，${article.feedback.saved ? '取消收藏' : '收藏'}`}
      selected={article.feedback.saved} disabled={locked} onPress={() => void store.toggleSaved(article.id)} testID={`news-save-${article.id}`} />
  </View>;
}

function ArticleCard({ article, store, snapshot }: { article: NewsArticle; store: NewsStore; snapshot: NewsSnapshot }) {
  const { colors } = useTheme();
  const work = snapshot.articleWork[article.id];
  const uncertain = !!work && (work.reactionUncertain || work.savedUncertain || work.commentUncertain);
  return <View style={[styles.article, { borderBottomColor: colors.line }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`阅读文章，${article.title}`} onPress={() => store.openArticle(article.id)}
      testID={`news-article-${article.id}`} style={styles.articleOpen}>
      <Text style={[styles.meta, { color: colors.faint }]}>{article.sourceTitle} · {dateLabel(article.publishedAt)}</Text>
      <Text style={[styles.articleTitle, { color: colors.ink }]}>{article.title}</Text>
      {!!article.content && <Text numberOfLines={3} style={[styles.excerpt, { color: colors.muted }]}>{article.content}</Text>}
      {snapshot.view === 'recommended' && article.recommendation && <Text style={[styles.reason, { color: colors.accentText }]}>推荐理由 · {article.recommendation.reason}</Text>}
      <Text style={[styles.readMore, { color: colors.accentText }]}>查看内容 ›</Text>
    </Pressable>
    <ArticleActions article={article} work={work} store={store} />
    {uncertain && <UncertainArticle articleId={article.id} snapshot={snapshot} store={store} />}
  </View>;
}

function UncertainArticle({ articleId, snapshot, store }: { articleId: string; snapshot: NewsSnapshot; store: NewsStore }) {
  const work = snapshot.articleWork[articleId];
  if (!work || !(work.reactionUncertain || work.savedUncertain || work.commentUncertain)) return null;
  const reviewed = (!work.reactionUncertain || work.reactionReviewed) &&
    (!work.savedUncertain || work.savedReviewed) && (!work.commentUncertain || work.commentReviewed);
  return <View>
    <FeedbackNotice tone="warning" text="操作结果未明。请回读文章和评论并核对实际状态；核对前不会重复发送。" />
    <View style={styles.actionRow}>
      <ActionButton label="重新读取文章以核对" text="回读核对" onPress={() => void store.readbackArticle(articleId)} testID="news-article-readback" />
      {reviewed && <ActionButton label="确认已核对文章状态并解锁操作" text="已核对，解锁" onPress={() => store.acknowledgeArticleReadback(articleId)} testID="news-article-acknowledge" />}
    </View>
  </View>;
}

function ArticleDetail({ store, snapshot }: { store: NewsStore; snapshot: NewsSnapshot }) {
  const { colors } = useTheme();
  const id = snapshot.selectedArticleId!;
  const article = snapshot.articleMissing ? undefined : snapshot.article?.id === id ? snapshot.article : snapshot.articles.find((item) => item.id === id);
  const work = snapshot.articleWork[id];
  const url = article?.url ? safeMessageUrl(article.url) : undefined;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} testID="news-detail">
    <ActionButton label="返回新闻列表" text="返回新闻" icon={ChevronLeft} onPress={() => store.closeArticle()} testID="news-detail-back" />
    {snapshot.articleLoading && <Text style={[styles.meta, { color: colors.faint }]}>正在读取文章内容…</Text>}
    <FeedbackNotice tone="danger" text={snapshot.articleError} />
    {!routineNotice(snapshot.notice) && <NewsNotice notice={snapshot.notice} store={store} />}
    {snapshot.articleError && <ActionButton label="重试读取新闻详情" text="重试详情" onPress={() => void store.readbackArticle(id)} testID="news-detail-retry" />}
    {snapshot.articleMissing && <FeedbackNotice tone="warning" text="文章已不存在。返回列表后刷新核对。" />}
    {article && <>
      <View style={styles.detailHeading}>
        <Text style={[styles.meta, { color: colors.faint }]}>{article.sourceTitle} · {dateLabel(article.publishedAt)}</Text>
        <Text accessibilityRole="header" style={[styles.detailTitle, { color: colors.ink }]}>{article.title}</Text>
        {article.recommendation && <View style={[styles.reasonBox, { backgroundColor: colors.blueSoft }]}><Text style={[styles.reason, { color: colors.accentText }]}>推荐理由 · {article.recommendation.reason}</Text></View>}
      </View>
      <Text style={[styles.meta, { color: colors.faint }]}>以下为 RSS 提供的内容；如需完整网页，请打开原文。</Text>
      <Text selectable style={[styles.body, { color: colors.ink }]}>{article.content || 'RSS 未提供可显示的正文。'}</Text>
      {url && <ActionButton label="在浏览器打开无凭据原文" text="查看原文" icon={ExternalLink} onPress={() => void Linking.openURL(url).catch(() => Alert.alert('无法打开原文', '请稍后重试。'))} testID="news-original-link" />}
      <View style={[styles.sectionLine, { borderTopColor: colors.line }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>你的反馈</Text>
        <ArticleActions article={article} work={work} store={store} />
        <UncertainArticle articleId={id} snapshot={snapshot} store={store} />
      </View>
      <View style={[styles.sectionLine, { borderTopColor: colors.line }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>评论 · {article.feedback.comments.length}</Text>
        {article.feedback.comments.length === 0 && <Text style={[styles.excerpt, { color: colors.muted }]}>还没有评论。</Text>}
        {article.feedback.comments.map((comment) => <View key={comment.id} style={[styles.comment, { borderBottomColor: colors.line }]}>
          <Text style={[styles.meta, { color: colors.faint }]}>{dateLabel(comment.createdAt)}</Text>
          <Text style={[styles.excerpt, { color: colors.ink }]}>{comment.text}</Text>
          <ActionButton label="删除这条评论" text="删除评论" tone="danger" disabled={!!work && (work.reactionWriting || work.savedWriting || work.commentWriting || work.reactionUncertain || work.savedUncertain || work.commentUncertain)}
            onPress={() => Alert.alert('删除评论？', '这条评论将被删除。', [
              { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => void store.deleteComment(id, comment.id) },
            ])} testID={`news-delete-comment-${comment.id}`} />
        </View>)}
        <FormInput accessibilityLabel="写评论，最多4000字" placeholder="写下你的看法" value={snapshot.commentDrafts[id] ?? ''}
          onChangeText={(text) => store.setCommentDraft(id, text)} maxLength={4000} multiline style={styles.commentInput} testID="news-comment-input" />
        <Text style={[styles.meta, { color: colors.faint }]}>{(snapshot.commentDrafts[id] ?? '').length} / 4000</Text>
        <ActionButton label="发送评论" text="发布评论" tone="primary" busy={!!work?.commentWriting}
          disabled={!(snapshot.commentDrafts[id] ?? '').trim() || !!work && (work.reactionWriting || work.savedWriting || work.commentWriting || work.reactionUncertain || work.savedUncertain || work.commentUncertain)}
          onPress={() => void store.addComment(id)} testID="news-comment-submit" />
      </View>
    </>}
  </ScrollView>;
}

function Sources({ store, snapshot, onBack }: { store: NewsStore; snapshot: NewsSnapshot; onBack: () => void }) {
  const { colors } = useTheme();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} testID="news-sources">
    <ActionButton label="返回新闻列表" text="返回新闻" icon={ChevronLeft} onPress={onBack} testID="news-sources-back" />
    <View style={styles.detailHeading}><Text accessibilityRole="header" style={[styles.detailTitle, { color: colors.ink }]}>RSS 来源</Text>
      <Text style={[styles.excerpt, { color: colors.muted }]}>添加标准 RSS 地址，新闻会在服务端抓取并分析。</Text></View>
    <Card style={styles.sourceStatus}>
      <Text style={[styles.sectionTitle, { color: colors.ink }]}>抓取与分析</Text>
      {snapshot.status ? <>
        <Text style={[styles.excerpt, { color: colors.muted }]}>{snapshot.status.refreshing ? '正在抓取来源' : snapshot.status.processing || snapshot.status.pendingCount > 0 ? `正在分析 · ${snapshot.status.pendingCount} 篇等待处理` : '当前没有待处理文章'}</Text>
        <Text style={[styles.meta, { color: colors.faint }]}>{snapshot.status.lastRefreshedAt ? `上次抓取 ${dateLabel(snapshot.status.lastRefreshedAt)}` : '尚未抓取'}</Text>
        {snapshot.status.failedCount > 0 && <FeedbackNotice tone="warning" text={`${snapshot.status.failedCount} 篇分析失败；全部文章仍可阅读。手动抓取可重试已知失败分析。`} />}
        <FeedbackNotice tone="danger" text={snapshot.status.lastError ?? undefined} />
      </> : <Text style={[styles.meta, { color: colors.faint }]}>{snapshot.statusLoading ? '正在读取状态…' : '尚未读取状态'}</Text>}
      <FeedbackNotice tone="danger" text={snapshot.statusError} />
      <ActionButton label="回读新闻抓取与分析状态" text="核对状态" busy={snapshot.statusLoading} onPress={() => void store.refreshStatus()} testID="news-status-retry" />
    </Card>
    <FeedFeedback snapshot={snapshot} store={store} />
    <NewsNotice notice={snapshot.notice} store={store} success={routineNotice(snapshot.notice)} />
    <Card style={styles.sourceForm}>
      <Text style={[styles.sectionTitle, { color: colors.ink }]}>添加来源</Text>
      <FormInput accessibilityLabel="RSS 地址" placeholder="https://example.com/feed.xml" autoCapitalize="none" keyboardType="url" value={snapshot.sourceDraft.url}
        editable={!snapshot.sourceWriting && !snapshot.sourceUncertain} onChangeText={(url) => store.setSourceDraft({ url })} testID="news-source-url" />
      <FormInput accessibilityLabel="来源标题，可选" placeholder="标题（可选）" value={snapshot.sourceDraft.title}
        editable={!snapshot.sourceWriting && !snapshot.sourceUncertain} onChangeText={(title) => store.setSourceDraft({ title })} testID="news-source-title" />
      <FeedbackNotice tone={snapshot.sourceUncertain ? 'warning' : 'danger'} text={snapshot.sourceWriteError} />
      <ActionButton label="添加RSS来源" text="添加来源" tone="primary" busy={snapshot.sourceWriting} disabled={!snapshot.sourceDraft.url.trim() || snapshot.sourceUncertain}
        onPress={() => void store.addSource()} testID="news-source-add" />
      {snapshot.sourceUncertain && <View style={styles.actionRow}>
        <ActionButton label="回读RSS来源以核对" text="回读核对" onPress={() => void store.refreshSources()} testID="news-source-readback" />
        {snapshot.sourceReviewed && <ActionButton label="确认已核对RSS来源并解锁添加" text="已核对，解锁" onPress={() => store.acknowledgeSourceCreateReadback()} testID="news-source-acknowledge" />}
      </View>}
    </Card>
    <View style={styles.sectionHeading}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>已有来源 · {snapshot.sources.length}</Text>
      <ActionButton label="刷新来源列表" text="刷新列表" busy={snapshot.sourcesLoading} onPress={() => void store.refreshSources()} testID="news-sources-retry" /></View>
    <FeedbackNotice tone="danger" text={snapshot.sourceError} />
    {snapshot.sourcesLoading && !snapshot.sourcesLoaded && <Text style={[styles.meta, { color: colors.faint }]}>正在读取来源…</Text>}
    {snapshot.sourcesLoaded && !snapshot.sources.length && <Text style={[styles.excerpt, { color: colors.muted }]}>还没有 RSS 来源。添加后可回到新闻页手动抓取。</Text>}
    {snapshot.sources.map((source) => {
      const work = snapshot.sourceDeleteWork[source.id];
      return <View key={source.id} style={[styles.sourceRow, { borderBottomColor: colors.line }]}>
        <Text style={[styles.articleTitle, { color: colors.ink }]}>{source.title}</Text>
        <Text selectable style={[styles.meta, { color: colors.faint }]}>{source.url}</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>{source.lastFetchedAt ? `上次抓取 ${dateLabel(source.lastFetchedAt)}` : '尚未抓取'}</Text>
        <FeedbackNotice tone="danger" text={source.lastError ?? undefined} />
        {work?.uncertain && <><FeedbackNotice tone="warning" text="删除结果未明；请回读来源并核对，确认前不会重复删除。" />
          <View style={styles.actionRow}><ActionButton label="回读来源以核对删除" text="回读核对" onPress={() => void store.refreshSources()} />
            {work.reviewed && <ActionButton label="确认已核对来源删除结果" text="已核对，解锁" onPress={() => store.acknowledgeSourceDeleteReadback(source.id)} />}</View></>}
        {deleteId === source.id ? <Card tone="danger" style={styles.confirm}>
          <Text style={[styles.excerpt, { color: colors.ink }]}>停止采集「{source.title}」？已有文章和收藏不会删除。</Text>
          <View style={styles.actionRow}><ActionButton label="确认删除RSS来源" text="确认删除" tone="danger" busy={!!work?.writing} disabled={!!work?.uncertain}
            onPress={() => void store.deleteSource(source.id).then((ok) => { if (ok) setDeleteId(null); })} testID="news-source-confirm-delete" />
            <ActionButton label="取消删除RSS来源" text="取消" onPress={() => setDeleteId(null)} /></View>
        </Card> : <ActionButton label={`删除RSS来源，${source.title}`} text="删除来源" tone="danger" disabled={!!work?.uncertain || !!work?.writing}
          onPress={() => setDeleteId(source.id)} testID={`news-source-delete-${source.id}`} />}
      </View>;
    })}
  </ScrollView>;
}

/** 页面仅呈现连接级 NewsStore；切页与后台生命周期由根层统一驱动。 */
export function NewsPage({ store, managing, onManaging }: { store: NewsStore; managing: boolean; onManaging: (value: boolean) => void }) {
  const { colors } = useTheme();
  const { snapshot } = useNews(store);
  if (snapshot.selectedArticleId) return <ArticleDetail store={store} snapshot={snapshot} />;
  if (managing) return <Sources store={store} snapshot={snapshot} onBack={() => onManaging(false)} />;
  const pending = !!snapshot.status && (snapshot.status.pendingCount > 0 || snapshot.status.processing);
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.readerContent} testID="news-page">
    {/* 首屏只保留一个受控导航与三个必要操作；抓取状态和时间留在来源管理。 */}
    <View style={styles.readerToolbar}>
      <View accessibilityRole="tablist" accessibilityLabel="新闻视图" style={styles.viewTabs}>
        {(['recommended', 'all'] as const).map((view) => <Pressable key={view} accessibilityRole="tab"
          accessibilityLabel={view === 'recommended' ? '推荐' : '全部'} accessibilityState={{ selected: snapshot.view === view }}
          aria-selected={snapshot.view === view} onPress={() => store.setView(view)} testID={`news-view-${view}`}
          style={({ pressed }) => [styles.textTab, snapshot.view === view && { backgroundColor: colors.selected }, pressed && styles.pressed]}>
          <Text style={[styles.tabText, { color: snapshot.view === view ? colors.accentText : colors.muted }]}>{view === 'recommended' ? '推荐' : '全部'}</Text>
        </Pressable>)}
      </View>
      <IconControl small icon={Bookmark} label={snapshot.savedOnly ? '取消只看收藏' : '只看收藏'} selected={snapshot.savedOnly}
        style={snapshot.savedOnly ? { borderColor: colors.blue } : undefined}
        onPress={() => store.setSavedOnly(!snapshot.savedOnly)} testID="news-saved-filter" />
      <IconControl small icon={Rss} label="管理RSS来源与抓取状态" onPress={() => onManaging(true)} testID="news-manage-sources" />
      <IconControl small icon={RefreshCw} label="抓取新文章并重试失败分析" busy={snapshot.feedRefreshing}
        disabled={snapshot.feedUncertain || !snapshot.sources.length}
        onPress={() => void store.refreshFeeds()} testID="news-refresh-feeds" />
    </View>
    {snapshot.feedRefreshing && <Text style={[styles.meta, { color: colors.muted }]}>正在抓取来源…</Text>}
    <FeedbackNotice tone="danger" text={snapshot.listError} />
    {snapshot.listError && <ActionButton label="重试读取新闻列表" text="重试列表" busy={snapshot.loading} onPress={() => void store.refresh()} testID="news-retry" />}
    <FeedbackNotice tone="danger" text={snapshot.statusError} />
    {snapshot.statusError && <ActionButton label="重试读取新闻状态" text="核对状态" busy={snapshot.statusLoading} onPress={() => void store.refreshStatus()} testID="news-status-retry" />}
    <FeedFeedback snapshot={snapshot} store={store} />
    {!routineNotice(snapshot.notice) && <NewsNotice notice={snapshot.notice} store={store} />}
    {snapshot.loading && !snapshot.loaded && <Text style={[styles.meta, { color: colors.faint }]}>正在读取文章…</Text>}
    {snapshot.loaded && snapshot.articles.length === 0 && <View style={styles.empty}>
      <Bookmark size={l.iconSize} color={colors.faint} />
      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{snapshot.savedOnly ? '暂无收藏文章' : snapshot.view === 'recommended' ? '还没有推荐文章' : '还没有文章'}</Text>
      <Text style={[styles.excerpt, { color: colors.muted }]}>{snapshot.savedOnly ? '收藏的文章会出现在这里。' : snapshot.sourcesLoaded && !snapshot.sources.length ? '先添加一个 RSS 来源，再抓取新文章。' : pending ? '新文章正在分析，稍后回来看看。' : snapshot.view === 'recommended' ? '全部文章里可能已有新内容；分析状态可在来源查看。' : '抓取来源后，新文章会显示在这里。'}</Text>
      {snapshot.sourcesLoaded && !snapshot.sources.length && <ActionButton label="添加RSS来源" text="添加来源" tone="primary" onPress={() => onManaging(true)} testID="news-empty-add-source" />}
    </View>}
    {snapshot.articles.map((article) => <ArticleCard key={article.id} article={article} store={store} snapshot={snapshot} />)}
    {snapshot.hasMore && <ActionButton label="加载更多文章" text="加载更多" busy={snapshot.loading} onPress={() => store.loadMore()} testID="news-load-more" />}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: l.sidePadding, paddingTop: spacing[16], paddingBottom: spacing[34], gap: spacing[18] },
  readerContent: { paddingHorizontal: l.sidePadding, paddingTop: spacing[4], paddingBottom: spacing[34], gap: spacing[4] },
  readerToolbar: { minHeight: l.smallControl, flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  viewTabs: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'stretch', gap: spacing[2] },
  textTab: { flex: 1, minWidth: 0, minHeight: l.smallControl, paddingHorizontal: spacing[4], paddingVertical: spacing[8], borderRadius: r.field,
    alignItems: 'center', justifyContent: 'center' },
  tabText: { ...t.status, fontWeight: '600', textAlign: 'center' },
  pressed: { opacity: themeTokens.interaction.pressedOpacity },
  noticeWrap: { gap: spacing[4] },
  sourceStatus: { gap: spacing[8] },
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing[8] },
  sectionTitle: { ...t.section },
  meta: { ...t.caption },
  article: { paddingVertical: spacing[14], borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing[12] },
  articleOpen: { gap: spacing[8], minHeight: l.smallControl },
  articleTitle: { ...t.itemTitle },
  excerpt: { ...t.detail },
  reason: { ...t.status },
  readMore: { ...t.status, fontWeight: '600' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
  detailHeading: { gap: spacing[12], paddingTop: spacing[8] },
  detailTitle: { ...t.pageTitle },
  reasonBox: { padding: spacing[14], borderRadius: r.field },
  body: { ...t.message, lineHeight: 28 },
  sectionLine: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing[20], gap: spacing[14] },
  comment: { paddingBottom: spacing[16], borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing[8] },
  commentInput: { minHeight: 104 },
  sourceForm: { gap: spacing[12] },
  sourceRow: { paddingVertical: spacing[18], borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing[8] },
  confirm: { gap: spacing[12] },
  empty: { alignItems: 'flex-start', paddingVertical: spacing[24], gap: spacing[12] },
});
