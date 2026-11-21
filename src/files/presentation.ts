import type { WorkspaceListEntry } from './types';

const folderLabels = new Map([
  ['assistant', '助手资料'],
  ['domains', '领域规则'],
  ['domains/news', '新闻'],
  ['domains/sms', '短信'],
  ['files', '普通文件'],
]);

const managedFileLabels = new Map([
  ['assistant/USER.md', '关于我'],
  ['assistant/SOUL.md', '助手人设'],
  ['assistant/INSTRUCTIONS.md', '助手指令'],
  ['domains/news/RULES.md', '新闻规则'],
  ['domains/sms/RULES.md', '短信规则'],
]);

export function workspaceEntryLabel(path: string, kind: WorkspaceListEntry['kind']): string {
  const labels = kind === 'directory' ? folderLabels : managedFileLabels;
  return labels.get(path) ?? path.split('/').at(-1) ?? path;
}

export function isManagedWorkspaceFile(path: string): boolean {
  return managedFileLabels.has(path);
}

/** 展示顺序不改变服务端列表或路径，避免影响请求与完整前后预览。 */
export function workspaceDisplayEntries(path: string, entries: readonly WorkspaceListEntry[]): readonly WorkspaceListEntry[] {
  if (path !== '.') return entries;
  const groups = ['assistant', 'domains', 'files'];
  const isGroup = (entry: WorkspaceListEntry, group: string) => entry.kind === 'directory' && entry.path === group;
  return [
    ...groups.flatMap((group) => entries.filter((entry) => isGroup(entry, group))),
    ...entries.filter((entry) => !groups.some((group) => isGroup(entry, group))),
  ];
}

export function workspaceCreateDirectory(path: string): string | undefined {
  if (path === '.') return 'files';
  return path === 'files' || path.startsWith('files/') ? path : undefined;
}
