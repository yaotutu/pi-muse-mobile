import assert from 'node:assert/strict';
import test from 'node:test';
import { isManagedWorkspaceFile, workspaceCreateDirectory, workspaceDisplayEntries, workspaceEntryLabel } from '../src/files/presentation.ts';
import { FilesStore } from '../src/files/files-store.ts';

const listed = (path, kind = 'directory') => ({ path, kind, name: path.split('/').at(-1), size: 0, updatedAt: '2026-11-21T00:00:00.000Z' });

test('工作区入口按助手资料、领域规则和普通文件展示，保留路径和服务器返回的其他条目', () => {
  const entries = [listed('assistant'), listed('notes'), listed('domains'), listed('files'), listed('README.md', 'file')];
  const ordered = workspaceDisplayEntries('.', entries);
  assert.deepEqual(ordered.map((entry) => entry.path), ['assistant', 'domains', 'files', 'notes', 'README.md']);
  assert.deepEqual(ordered.map((entry) => workspaceEntryLabel(entry.path, entry.kind)), ['助手资料', '领域规则', '普通文件', 'notes', 'README.md']);
  assert.equal(ordered[1], entries[2]);
  assert.equal(workspaceDisplayEntries('files', entries), entries);
});

test('仅精确的管理 Markdown 有可读名，普通文件同名也不冒充管理文件', () => {
  for (const [path, title] of [
    ['assistant/USER.md', '关于我'],
    ['assistant/SOUL.md', '助手人设'],
    ['assistant/INSTRUCTIONS.md', '助手指令'],
    ['domains/news/RULES.md', '新闻规则'],
    ['domains/sms/RULES.md', '短信规则'],
  ]) {
    assert.equal(workspaceEntryLabel(path, 'file'), title);
    assert.equal(isManagedWorkspaceFile(path), true);
  }
  assert.equal(workspaceEntryLabel('files/USER.md', 'file'), 'USER.md');
  assert.equal(isManagedWorkspaceFile('files/USER.md'), false);
  assert.equal(workspaceCreateDirectory('.'), 'files');
  assert.equal(workspaceCreateDirectory('files/notes'), 'files/notes');
  assert.equal(workspaceCreateDirectory('domains/news'), undefined);
});

test('客户端文件流程拒绝将管理文件加入删除确认', async () => {
  const entry = listed('assistant/USER.md', 'file');
  const api = {
    listWorkspaceFiles: async ({ path }) => ({ path, entries: [entry] }),
  };
  const files = new FilesStore(api);
  files.setActive(true);
  files.open();
  files.openDirectory('assistant');
  assert.equal(await files.refresh(), true);
  assert.equal(files.requestDelete(entry.path), false);
  assert.equal(files.getSnapshot().deleteTarget, undefined);
  assert.match(files.getSnapshot().error, /不可删除/);
  files.dispose();
});
