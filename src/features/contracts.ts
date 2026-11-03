import { ApiError } from '../api/errors';
import type { InformationClient } from '../information/contracts';
export type FeatureId = 'news' | 'sms';
export type FeatureBinding = { id: FeatureId; name: string; targetAgentId: string };
export type FeatureSource = { featureId: FeatureId; itemIds: string[] };
export type FeatureDiscussion = { agentId: string; sessionId: string; messageId: string; notificationId: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const invalid = () => new ApiError(502, '服务器返回的功能数据不正确，请刷新核对');
export function parseFeature(value: unknown): FeatureBinding {
  if (!record(value) || (value.id !== 'news' && value.id !== 'sms') || typeof value.name !== 'string' || typeof value.targetAgentId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.targetAgentId)) throw invalid();
  return { id: value.id, name: value.name, targetAgentId: value.targetAgentId };
}
export function parseFeatures(value: unknown): FeatureBinding[] {
  if (!record(value) || !Array.isArray(value.features)) throw invalid();
  const features = value.features.map(parseFeature);
  if (features.length !== 2 || new Set(features.map((feature) => feature.id)).size !== 2) throw invalid();
  return features;
}
export function parseFeatureSource(value: unknown): FeatureSource {
  if (!record(value) || (value.featureId !== 'news' && value.featureId !== 'sms') || !Array.isArray(value.itemIds) || !value.itemIds.length || value.itemIds.length > 20 || !value.itemIds.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) || Object.keys(value).some((key) => !['featureId', 'itemIds'].includes(key))) throw invalid();
  return { featureId: value.featureId, itemIds: value.itemIds as string[] };
}
export function parseDiscussion(value: unknown): FeatureDiscussion {
  if (!record(value) || !['agentId', 'sessionId', 'messageId', 'notificationId'].every((key) => typeof value[key] === 'string' && value[key])) throw invalid();
  return { agentId: value.agentId as string, sessionId: value.sessionId as string, messageId: value.messageId as string, notificationId: value.notificationId as string };
}
export interface FeatureClient {
  listFeatures(signal?: AbortSignal): Promise<FeatureBinding[]>;
  bindFeature(id: FeatureId, agentId: string, signal?: AbortSignal): Promise<FeatureBinding>;
  discussNews(articleId: string, signal?: AbortSignal): Promise<FeatureDiscussion>;
  getSmsSettings: (signal?: AbortSignal) => ReturnType<InformationClient['getInformationSettings']>;
  saveSmsSettings: (settings: Parameters<InformationClient['saveInformationSettings']>[1], signal?: AbortSignal) => ReturnType<InformationClient['saveInformationSettings']>;
  getSmsPreferences: (signal?: AbortSignal) => ReturnType<InformationClient['getInformationPreferences']>;
  saveSmsPreferences: (preferences: { notes: string }, signal?: AbortSignal) => ReturnType<InformationClient['saveInformationPreferences']>;
  ingestSmsItems: (items: Parameters<InformationClient['ingestInformationItems']>[1], signal?: AbortSignal) => ReturnType<InformationClient['ingestInformationItems']>;
  listSmsItems: (query?: Parameters<InformationClient['listInformationItems']>[1], signal?: AbortSignal) => ReturnType<InformationClient['listInformationItems']>;
  triggerSmsRun(signal?: AbortSignal): Promise<void>;
}
