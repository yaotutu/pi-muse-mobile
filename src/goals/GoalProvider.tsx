import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { GoalStore } from './goal-store';

const Context = createContext<GoalStore | null>(null);

export function GoalProvider({ store, children }: { store: GoalStore; children: ReactNode }) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useGoals() {
  const store = useContext(Context);
  if (!store) throw new Error('GoalProvider is required');
  return {
    store,
    snapshot: useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot),
  };
}
