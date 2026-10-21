import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { MemoryStore } from './memory-store';

const Context = createContext<MemoryStore | null>(null);
export function MemoryProvider({ store, children }: { store: MemoryStore; children: ReactNode }) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useMemories() {
  const store = useContext(Context);
  if (!store) throw new Error('MemoryProvider is required');
  return { store, snapshot: useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) };
}
