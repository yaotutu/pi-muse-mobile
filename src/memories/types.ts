import type { MemoryItem } from '../api/types';

export type MemoryQuery = {
  q?: string;
  limit?: number;
  sort?: 'updatedAt' | 'createdAt';
  order?: 'asc' | 'desc';
};
export type MemoryPage = { memories: MemoryItem[] };

/** 全局长期记忆与空间无关；只用独立 HTTP，不读工作区大快照、不新增通知连接。 */
export interface MemoryClient {
  listMemories(query?: MemoryQuery, signal?: AbortSignal): Promise<MemoryPage>;
  getMemory(id: string, signal?: AbortSignal): Promise<MemoryItem>;
  addMemory(text: string, source?: string, signal?: AbortSignal): Promise<MemoryItem>;
  editMemory(id: string, text: string, signal?: AbortSignal): Promise<MemoryItem>;
  forgetMemory(id: string, signal?: AbortSignal): Promise<void>;
}
