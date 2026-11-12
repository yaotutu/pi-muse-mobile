import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import appConfig from '../../app.json';
import { apkAssetNameForAbi, getLatestRelease } from './releases';
import type { AppRelease } from './types';
import type { UpdateDependencies } from './update-manager';

const APP_PACKAGE = 'com.yaotutu.pimusemobile';
const DOWNLOAD_STALL_MS = 60_000;

// 设备首选 ABI 决定下载哪个拆分安装包；拿不到或不在拆分列表时由纯函数回退通用包。
function deviceApkAssetName(): string {
  return apkAssetNameForAbi(Device.supportedCpuArchitectures?.[0]);
}

function cancelled() {
  const error = new Error('下载已取消');
  error.name = 'AbortError';
  return error;
}

export async function downloadApk(
  release: AppRelease,
  signal: AbortSignal,
  onProgress: (written: number, total?: number) => void,
  force: boolean,
): Promise<string> {
  if (signal.aborted) throw cancelled();
  const directory = new Directory(Paths.cache, 'app-updates');
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `pi-muse-${release.assetId}.apk`);
  if (!force && destination.exists) return destination.uri;
  // 此目录仅属于安装包下载，不与服务器配置或业务缓存共用。
  for (const entry of directory.list()) entry.delete();
  const temporary = new File(directory, `pi-muse-${release.assetId}.part`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let stalled = false;
  let lastWritten = 0;
  const timeout = () => { stalled = true; controller.abort(); };
  let timer = setTimeout(timeout, DOWNLOAD_STALL_MS);
  const task = File.createDownloadTask(release.url, temporary, {
    signal: controller.signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (bytesWritten > lastWritten) {
        lastWritten = bytesWritten;
        clearTimeout(timer);
        timer = setTimeout(timeout, DOWNLOAD_STALL_MS);
      }
      onProgress(bytesWritten, totalBytes > 0 ? totalBytes : undefined);
    },
  });
  try {
    const file = await task.downloadAsync();
    if (signal.aborted) throw cancelled();
    if (!file) throw new Error('下载未完成，请重新下载');
    // 等待下载与移动都完成，不能把进度到100%当作可安装。
    await file.move(destination);
    if (signal.aborted) throw cancelled();
    return destination.uri;
  } catch (error) {
    if (temporary.exists) temporary.delete();
    if (destination.exists) destination.delete();
    if (stalled) throw new Error('下载长时间没有进展，请检查网络后重试');
    if (signal.aborted) throw cancelled();
    throw new Error('安装包下载失败，请检查网络和可用存储空间后重试', { cause: error });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    task.release();
  }
}

export async function installApk(uri: string): Promise<void> {
  const file = new File(uri);
  if (!file.exists) throw new Error('安装包已被系统清理，请重新下载');
  // 临时授予安装器读取content URI；签名和安装确认仍由Android负责。
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1,
  });
}

export function createUpdateDependencies(): UpdateDependencies {
  const standalone = Application.applicationId === APP_PACKAGE;
  const version = Platform.OS === 'android' && standalone ? Application.nativeApplicationVersion : appConfig.expo.version;
  const supported = Platform.OS === 'android' && standalone && !!version;
  return {
    currentVersion: version,
    supported,
    unsupportedReason: Platform.OS !== 'android'
      ? '当前平台不支持 Android APK 应用内更新，请使用 Android 安装包'
      : !standalone ? 'Expo Go 不支持 Pi Muse APK 更新，请先安装 Pi Muse Android 安装包' : '无法读取当前安装包版本，请重新安装正式版本',
    getLatestRelease: (signal) => getLatestRelease(signal, undefined, deviceApkAssetName()),
    download: downloadApk,
    fileExists: (uri) => new File(uri).exists,
    install: installApk,
    openInstallSettings: async () => {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, { data: `package:${APP_PACKAGE}` });
    },
  };
}
