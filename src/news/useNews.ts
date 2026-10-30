import { useSyncExternalStore } from 'react';
import type { NewsStore } from './news-store';

/**
 * UI 只订阅调用方按 ApiClient 生命周期创建的 Store。
 * 页面显式调用 open/close，应用前后台调用 setActive，连接替换时 dispose 并重建。
 */
export function useNews(store: NewsStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, snapshot };
}
