import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api/errors.ts';
import { createNewsStore } from '../src/news/news-store.ts';

const tick = () => new Promise(setImmediate);
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const feedback = (patch = {}) => ({
  reaction: null,
  saved: false,
  comments: [],
  ...patch,
});

const article = (patch = {}) => ({
  id: 'article-1',
  sourceId: 'source-1',
  sourceTitle: '示例源',
  title: '示例文章',
  url: 'https://example.com/article',
  content: '安全正文',
  publishedAt: '2026-10-30T01:00:00Z',
  acceptedAt: '2026-10-30T01:01:00Z',
  recommendation: { reason: '相关' },
  feedback: feedback(),
  ...patch,
});

const source = (patch = {}) => ({
  id: 'source-1',
  title: '示例源',
  url: 'https://example.com/feed.xml',
  createdAt: '2026-10-30T00:00:00Z',
  lastFetchedAt: null,
  lastError: null,
  ...patch,
});

const status = (patch = {}) => ({
  refreshing: false,
  processing: false,
  pendingCount: 0,
  failedCount: 0,
  lastRefreshedAt: null,
  lastError: null,
  ...patch,
});

function createClient() {
  const calls = {
    lists: [],
    statuses: [],
    sources: [],
    details: [],
    reactions: [],
    saves: [],
    addComments: [],
    deleteComments: [],
    createSources: [],
    deleteSources: [],
    refreshes: [],
  };
  const pending = (bucket, value = {}) => {
    const entry = { ...value, ...deferred() };
    calls[bucket].push(entry);
    return entry.promise;
  };
  return {
    calls,
    listNewsArticles(query, signal) {
      return pending('lists', { query, signal });
    },
    getNewsStatus(signal) {
      return pending('statuses', { signal });
    },
    listNewsSources(signal) {
      return pending('sources', { signal });
    },
    getNewsArticle(articleId, signal) {
      return pending('details', { articleId, signal });
    },
    setNewsReaction(articleId, reaction, signal) {
      return pending('reactions', { articleId, reaction, signal });
    },
    setNewsSaved(articleId, saved, signal) {
      return pending('saves', { articleId, saved, signal });
    },
    addNewsComment(articleId, text, signal) {
      return pending('addComments', { articleId, text, signal });
    },
    deleteNewsComment(articleId, commentId, signal) {
      return pending('deleteComments', { articleId, commentId, signal });
    },
    createNewsSource(input, signal) {
      return pending('createSources', { input, signal });
    },
    deleteNewsSource(sourceId, signal) {
      return pending('deleteSources', { sourceId, signal });
    },
    refreshNews(signal) {
      return pending('refreshes', { signal });
    },
    async getNewsPreferences() {
      return { notes: '', learnedNotes: '' };
    },
    async saveNewsPreferences(input) {
      return { notes: input.notes, learnedNotes: '' };
    },
  };
}

async function openStore(store, client, page = { articles: [], nextCursor: null }) {
  store.setActive(true);
  store.open();
  assert.equal(client.calls.lists.length, 1);
  assert.equal(client.calls.lists[0].query.view, 'recommended');
  assert.equal(client.calls.statuses.length, 1);
  assert.equal(client.calls.sources.length, 1);
  client.calls.lists[0].resolve(page);
  client.calls.statuses[0].resolve(status());
  client.calls.sources[0].resolve([source()]);
  await tick();
}

test('新闻筛选切换隔离迟到列表；关闭与后台停止读取，不污染新视图', async () => {
  const client = createClient();
  const store = createNewsStore(client);
  store.setActive(true);
  store.open('all', false);

  const allCall = client.calls.lists[0];
  store.setSavedOnly(true);
  assert.equal(allCall.signal.aborted, true);
  const savedCall = client.calls.lists[1];
  allCall.resolve({ articles: [article()], nextCursor: null });
  await tick();
  assert.deepEqual(store.getSnapshot().articles, []);

  savedCall.resolve({ articles: [article({ feedback: feedback({ saved: true }) })], nextCursor: null });
  await tick();
  assert.equal(store.getSnapshot().savedOnly, true);
  assert.equal(store.getSnapshot().articles.length, 1);

  store.setView('recommended');
  const recommendedCall = client.calls.lists[2];
  savedCall.resolve({ articles: [article({ id: 'late-saved' })], nextCursor: null });
  await tick();
  assert.equal(store.getSnapshot().view, 'recommended');
  assert.deepEqual(store.getSnapshot().articles, []);

  store.close();
  assert.equal(recommendedCall.signal.aborted, true);
  recommendedCall.resolve({ articles: [article({ id: 'late-view' })], nextCursor: null });
  await tick();
  assert.deepEqual(store.getSnapshot().articles, []);
  assert.equal(store.getSnapshot().sources.length, 0);

  store.open();
  assert.equal(client.calls.lists.length, 4);
  store.setActive(false);
  assert.equal(client.calls.lists[3].signal.aborted, true);
  const before = client.calls.lists.length;
  await wait(5);
  assert.equal(client.calls.lists.length, before);
  store.dispose();
});

test('读取失败保留旧列表、源和详情并显示错误；迟到旧连接响应不能回灌', async () => {
  const client = createClient();
  const store = createNewsStore(client);
  await openStore(store, client, { articles: [article()], nextCursor: null });

  store.openArticle('article-1');
  client.calls.details[0].resolve({ article: article() });
  await tick();

  store.refresh();
  client.calls.lists[1].reject(new ApiError(500, '列表暂不可用'));
  client.calls.statuses[1].reject(new ApiError(500, '状态暂不可用'));
  client.calls.sources[1].reject(new ApiError(500, '源暂不可用'));
  client.calls.details[1].reject(new ApiError(500, '详情暂不可用'));
  await tick();

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.articles.length, 1);
  assert.equal(snapshot.sources.length, 1);
  assert.equal(snapshot.article?.id, 'article-1');
  assert.match(snapshot.listError, /列表暂不可用/);
  assert.match(snapshot.statusError, /状态暂不可用/);
  assert.match(snapshot.sourceError, /源暂不可用/);
  assert.match(snapshot.articleError, /详情暂不可用/);
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.articleStale, true);

  store.refresh();
  const late = client.calls.lists[2];
  store.dispose();
  late.resolve({ articles: [article({ id: 'late' })], nextCursor: null });
  await tick();
  assert.equal(store.getSnapshot().articles.length, 0);
});

test('每文章反馈写入互斥，反应与收藏状态独立；评论未明写保留草稿并锁住重发', async () => {
  const client = createClient();
  const store = createNewsStore(client);
  await openStore(store, client, { articles: [article()], nextCursor: null });
  store.openArticle('article-1');
  client.calls.details[0].resolve({ article: article() });
  await tick();

  const reacting = store.setReaction('article-1', 'like');
  assert.equal(client.calls.reactions.length, 1);
  assert.equal(await store.setSaved('article-1', true), false, '反应写入期间不得并发提交收藏');
  assert.equal(client.calls.saves.length, 0);
  client.calls.reactions[0].resolve(feedback({ reaction: 'like' }));
  assert.equal(await reacting, true);

  const saving = store.setSaved('article-1', true);
  assert.equal(client.calls.saves.length, 1);
  client.calls.saves[0].resolve(feedback({ reaction: 'like', saved: true }));
  assert.equal(await saving, true);
  await tick();
  assert.equal(store.getSnapshot().article.feedback.reaction, 'like');
  assert.equal(store.getSnapshot().article.feedback.saved, true);
  assert.equal(store.getSnapshot().articles[0].feedback.saved, true);

  store.setCommentDraft('article-1', '  新评论  ');
  const adding = store.addComment('article-1');
  assert.equal(client.calls.addComments[0].text, '新评论');
  client.calls.addComments[0].reject(new ApiError(503, '新闻服务暂不可用'));
  assert.equal(await adding, false);
  await tick();

  assert.equal(store.getSnapshot().commentDrafts['article-1'], '  新评论  ');
  assert.equal(store.getSnapshot().articleWork['article-1'].commentUncertain, true);
  assert.equal(client.calls.details.length, 2, '未明写应自动发起只读回读');
  assert.equal(await store.addComment('article-1'), false);
  assert.equal(client.calls.addComments.length, 1, '核对前不能重复 POST');

  client.calls.details[1].resolve({
    article: article({
      feedback: feedback({
        reaction: 'like',
        saved: true,
        comments: [{
          id: 'comment-1',
          text: '新评论',
          createdAt: '2026-10-30T02:00:00Z',
          updatedAt: '2026-10-30T02:00:00Z',
        }],
      }),
    }),
  });
  await tick();
  assert.equal(store.getSnapshot().articleWork['article-1'].commentReviewed, true);
  assert.equal(await store.addComment('article-1'), false, '仅回读成功不能自动解锁');
  assert.equal(store.acknowledgeArticleReadback('article-1'), true);

  const retry = store.addComment('article-1');
  assert.equal(client.calls.addComments.length, 2, '显式核对后才允许新写入');
  client.calls.addComments[1].resolve(feedback({ reaction: 'like', saved: true, comments: [] }));
  assert.equal(await retry, true);
  assert.equal(store.getSnapshot().commentDrafts['article-1'], '');
  store.dispose();
});

test('反馈写成功取消此前列表/详情读取，迟到旧响应不能覆盖新反馈', async () => {
  const client = createClient();
  const store = createNewsStore(client);
  await openStore(store, client, { articles: [article()], nextCursor: null });
  store.openArticle('article-1');
  client.calls.details[0].resolve({ article: article() });
  await tick();

  store.refresh();
  const staleList = client.calls.lists[1];
  const staleDetail = client.calls.details[1];
  const reacting = store.setReaction('article-1', 'like');
  client.calls.reactions[0].resolve(feedback({ reaction: 'like', saved: true }));
  assert.equal(await reacting, true);
  assert.equal(staleList.signal.aborted, true);
  assert.equal(staleDetail.signal.aborted, true);

  staleList.resolve({ articles: [article()], nextCursor: null });
  staleDetail.resolve({ article: article() });
  await tick();
  assert.equal(store.getSnapshot().article.feedback.reaction, 'like');
  assert.equal(store.getSnapshot().article.feedback.saved, true);
  assert.equal(store.getSnapshot().articles[0].feedback.reaction, 'like');
  assert.equal(store.getSnapshot().articles[0].feedback.saved, true);
  store.dispose();
});

test('评论提交期间更新草稿时，成功响应保留较新的草稿', async () => {
  const client = createClient();
  const store = createNewsStore(client);
  await openStore(store, client, { articles: [article()], nextCursor: null });

  store.setCommentDraft('article-1', '提交版本');
  const adding = store.addComment('article-1');
  store.setCommentDraft('article-1', '更新后的草稿');
  client.calls.addComments[0].resolve(feedback());
  assert.equal(await adding, true);
  assert.equal(store.getSnapshot().commentDrafts['article-1'], '更新后的草稿');
  store.dispose();
});

test('RSS 源添加结果未明保留草稿，回读后仍需明确解锁；成功后不自动连环刷新', async () => {
  const client = createClient();
  const store = createNewsStore(client);
  await openStore(store, client);

  store.setSourceDraft({ url: 'https://example.com/rss', title: '技术' });
  const first = store.addSource();
  assert.deepEqual(client.calls.createSources[0].input, {
    url: 'https://example.com/rss',
    title: '技术',
  });
  client.calls.createSources[0].reject(new Error('offline'));
  assert.equal(await first, false);
  await tick();
  assert.deepEqual(store.getSnapshot().sourceDraft, { url: 'https://example.com/rss', title: '技术' });
  assert.equal(store.getSnapshot().sourceUncertain, true);
  assert.equal(client.calls.sources.length, 2, '未明写应自动回读源列表');
  assert.equal(await store.addSource(), false);
  assert.equal(client.calls.createSources.length, 1);

  client.calls.sources[1].resolve([source()]);
  await tick();
  assert.equal(store.getSnapshot().sourceReviewed, true);
  assert.equal(await store.addSource(), false);
  assert.equal(store.acknowledgeSourceCreateReadback(), true);

  const second = store.addSource();
  assert.equal(client.calls.createSources.length, 2);
  client.calls.createSources[1].resolve(source({ id: 'source-2' }));
  assert.equal(await second, true);
  assert.equal(store.getSnapshot().sourceDraft.url, '');
  assert.equal(client.calls.refreshes.length, 0, '源添加成功后不自动 POST refresh');
  store.dispose();
});

test('RSS 写成功取消此前源读取，迟到列表不能丢弃新增源或复活已删源', async () => {
  const client = createClient();
  const store = createNewsStore(client);
  await openStore(store, client);

  store.refreshSources();
  const staleRead = client.calls.sources[1];
  store.setSourceDraft({ url: 'https://example.com/new.xml', title: '新源' });
  const adding = store.addSource();
  client.calls.createSources[0].resolve(source({ id: 'source-2', title: '新源', url: 'https://example.com/new.xml' }));
  assert.equal(await adding, true);
  assert.equal(staleRead.signal.aborted, true);
  staleRead.resolve([source()]);
  await tick();
  assert.deepEqual(store.getSnapshot().sources.map((item) => item.id), ['source-1', 'source-2']);

  store.refreshSources();
  const staleDeleteRead = client.calls.sources[2];
  const deleting = store.deleteSource('source-1');
  client.calls.deleteSources[0].resolve({ deleted: true, sourceId: 'source-1' });
  assert.equal(await deleting, true);
  assert.equal(staleDeleteRead.signal.aborted, true);
  staleDeleteRead.resolve([source(), source({ id: 'source-2' })]);
  await tick();
  assert.deepEqual(store.getSnapshot().sources.map((item) => item.id), ['source-2']);
  store.dispose();
});

test('分页原样传递游标、按 ID 去重，游标不前进与刷新后的迟到追加页不能污染列表', async () => {
  const client = createClient();
  const store = createNewsStore(client);
  await openStore(store, client, {
    articles: [article()],
    nextCursor: 'cursor-1',
  });

  store.loadMore();
  assert.equal(client.calls.lists[1].query.cursor, 'cursor-1');
  client.calls.lists[1].resolve({
    articles: [article(), article({ id: 'article-2' })],
    nextCursor: 'cursor-2',
  });
  await tick();
  assert.deepEqual(store.getSnapshot().articles.map((item) => item.id), ['article-1', 'article-2']);
  assert.equal(store.getSnapshot().nextCursor, 'cursor-2');

  store.loadMore();
  client.calls.lists[2].resolve({ articles: [article({ id: 'article-3' })], nextCursor: 'cursor-2' });
  await tick();
  assert.match(store.getSnapshot().listError, /游标没有前进/);
  assert.equal(store.getSnapshot().articles.length, 2);

  store.dispose();

  const lateClient = createClient();
  const lateStore = createNewsStore(lateClient);
  await openStore(lateStore, lateClient, { articles: [article()], nextCursor: 'cursor-1' });
  lateStore.loadMore();
  const lateAppend = lateClient.calls.lists[1];
  lateStore.refresh();
  assert.equal(lateAppend.signal.aborted, true);
  lateClient.calls.lists[2].resolve({ articles: [article({ id: 'fresh' })], nextCursor: null });
  lateClient.calls.statuses[1].resolve(status());
  lateClient.calls.sources[1].resolve([source()]);
  lateAppend.resolve({ articles: [article({ id: 'late' })], nextCursor: null });
  await tick();
  assert.deepEqual(lateStore.getSnapshot().articles.map((item) => item.id), ['fresh']);
  lateStore.dispose();
});

test('仅前台新闻页在处理中短轮询 status/list，终态、关闭或后台立即停止', async () => {
  const client = createClient();
  const store = createNewsStore(client, { pollIntervalMs: 1, pollLimit: 3 });
  store.setActive(true);
  store.open();
  client.calls.lists[0].resolve({ articles: [], nextCursor: null });
  client.calls.statuses[0].resolve(status({ processing: true, pendingCount: 1 }));
  client.calls.sources[0].resolve([]);
  await tick();

  await wait(5);
  assert.equal(client.calls.statuses.length, 2);
  assert.equal(store.getSnapshot().pollCount, 1);
  client.calls.statuses[1].resolve(status({ processing: true, pendingCount: 1 }));
  await tick();
  assert.equal(client.calls.lists.length, 2, '处理中轮询同时回读列表');
  client.calls.lists[1].resolve({ articles: [], nextCursor: null });
  await tick();

  await wait(5);
  assert.equal(client.calls.statuses.length, 3);
  client.calls.statuses[2].resolve(status());
  await tick();
  assert.equal(client.calls.lists.length, 3, '进入终态仍回读最后一批推荐结果');
  client.calls.lists[2].resolve({ articles: [article()], nextCursor: null });
  await tick();
  assert.deepEqual(store.getSnapshot().articles.map((item) => item.id), ['article-1']);
  const statusCalls = client.calls.statuses.length;
  const listCalls = client.calls.lists.length;
  await wait(10);
  assert.equal(client.calls.statuses.length, statusCalls, '终态后停止轮询');
  assert.equal(client.calls.lists.length, listCalls);

  store.setActive(false);
  store.open();
  store.setActive(true);
  assert.equal(client.calls.statuses.length, 4);
  client.calls.statuses[3].resolve(status({ processing: true, pendingCount: 1 }));
  await tick();
  store.setActive(false);
  const stoppedAt = client.calls.statuses.length;
  await wait(10);
  assert.equal(client.calls.statuses.length, stoppedAt, '后台停止轮询');
  store.dispose();
});
