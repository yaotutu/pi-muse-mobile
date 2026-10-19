/** 仅识别协议中的逻辑相对路径；未知/绝对路径不伪装成私有文件。 */
export function fileScope(path: string | undefined): string | undefined {
  if (!path || path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) || path.split(/[\\/]/).includes('..')) return undefined;
  return path.startsWith('shared/') ? '共享文件' : '该会话私有文件';
}
