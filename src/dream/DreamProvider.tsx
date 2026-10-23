import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { DreamStore, type DreamSnapshot } from './dream-store';

const Context = createContext<{ store: DreamStore; snapshot: DreamSnapshot } | null>(null);

/** Dream 是全局管理页，但状态与草稿仍只属于当前服务连接；原生后台暂停读取。 */
export function DreamProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const connection = useServiceConnection();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const store = useMemo(() => new DreamStore(api), [api]);
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

export function useDream() {
  const value = useContext(Context);
  if (!value) throw new Error('DreamProvider is required');
  return value;
}
