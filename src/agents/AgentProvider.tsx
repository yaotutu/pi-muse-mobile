import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { useApi } from '../api/ApiProvider';
import { AgentStore } from './agent-store';

const SessionContext = createContext<AgentStore | undefined>(undefined);

export function AgentProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const connection = useServiceConnection();
  const enabled = connection?.enabled ?? true;
  const store = useMemo(() => new AgentStore(api), [api]);
  store.setEnabled(enabled);
  useEffect(() => () => store.dispose(), [store]);
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useAgentStore() {
  const store = useContext(SessionContext);
  if (!store) throw new Error('AgentProvider is required');
  return store;
}

export function useAgentState(id: string) {
  const store = useAgentStore();
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return store.get(id);
}
