import { Platform } from 'react-native';
import { Directory } from 'expo-file-system';
import type { WorkspaceFileDetail } from './types';
import { safeDownloadFileName } from './native-download-name';
import { writeVerifiedDownloadTarget } from './native-download-target';

export type NativeDownloadResult =
  | { status: 'saved'; fileName: string; uri: string }
  | { status: 'cancelled' }
  | { status: 'conflict'; fileName: string; uri: string }
  | { status: 'unsupported'; message: string }
  | { status: 'error'; message: string };

export function decodeBase64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesOf(detail: WorkspaceFileDetail): Uint8Array {
  return detail.kind === 'text' ? new TextEncoder().encode(detail.content) : decodeBase64ToBytes(detail.dataBase64);
}

/**
 * Android/iOS 由用户选择目标目录；已存在同名文件时只返回冲突，不覆盖。
 * Web 的 expo-file-system 目录选择与本地写入不可用，诚实体外化为 unsupported。
 */
export async function saveWorkspaceFileToDevice(detail: WorkspaceFileDetail): Promise<NativeDownloadResult> {
  if (Platform.OS === 'web') {
    return { status: 'unsupported', message: '当前 Web 环境不支持保存到设备目录；请在 Android 客户端下载。' };
  }

  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync();
  } catch (error) {
    if (error instanceof Error && /cancel/i.test(error.message)) return { status: 'cancelled' };
    return { status: 'error', message: error instanceof Error ? error.message : '无法打开目录选择器' };
  }

  const fileName = safeDownloadFileName(detail.name);
  return writeVerifiedDownloadTarget(directory, fileName, detail.mimeType, bytesOf(detail));
}
