export type NativeDownloadWritableFile = {
  uri: string;
  write(content: Uint8Array): void;
  delete(): void;
};

export type NativeDownloadDirectory = {
  uri: string;
  info(): { exists: boolean; files?: string[] };
  createFile(name: string, mimeType: string): NativeDownloadWritableFile;
};

export type VerifiedDownloadTargetResult =
  | { status: 'conflict'; fileName: string; uri: string }
  | { status: 'saved'; fileName: string; uri: string }
  | { status: 'error'; message: string };

const childNames = (directory: NativeDownloadDirectory): string[] => {
  const info = directory.info();
  if (!info.exists || !Array.isArray(info.files) || info.files.some((name) => typeof name !== 'string')) {
    throw new Error('unable to inspect directory children');
  }
  return info.files;
};

const discardCreatedFile = (file: NativeDownloadWritableFile): boolean => {
  try {
    file.delete();
    return true;
  } catch {
    return false;
  }
};

/**
 * SAF 不能用拼接 content URI 或 File.name 判断子项名；必须读取目录 display names。
 * 创建后若 provider 自动改名，只删除本次返回且尚未写入的对象，绝不覆盖或删除既有文件。
 */
export function writeVerifiedDownloadTarget(
  directory: NativeDownloadDirectory,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): VerifiedDownloadTargetResult {
  let names: string[];
  try {
    names = childNames(directory);
  } catch {
    return { status: 'error', message: '无法确认所选目录中的同名文件，已停止下载。' };
  }
  if (names.includes(fileName)) {
    // SAF 子项 URI 不可由文件名可靠拼接；返回目录 URI，不伪造目标文件 URI。
    return { status: 'conflict', fileName, uri: directory.uri };
  }

  let file: NativeDownloadWritableFile;
  try {
    file = directory.createFile(fileName, mimeType);
  } catch (error) {
    const cause = error instanceof Error && error.message ? `：${error.message}` : '';
    return { status: 'error', message: `无法在所选目录创建文件${cause}` };
  }
  try {
    const createdNames = childNames(directory);
    const beforeNames = new Set(names);
    const addedNames = createdNames.filter((name) => !beforeNames.has(name));
    if (!(addedNames.length === 1 && addedNames[0] === fileName)) {
      const removed = discardCreatedFile(file);
      return {
        status: 'error',
        message: removed
          ? '所选目录服务自动更改了文件名，已取消本次下载。'
          : '所选目录服务自动更改了文件名，且本次空文件清理失败；请手动删除刚生成的空文件。',
      };
    }
    file.write(bytes);
    return { status: 'saved', fileName, uri: file.uri };
  } catch (error) {
    const removed = discardCreatedFile(file);
    const cause = error instanceof Error && error.message ? `：${error.message}` : '';
    return {
      status: 'error',
      message: removed
        ? `文件写入设备失败，本次新建文件已清理${cause}`
        : `文件写入或名称核对失败，本次新建文件清理失败${cause}`,
    };
  }
}
