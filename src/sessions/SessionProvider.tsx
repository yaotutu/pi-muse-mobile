import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { useApi } from '../api/ApiProvider';
import { ChatSessionStore } from './chat-session-store';
import { SessionStore } from './session-store';

const DirectoryContext = createContext<SessionStore | undefined>(undefined);
const SessionContext = createContext<ChatSessionStore | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const connection = useServiceConnection();
  const enabled = connection?.enabled ?? true;
  const store = useMemo(() => new ChatSessionStore(api), [api]);
  const directory = useMemo(() => new SessionStore(api, store), [api, store]);
  store.setEnabled(enabled); directory.setEnabled(enabled);
  useEffect(() => () => { store.dispose(); directory.dispose(); }, [store, directory]);
  return <DirectoryContext.Provider value={directory}><SessionContext.Provider value={store}>{children}</SessionContext.Provider></DirectoryContext.Provider>;
}

export function useChatSessionStore() {
  const store = useContext(SessionContext);
  if (!store) throw new Error('SessionProvider is required');
  return store;
}

export function useSessionState(id: string) {
  const store = useChatSessionStore();
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return store.get(id);
}

export function useSessionDirectoryStore() { const store = useContext(DirectoryContext); if (!store) throw new Error('SessionProvider is required'); return store; }
