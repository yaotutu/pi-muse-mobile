import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { ProfileStore, type ProfileSnapshot } from './profile-store';

const Context = createContext<{ store: ProfileStore; snapshot: ProfileSnapshot } | null>(null);

/** 全局资料不随 space 隔离；连接域内按 active/open/前台读取，不建立轮询。 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const connection = useServiceConnection();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const store = useMemo(() => new ProfileStore(api), [api]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  const enabled = !!connection?.enabled && (Platform.OS === 'web' || foreground);
  useEffect(() => {
    store.setActive(enabled);
    return () => store.setActive(false);
  }, [store, enabled]);

  useEffect(() => () => store.dispose(), [store]);

  const value = useMemo(() => ({ store, snapshot }), [store, snapshot]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProfile() {
  const value = useContext(Context);
  if (!value) throw new Error('ProfileProvider is required');
  return value;
}
