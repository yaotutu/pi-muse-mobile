import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { CompanionPreferences } from './types';

/** 仅保存非敏感形象 key，与连接认证存储完全分离。 */
export const COMPANION_PREFERENCE_KEY = 'pi-muse-mobile-companion-v1';
let pendingWrite: Promise<void> = Promise.resolve();
export const deviceCompanionPreferences: CompanionPreferences = {
  read: async () => {
    await pendingWrite;
    return Platform.OS === 'web' ? localStorage.getItem(COMPANION_PREFERENCE_KEY) : SecureStore.getItemAsync(COMPANION_PREFERENCE_KEY);
  },
  write: (value) => {
    const result = pendingWrite.then(async () => {
      if (Platform.OS === 'web') localStorage.setItem(COMPANION_PREFERENCE_KEY, value);
      else await SecureStore.setItemAsync(COMPANION_PREFERENCE_KEY, value);
    });
    pendingWrite = result.catch(() => {});
    return result;
  },
};
