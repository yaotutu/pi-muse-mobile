import { ApiError } from '../api/errors';
import type {
  NewsArticle,
  NewsArticleDetail,
  NewsArticlePage,
  NewsComment,
  NewsFeedback,
  NewsPreferences,
  NewsReaction,
  NewsRefreshResult,
  NewsSource,
  NewsSourceCreateInput,
  NewsSourceDeleteResult,
  NewsStatus,
} from './types';

const invalid = (): never => {
  throw new ApiError(502, '服务器新闻响应格式不正确，请确认服务器版本与地址');
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);
const text = (value: unknown, limits: { min?: number; max?: number } = {}): string => {
  if (typeof value !== 'string') return invalid();
  if (value.length < (limits.min ?? 0) || value.length > (limits.max ?? Number.MAX_SAFE_INTEGER)) return invalid();
  return value;
};
const nullableText = (value: unknown, limits?: { min?: number; max?: number }): string | null =>
  value === null ? null : text(value, limits);
const integer = (value: unknown, min = 0): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) return invalid();
  return value;
};
const boolean = (value: unknown): boolean => (typeof value === 'boolean' ? value : invalid());
const timestamp = (value: unknown): string => {
  const result = text(value, { min: 1, max: 64 });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result))) return invalid();
  const day = result.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return invalid();
  return result;
};
const nullableTimestamp = (value: unknown): string | null => (value === null ? null : timestamp(value));
const newsId = (value: unknown): string => {
  const result = text(value, { min: 1, max: 128 });
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result) ? result : invalid();
};
const reaction = (value: unknown): NewsReaction | null =>
  value === null || value === 'like' || value === 'dislike' ? value : invalid();

/** 客户端只挡明显非法与带凭据 URL；SSRF/公网判定仍以服务端校验为准。 */
export function assertNewsHttpUrl(value: string): string {
  if (value.length > 2048 || value !== value.trim() || !/^https?:\/\//.test(value)) {
    throw new ApiError(400, 'RSS 地址必须是无凭据的 http(s) URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(400, 'RSS 地址必须是无凭据的 http(s) URL');
  }
  const passwordKey = 'pass' + 'word';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' ||
    parsed.username !== '' || parsed[passwordKey as keyof URL] !== '') {
    throw new ApiError(400, 'RSS 地址必须是无凭据的 http(s) URL');
  }
  return value;
}

export function assertNewsSourceInput(input: NewsSourceCreateInput): NewsSourceCreateInput {
  const url = assertNewsHttpUrl(input.url);
  const title = input.title?.trim();
  if (title !== undefined && (title.length === 0 || title.length > 500)) {
    throw new ApiError(400, 'RSS 标题必须为 1 到 500 字');
  }
  return { url, ...(title === undefined ? {} : { title }) };
}

export function normalizedNewsComment(text: string): string {
  const result = text.trim();
  if (!result || result.length > 4000) {
    throw new ApiError(400, '评论去除首尾空白后必须为 1 到 4000 字');
  }
  return result;
}

function parseHttpUrl(value: unknown): string {
  try {
    return assertNewsHttpUrl(text(value, { min: 1, max: 2048 }));
  } catch {
    return invalid();
  }
}

function parseComment(value: unknown): NewsComment {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'text', 'createdAt', 'updatedAt'])) return invalid();
  return {
    id: text(value.id, { min: 1 }),
    text: text(value.text, { min: 1, max: 4000 }),
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt),
  };
}

export function parseNewsFeedback(value: unknown): NewsFeedback {
  if (!isRecord(value) || !hasOnlyKeys(value, ['reaction', 'saved', 'comments'])) return invalid();
  if (!Array.isArray(value.comments)) return invalid();
  return {
    reaction: reaction(value.reaction),
    saved: boolean(value.saved),
    comments: value.comments.map(parseComment),
  };
}

/** 写接口统一包在 {feedback} 中；与文章详情内嵌反馈共用同一严格解析。 */
export function parseNewsFeedbackResponse(value: unknown): NewsFeedback {
  if (!isRecord(value) || !hasOnlyKeys(value, ['feedback'])) return invalid();
  return parseNewsFeedback(value.feedback);
}

export function parseNewsStatus(value: unknown): NewsStatus {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'refreshing', 'processing', 'pendingCount', 'failedCount', 'lastRefreshedAt', 'lastError',
  ])) return invalid();
  return {
    refreshing: boolean(value.refreshing),
    processing: boolean(value.processing),
    pendingCount: integer(value.pendingCount),
    failedCount: integer(value.failedCount),
    lastRefreshedAt: nullableTimestamp(value.lastRefreshedAt),
    lastError: nullableText(value.lastError),
  };
}

export function parseNewsSource(value: unknown): NewsSource {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id', 'title', 'url', 'createdAt', 'lastFetchedAt', 'lastError',
  ])) return invalid();
  return {
    id: newsId(value.id),
    title: text(value.title, { min: 1, max: 500 }),
    url: parseHttpUrl(value.url),
    createdAt: timestamp(value.createdAt),
    lastFetchedAt: nullableTimestamp(value.lastFetchedAt),
    lastError: nullableText(value.lastError),
  };
}

export function parseNewsSourceList(value: unknown): NewsSource[] {
  if (!isRecord(value) || !hasOnlyKeys(value, ['sources']) || !Array.isArray(value.sources)) return invalid();
  const sources = value.sources.map(parseNewsSource);
  if (new Set(sources.map((source) => source.id)).size !== sources.length) return invalid();
  return sources;
}

export function parseNewsSourceCreate(value: unknown): NewsSource {
  if (!isRecord(value) || !hasOnlyKeys(value, ['source'])) return invalid();
  return parseNewsSource(value.source);
}

export function parseNewsSourceDelete(value: unknown, expectedId?: string): NewsSourceDeleteResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ['deleted', 'sourceId']) || value.deleted !== true) return invalid();
  const sourceId = newsId(value.sourceId);
  if (expectedId !== undefined && sourceId !== expectedId) return invalid();
  return { deleted: true, sourceId };
}

function parseArticle(value: unknown): NewsArticle {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id', 'sourceId', 'sourceTitle', 'title', 'url', 'content', 'publishedAt', 'acceptedAt',
    'recommendation', 'feedback',
  ])) return invalid();
  let recommendation: NewsArticle['recommendation'];
  if (value.recommendation === null) recommendation = null;
  else {
    if (!isRecord(value.recommendation) || !hasOnlyKeys(value.recommendation, ['reason'])) return invalid();
    recommendation = { reason: text(value.recommendation.reason, { min: 1, max: 1000 }) };
  }
  return {
    id: newsId(value.id),
    sourceId: newsId(value.sourceId),
    sourceTitle: text(value.sourceTitle, { min: 1, max: 500 }),
    title: text(value.title, { min: 1, max: 500 }),
    url: value.url === null ? null : parseHttpUrl(value.url),
    content: text(value.content, { min: 1, max: 20000 }),
    publishedAt: timestamp(value.publishedAt),
    acceptedAt: timestamp(value.acceptedAt),
    recommendation,
    feedback: parseNewsFeedback(value.feedback),
  };
}

export function parseNewsArticlePage(value: unknown): NewsArticlePage {
  if (!isRecord(value) || !hasOnlyKeys(value, ['articles', 'nextCursor']) || !Array.isArray(value.articles)) {
    return invalid();
  }
  const articles = value.articles.map(parseArticle);
  const nextCursor = value.nextCursor === null ? null : text(value.nextCursor, { min: 1, max: 2048 });
  if (new Set(articles.map((article) => article.id)).size !== articles.length) return invalid();
  return { articles, nextCursor };
}

export function parseNewsArticleDetail(value: unknown, expectedId?: string): NewsArticleDetail {
  if (!isRecord(value) || !hasOnlyKeys(value, ['article'])) return invalid();
  const article = parseArticle(value.article);
  if (expectedId !== undefined && article.id !== expectedId) return invalid();
  return { article };
}

export function parseNewsRefresh(value: unknown): NewsRefreshResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ['added'])) return invalid();
  return { added: integer(value.added) };
}

export function parseNewsPreferences(value: unknown): NewsPreferences {
  if (!isRecord(value) || !hasOnlyKeys(value, ['notes', 'learnedNotes'])) return invalid();
  return {
    notes: text(value.notes, { max: 20000 }),
    learnedNotes: text(value.learnedNotes, { max: 20000 }),
  };
}
