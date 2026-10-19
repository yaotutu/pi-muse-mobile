import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { useApi } from '../api/ApiProvider';
import { ThreadSessionStore } from './thread-session-store';

const SessionContext = createContext<ThreadSessionStore | undefined>(undefined);

export function ThreadSessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const connection = useServiceConnection();
  const enabled = connection?.enabled ?? true;
  const store = useMemo(() => new ThreadSessionStore(api), [api]);
  store.setEnabled(enabled);
  useEffect(() => () => store.dispose(), [store]);
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useThreadSessionStore() {
  const store = useContext(SessionContext);
  if (!store) throw new Error('ThreadSessionProvider is required');
  return store;
}

export function useThreadSession(id: string) {
  const store = useThreadSessionStore();
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return store.get(id);
}
