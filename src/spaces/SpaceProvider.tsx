import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { useApi } from '../api/ApiProvider';
import { SpaceStore } from './space-store';

const SessionContext = createContext<SpaceStore | undefined>(undefined);

export function SpaceProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const connection = useServiceConnection();
  const enabled = connection?.enabled ?? true;
  const store = useMemo(() => new SpaceStore(api), [api]);
  store.setEnabled(enabled);
  useEffect(() => () => store.dispose(), [store]);
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useSpaceStore() {
  const store = useContext(SessionContext);
  if (!store) throw new Error('SpaceProvider is required');
  return store;
}

export function useSpaceState(id: string) {
  const store = useSpaceStore();
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return store.get(id);
}
