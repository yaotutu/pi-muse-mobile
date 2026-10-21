import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ThemePreferenceStore } from './theme-controller';

/** 主题独立键，不复用连接存储；仅保存非敏感的主题 ID，切服/退出不清除此偏好。 */
export const THEME_PREFERENCE_KEY = 'pi-muse-mobile-theme-v1';
export const deviceThemePreferences: ThemePreferenceStore = {
  read: async () => Platform.OS === 'web'
    ? localStorage.getItem(THEME_PREFERENCE_KEY) : SecureStore.getItemAsync(THEME_PREFERENCE_KEY),
  write: async (value) => {
    if (Platform.OS === 'web') localStorage.setItem(THEME_PREFERENCE_KEY, value);
    else await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, value);
  },
};
