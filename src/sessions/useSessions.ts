import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { useSessionDirectoryStore } from './SessionProvider';

/** 页面仅订阅目录，事实与草稿都由连接级 Store 持有。 */
export function useSessions() {
  const store = useSessionDirectoryStore();
  const connection = useServiceConnection();
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  useEffect(() => {
    void store.reload();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void store.reload(); });
    return () => subscription.remove();
  }, [store, connection?.enabled, connection?.snapshot.refreshVersion]);
  return { store, sessions: store.records, loading: store.loading, loaded: store.loaded,
    error: store.directoryError, busy: store.directoryWriting, uncertain: store.directoryUncertain };
}
