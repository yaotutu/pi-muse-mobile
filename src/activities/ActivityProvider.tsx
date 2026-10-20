import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ActivityStore } from './activity-store';

const Context = createContext<ActivityStore | null>(null);
/** 由运行 Provider 同域创建；通知只做失效提示，不另开活动流。 */
export function ActivityProvider({ store, children }: { store: ActivityStore; children: ReactNode }) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useActivityStore() {
  const store = useContext(Context);
  if (!store) throw new Error('ActivityProvider is required');
  return store;
}
export function useActivities() {
  const store = useActivityStore();
  return { store, snapshot: useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) };
}
