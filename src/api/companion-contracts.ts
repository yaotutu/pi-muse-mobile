import { ApiError } from './errors';

export const COMPANION_STATES = ['idle', 'thinking', 'responding', 'working', 'waiting-approval', 'success', 'error', 'stopped'] as const;
export type CompanionState = typeof COMPANION_STATES[number];
export type CompanionPackSummary = { id: string; name: string; description: string; states: CompanionState[]; version: string; updatedAt: string };
export type CompanionDiagnostic = { id: string; message: string };
export type CompanionList = { companions: CompanionPackSummary[]; diagnostics: CompanionDiagnostic[] };
export interface CompanionClient {
  listCompanions(signal?: AbortSignal): Promise<CompanionList>;
  getCompanion(packId: string, signal?: AbortSignal): Promise<CompanionPackSummary>;
  fetchCompanionAsset(packId: string, state: CompanionState, signal?: AbortSignal): Promise<Uint8Array>;
}
const invalid = (): never => { throw new ApiError(502, '服务器助手形象响应格式不正确，请刷新核对'); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const exact = (item: Record<string, unknown>, keys: string[]) => Object.keys(item).length === keys.length && Object.keys(item).every((key) => keys.includes(key));
export const isCompanionPackId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
export const isCompanionState = (value: unknown): value is CompanionState => COMPANION_STATES.includes(value as CompanionState);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10);

export function parseCompanionPack(value: unknown, expectedId?: string): CompanionPackSummary {
  const item = object(value);
  if (!exact(item, ['id', 'name', 'description', 'states', 'version', 'updatedAt']) ||
    !isCompanionPackId(item.id) || (expectedId !== undefined && item.id !== expectedId) || !text(item.name) || typeof item.description !== 'string' ||
    !text(item.version) || !timestamp(item.updatedAt) || !Array.isArray(item.states) || item.states.length !== COMPANION_STATES.length ||
    !item.states.every(isCompanionState) || new Set(item.states).size !== COMPANION_STATES.length) return invalid();
  return { id: item.id, name: item.name, description: item.description, states: [...item.states], version: item.version, updatedAt: item.updatedAt };
}
export function parseCompanions(value: unknown): CompanionList {
  const item = object(value);
  if (!exact(item, ['companions', 'diagnostics']) || !Array.isArray(item.companions) || !Array.isArray(item.diagnostics)) return invalid();
  const companions = item.companions.map((pack) => parseCompanionPack(pack));
  if (new Set(companions.map((pack) => pack.id)).size !== companions.length) return invalid();
  const diagnostics = item.diagnostics.map((value) => {
    const diagnostic = object(value);
    if (!exact(diagnostic, ['id', 'message']) || !text(diagnostic.id) || !text(diagnostic.message)) return invalid();
    return { id: diagnostic.id, message: diagnostic.message };
  });
  return { companions, diagnostics };
}
export function parseCompanion(value: unknown, expectedId?: string): CompanionPackSummary {
  const item = object(value);
  if (!exact(item, ['companion'])) return invalid();
  return parseCompanionPack(item.companion, expectedId);
}

export const MAX_COMPANION_ASSET_BYTES = 786_432;
/** 传输和落盘共用校验；即使调用方注入客户端，也不能激活 HTML 错误页或超大文件。 */
export function assertCompanionPng(bytes: Uint8Array): void {
  const magic = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength > MAX_COMPANION_ASSET_BYTES || bytes.byteLength < magic.length || magic.some((value, index) => bytes[index] !== value)) {
    throw new ApiError(502, '助手形象图片不是有效 PNG 或超过大小限制');
  }
}
