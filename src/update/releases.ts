import { fetch } from 'expo/fetch';
import type { AppRelease } from './types';

export const RELEASE_REPOSITORY = 'yaotutu/pi-muse-mobile';
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
// 通用包含全部 CPU 架构，命名保持 app-release.apk：旧版本更新器只认这个名字，不能改。
export const UNIVERSAL_APK_NAME = 'app-release.apk';
// 按 ABI 拆分的 release 产物名，与 CI gradle splits 的输出一一对应。
const ABI_APK_NAMES: Readonly<Record<string, string>> = {
  'arm64-v8a': 'app-arm64-v8a-release.apk',
  'armeabi-v7a': 'app-armeabi-v7a-release.apk',
  'x86': 'app-x86-release.apk',
  'x86_64': 'app-x86_64-release.apk',
};
const CHECK_TIMEOUT_MS = 15_000;

function versionParts(version: string): number[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('版本号格式不受支持');
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('版本号格式不受支持');
  return parts;
}

export function isNewerVersion(candidate: string, installed: string): boolean {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
}

/** 设备首选 ABI 对应的拆分包资产名；未知或缺失 ABI 回退通用包。 */
export function apkAssetNameForAbi(abi: string | null | undefined): string {
  return (abi ? ABI_APK_NAMES[abi] : undefined) ?? UNIVERSAL_APK_NAME;
}

/** 手动下载入口的 latest 永久地址；只允许本模块生成的固定文件名。 */
export function latestApkDownloadUrl(assetName: string): string {
  if (assetName !== UNIVERSAL_APK_NAME && !Object.values(ABI_APK_NAMES).includes(assetName)) {
    throw new Error('安装包名称不受支持');
  }
  return `https://github.com/${RELEASE_REPOSITORY}/releases/latest/download/${assetName}`;
}

export function parseRelease(value: unknown, apkName = UNIVERSAL_APK_NAME): AppRelease {
  if (!value || typeof value !== 'object') throw new Error('发布信息格式不正确');
  const release = value as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error('当前发布不是受支持的正式版本');
  }
  const version = release.tag_name.slice(1);
  versionParts(version);
  if (!Number.isSafeInteger(release.id) || (release.id as number) <= 0 || !Array.isArray(release.assets)) throw new Error('发布信息缺少有效安装包');
  // 优先拆分包，缺失时回退通用包；任一名字出现多份仍视为异常，不猜该下载哪个。
  const candidates = apkName === UNIVERSAL_APK_NAME ? [UNIVERSAL_APK_NAME] : [apkName, UNIVERSAL_APK_NAME];
  let asset: Record<string, unknown> | undefined;
  for (const name of candidates) {
    const matches = release.assets.filter((entry: unknown) => !!entry && typeof entry === 'object' && (entry as Record<string, unknown>).name === name);
    if (matches.length > 1) throw new Error('正式版本没有唯一的 Android 安装包');
    if (matches.length === 1) { asset = matches[0] as Record<string, unknown>; break; }
  }
  if (!asset) throw new Error('正式版本没有唯一的 Android 安装包');
  if (!Number.isSafeInteger(asset.id) || (asset.id as number) <= 0 || !Number.isSafeInteger(asset.size) || (asset.size as number) <= 0 || typeof asset.browser_download_url !== 'string') {
    throw new Error('安装包信息不完整');
  }
  const url = new URL(asset.browser_download_url);
  // 更新只来自官方仓库，业务服务器不能指定可执行安装包；URL 路径必须与选中的拆分包名一致。
  if (url.protocol !== 'https:' || url.host !== 'github.com' || url.username || url.password || url.search || url.hash || url.pathname !== `/${RELEASE_REPOSITORY}/releases/download/${release.tag_name}/${asset.name}`) {
    throw new Error('安装包不属于官方发布地址');
  }
  return { id: release.id as number, assetId: asset.id as number, version, size: asset.size as number, url: url.href };
}

export async function getLatestRelease(signal: AbortSignal, timeoutMs = CHECK_TIMEOUT_MS, apkName = UNIVERSAL_APK_NAME): Promise<AppRelease> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    // 与业务客户端隔离：不附带用户服务器的 Token、Key 或 Cookie。
    const response = await fetch(LATEST_RELEASE_URL, {
      signal: controller.signal,
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json' },
      redirect: 'error',
    });
    if (response.status === 404) throw new Error('暂时没有可用的正式版本');
    if (response.status === 403 || response.status === 429) throw new Error('GitHub 检查更新请求受限，请稍后重试');
    if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}），请稍后重试`);
    if (controller.signal.aborted) throw new Error('检查更新已取消');
    return parseRelease(await response.json(), apkName);
  } catch (error) {
    if (timedOut) throw new Error('检查更新超时，请稍后重试');
    if (signal.aborted) { const cancelled = new Error('检查更新已取消'); cancelled.name = 'AbortError'; throw cancelled; }
    throw error instanceof Error ? error : new Error('无法连接 GitHub，请检查网络后重试');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
