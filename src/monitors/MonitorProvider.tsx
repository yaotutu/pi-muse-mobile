import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { MonitorStore } from './monitor-store';

const Context = createContext<MonitorStore | null>(null);

export function MonitorProvider({ store, children }: { store: MonitorStore; children: ReactNode }) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useMonitors() {
  const store = useContext(Context);
  if (!store) throw new Error('MonitorProvider is required');
  return {
    store,
    snapshot: useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot),
  };
}
