import { ApiError, isRequestCancelled } from '../api/errors';
import {
  assertNewsSourceInput,
  normalizedNewsComment,
} from './contracts';
import type {
  NewsArticle,
  NewsArticleWork,
  NewsClient,
  NewsFeedback,
  NewsReaction,
  NewsSnapshot,
  NewsSourceDeleteWork,
  NewsView,
} from './types';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_LIMIT = 60;

const initialArticleWork = (): NewsArticleWork => ({
  reactionWriting: false,
  reactionUncertain: false,
  reactionReviewed: false,
  savedWriting: false,
  savedUncertain: false,
  savedReviewed: false,
  commentWriting: false,
  commentUncertain: false,
  commentReviewed: false,
});

const initialSourceDeleteWork = (): NewsSourceDeleteWork => ({
  writing: false,
  uncertain: false,
  reviewed: false,
});

const initial = (): NewsSnapshot => ({
  view: 'recommended',
  savedOnly: false,
  articles: [],
  loaded: false,
  loading: false,
  stale: true,
  hasMore: false,
  nextCursor: null,
  statusLoaded: false,
  statusLoading: false,
  statusStale: true,
  pollCount: 0,
  pollLimitReached: false,
  sources: [],
  sourcesLoaded: false,
  sourcesLoading: false,
  sourcesStale: true,
  sourceDraft: { url: '', title: '' },
  sourceWriting: false,
  sourceUncertain: false,
  sourceReviewed: false,
  sourceDeleteWork: {},
  articleLoading: false,
  articleStale: true,
  articleMissing: false,
  articleWork: {},
  commentDrafts: {},
  feedRefreshing: false,
  feedUncertain: false,
  feedReviewed: false,
});

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

/** 只有远端明确拒绝时才允许直接重试；断线、超时、5xx 和本地取消均视为结果未明。 */
const uncertainWrite = (error: unknown): boolean =>
  isRequestCancelled(error) || !(error instanceof ApiError) ||
  error.status === 0 || error.status === 408 || error.status >= 500;

const sameFilter = (state: NewsSnapshot, view: NewsView, savedOnly: boolean) =>
  state.view === view && state.savedOnly === savedOnly;

const feedbackBusy = (work: NewsArticleWork) =>
  work.reactionWriting || work.savedWriting || work.commentWriting ||
  work.reactionUncertain || work.savedUncertain || work.commentUncertain;

/**
 * 当前连接内的新闻页状态。新闻不绑定聊天空间，也不读取聊天 reset/选中空间。
 * 页面关闭或应用后台只停止读取与轮询；列表、详情、源和草稿留在当前连接，直到上层 dispose。
 */
export class NewsStore {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private visible = false;
  private disposed = false;
  private listGeneration = 0;
  private statusGeneration = 0;
  private sourcesGeneration = 0;
  private articleGeneration = 0;
  private listController?: AbortController;
  private statusController?: AbortController;
  private sourcesController?: AbortController;
  private articleController?: AbortController;
  private writeControllers = new Set<AbortController>();
  private pollTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly client: NewsClient,
    private readonly pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    private readonly pollLimit = DEFAULT_POLL_LIMIT,
  ) {}

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<NewsSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private cancelList() {
    this.listGeneration++;
    this.listController?.abort();
    this.listController = undefined;
  }

  private cancelStatus() {
    this.statusGeneration++;
    this.statusController?.abort();
    this.statusController = undefined;
  }

  private cancelSources() {
    this.sourcesGeneration++;
    this.sourcesController?.abort();
    this.sourcesController = undefined;
  }

  private cancelArticle() {
    this.articleGeneration++;
    this.articleController?.abort();
    this.articleController = undefined;
  }

  private cancelReads() {
    this.cancelList();
    this.cancelStatus();
    this.cancelSources();
    this.cancelArticle();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private abortWrites() {
    for (const controller of this.writeControllers) controller.abort();
    this.writeControllers.clear();
  }

  private canRead() {
    return !this.disposed && this.active && this.visible;
  }

  private workFor(articleId: string): NewsArticleWork {
    return this.state.articleWork[articleId] ?? initialArticleWork();
  }

  private patchWork(articleId: string, patch: Partial<NewsArticleWork>) {
    this.publish({
      articleWork: {
        ...this.state.articleWork,
        [articleId]: { ...this.workFor(articleId), ...patch },
      },
    });
  }

  private sourceWorkFor(sourceId: string): NewsSourceDeleteWork {
    return this.state.sourceDeleteWork[sourceId] ?? initialSourceDeleteWork();
  }

  private patchSourceWork(sourceId: string, patch: Partial<NewsSourceDeleteWork>) {
    this.publish({
      sourceDeleteWork: {
        ...this.state.sourceDeleteWork,
        [sourceId]: { ...this.sourceWorkFor(sourceId), ...patch },
      },
    });
  }

  private articleFromState(articleId: string): NewsArticle | undefined {
    if (this.state.article?.id === articleId) return this.state.article;
    return this.state.articles.find((article) => article.id === articleId);
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      this.cancelReads();
      this.abortWrites();
      this.publish({
        loading: false,
        statusLoading: false,
        sourcesLoading: false,
        articleLoading: false,
        stale: true,
        statusStale: true,
        sourcesStale: true,
        articleStale: true,
      });
      return;
    }
    if (this.visible) void this.refresh();
  }

  open(view: NewsView = this.state.view, savedOnly = this.state.savedOnly) {
    if (this.disposed) return;
    this.visible = true;
    if (!sameFilter(this.state, view, savedOnly)) {
      this.cancelList();
      this.publish({
        view,
        savedOnly,
        articles: [],
        loaded: false,
        loading: false,
        stale: true,
        hasMore: false,
        nextCursor: null,
        listError: undefined,
      });
    }
    if (this.active) void this.refresh();
  }

  close() {
    this.visible = false;
    this.cancelReads();
    // 保留当前连接内的列表、详情、源与草稿，重开页面时再按权威接口刷新。
    this.publish({ loading: false, statusLoading: false, sourcesLoading: false, articleLoading: false });
  }

  setView(view: NewsView) {
    if (this.disposed || this.state.view === view) return;
    this.cancelList();
    this.publish({
      view,
      articles: [],
      loaded: false,
      loading: false,
      stale: true,
      hasMore: false,
      nextCursor: null,
      listError: undefined,
    });
    if (this.canRead()) void this.loadList(false);
  }

  setSavedOnly(savedOnly: boolean) {
    if (this.disposed || this.state.savedOnly === savedOnly) return;
    this.cancelList();
    this.publish({
      savedOnly,
      articles: [],
      loaded: false,
      loading: false,
      stale: true,
      hasMore: false,
      nextCursor: null,
      listError: undefined,
    });
    if (this.canRead()) void this.loadList(false);
  }

  refresh = async (): Promise<boolean> => {
    if (!this.canRead()) return false;
    this.publish({ pollCount: 0, pollLimitReached: false });
    const tasks: Promise<boolean>[] = [this.loadList(false), this.loadStatus(), this.loadSources()];
    if (this.state.selectedArticleId) tasks.push(this.loadArticle(this.state.selectedArticleId, false));
    const results = await Promise.all(tasks);
    return results.every(Boolean);
  };

  loadMore = () => {
    if (!this.canRead() || this.state.loading || this.state.stale ||
      !this.state.hasMore || !this.state.nextCursor) return;
    void this.loadList(true);
  };

  private async loadList(append: boolean): Promise<boolean> {
    if (!this.canRead()) return false;
    const view = this.state.view;
    const savedOnly = this.state.savedOnly;
    const cursor = append ? this.state.nextCursor : null;
    const generation = ++this.listGeneration;
    this.listController?.abort();
    const controller = new AbortController();
    this.listController = controller;
    this.publish({ loading: true, listError: undefined });
    try {
      const page = await this.client.listNewsArticles({
        view,
        savedOnly,
        limit: 20,
        ...(cursor ? { cursor } : {}),
      }, controller.signal);
      if (generation !== this.listGeneration || controller.signal.aborted || !this.canRead() ||
        view !== this.state.view || savedOnly !== this.state.savedOnly) return false;
      if (page.articles.some((article) =>
        view === 'recommended' && article.recommendation === null ||
        savedOnly && !article.feedback.saved)) {
        throw new ApiError(502, '新闻列表与当前筛选不一致，请刷新核对');
      }
      if (append && cursor && page.nextCursor === cursor) {
        throw new ApiError(502, '新闻分页游标没有前进，请刷新列表');
      }
      const merged = new Map<string, NewsArticle>();
      if (append) for (const article of this.state.articles) merged.set(article.id, article);
      for (const article of page.articles) merged.set(article.id, article);
      this.publish({
        articles: [...merged.values()],
        loaded: true,
        stale: false,
        hasMore: page.nextCursor !== null,
        nextCursor: page.nextCursor,
      });
      return true;
    } catch (error) {
      if (generation !== this.listGeneration || controller.signal.aborted ||
        !this.canRead() || isRequestCancelled(error)) return false;
      this.publish({ stale: true, listError: errorMessage(error, '新闻列表读取失败，请重试') });
      return false;
    } finally {
      if (generation === this.listGeneration) {
        this.listController = undefined;
        this.publish({ loading: false });
      }
    }
  }

  private async loadStatus(schedule = true): Promise<boolean> {
    if (!this.canRead()) return false;
    const generation = ++this.statusGeneration;
    this.statusController?.abort();
    const controller = new AbortController();
    this.statusController = controller;
    this.publish({ statusLoading: true, statusError: undefined });
    try {
      const status = await this.client.getNewsStatus(controller.signal);
      if (generation !== this.statusGeneration || controller.signal.aborted || !this.canRead()) return false;
      this.publish({
        status,
        statusLoaded: true,
        statusStale: false,
        ...(this.state.feedUncertain ? { feedReviewed: true } : {}),
      });
      if (schedule) this.schedulePolling();
      return true;
    } catch (error) {
      if (generation !== this.statusGeneration || controller.signal.aborted ||
        !this.canRead() || isRequestCancelled(error)) return false;
      this.stopPolling();
      this.publish({ statusStale: true, statusError: errorMessage(error, '新闻状态读取失败，请重试') });
      return false;
    } finally {
      if (generation === this.statusGeneration) {
        this.statusController = undefined;
        this.publish({ statusLoading: false });
      }
    }
  }

  private shouldPoll(): boolean {
    const status = this.state.status;
    return this.canRead() && !!status &&
      (status.refreshing || status.processing || status.pendingCount > 0);
  }

  private stopPolling() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private schedulePolling() {
    this.stopPolling();
    if (!this.shouldPoll()) return;
    if (this.state.pollCount >= this.pollLimit) {
      this.publish({
        pollLimitReached: true,
        statusStale: true,
        statusError: '新闻仍在处理，已暂停自动回读；可手动刷新继续核对。',
      });
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  private async pollOnce() {
    if (!this.shouldPoll()) return;
    this.publish({ pollCount: this.state.pollCount + 1 });
    if (!await this.loadStatus(false)) return;
    // 终态这一帧也要回读：推荐结果恰好在 processing 结束时才成为可见事实。
    await this.loadList(false);
    this.schedulePolling();
  }

  private async loadSources(): Promise<boolean> {
    if (!this.canRead()) return false;
    const generation = ++this.sourcesGeneration;
    this.sourcesController?.abort();
    const controller = new AbortController();
    this.sourcesController = controller;
    this.publish({ sourcesLoading: true, sourceError: undefined });
    try {
      const sources = await this.client.listNewsSources(controller.signal);
      if (generation !== this.sourcesGeneration || controller.signal.aborted || !this.canRead()) return false;
      const sourceDeleteWork = Object.fromEntries(Object.entries(this.state.sourceDeleteWork).map(
        ([id, work]) => [id, work.uncertain ? { ...work, reviewed: true } : work],
      ));
      this.publish({
        sources,
        sourcesLoaded: true,
        sourcesStale: false,
        sourceDeleteWork,
        ...(this.state.sourceUncertain ? { sourceReviewed: true } : {}),
      });
      return true;
    } catch (error) {
      if (generation !== this.sourcesGeneration || controller.signal.aborted ||
        !this.canRead() || isRequestCancelled(error)) return false;
      this.publish({ sourcesStale: true, sourceError: errorMessage(error, 'RSS 源读取失败，请重试') });
      return false;
    } finally {
      if (generation === this.sourcesGeneration) {
        this.sourcesController = undefined;
        this.publish({ sourcesLoading: false });
      }
    }
  }

  refreshSources = async (): Promise<boolean> => this.loadSources();
  refreshStatus = async (): Promise<boolean> => this.loadStatus();

  openArticle(articleId: string) {
    if (this.disposed || !articleId) return;
    if (this.state.selectedArticleId !== articleId) {
      this.cancelArticle();
      this.publish({
        selectedArticleId: articleId,
        article: undefined,
        articleStale: true,
        articleError: undefined,
        articleMissing: false,
      });
    }
    if (this.canRead()) void this.loadArticle(articleId, false);
  }

  closeArticle() {
    this.cancelArticle();
    this.publish({
      selectedArticleId: undefined,
      article: undefined,
      articleLoading: false,
      articleStale: true,
      articleError: undefined,
      articleMissing: false,
    });
  }

  readbackArticle = async (articleId = this.state.selectedArticleId): Promise<boolean> => {
    if (!articleId) return false;
    if (this.state.selectedArticleId !== articleId) {
      this.publish({ selectedArticleId: articleId });
    }
    return this.loadArticle(articleId, false, true);
  };

  private async loadArticle(articleId: string, replace: boolean, authoritative = false): Promise<boolean> {
    if (!this.canRead()) return false;
    const generation = ++this.articleGeneration;
    this.articleController?.abort();
    const controller = new AbortController();
    this.articleController = controller;
    if (replace) this.publish({ article: undefined });
    this.publish({ articleLoading: true, articleStale: true, articleError: undefined, articleMissing: false });
    try {
      const detail = await this.client.getNewsArticle(articleId, controller.signal);
      if (generation !== this.articleGeneration || controller.signal.aborted ||
        !this.canRead() || this.state.selectedArticleId !== articleId) return false;
      if (authoritative) this.cancelList();
      const work = this.workFor(articleId);
      const articles = this.state.articles.flatMap((article) => {
        if (article.id !== articleId) return [article];
        return this.state.savedOnly && !detail.article.feedback.saved ? [] : [detail.article];
      });
      this.publish({
        article: detail.article,
        articles,
        loading: authoritative ? false : this.state.loading,
        articleStale: false,
        articleMissing: false,
        articleWork: {
          ...this.state.articleWork,
          [articleId]: {
            ...work,
            reactionReviewed: work.reactionUncertain ? true : work.reactionReviewed,
            savedReviewed: work.savedUncertain ? true : work.savedReviewed,
            commentReviewed: work.commentUncertain ? true : work.commentReviewed,
          },
        },
      });
      return true;
    } catch (error) {
      if (generation !== this.articleGeneration || controller.signal.aborted ||
        !this.canRead() || isRequestCancelled(error)) return false;
      if (error instanceof ApiError && error.status === 404) {
        this.publish({ article: undefined, articleStale: true, articleMissing: true });
        return false;
      }
      this.publish({ articleStale: true, articleError: errorMessage(error, '新闻详情读取失败，请重试') });
      return false;
    } finally {
      if (generation === this.articleGeneration) {
        this.articleController = undefined;
        this.publish({ articleLoading: false });
      }
    }
  }

  private applyFeedback(articleId: string, feedback: NewsFeedback) {
    // 写成功响应比此前发出的列表/详情读取更新；取消旧读，防止迟到载荷回退反馈。
    this.cancelList();
    if (this.state.selectedArticleId === articleId || this.state.article?.id === articleId) {
      this.cancelArticle();
    }
    const articles = this.state.articles.flatMap((article) => {
      if (article.id !== articleId) return [article];
      if (this.state.savedOnly && !feedback.saved) return [];
      return [{ ...article, feedback }];
    });
    this.publish({
      articles,
      loading: false,
      articleLoading: false,
      ...(this.state.article?.id === articleId
        ? { article: { ...this.state.article, feedback } }
        : {}),
    });
  }

  setReaction = async (articleId: string, reaction: NewsReaction | null): Promise<boolean> => {
    const article = this.articleFromState(articleId);
    const work = this.workFor(articleId);
    if (!this.canRead() || !article || feedbackBusy(work)) return false;
    if (article.feedback.reaction === reaction) return true;
    const controller = new AbortController();
    this.writeControllers.add(controller);
    this.patchWork(articleId, { reactionWriting: true });
    try {
      const feedback = await this.client.setNewsReaction(articleId, reaction, controller.signal);
      if (this.disposed) return false;
      this.applyFeedback(articleId, feedback);
      this.patchWork(articleId, {
        reactionWriting: false,
        reactionUncertain: false,
        reactionReviewed: false,
      });
      return true;
    } catch (error) {
      if (this.disposed) return false;
      const uncertain = uncertainWrite(error);
      this.patchWork(articleId, {
        reactionWriting: false,
        reactionUncertain: uncertain,
        reactionReviewed: false,
      });
      if (uncertain) void this.readbackArticle(articleId);
      this.publish({
        notice: uncertain
          ? '反应提交结果未明，正在回读；核对前不会重复提交。'
          : errorMessage(error, '反应保存失败，请重试'),
      });
      return false;
    } finally {
      this.writeControllers.delete(controller);
    }
  };

  toggleReaction = async (articleId: string, reaction: NewsReaction): Promise<boolean> => {
    const article = this.articleFromState(articleId);
    if (!article) return false;
    return this.setReaction(articleId, article.feedback.reaction === reaction ? null : reaction);
  };

  setSaved = async (articleId: string, saved: boolean): Promise<boolean> => {
    const article = this.articleFromState(articleId);
    const work = this.workFor(articleId);
    if (!this.canRead() || !article || feedbackBusy(work)) return false;
    if (article.feedback.saved === saved) return true;
    const controller = new AbortController();
    this.writeControllers.add(controller);
    this.patchWork(articleId, { savedWriting: true });
    try {
      const feedback = await this.client.setNewsSaved(articleId, saved, controller.signal);
      if (this.disposed) return false;
      this.applyFeedback(articleId, feedback);
      this.patchWork(articleId, { savedWriting: false, savedUncertain: false, savedReviewed: false });
      return true;
    } catch (error) {
      if (this.disposed) return false;
      const uncertain = uncertainWrite(error);
      this.patchWork(articleId, {
        savedWriting: false,
        savedUncertain: uncertain,
        savedReviewed: false,
      });
      if (uncertain) void this.readbackArticle(articleId);
      this.publish({
        notice: uncertain
          ? '收藏提交结果未明，正在回读；核对前不会重复提交。'
          : errorMessage(error, '收藏保存失败，请重试'),
      });
      return false;
    } finally {
      this.writeControllers.delete(controller);
    }
  };

  toggleSaved = async (articleId: string): Promise<boolean> => {
    const article = this.articleFromState(articleId);
    return article ? this.setSaved(articleId, !article.feedback.saved) : false;
  };

  setCommentDraft(articleId: string, text: string) {
    if (this.disposed) return;
    this.publish({ commentDrafts: { ...this.state.commentDrafts, [articleId]: text } });
  };

  addComment = async (articleId: string): Promise<boolean> => {
    const work = this.workFor(articleId);
    if (!this.canRead() || feedbackBusy(work)) return false;
    const draft = this.state.commentDrafts[articleId] ?? '';
    let text: string;
    try {
      text = normalizedNewsComment(draft);
    } catch (error) {
      this.publish({ notice: errorMessage(error, '评论不能为空') });
      return false;
    }
    const controller = new AbortController();
    this.writeControllers.add(controller);
    this.patchWork(articleId, { commentWriting: true });
    try {
      const feedback = await this.client.addNewsComment(articleId, text, controller.signal);
      if (this.disposed) return false;
      this.applyFeedback(articleId, feedback);
      if ((this.state.commentDrafts[articleId] ?? '') === draft) {
        this.publish({ commentDrafts: { ...this.state.commentDrafts, [articleId]: '' } });
      }
      this.patchWork(articleId, {
        commentWriting: false,
        commentUncertain: false,
        commentReviewed: false,
      });
      return true;
    } catch (error) {
      if (this.disposed) return false;
      const uncertain = uncertainWrite(error);
      this.patchWork(articleId, {
        commentWriting: false,
        commentUncertain: uncertain,
        commentReviewed: false,
      });
      if (uncertain) void this.readbackArticle(articleId);
      this.publish({
        notice: uncertain
          ? '评论提交结果未明，草稿已保留；回读并明确核对前不会重复提交。'
          : errorMessage(error, '评论保存失败，草稿已保留'),
      });
      return false;
    } finally {
      this.writeControllers.delete(controller);
    }
  };

  deleteComment = async (articleId: string, commentId: string): Promise<boolean> => {
    const work = this.workFor(articleId);
    if (!this.canRead() || feedbackBusy(work)) return false;
    const controller = new AbortController();
    this.writeControllers.add(controller);
    this.patchWork(articleId, { commentWriting: true });
    try {
      const feedback = await this.client.deleteNewsComment(articleId, commentId, controller.signal);
      if (this.disposed) return false;
      this.applyFeedback(articleId, feedback);
      this.patchWork(articleId, {
        commentWriting: false,
        commentUncertain: false,
        commentReviewed: false,
      });
      return true;
    } catch (error) {
      if (this.disposed) return false;
      const uncertain = uncertainWrite(error);
      this.patchWork(articleId, {
        commentWriting: false,
        commentUncertain: uncertain,
        commentReviewed: false,
      });
      if (uncertain) void this.readbackArticle(articleId);
      this.publish({
        notice: uncertain
          ? '删除评论结果未明，正在回读；核对前不会重复删除。'
          : errorMessage(error, '删除评论失败，请重试'),
      });
      return false;
    } finally {
      this.writeControllers.delete(controller);
    }
  };

  /** 详情回读成功只标记已核对；仍需 UI 明确调用，不能仅清错误后自动重发。 */
  acknowledgeArticleReadback = (articleId: string) => {
    const work = this.workFor(articleId);
    const reviewed = work.reactionUncertain && work.reactionReviewed ||
      work.savedUncertain && work.savedReviewed ||
      work.commentUncertain && work.commentReviewed;
    if (!reviewed || work.reactionWriting || work.savedWriting || work.commentWriting) return false;
    this.patchWork(articleId, {
      reactionUncertain: false,
      reactionReviewed: false,
      savedUncertain: false,
      savedReviewed: false,
      commentUncertain: false,
      commentReviewed: false,
    });
    this.publish({ notice: '已解除文章提交锁定；再次操作会发起新的写入。' });
    return true;
  };

  setSourceDraft(patch: Partial<{ url: string; title: string }>) {
    if (this.disposed || this.state.sourceWriting || this.state.sourceUncertain) return;
    this.publish({ sourceDraft: { ...this.state.sourceDraft, ...patch }, sourceWriteError: undefined });
  }

  addSource = async (): Promise<boolean> => {
    if (!this.canRead() || this.state.sourceWriting || this.state.sourceUncertain) return false;
    let input;
    try {
      const title = this.state.sourceDraft.title.trim();
      input = assertNewsSourceInput({
        url: this.state.sourceDraft.url,
        ...(title ? { title } : {}),
      });
    } catch (error) {
      this.publish({ sourceWriteError: errorMessage(error, 'RSS 地址不正确') });
      return false;
    }
    const controller = new AbortController();
    this.writeControllers.add(controller);
    this.publish({ sourceWriting: true, sourceWriteError: undefined });
    try {
      const source = await this.client.createNewsSource(input, controller.signal);
      if (this.disposed) return false;
      this.cancelSources();
      this.publish({
        sources: [...this.state.sources.filter((item) => item.id !== source.id), source],
        sourceDraft: { url: '', title: '' },
        sourcesLoading: false,
        sourceWriting: false,
        sourceUncertain: false,
        sourceReviewed: false,
        notice: 'RSS 源已添加；需要新文章时可手动刷新。',
      });
      return true;
    } catch (error) {
      if (this.disposed) return false;
      const uncertain = uncertainWrite(error);
      this.publish({
        sourceWriting: false,
        sourceUncertain: uncertain,
        sourceReviewed: false,
        sourceWriteError: uncertain
          ? 'RSS 源添加结果未明，草稿已保留；回读并明确核对前不会重复提交。'
          : errorMessage(error, 'RSS 源添加失败，草稿已保留'),
      });
      if (uncertain) void this.loadSources();
      return false;
    } finally {
      this.writeControllers.delete(controller);
    }
  };

  deleteSource = async (sourceId: string): Promise<boolean> => {
    const work = this.sourceWorkFor(sourceId);
    if (!this.canRead() || work.writing || work.uncertain) return false;
    const controller = new AbortController();
    this.writeControllers.add(controller);
    this.patchSourceWork(sourceId, { writing: true });
    try {
      const result = await this.client.deleteNewsSource(sourceId, controller.signal);
      if (this.disposed) return false;
      this.cancelSources();
      this.publish({
        sources: this.state.sources.filter((source) => source.id !== result.sourceId),
        sourcesLoading: false,
        sourceDeleteWork: {
          ...this.state.sourceDeleteWork,
          [sourceId]: { writing: false, uncertain: false, reviewed: false },
        },
      });
      return true;
    } catch (error) {
      if (this.disposed) return false;
      const uncertain = uncertainWrite(error);
      this.patchSourceWork(sourceId, { writing: false, uncertain, reviewed: false });
      if (uncertain) void this.loadSources();
      this.publish({
        sourceError: uncertain
          ? '删除 RSS 源结果未明，正在回读；核对前不会重复删除。'
          : errorMessage(error, '删除 RSS 源失败，请重试'),
      });
      return false;
    } finally {
      this.writeControllers.delete(controller);
    }
  };

  acknowledgeSourceCreateReadback = () => {
    if (!this.state.sourceUncertain || !this.state.sourceReviewed || this.state.sourceWriting) return false;
    this.publish({
      sourceUncertain: false,
      sourceReviewed: false,
      sourceWriteError: undefined,
      notice: '已解除 RSS 添加锁定；再次添加会发起新的写入。',
    });
    return true;
  };

  acknowledgeSourceDeleteReadback = (sourceId: string) => {
    const work = this.sourceWorkFor(sourceId);
    if (!work.uncertain || !work.reviewed || work.writing) return false;
    this.patchSourceWork(sourceId, { uncertain: false, reviewed: false });
    this.publish({ sourceError: undefined, notice: '已解除 RSS 删除锁定。' });
    return true;
  };

  refreshFeeds = async (): Promise<boolean> => {
    if (!this.canRead() || this.state.feedRefreshing || this.state.feedUncertain) return false;
    const controller = new AbortController();
    this.writeControllers.add(controller);
    this.publish({ feedRefreshing: true, feedError: undefined, lastRefreshAdded: undefined });
    try {
      const result = await this.client.refreshNews(controller.signal);
      if (this.disposed) return false;
      this.publish({
        feedRefreshing: false,
        feedUncertain: false,
        feedReviewed: false,
        lastRefreshAdded: result.added,
        pollCount: 0,
        pollLimitReached: false,
        notice: `RSS 抓取完成，本次新增 ${result.added} 篇。`,
      });
      await Promise.all([this.loadStatus(), this.loadList(false)]);
      return true;
    } catch (error) {
      if (this.disposed) return false;
      const uncertain = uncertainWrite(error);
      this.publish({
        feedRefreshing: false,
        feedUncertain: uncertain,
        feedReviewed: false,
        feedError: uncertain
          ? 'RSS 抓取结果未明，正在回读；核对前不会重复提交。'
          : errorMessage(error, 'RSS 抓取失败，请重试'),
      });
      if (uncertain) void Promise.all([this.loadStatus(), this.loadList(false)]);
      return false;
    } finally {
      this.writeControllers.delete(controller);
    }
  };

  acknowledgeFeedReadback = () => {
    if (!this.state.feedUncertain || !this.state.feedReviewed || this.state.feedRefreshing) return false;
    this.publish({
      feedUncertain: false,
      feedReviewed: false,
      feedError: undefined,
      notice: '已解除 RSS 抓取锁定；再次刷新会发起新的抓取。',
    });
    return true;
  };

  clearNotice = () => this.publish({ notice: undefined });

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelReads();
    this.abortWrites();
    this.visible = false;
    this.active = false;
    this.state = initial();
    this.listeners.clear();
  }
}

export function createNewsStore(
  client: NewsClient,
  options: { pollIntervalMs?: number; pollLimit?: number } = {},
) {
  return new NewsStore(
    client,
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    options.pollLimit ?? DEFAULT_POLL_LIMIT,
  );
}
