import { normalizeServerAddress } from './server-address';
import { normalizeBrowserAddress } from './browser-address';
import type { ConnectionRecord } from './types';

export const CONNECTION_KEY = 'pi-muse-connection';
export type AsyncKeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};
export type ConnectionStore = { load: () => Promise<ConnectionRecord | undefined>; save: (record: ConnectionRecord) => Promise<void> };

function recordFrom(value: unknown): ConnectionRecord {
  if (!value || typeof value !== 'object' || !('serverUrl' in value) || typeof value.serverUrl !== 'string') throw new Error('连接配置已损坏，请重新配置服务器');
  const record = value as Record<string, unknown>;
  if (record.token !== undefined && (typeof record.token !== 'string' || !record.token.trim())) throw new Error('连接凭证已损坏，请重新认证');
  if (record.resetPending !== undefined && typeof record.resetPending !== 'boolean') throw new Error('连接清理状态已损坏，请重新配置服务器');
  if (record.browserUrl !== undefined && typeof record.browserUrl !== 'string') throw new Error('浏览器地址已损坏，请重新配置');
  return {
    serverUrl: normalizeServerAddress(value.serverUrl),
    ...(record.browserUrl !== undefined ? { browserUrl: normalizeBrowserAddress(record.browserUrl) } : {}),
    ...(record.token !== undefined ? { token: record.token as string } : {}),
    ...(record.resetPending ? { resetPending: true } : {}),
  };
}

/** 单条记录绑定地址与Token；串行化防止迟到的凭证写入覆盖新配置。 */
export function createConnectionStore(storage: AsyncKeyValueStore): ConnectionStore {
  let pending: Promise<unknown> = Promise.resolve();
  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(action, action);
    pending = result.catch(() => undefined);
    return result;
  }
  return {
    load: () => enqueue(async () => {
      const raw = await storage.getItem(CONNECTION_KEY);
      if (raw === null) return undefined;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new Error('连接配置已损坏，请重新配置服务器'); }
      return recordFrom(value);
    }),
    save: (record) => enqueue(async () => {
      const value = recordFrom(record);
      await storage.setItem(CONNECTION_KEY, JSON.stringify(value));
    }),
  };
}
