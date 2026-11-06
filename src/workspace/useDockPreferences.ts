import { useEffect, useMemo, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  DockPreferenceStore,
  getDockStorageKey,
  type DockPreferences,
} from './dock-preferences';

/**
 * 底部固定 Agent 偏好设置 Hook。
 *
 * 复用 getDockStorageKey 以对服务器地址安全编码，无缝继承既有置顶顺序。
 * Web 平台使用 localStorage，原生平台使用 SecureStore；不持久化明文凭据或 Token。
 */
export function useDockPreferences(serverUrl: string) {
  const store = useMemo(() => {
    const key = getDockStorageKey(serverUrl);
    return new DockPreferenceStore({
      read: () =>
        Platform.OS === 'web'
          ? Promise.resolve(localStorage.getItem(key))
          : SecureStore.getItemAsync(key),
      write: async (value) => {
        if (Platform.OS === 'web') localStorage.setItem(key, value);
        else await SecureStore.setItemAsync(key, value);
      },
    });
  }, [serverUrl]);

  useEffect(() => {
    void store.load();
  }, [store]);

  const snapshot: DockPreferences = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return {
    ...snapshot,
    store,
    togglePin: (id: string) => store.togglePin(id),
    reorder: (orderOrFrom: readonly string[] | number, toIndex?: number) =>
      store.reorder(orderOrFrom, toIndex),
    retry: () => void store.load(),
  };
}
