import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { RuntimeStore, threadRuntime } from './runtime-store';

const Context = createContext<RuntimeStore | null>(null);

/** 原生通知流仅前台订阅；开发 Web 的宿主可见性不等于 App 生命周期。 */
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const connection = useServiceConnection();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const store = useMemo(() => new RuntimeStore(api), [api]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  const enabled = !!connection?.enabled && (Platform.OS === 'web' || foreground);
  useEffect(() => { store.setActive(enabled); return () => store.setActive(false); }, [store, enabled, connection?.snapshot.refreshVersion]);
  useEffect(() => () => store.dispose(), [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useRuntimeStore() {
  const store = useContext(Context);
  if (!store) throw new Error('RuntimeProvider is required');
  return store;
}
export function useThreadRuntime(threadId: string) {
  const store = useRuntimeStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...threadRuntime(snapshot, threadId), retry: store.retry, forgetThread: (id: string) => store.forgetThread(id) };
}
