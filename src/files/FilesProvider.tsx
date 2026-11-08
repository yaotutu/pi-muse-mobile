import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { FilesStore, type FilesSnapshot } from './files-store';

const Context = createContext<{ store: FilesStore; snapshot: FilesSnapshot } | null>(null);

/**
 * FilesProvider 只承载当前连接与前台生命周期；文件面板后续必须调用 open()/close()。
 * 所有会话共用同一工作区；聊天切换不影响文件草稿。
 */
export function FilesProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const connection = useServiceConnection();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const store = useMemo(() => new FilesStore(api), [api]);
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

export function useFiles() {
  const value = useContext(Context);
  if (!value) throw new Error('FilesProvider is required');
  return value;
}
