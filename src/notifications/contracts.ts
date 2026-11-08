import { ApiError } from '../api/errors';
export type FeatureSource = { featureId: 'news' | 'sms'; itemIds: string[] };
/** 通知定位只引用真实公开会话与消息，不持有独立讨论上下文。 */
export type NotificationReference = { sessionId: string; messageId: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const invalid = () => new ApiError(502, '通知来源格式不正确');
export function parseFeatureSource(value: unknown): FeatureSource {
  if (!record(value) || (value.featureId !== 'news' && value.featureId !== 'sms') || !Array.isArray(value.itemIds) || !value.itemIds.length || value.itemIds.length > 20 || !value.itemIds.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) || Object.keys(value).some((key) => !['featureId', 'itemIds'].includes(key))) throw invalid();
  return { featureId: value.featureId, itemIds: value.itemIds as string[] };
}
