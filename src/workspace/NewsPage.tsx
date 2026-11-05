import { ChatSwipeArea } from '../ui/ChatSwipeArea';
import { ChevronDown, ChevronUp, Bookmark, Check, ChevronLeft, MessageSquare, MoreHorizontal, Plus, RefreshCw, Rss, X, type LucideIcon } from 'lucide-react-native';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, themeTokens } from '../theme/tokens';
import { AgentHeader } from './AgentHeader';
import { ActionButton } from '../ui/ActionButton';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { IconControl } from '../ui/IconControl';
import { Card } from '../ui/Surfaces';
import { NewsArticleActions } from '../news/NewsArticleActions';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { AnchoredFeedbackMenu, FeedbackMenuRow, FeedbackMenuRows } from '../ui/AnchoredFeedbackMenu';
import { newsArticleDateLabel, newsFeedDateLabel, newsListExcerpt } from '../news/news-feed-display';
import type { NewsStore } from '../news/news-store';
import type { NewsArticle, NewsSnapshot } from '../news/types';
import { useNews } from '../news/useNews';
import type { MenuRect } from '../ui/menu-position';

const { typography: t, layout: l, radius: r, newsReading: n } = themeTokens;

const PRESET_CHINESE_SOURCES = [
  { title: '少数派', url: 'https://sspai.com/feed', desc: '高效工作与数字生活' },
  { title: '36氪', url: 'https://36kr.com/feed', desc: '科技创投与商业深度' },
  { title: '机器之心', url: 'https://www.jiqizhixin.com/rss', desc: '人工智能与前沿研究' },
  { title: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/atom.xml', desc: '科技爱好者周刊与技术杂谈' },
  { title: 'IT之家', url: 'https://www.ithome.com/rss/', desc: '前沿数码与IT科技资讯' },
] as const;

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

/** 只有筛选与更多菜单使用锚定弹层；文章与反馈本身不再长按弹菜单。
 * 页面隐藏或测量迟到时不得打开弹层；菜单只呈现调用方给的内容，不持有写入状态。
 */
function ReaderMenu({ label, text, icon: Icon = MoreHorizontal, visible, children, testID }: {
  label: string; text?: string; icon?: LucideIcon; visible: boolean;
  children: (close: () => void) => ReactNode; testID: string;
}) {
  const { colors } = useTheme();
  const target = useRef<ViewInstance>(null);
  const sequence = useRef(0);
  const [menu, setMenu] = useState<{ visible: boolean; anchor: MenuRect | null }>({ visible, anchor: null });
  if (menu.visible !== visible) setMenu({ visible, anchor: null });
  const anchor = menu.anchor;
  useLayoutEffect(() => {
    sequence.current += 1;
    return () => { sequence.current += 1; };
  }, [visible]);
  const open = () => {
    const request = ++sequence.current;
    target.current?.measureInWindow((x, y, width, height) => {
      if (request !== sequence.current || width <= 0 || height <= 0) return;
      setMenu({ visible, anchor: { x, y, width, height } });
    });
  };
  const close = () => { setMenu({ visible, anchor: null }); };
  return <>
    <Pressable ref={target} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ expanded: anchor !== null }} onPress={open} testID={testID}
      style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}>
      <Icon size={themeTokens.layout.iconSize} color={colors.ink} />
      {text && <Text style={[styles.menuText, { color: colors.ink }]}>{text}</Text>}
    </Pressable>
    {visible && anchor && <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent
      onRequestClose={close}>
      <ThemeStatusBar />
      <AnchoredFeedbackMenu anchor={anchor} align="right" dismissLabel={label} onDismiss={close} testID={testID}>
        {children(close)}
      </AnchoredFeedbackMenu>
    </Modal>}
  </>;
}

function ArticleCard({ article, store, snapshot }: { article: NewsArticle; store: NewsStore; snapshot: NewsSnapshot }) {
  const { colors } = useTheme();
  const excerpt = newsListExcerpt(article.content);
  return <View style={[styles.article, { borderBottomColor: colors.line }]}>
    {/* 阅读区与三个反馈按钮是兄弟节点；反馈点击不打开详情，也不触发智能体横扫。 */}
    <Pressable accessibilityRole="button" accessibilityLabel={`阅读文章，${article.title}`}
      onPress={() => store.openArticle(article.id)} testID={`news-article-${article.id}`}
      style={({ pressed }) => [styles.articleOpen, pressed && styles.pressed]}>
      <Text style={[styles.feedMeta, { color: colors.muted }]}>{article.sourceTitle} · {newsFeedDateLabel(article.publishedAt)}</Text>
      <Text accessibilityRole="header" style={[styles.feedTitle, { color: colors.ink }]}>{article.title}</Text>
      {excerpt && <Text numberOfLines={2} style={[styles.feedExcerpt, { color: colors.muted }]}>{excerpt}</Text>}
    </Pressable>
    <NewsArticleActions article={article} store={store} work={snapshot.articleWork[article.id]} />
    <UncertainArticle articleId={article.id} snapshot={snapshot} store={store} />
  </View>;
}

function UncertainArticle({ articleId, snapshot, store }: { articleId: string; snapshot: NewsSnapshot; store: NewsStore }) {
  const work = snapshot.articleWork[articleId];
  if (!work || !(work.reactionUncertain || work.savedUncertain)) return null;
  const reviewed = (!work.reactionUncertain || work.reactionReviewed) &&
    (!work.savedUncertain || work.savedReviewed);
  return <View>
    <FeedbackNotice tone="warning" text="操作结果未明。请回读文章并核对实际状态；核对前不会重复发送。" />
    <View style={styles.actionRow}>
      <ActionButton label="重新读取文章以核对" text="回读核对" onPress={() => void store.readbackArticle(articleId)} testID="news-article-readback" />
      {reviewed && <ActionButton label="确认已核对文章状态并解锁操作" text="已核对，解锁" onPress={() => store.acknowledgeArticleReadback(articleId)} testID="news-article-acknowledge" />}
    </View>
  </View>;
}

type DiscussionProps = { onDiscuss?: (articleId: string) => void; discussing?: boolean; discussionError?: string; uncertainDiscussion?: boolean; onCheckDiscussion?: () => void; onConfirmDiscussion?: () => void };

function ArticleDetail({ store, snapshot, onDiscuss, discussing, discussionError, uncertainDiscussion, onCheckDiscussion, onConfirmDiscussion }: {
  store: NewsStore; snapshot: NewsSnapshot;
} & DiscussionProps) {
  const { colors } = useTheme();
  const id = snapshot.selectedArticleId!;
  const article = snapshot.articleMissing ? undefined : snapshot.article?.id === id ? snapshot.article : snapshot.articles.find((item) => item.id === id);
  const discussDisabled = discussing || uncertainDiscussion;
  return <View style={[styles.readerContainer, { backgroundColor: colors.canvas }]}>
    {/* 详情顶栏只负责返回；文章级动作（讨论）与个人反馈都在底部操作栏。 */}
    <View style={styles.readerToolbar}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回新闻列表" onPress={() => store.closeArticle()}
        style={styles.menuButton} testID="news-detail-back">
        <ChevronLeft size={l.iconSize} color={colors.ink} /><Text style={[styles.menuText, { color: colors.ink }]}>返回</Text>
      </Pressable>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.detailContent} testID="news-detail">
      {snapshot.articleLoading && <Text style={[styles.meta, { color: colors.muted }]}>正在读取文章内容…</Text>}
      <FeedbackNotice tone="danger" text={snapshot.articleError} />
      {!routineNotice(snapshot.notice) && <NewsNotice notice={snapshot.notice} store={store} />}
      {snapshot.articleError && <ActionButton label="重试读取新闻详情" text="重试详情" onPress={() => void store.readbackArticle(id)} testID="news-detail-retry" />}
      {snapshot.articleMissing && <FeedbackNotice tone="warning" text="文章已不存在。返回列表后刷新核对。" />}
      {article && <>
        <View style={styles.detailHeading}>
          <Text style={[styles.meta, { color: colors.muted }]}>{article.sourceTitle} · {newsArticleDateLabel(article.publishedAt)}</Text>
          <Text accessibilityRole="header" selectable style={[styles.detailTitle, { color: colors.ink }]}>{article.title}</Text>
          {article.recommendation && <View style={[styles.reason, { borderLeftColor: colors.line }]}>
            <Text style={[styles.detailReason, { color: colors.muted }]}>推荐理由 · {article.recommendation.reason}</Text>
          </View>}
        </View>
        <Text selectable style={[styles.body, { color: colors.ink }]}>{article.content || 'RSS 未提供可显示的正文。'}</Text>
        <Text style={[styles.detailNote, { color: colors.muted }]}>内容来自 RSS 订阅源。</Text>
      </>}
    </ScrollView>
    {/* 固定底部操作栏：讨论与喜欢／不喜欢／收藏同栏靠右；未明回读与讨论核对提示也在栏内，不随正文滚动。 */}
    {article && <View style={[styles.detailFooter, { borderTopColor: colors.line }]} testID="news-detail-footer">
      {onDiscuss && <View style={styles.footerActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="带到会话讨论这篇新闻"
          accessibilityState={{ disabled: discussDisabled, busy: discussing }} disabled={discussDisabled}
          onPress={() => onDiscuss(id)} testID="news-discuss"
          style={({ pressed }) => [styles.footerChat, { backgroundColor: colors.surface }, discussDisabled && styles.chatDisabled, pressed && styles.pressed]}>
          <MessageSquare size={themeTokens.newsReading.actionIconSize} color={colors.muted} strokeWidth={1.7} />
          <Text style={[styles.footerChatText, { color: colors.muted }]}>{discussing ? '讨论中…' : '讨论'}</Text>
        </Pressable>
        <NewsArticleActions article={article} store={store} work={snapshot.articleWork[id]} />
      </View>}
      {!onDiscuss && <NewsArticleActions article={article} store={store} work={snapshot.articleWork[id]} />}
      <UncertainArticle articleId={id} snapshot={snapshot} store={store} />
      {/* 讨论仍有独立失败与核对语义；入口移入底部栏后，未明状态依旧不能藏起来。 */}
      <FeedbackNotice tone="danger" text={discussionError} />
      {uncertainDiscussion && onCheckDiscussion && <ActionButton label="核对新闻承接会话" text="前往承接会话核对" onPress={onCheckDiscussion} />}
      {uncertainDiscussion && onConfirmDiscussion && <ActionButton label="已核对恢复新闻讨论" text="已核对，恢复操作" disabled={discussing} onPress={onConfirmDiscussion} />}
    </View>}
  </View>;
}

/** 设置中的 RSS 沿原设置层级返回，且不清空阅读页当前打开的文章。 */
export function NewsSourcesPage({ store, onBack }: { store: NewsStore; onBack: () => void }) {
  const { snapshot } = useNews(store);
  return <Sources store={store} snapshot={snapshot} onBack={onBack} backToSettings />;
}

function Sources({ store, snapshot, onBack, backToSettings = false }: { store: NewsStore; snapshot: NewsSnapshot; onBack: () => void; backToSettings?: boolean }) {
  const { colors } = useTheme();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showAddSource, setShowAddSource] = useState(!!snapshot.sourceDraft.url || !!snapshot.sourceDraft.title);
  const [showPresets, setShowPresets] = useState(false);
  // 展开只控制可见性，不清草稿、不解锁未明写入；正在写入和待核对状态始终可见。
  const adding = showAddSource || snapshot.sourceWriting || snapshot.sourceUncertain;
  return <View style={styles.readerContainer}>
    <AgentHeader title="RSS 来源" backLabel={backToSettings ? '返回新闻设置' : '返回新闻列表'} onBack={onBack} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} testID="news-sources">
      <FeedFeedback snapshot={snapshot} store={store} />
      <NewsNotice notice={snapshot.notice} store={store} success={routineNotice(snapshot.notice)} />
      <View style={styles.sectionHeading}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>已有来源 · {snapshot.sources.length}</Text>
        <View style={styles.actionRow}>
          <ActionButton label={adding ? '收起RSS添加表单' : '展开RSS添加表单'} text={adding ? '收起' : snapshot.sourceDraft.url || snapshot.sourceDraft.title ? '继续添加' : '添加来源'}
            icon={adding ? ChevronUp : Plus} expanded={adding} disabled={snapshot.sourceWriting || snapshot.sourceUncertain}
            onPress={() => { Keyboard.dismiss(); setShowAddSource(!adding); }} testID="news-source-toggle" />
          <IconControl small icon={RefreshCw} label="刷新来源列表" busy={snapshot.sourcesLoading} onPress={() => void store.refreshSources()} testID="news-sources-retry" />
        </View></View>
      {adding && <Card style={styles.sourceForm}>
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
        <ActionButton label={showPresets ? '收起推荐中文来源' : '展开推荐中文来源'} text="推荐中文来源" expanded={showPresets}
          icon={showPresets ? ChevronUp : ChevronDown} onPress={() => setShowPresets(!showPresets)} />
        {showPresets && <View style={styles.presetCard}>
          <Text style={[styles.meta, { color: colors.muted }]}>精选常用中文科技与资讯 RSS，点击快捷填入：</Text>
          <View style={styles.presetList}>
            {PRESET_CHINESE_SOURCES.map((preset) => {
              const added = snapshot.sources.some((s) => s.url === preset.url);
              return (
                <View key={preset.url} style={[styles.presetRow, { borderColor: colors.line }]}>
                  <View style={styles.presetInfo}>
                    <Text style={[styles.presetTitle, { color: colors.ink }]}>{preset.title}</Text>
                    <Text numberOfLines={1} style={[styles.meta, { color: colors.faint }]}>{preset.desc}</Text>
                  </View>
                  {added ? (
                    <View style={[styles.presetBadge, { backgroundColor: colors.canvas }]}>
                      <Check size={14} color={colors.success} />
                      <Text style={[styles.meta, { color: colors.success }]}>已添加</Text>
                    </View>
                  ) : (
                    <ActionButton
                      label={`快捷填入 ${preset.title}`}
                      text="填入"
                      icon={Plus}
                      disabled={snapshot.sourceWriting || snapshot.sourceUncertain}
                      onPress={() => store.setSourceDraft({ url: preset.url, title: preset.title })}
                      testID={`news-preset-select-${preset.title}`}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </View>}
      </Card>}
      <FeedbackNotice tone="danger" text={snapshot.sourceError} />
      {snapshot.sourcesLoading && !snapshot.sourcesLoaded && <Text style={[styles.meta, { color: colors.faint }]}>正在读取来源…</Text>}
      {snapshot.sourcesLoaded && !snapshot.sources.length && <Text style={[styles.excerpt, { color: colors.muted }]}>还没有 RSS 来源。添加后可回到新闻页手动抓取。</Text>}
      {snapshot.sources.map((source) => {
        const work = snapshot.sourceDeleteWork[source.id];
        return <View key={source.id} style={[styles.sourceRow, { borderBottomColor: colors.line }]}>
          <Text style={[styles.articleTitle, { color: colors.ink }]}>{source.title}</Text>
          <Text selectable style={[styles.meta, { color: colors.faint }]}>{source.url}</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>{source.lastFetchedAt ? `上次抓取 ${newsArticleDateLabel(source.lastFetchedAt)}` : '尚未抓取'}</Text>
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
      <Card style={styles.sourceStatus}>
        <Text style={[styles.sectionTitle, { color: colors.ink }]}>抓取与分析</Text>
        {snapshot.status ? <>
          <Text style={[styles.excerpt, { color: colors.muted }]}>{snapshot.status.refreshing ? '正在抓取来源' : snapshot.status.processing || snapshot.status.pendingCount > 0 ? `正在分析 · ${snapshot.status.pendingCount} 篇等待处理` : '当前没有待处理文章'}</Text>
          <Text style={[styles.meta, { color: colors.faint }]}>{snapshot.status.lastRefreshedAt ? `上次抓取 ${newsArticleDateLabel(snapshot.status.lastRefreshedAt)}` : '尚未抓取'}</Text>
          {snapshot.status.failedCount > 0 && <FeedbackNotice tone="warning" text={`${snapshot.status.failedCount} 篇分析失败；全部文章仍可阅读。手动抓取可重试已知失败分析。`} />}
          <FeedbackNotice tone="danger" text={snapshot.status.lastError ?? undefined} />
        </> : <Text style={[styles.meta, { color: colors.faint }]}>{snapshot.statusLoading ? '正在读取状态…' : '尚未读取状态'}</Text>}
        <FeedbackNotice tone="danger" text={snapshot.statusError} />
        <ActionButton label="回读新闻抓取与分析状态" text="核对状态" busy={snapshot.statusLoading} onPress={() => void store.refreshStatus()} testID="news-status-retry" />
      </Card>
  </ScrollView></View>;
}

/** 页面只呈现连接级 NewsStore；阅读列表持续挂载，详情返回和来源管理不丢浏览位置。 */
export function NewsPage({ store, visible, managing, onManaging, onSwipe, ...discussion }: {
  store: NewsStore; visible: boolean; managing: boolean; onManaging: (value: boolean) => void;
  onSwipe: (direction: -1 | 1) => void;
} & DiscussionProps) {
  const { colors } = useTheme();
  const { snapshot } = useNews(store);
  const readingList = !snapshot.selectedArticleId && !managing;
  const pending = !!snapshot.status && (snapshot.status.pendingCount > 0 || snapshot.status.processing);
  return <View style={[styles.readerContainer, { backgroundColor: colors.canvas }]}>
    <View style={[styles.readerContainer, !readingList && styles.hidden]}
      pointerEvents={readingList ? 'auto' : 'none'} accessibilityElementsHidden={!readingList}
      importantForAccessibility={readingList ? 'auto' : 'no-hide-descendants'}>
      <View style={styles.readerToolbar}>
        <ReaderMenu key={`${snapshot.view}-${snapshot.savedOnly}`} label="选择新闻内容" text={snapshot.view === 'recommended' ? '推荐' : '全部'}
          icon={ChevronDown} testID="news-filter-menu" visible={visible && readingList}>
          {(close) => <FeedbackMenuRows>{(['recommended', 'all'] as const).map((view) => <FeedbackMenuRow key={view}
            icon={snapshot.view === view ? Check : Rss} label={view === 'recommended' ? '推荐文章' : '全部文章'}
            text={view === 'recommended' ? '推荐文章' : '全部文章'} selected={snapshot.view === view} testID={`news-view-${view}`}
            onPress={() => { close(); store.setView(view); }} />)}</FeedbackMenuRows>}
        </ReaderMenu>
        <View style={styles.toolbarActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={snapshot.savedOnly ? '取消只看收藏' : '只看收藏'}
            accessibilityState={{ selected: snapshot.savedOnly }} onPress={() => store.setSavedOnly(!snapshot.savedOnly)}
            style={[styles.menuButton, snapshot.savedOnly && { backgroundColor: colors.selected, borderRadius: r.field }]} testID="news-saved-filter">
            <Bookmark size={l.iconSize} color={snapshot.savedOnly ? colors.accentText : colors.muted} fill={snapshot.savedOnly ? colors.selected : 'none'} />
            {snapshot.savedOnly && <Text style={[styles.meta, { color: colors.accentText }]}>收藏</Text>}
          </Pressable>
          <ReaderMenu label="更多新闻操作" visible={visible && readingList} testID="news-more-menu">
            {(close) => <FeedbackMenuRows>
              <FeedbackMenuRow icon={Rss} label="管理RSS来源与抓取状态" text="来源与状态" testID="news-manage-sources"
                onPress={() => { close(); onManaging(true); }} />
              <FeedbackMenuRow icon={RefreshCw} label="抓取新文章并重试失败分析" text={snapshot.feedRefreshing ? '正在抓取…' : '抓取新文章'}
                disabled={snapshot.feedRefreshing || snapshot.feedUncertain || !snapshot.sources.length} testID="news-refresh-feeds"
                onPress={() => { close(); void store.refreshFeeds(); }} />
            </FeedbackMenuRows>}
          </ReaderMenu>
        </View>
      </View>
      <ChatSwipeArea onSwipe={onSwipe}><ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.readerContent} testID="news-page">
        {snapshot.feedRefreshing && <Text style={[styles.meta, { color: colors.muted }]}>正在抓取来源…</Text>}
        <FeedbackNotice tone="danger" text={snapshot.listError} />
        {snapshot.listError && <ActionButton label="重试读取新闻列表" text="重试列表" busy={snapshot.loading} onPress={() => void store.refresh()} testID="news-retry" />}
        <FeedbackNotice tone="danger" text={snapshot.statusError} />
        {snapshot.statusError && <ActionButton label="重试读取新闻状态" text="核对状态" busy={snapshot.statusLoading} onPress={() => void store.refreshStatus()} testID="news-status-retry" />}
        <FeedFeedback snapshot={snapshot} store={store} />
        {!routineNotice(snapshot.notice) && <NewsNotice notice={snapshot.notice} store={store} />}
        {snapshot.loading && !snapshot.loaded && <Text style={[styles.meta, { color: colors.muted }]}>正在读取文章…</Text>}
        {snapshot.loaded && snapshot.articles.length === 0 && <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.ink }]}>{snapshot.savedOnly ? '暂无收藏文章' : snapshot.view === 'recommended' ? '还没有推荐文章' : '还没有文章'}</Text>
          <Text style={[styles.emptyExcerpt, { color: colors.muted }]}>{snapshot.savedOnly ? '收藏的文章会出现在这里。' : snapshot.sourcesLoaded && !snapshot.sources.length ? '先添加一个 RSS 来源，再抓取新文章。' : pending ? '新文章正在分析，稍后回来看看。' : snapshot.view === 'recommended' ? '全部文章里可能已有新内容；分析状态可在来源查看。' : '抓取来源后，新文章会显示在这里。'}</Text>
          {snapshot.sourcesLoaded && !snapshot.sources.length && <ActionButton label="添加RSS来源" text="添加来源" tone="primary" style={styles.emptyAction} onPress={() => onManaging(true)} testID="news-empty-add-source" />}
        </View>}
        {snapshot.articles.map((article) => <ArticleCard key={article.id} article={article} store={store} snapshot={snapshot} />)}
        {snapshot.hasMore && <ActionButton label="加载更多文章" text="加载更多" busy={snapshot.loading} onPress={() => store.loadMore()} testID="news-load-more" />}
      </ScrollView></ChatSwipeArea>
    </View>
    {snapshot.selectedArticleId ? <ChatSwipeArea onSwipe={onSwipe}>
      <ArticleDetail key={snapshot.selectedArticleId} store={store} snapshot={snapshot} {...discussion} />
    </ChatSwipeArea> : managing && <Sources store={store} snapshot={snapshot} onBack={() => onManaging(false)} />}
  </View>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: l.sidePadding, paddingTop: spacing[16], paddingBottom: spacing[34], gap: spacing[18] },
  readerContainer: { flex: 1, minHeight: 0 },
  hidden: { display: 'none' },
  readerContent: { paddingHorizontal: l.sidePadding, paddingBottom: spacing[34], gap: spacing[8] },
  readerToolbar: { minHeight: l.controlSize, paddingHorizontal: l.sidePadding,
    paddingVertical: spacing[4], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[8] },
  menuButton: { minHeight: l.smallControl, minWidth: l.smallControl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[6] },
  menuText: { ...t.status, fontWeight: '600' },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] },
  pressed: { opacity: themeTokens.interaction.pressedOpacity },
  noticeWrap: { gap: spacing[4] },
  sourceStatus: { gap: spacing[8] },
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing[8] },
  sectionTitle: { ...t.section },
  meta: { ...t.caption },
  article: { paddingVertical: n.itemSpacing, borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing[8] },
  articleOpen: { minHeight: l.smallControl, gap: spacing[8] },
  feedTitle: { ...n.listTitle, fontWeight: '600' },
  feedExcerpt: { ...n.listExcerpt },
  feedMeta: { ...t.caption },
  articleTitle: { ...t.itemTitle },
  excerpt: { ...t.detail },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
  detailContent: { paddingHorizontal: l.sidePadding, paddingTop: spacing[16], paddingBottom: spacing[34], gap: spacing[24] },
  detailHeading: { gap: spacing[16] },
  detailTitle: { ...n.detailTitle, fontWeight: '600' },
  reason: { borderLeftWidth: 2, paddingLeft: spacing[12] },
  detailReason: { ...n.detailReason },
  detailNote: { ...n.detailNote },
  body: { ...n.detailBody },
  detailFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: l.sidePadding, paddingVertical: spacing[6], gap: spacing[8] },
  /* 底部栏一行的动作组：讨论在反馈组左侧，整组靠右；窄屏允许换行。 */
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: spacing[8] },
  footerChat: { minHeight: themeTokens.layout.smallControl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing[6], paddingHorizontal: spacing[10], borderRadius: themeTokens.radius.field },
  footerChatText: { ...themeTokens.typography.caption },
  chatDisabled: { opacity: themeTokens.interaction.disabledOpacity },
  sourceForm: { gap: spacing[12] },
  sourceRow: { paddingVertical: spacing[12], borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing[8] },
  confirm: { gap: spacing[12] },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[48], paddingHorizontal: spacing[24], gap: spacing[12] },
  emptyTitle: { ...t.section, fontWeight: '600', textAlign: 'center' },
  emptyExcerpt: { ...t.detail, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
  emptyAction: { alignSelf: 'center', marginTop: spacing[4] },
  presetCard: { gap: spacing[12] },
  presetList: { gap: spacing[8] },
  presetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[10], paddingHorizontal: spacing[12], borderRadius: r.field, borderWidth: StyleSheet.hairlineWidth },
  presetInfo: { flex: 1, minWidth: 0, gap: spacing[2], marginRight: spacing[8] },
  presetTitle: { ...t.itemTitle, fontSize: 15 },
  presetBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing[4], paddingHorizontal: spacing[8], paddingVertical: spacing[4], borderRadius: r.round },
});
