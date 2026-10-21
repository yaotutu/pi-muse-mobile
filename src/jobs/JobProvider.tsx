import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { JobStore } from './job-store';

const Context = createContext<JobStore | null>(null);
export function JobProvider({ store, children }: { store: JobStore; children: ReactNode }) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useJobs() {
  const store = useContext(Context);
  if (!store) throw new Error('JobProvider is required');
  return { store, snapshot: useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) };
}
