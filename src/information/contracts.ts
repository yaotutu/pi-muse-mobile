import { ApiError } from '../api/errors';
import type {
  InformationFeedbackExample,
  InformationInputItem,
  InformationItem,
  InformationItemStatus,
  InformationItemsPage,
  InformationItemsQuery,
  InformationPreferences,
  InformationSettings,
} from './types';

const invalid = (): never => {
  throw new ApiError(502, '服务器信息后台响应格式不正确，请确认服务器版本与地址');
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, limits: { min?: number; max?: number } = {}): string => {
  if (typeof value !== 'string') return invalid();
  if (value.length < (limits.min ?? 0) || value.length > (limits.max ?? Number.MAX_SAFE_INTEGER)) return invalid();
  return value;
};
const boolean = (value: unknown): boolean => (typeof value === 'boolean' ? value : invalid());
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
};
const timestamp = (value: unknown): string => {
  const result = text(value, { min: 1, max: 64 });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result))) return invalid();
  return result;
};
const status = (value: unknown): InformationItemStatus => {
  if (value === 'pending' || value === 'processing' || value === 'processed' || value === 'failed') return value;
  return invalid();
};

export function parseInformationSettings(value: unknown): InformationSettings {
  if (!isRecord(value)) return invalid();
  return {
    enabled: boolean(value.enabled),
    batchWindowSeconds: integer(value.batchWindowSeconds, 0, 3600),
  };
}

export function parseInformationFeedbackExample(value: unknown): InformationFeedbackExample {
  if (!isRecord(value)) return invalid();
  const reactionVal = value.reaction;
  if (reactionVal !== null && reactionVal !== 'like' && reactionVal !== 'dislike') return invalid();
  if (!Array.isArray(value.comments) || !Array.isArray(value.items)) return invalid();
  return {
    runId: text(value.runId, { min: 1, max: 128 }),
    notificationId: text(value.notificationId, { min: 1, max: 128 }),
    text: text(value.text),
    reaction: reactionVal,
    comments: value.comments.map((c) => text(c)),
    commentsTruncated: boolean(value.commentsTruncated),
    items: value.items.map((item) => {
      if (!isRecord(item)) return invalid();
      return {
        id: text(item.id, { min: 1, max: 128 }),
        source: text(item.source, { min: 1, max: 128 }),
        title: item.title !== undefined ? text(item.title) : undefined,
        content: text(item.content),
        contentTruncated: boolean(item.contentTruncated),
      };
    }),
  };
}

export function parseInformationPreferences(value: unknown): InformationPreferences {
  if (!isRecord(value)) return invalid();
  if (!Array.isArray(value.feedbackExamples)) return invalid();
  return {
    notes: text(value.notes, { max: 20000 }),
    feedbackExamples: value.feedbackExamples.map(parseInformationFeedbackExample),
  };
}

export function parseInformationItem(value: unknown): InformationItem {
  if (!isRecord(value)) return invalid();
  return {
    id: text(value.id, { min: 1, max: 128 }),
    spaceId: text(value.spaceId, { min: 1, max: 128 }),
    source: text(value.source, { min: 1, max: 128 }),
    externalId: text(value.externalId, { min: 1, max: 256 }),
    title: value.title !== undefined ? text(value.title) : undefined,
    content: text(value.content),
    receivedAt: timestamp(value.receivedAt),
    acceptedAt: timestamp(value.acceptedAt),
    status: status(value.status),
    runId: value.runId !== undefined ? text(value.runId) : undefined,
  };
}

export function parseInformationIngestResult(value: unknown): InformationItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return invalid();
  return value.items.map(parseInformationItem);
}

export function parseInformationItemsPage(value: unknown): InformationItemsPage {
  if (!isRecord(value) || !Array.isArray(value.items)) return invalid();
  return {
    items: value.items.map(parseInformationItem),
    nextCursor: value.nextCursor !== undefined ? text(value.nextCursor) : undefined,
  };
}

export interface InformationClient {
  getInformationSettings(spaceId: string, signal?: AbortSignal): Promise<InformationSettings>;
  saveInformationSettings(spaceId: string, settings: InformationSettings, signal?: AbortSignal): Promise<InformationSettings>;
  getInformationPreferences(spaceId: string, signal?: AbortSignal): Promise<InformationPreferences>;
  saveInformationPreferences(spaceId: string, preferences: { notes: string }, signal?: AbortSignal): Promise<InformationPreferences>;
  ingestInformationItems(spaceId: string, items: InformationInputItem[], signal?: AbortSignal): Promise<InformationItem[]>;
  listInformationItems(spaceId: string, query?: InformationItemsQuery, signal?: AbortSignal): Promise<InformationItemsPage>;
  triggerInformationRun(spaceId: string, signal?: AbortSignal): Promise<void>;
}
