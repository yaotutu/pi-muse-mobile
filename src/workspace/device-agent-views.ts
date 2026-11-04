import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ViewPreferenceStorage } from './agent-view-preferences';

/** 使用独立的非敏感偏好键；不复用或修改服务器凭据与连接记录。 */
export const deviceAgentViews: ViewPreferenceStorage = {
  getItem: (key) => Platform.OS === 'web' ? Promise.resolve(localStorage.getItem(key)) : SecureStore.getItemAsync(key),
  setItem: async (key, value) => {
    if (Platform.OS === 'web') localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
};
