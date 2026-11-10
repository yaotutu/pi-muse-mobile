import { clearCompanionCache } from '../companion/companion-cache';
import { deviceCompanionPreferences } from '../companion/device-preferences';

// 只清本机业务缓存，不删除服务器配置或凭证记录；跨服形象不能沿用旧服务器选择。
export async function clearLocalWorkspaceData(): Promise<void> {
  await clearCompanionCache();
  await deviceCompanionPreferences.write('builtin:penguin');
}
