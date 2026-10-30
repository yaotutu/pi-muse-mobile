import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import {
  parseNewsArticlePage,
  parseNewsFeedback,
  parseNewsSourceList,
} from '../src/news/contracts.ts';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
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
  recommendation: { reason: '与关注主题相关' },
  feedback: { reaction: null, saved: false, comments: [] },
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

const feedback = (patch = {}) => ({
  reaction: 'like',
  saved: false,
  comments: [{
    id: 'comment-1',
    text: '有价值',
    createdAt: '2026-10-30T02:00:00Z',
    updatedAt: '2026-10-30T02:00:00Z',
  }],
  ...patch,
});

async function withClient(handler, work) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await work(new HttpApiClient('https://news.example', () => 'news-token', () => {}));
  } finally {
    globalThis.fetch = original;
  }
}

test('新闻列表显式发送 savedOnly=false，空游标不发，筛选和游标原样编码', async () => {
  const seen = [];
  await withClient(async (url, init) => {
    seen.push({ url, init });
    return json({ articles: [article()], nextCursor: null });
  }, async (api) => {
    await api.listNewsArticles();
    await api.listNewsArticles({ view: 'recommended', savedOnly: true, limit: 7, cursor: 'a+b/中文==' });
  });

  assert.equal(seen[0].url, 'https://news.example/api/news/articles?view=all&savedOnly=false&limit=20');
  assert.equal(seen[1].url, 'https://news.example/api/news/articles?view=recommended&savedOnly=true&limit=7&cursor=a%2Bb%2F%E4%B8%AD%E6%96%87%3D%3D');
  for (const { init } of seen) {
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.authorization, 'Bearer news-token');
    assert.equal(init.redirect, 'error');
  }
});

test('新闻读取端点使用 /api/news 且不携带 spaceId', async () => {
  const urls = [];
  await withClient(async (url) => {
    urls.push(url);
    if (url.endsWith('/status')) {
      return json({
        refreshing: false,
        processing: true,
        pendingCount: 2,
        failedCount: 1,
        lastRefreshedAt: null,
        lastError: null,
      });
    }
    if (url.endsWith('/sources')) return json({ sources: [source()] });
    if (url.endsWith('/preferences')) return json({ notes: '关注 AI', learnedNotes: '偏技术' });
    return json({ article: article() });
  }, async (api) => {
    await api.getNewsStatus();
    await api.listNewsSources();
    await api.getNewsArticle('article-1');
    await api.getNewsPreferences();
  });

  assert.deepEqual(urls, [
    'https://news.example/api/news/status',
    'https://news.example/api/news/sources',
    'https://news.example/api/news/articles/article-1',
    'https://news.example/api/news/preferences',
  ]);
  assert.equal(urls.some((url) => url.includes('spaceId')), false);
});

test('新闻写入端点严格发送冻结请求体并返回完整反馈', async () => {
  const requests = [];
  await withClient(async (url, init) => {
    requests.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/refresh')) return json({ added: 3 });
    if (url.endsWith('/sources')) return json({ source: source({ id: 'source-2' }) });
    if (url.endsWith('/preferences')) return json({ notes: '新备注', learnedNotes: '' });
    if (url.includes('/saved')) return json({ feedback: feedback({ saved: true }) });
    if (url.includes('/reaction')) return json({ feedback: feedback({ reaction: null }) });
    if (url.includes('/comments/')) return json({ feedback: feedback({ comments: [] }) });
    if (url.includes('/comments')) return json({ feedback: feedback() });
    if (init.method === 'DELETE') return json({ deleted: true, sourceId: 'source-1' });
    throw new Error(`意外请求 ${url}`);
  }, async (api) => {
    await assert.rejects(
      api.createNewsSource({ url: ' https://example.com/rss ' }),
      (error) => error instanceof ApiError && error.status === 400,
    );
  });
  // 上面的前导空格应先被客户端拒绝，不能发请求。
  assert.equal(requests.length, 0);

  await withClient(async (url, init) => {
    requests.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/refresh')) return json({ added: 3 });
    if (url.endsWith('/sources')) return json({ source: source({ id: 'source-2' }) });
    if (url.endsWith('/preferences')) return json({ notes: '新备注', learnedNotes: '' });
    if (url.includes('/saved')) return json({ feedback: feedback({ saved: true }) });
    if (url.includes('/reaction')) return json({ feedback: feedback({ reaction: null }) });
    if (url.includes('/comments/')) return json({ feedback: feedback({ comments: [] }) });
    if (url.includes('/comments')) return json({ feedback: feedback() });
    if (init.method === 'DELETE') return json({ deleted: true, sourceId: 'source-1' });
    throw new Error(`意外请求 ${url}`);
  }, async (api) => {
    await api.createNewsSource({ url: 'https://example.com/rss', title: ' 技术源 ' });
    await api.deleteNewsSource('source-1');
    await api.setNewsReaction('article_1', 'dislike');
    await api.setNewsSaved('article_1', true);
    await api.addNewsComment('article_1', '  一条评论  ');
    await api.deleteNewsComment('article_1', 'comment/一');
    await api.refreshNews();
    await api.saveNewsPreferences({ notes: '新备注' });
  });

  assert.deepEqual(requests, [
    {
      url: 'https://news.example/api/news/sources',
      method: 'POST',
      body: { url: 'https://example.com/rss', title: '技术源' },
    },
    {
      url: 'https://news.example/api/news/sources/source-1',
      method: 'DELETE',
      body: undefined,
    },
    {
      url: 'https://news.example/api/news/articles/article_1/reaction',
      method: 'PUT',
      body: { reaction: 'dislike' },
    },
    {
      url: 'https://news.example/api/news/articles/article_1/saved',
      method: 'PUT',
      body: { saved: true },
    },
    {
      url: 'https://news.example/api/news/articles/article_1/comments',
      method: 'POST',
      body: { text: '一条评论' },
    },
    {
      url: 'https://news.example/api/news/articles/article_1/comments/comment%2F%E4%B8%80',
      method: 'DELETE',
      body: undefined,
    },
    {
      url: 'https://news.example/api/news/refresh',
      method: 'POST',
      body: {},
    },
    {
      url: 'https://news.example/api/news/preferences',
      method: 'PUT',
      body: { notes: '新备注' },
    },
  ]);
});

test('新闻严格解析公开响应；额外字段、错位 ID、坏 URL 和错误类型均报 502', () => {
  const credentialUrl = `https://user:${'pass' + 'word'}@example.com/a`;
  assert.deepEqual(parseNewsArticlePage({ articles: [article()], nextCursor: null }), {
    articles: [article()],
    nextCursor: null,
  });
  assert.deepEqual(parseNewsSourceList({ sources: [source()] }), [source()]);
  assert.deepEqual(parseNewsFeedback(feedback()), feedback());

  for (const value of [
    { articles: [{ ...article(), secret: true }], nextCursor: null },
    { articles: [article({ id: '../bad' })], nextCursor: null },
    { articles: [article({ url: credentialUrl })], nextCursor: null },
    { articles: [article()], nextCursor: '' },
    { articles: [article()], nextCursor: null, hasMore: false },
    { sources: [source({ url: 'file:///tmp/feed' })] },
    { reaction: 'neutral', saved: false, comments: [] },
    { reaction: null, saved: 'false', comments: [] },
  ]) {
    assert.throws(() => {
      if ('sources' in value) parseNewsSourceList(value);
      else if ('reaction' in value) parseNewsFeedback(value);
      else parseNewsArticlePage(value);
    }, (error) => error instanceof ApiError && error.status === 502);
  }
});

test('新闻源 URL 与评论在客户端先校验，非法请求不触网', async () => {
  const credentialUrl = `https://user:${'pass' + 'word'}@example.com/feed`;
  let calls = 0;
  await withClient(async () => {
    calls += 1;
    return json({});
  }, async (api) => {
    for (const url of [
      'ftp://example.com/feed',
      credentialUrl,
      'https://example.com/feed ',
      'not-a-url',
    ]) {
      await assert.rejects(api.createNewsSource({ url }), (error) => error instanceof ApiError && error.status === 400);
    }
    await assert.rejects(api.addNewsComment('article-1', '   '), (error) => error instanceof ApiError && error.status === 400);
    await assert.rejects(
      api.addNewsComment('article-1', 'x'.repeat(4001)),
      (error) => error instanceof ApiError && error.status === 400,
    );
  });
  assert.equal(calls, 0);
});

test('新闻接口保留 HTTP 错误状态且不自动重试', async () => {
  let calls = 0;
  await withClient(async () => {
    calls += 1;
    return json({ error: '新闻暂不可用' }, 503);
  }, async (api) => {
    await assert.rejects(api.listNewsArticles(), (error) =>
      error instanceof ApiError && error.status === 503 && error.message === '新闻暂不可用');
  });
  assert.equal(calls, 1);
});
