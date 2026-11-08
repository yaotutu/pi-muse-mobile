export const MAIN_SESSION_ID = 'main';

/** 公开会话标识与底层历史绑定分离；重置后公开 ID 不变。 */
export type SessionRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  isMain: boolean;
};

export const isSessionId = (id: string): boolean => id === MAIN_SESSION_ID || /^[a-f0-9-]{36}$/.test(id);
export const orderSessions = (items: readonly SessionRecord[]): SessionRecord[] => [...items].sort((a, b) =>
  a.isMain ? -1 : b.isMain ? 1 : b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
