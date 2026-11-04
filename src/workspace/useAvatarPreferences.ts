import { useEffect, useMemo, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { AvatarPreferenceStore } from './avatar-preferences';

export function useAvatarPreferences(serverUrl: string) {
  const store = useMemo(() => {
    // 地址逐字符编码，避免 SecureStore 不允许的字符；不使用 token 或明文 AccessKey 作为偏好键。
    const key = 'pi-muse-avatar-pins-' + [...serverUrl].map((char) => char.charCodeAt(0).toString(16)).join('-');
    return new AvatarPreferenceStore({
      read: () => Platform.OS === 'web' ? Promise.resolve(localStorage.getItem(key)) : SecureStore.getItemAsync(key),
      write: async (value) => { if (Platform.OS === 'web') localStorage.setItem(key, value); else await SecureStore.setItemAsync(key, value); },
    });
  }, [serverUrl]);
  useEffect(() => { void store.load(); }, [store]);
  return { ...useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot), toggle: (id: string) => void store.toggle(id), retry: () => void store.load() };
}
