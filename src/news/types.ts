/** 新闻属于当前 API 连接，不跟随聊天空间；连接销毁时由上层丢弃整个 Store。 */
export type NewsView = 'recommended' | 'all';
export type NewsReaction = 'like' | 'dislike';

export type NewsStatus = {
  refreshing: boolean;
  processing: boolean;
  pendingCount: number;
  failedCount: number;
  lastRefreshedAt: string | null;
  lastError: string | null;
};

export type NewsSource = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  lastFetchedAt: string | null;
  lastError: string | null;
};

export type NewsSourceCreateInput = {
  url: string;
  title?: string;
};

export type NewsSourceDeleteResult = {
  deleted: true;
  sourceId: string;
};

export type NewsComment = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type NewsFeedback = {
  reaction: NewsReaction | null;
  saved: boolean;
  comments: NewsComment[];
};

export type NewsArticle = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  title: string;
  url: string | null;
  content: string;
  publishedAt: string;
  acceptedAt: string;
  recommendation: { reason: string } | null;
  feedback: NewsFeedback;
};

export type NewsArticlesQuery = {
  view?: NewsView;
  savedOnly?: boolean;
  limit?: number;
  cursor?: string;
};

export type NewsArticlePage = {
  articles: NewsArticle[];
  nextCursor: string | null;
};

export type NewsArticleDetail = {
  article: NewsArticle;
};

export type NewsRefreshResult = {
  added: number;
};

export type NewsPreferences = {
  notes: string;
  learnedNotes: string;
};

export type NewsPreferencesInput = {
  notes: string;
};

/** 只暴露新闻域需要的 API 方法，Store 与测试均不依赖具体 HTTP 实现。 */
export interface NewsClient {
  getNewsStatus(signal?: AbortSignal): Promise<NewsStatus>;
  listNewsSources(signal?: AbortSignal): Promise<NewsSource[]>;
  createNewsSource(input: NewsSourceCreateInput, signal?: AbortSignal): Promise<NewsSource>;
  deleteNewsSource(sourceId: string, signal?: AbortSignal): Promise<NewsSourceDeleteResult>;
  listNewsArticles(query?: NewsArticlesQuery, signal?: AbortSignal): Promise<NewsArticlePage>;
  getNewsArticle(articleId: string, signal?: AbortSignal): Promise<NewsArticleDetail>;
  setNewsReaction(
    articleId: string,
    reaction: NewsReaction | null,
    signal?: AbortSignal,
  ): Promise<NewsFeedback>;
  setNewsSaved(articleId: string, saved: boolean, signal?: AbortSignal): Promise<NewsFeedback>;
  addNewsComment(articleId: string, text: string, signal?: AbortSignal): Promise<NewsFeedback>;
  deleteNewsComment(
    articleId: string,
    commentId: string,
    signal?: AbortSignal,
  ): Promise<NewsFeedback>;
  refreshNews(signal?: AbortSignal): Promise<NewsRefreshResult>;
  getNewsPreferences(signal?: AbortSignal): Promise<NewsPreferences>;
  saveNewsPreferences(input: NewsPreferencesInput, signal?: AbortSignal): Promise<NewsPreferences>;
}

export type NewsSourceDraft = {
  url: string;
  title: string;
};

export type NewsArticleWork = {
  reactionWriting: boolean;
  reactionUncertain: boolean;
  reactionReviewed: boolean;
  savedWriting: boolean;
  savedUncertain: boolean;
  savedReviewed: boolean;
  commentWriting: boolean;
  commentUncertain: boolean;
  commentReviewed: boolean;
};

export type NewsSourceDeleteWork = {
  writing: boolean;
  uncertain: boolean;
  reviewed: boolean;
};

export type NewsSnapshot = {
  view: NewsView;
  savedOnly: boolean;
  articles: readonly NewsArticle[];
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  listError?: string;

  status?: NewsStatus;
  statusLoaded: boolean;
  statusLoading: boolean;
  statusStale: boolean;
  statusError?: string;
  pollCount: number;
  pollLimitReached: boolean;

  sources: readonly NewsSource[];
  sourcesLoaded: boolean;
  sourcesLoading: boolean;
  sourcesStale: boolean;
  sourceError?: string;
  sourceDraft: NewsSourceDraft;
  sourceWriting: boolean;
  sourceUncertain: boolean;
  sourceReviewed: boolean;
  sourceWriteError?: string;
  sourceDeleteWork: Readonly<Record<string, NewsSourceDeleteWork>>;

  selectedArticleId?: string;
  article?: NewsArticle;
  articleLoading: boolean;
  articleStale: boolean;
  articleError?: string;
  articleMissing: boolean;
  articleWork: Readonly<Record<string, NewsArticleWork>>;
  commentDrafts: Readonly<Record<string, string>>;

  feedRefreshing: boolean;
  feedUncertain: boolean;
  feedReviewed: boolean;
  feedError?: string;
  lastRefreshAdded?: number;
  notice?: string;
};
