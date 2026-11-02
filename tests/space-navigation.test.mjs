import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { filesBackAction, hasFileWork } from '../src/workspace/space-navigation.ts';
import { workspaceBackAction } from '../src/workspace/workspace-back.ts';
import { FilesStore } from '../src/files/files-store.ts';
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const state = { writing: false, uncertain: false, directoryPath: '.', entries: [] };

test('文件返回按未明/写入、确认、草稿、详情、目录、空间首页分层', () => {
  assert.equal(filesBackAction(state), 'home');
  assert.equal(filesBackAction({ ...state, directoryPath: 'notes' }), 'directory');
  assert.equal(filesBackAction({ ...state, selectedPath: 'readme.md' }), 'detail');
  assert.equal(filesBackAction({ ...state, editor: {} }), 'draft');
  assert.equal(filesBackAction({ ...state, deleteTarget: {} }), 'delete');
  assert.equal(filesBackAction({ ...state, editor: {}, savePreview: {} }), 'preview');
  assert.equal(filesBackAction({ ...state, editor: {}, uncertain: true }), 'locked');
  assert.equal(filesBackAction({ ...state, savePreview: {}, writing: 'update' }), 'locked');
  assert.equal(hasFileWork(state), false);
  for (const patch of [{ editor: {} }, { savePreview: {} }, { deleteTarget: {} }, { writing: 'update' }, { uncertain: true }]) assert.equal(hasFileWork({ ...state, ...patch }), true);
});

test('空间由根层统一处理 Back，键盘和覆盖层保持更高优先级', () => {
  const root = { keyboardVisible: false, sessionMounted: false, drawerOpen: false, page: 'space', settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction(root), 'space');
  assert.equal(workspaceBackAction({ ...root, keyboardVisible: true }), 'keyboard');
  assert.equal(workspaceBackAction({ ...root, drawerOpen: true }), 'drawer');
  assert.equal(workspaceBackAction({ ...root, sessionMounted: true }), 'session');
});

test('目录返回不清空列表，编辑/未明状态不能被 closeFile 绕过', async () => {
  const at = '2026-11-02T00:00:00.000Z';
  const selector = { scope: 'space', spaceId: 'test-space' };
  const entry = { path: 'a.md', name: 'a.md', kind: 'file', size: 4, updatedAt: at };
  const store = new FilesStore({
    listWorkspaceFiles: async () => ({ ...selector, path: '.', entries: [entry] }),
    readWorkspaceFile: async () => ({ ...selector, ...entry, kind: 'text', content: '# Hi', mimeType: 'text/markdown' }),
  });
  store.selectSpace(selector.spaceId); store.setActive(true); store.open();
  await store.refresh(); await store.openFile(entry.path);
  store.beginEdit(); assert.equal(store.closeFile(), false);
  store.cancelEditor(); const before = store.getSnapshot().entries;
  assert.equal(store.closeFile(), true);
  assert.equal(store.getSnapshot().selectedPath, undefined);
  assert.equal(store.getSnapshot().directoryPath, '.');
  assert.equal(store.getSnapshot().entries, before);
  store.dispose();
});

test('Markdown 文件阅读不清理 think，聊天清理留在消息包装层', () => {
  assert.doesNotMatch(read('ui/MarkdownContent.tsx'), /text\.replace|<think>/);
  assert.match(read('ui/MarkdownContent.tsx'), /marked\.lexer\(text,/);
  assert.match(read('workspace/MessageContent.tsx'), /text\.replace\(/);
  assert.match(read('workspace/FilesScreen.tsx'), /<MarkdownContent text=\{detail\.content\}/);
  assert.doesNotMatch(read('workspace/FilesScreen.tsx'), /selectShared|共享文件"|查看全部空间/);
});

test('丢弃规则或技能只影响所选字段，不丢其他设置草稿', async () => {
  const { SpaceStore } = await import('../src/spaces/space-store.ts');
  const store = new SpaceStore({});
  const a = store.get('space-a'); const b = store.get('space-b');
  a.instructions.saved = 'saved'; a.instructions.draft = 'draft';
  a.skills.saved = {read: true}; a.skills.draft = {read: false};
  b.instructions.draft = 'other-space';
  store.discardSettings('space-a','instructions');
  assert.equal(a.instructions.draft, 'saved');
  assert.equal(a.skills.draft.read, false);
  a.instructions.draft = 'another-draft';
  store.discardSettings('space-a','skills');
  assert.equal(a.skills.draft.read, true);
  assert.equal(a.instructions.draft, 'another-draft');
  assert.equal(b.instructions.draft, 'other-space');
});

test('文件未明回读保持原文，不使用 Markdown 渲染替代完整核对', () => {
  const source = read('workspace/FilesScreen.tsx');
  assert.match(source, /detail=\{verification\} label="回读结果全文" styles=\{styles\} sourceOnly/);
  assert.match(source, /sourceOnly && detail.kind === 'text'\) return <TextBlock/);
});

// 维护页每次重新进入都要重新确认，不能复用上次离开前的删除确认。
test('重新进入空间维护会清除先前删除确认', () => {
  assert.match(read('workspace/WorkspaceScreen.tsx'), /onSection=\{\(next\) => \{ setDeleteConfirm\(false\); setSpaceSection\(next\); \}\}/);
});
