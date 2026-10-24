const SAFE_DOWNLOAD_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * 下载文件名必须落在 Android 文件系统可安全创建的 ASCII 集合内；
 * 历史非 ASCII 文件名会被显式替换为下划线，不会静默映射到其它同名用户文件。
 */
export function safeDownloadFileName(rawName: string): string {
  let name = rawName.replace(/[^A-Za-z0-9._-]/g, '_');
  name = name.replace(/^\.+/, '_');
  if (!SAFE_DOWNLOAD_NAME.test(name) || name === '.' || name === '..') name = `workspace-file-${Date.now()}`;
  if (name.length <= 120) return name;
  const extensionMatch = name.match(/\.[A-Za-z0-9._-]{1,20}$/);
  const extension = extensionMatch ? extensionMatch[0].slice(0, 20) : '';
  return `${name.slice(0, Math.max(1, 100 - extension.length)).replace(/[.]$/, '_')}${extension}`;
}
