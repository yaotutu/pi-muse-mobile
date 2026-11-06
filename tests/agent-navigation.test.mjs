import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { filesBackAction, hasFileWork } from '../src/workspace/agent-navigation.ts';
import { workspaceBackAction } from '../src/workspace/workspace-back.ts';
import { FilesStore } from '../src/files/files-store.ts';
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const state = { writing: false, uncertain: false, directoryPath: '.', entries: [] };

test('文件返回按未明/写入、确认、草稿、详情、目录、智能体首页分层', () => {
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

test('智能体由根层统一处理 Back，键盘和覆盖层保持更高优先级', () => {
  const root = { keyboardVisible: false, sessionMounted: false, drawerOpen: false, page: 'agent', settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction(root), 'agent');
  assert.equal(workspaceBackAction({ ...root, keyboardVisible: true }), 'keyboard');
  assert.equal(workspaceBackAction({ ...root, page: 'feature' }), 'feature');
  assert.equal(workspaceBackAction({ ...root, page: 'chat' }), 'group');
  assert.equal(workspaceBackAction({ ...root, sessionMounted: true }), 'session');
});

test('目录返回不清空列表，编辑/未明状态不能被 closeFile 绕过', async () => {
  const at = '2026-11-02T00:00:00.000Z';
  const selector = { scope: 'agent', agentId: 'test-agent' };
  const entry = { path: 'a.md', name: 'a.md', kind: 'file', size: 4, updatedAt: at };
  const store = new FilesStore({
    listWorkspaceFiles: async () => ({ ...selector, path: '.', entries: [entry] }),
    readWorkspaceFile: async () => ({ ...selector, ...entry, kind: 'text', content: '# Hi', mimeType: 'text/markdown' }),
  });
  store.selectAgent(selector.agentId); store.setActive(true); store.open();
  await store.refresh(); await store.openFile(entry.path);
  store.beginEdit(); assert.equal(store.closeFile(), false);
  store.cancelEditor(); const before = store.getSnapshot().entries;
  assert.equal(store.closeFile(), true);
  assert.equal(store.getSnapshot().selectedPath, undefined);
  assert.equal(store.getSnapshot().directoryPath, '.');
  assert.equal(store.getSnapshot().entries, before);
  store.dispose();
});

test('文件只展示和编辑完整原文，Markdown 渲染与聊天清理不进入文件页', () => {
  assert.doesNotMatch(read('ui/MarkdownContent.tsx'), /text\.replace|<think>|getChatVisibleText|chat-visible-text/);
  assert.match(read('ui/MarkdownContent.tsx'), /marked\.lexer\(text,/);
  assert.match(read('workspace/MessageContent.tsx'), /getChatVisibleText\(text\)/);
  assert.doesNotMatch(read('workspace/FilesScreen.tsx'), /MarkdownContent|marked|<WebView|getChatVisibleText|chat-visible-text/);
  assert.match(read('workspace/FilesScreen.tsx'), /onChangeText=\{store.editFileContent\}/);
  assert.doesNotMatch(read('workspace/FilesScreen.tsx'), /selectShared|共享文件"|查看全部智能体/);
});

test('丢弃规则或技能只影响所选字段，不丢其他设置草稿', async () => {
  const { AgentStore } = await import('../src/agents/agent-store.ts');
  const store = new AgentStore({});
  const a = store.get('agent-a'); const b = store.get('agent-b');
  a.instructions.saved = 'saved'; a.instructions.draft = 'draft';
  a.skills.saved = {read: true}; a.skills.draft = {read: false};
  b.instructions.draft = 'other-agent';
  store.discardSettings('agent-a','instructions');
  assert.equal(a.instructions.draft, 'saved');
  assert.equal(a.skills.draft.read, false);
  a.instructions.draft = 'another-draft';
  store.discardSettings('agent-a','skills');
  assert.equal(a.skills.draft.read, true);
  assert.equal(a.instructions.draft, 'another-draft');
  assert.equal(b.instructions.draft, 'other-agent');
});

test('文件未明回读保持原文，不使用 Markdown 渲染替代完整核对', () => {
  const source = read('workspace/FilesScreen.tsx');
  assert.match(source, /detail=\{verification\} label="回读结果全文" styles=\{styles\}/);
  assert.match(source, /if \(detail.kind === 'text'\) return <TextBlock/);
});

test('文件默认直接编辑原文，路径归顶栏，信息与非编辑操作仅在详情菜单', () => {
  const source = read('workspace/FilesScreen.tsx');
  const start = source.indexOf('{!!snapshot.selectedPath && <View');
  const reading = source.slice(start, source.indexOf('</ScrollView>', start));
  assert.match(source, /<AgentHeader title=\{title\} caption=\{caption\}/);
  assert.match(source, /const caption = parent === '\.' \? agentName :/);
  assert.doesNotMatch(reading, /路径：|formatSize|formatTime|mimeType|ActionButton|FeedbackMenuRow/);
  assert.doesNotMatch(source, /ChoiceChip|阅读 Markdown|查看 Markdown 原文/);
  const menu = source.slice(source.indexOf('{info &&'));
  for (const text of ['文件详情', 'detail.path', 'detail.size', 'detail.updatedAt', 'detail.mimeType', '下载到设备', '删除文件…']) assert.ok(menu.includes(text), text);
  assert.match(menu, /onRequestClose=\{closeInfo\}/);
  assert.match(menu, /dismissLabel="关闭文件详情" onDismiss=\{closeInfo\}/);
  assert.doesNotMatch(menu, /store.beginEdit|编辑原文/);
  assert.match(menu, /closeInfo\(\); store.requestDelete\(detail.path\)/);
  assert.doesNotMatch(menu, /store.confirmSave\(|store.confirmDelete\(/);
});

test('文件菜单不跨智能体、文件或编辑状态复活；测量在页面变化后失效', () => {
  const source = read('workspace/FilesScreen.tsx');
  assert.match(source, /infoState.store !== store \|\| infoState.owner !== menuOwner/);
  assert.match(source, /\[store, selectedKey, viewKey, currentAgentId\]/);
  assert.match(source, /sequence !== measureSequence.current/);
  assert.match(source, /info.key === detailKey && detail && fileOpen && !wrongAgent/);
  assert.match(source, /label="查看文件详情与操作"/);
  assert.match(read('workspace/AgentHeader.tsx'), /ellipsizeMode="middle"/);
  assert.match(source, /width=\{l.fileInformationWidth\}/);
  const menu = read('ui/AnchoredFeedbackMenu.tsx');
  assert.match(menu, /Math.min\(width, viewport.width - m.screenMargin \* 2\)/);
  assert.match(menu, /anchor, \{ width: menuWidth, height: menuHeight \}/);
});

test('原文直编首次修改才建草稿，确认前不写入，恢复原文解除草稿保护', async () => {
  const selector = { scope: 'agent', agentId: 'source-agent' };
  const content = '# 原文\n\n**未渲染**\n\n```text\nhello\n```\n<think>保留</think>';
  const entry = { path: 'source.md', name: 'source.md', kind: 'file', size: Buffer.byteLength(content), updatedAt: '2026-11-02T00:00:00.000Z' };
  let writes = 0;
  const store = new FilesStore({
    listWorkspaceFiles: async () => ({ ...selector, path: '.', entries: [entry] }),
    readWorkspaceFile: async () => ({ ...selector, ...entry, kind: 'text', content, mimeType: 'text/plain' }),
    updateWorkspaceTextFile: async (_, next) => { writes++; return { ...selector, ...entry, kind: 'text', content: next, size: Buffer.byteLength(next), mimeType: 'text/plain' }; },
  });
  store.selectAgent(selector.agentId); store.setActive(true); store.open(); await store.refresh(); await store.openFile(entry.path);
  assert.equal(store.getSnapshot().editor, undefined);
  store.editFileContent(content); assert.equal(hasFileWork(store.getSnapshot()), false);
  store.editFileContent(content + '\nchanged');
  assert.equal(store.getSnapshot().editor.before, content);
  assert.equal(store.getSnapshot().editor.content, content + '\nchanged');
  assert.equal(store.closeFile(), false); assert.equal(writes, 0);
  store.editFileContent(content); assert.equal(hasFileWork(store.getSnapshot()), false);
  store.editFileContent(content + '\nbackground draft');
  store.setActive(false); store.setActive(true); await store.refresh();
  assert.equal(store.getSnapshot().editor.content, content + '\nbackground draft');
  assert.equal(store.getSnapshot().detailStale, true);
  store.cancelEditor(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getSnapshot().editor, undefined);
  assert.equal(store.getSnapshot().detailStale, false);
  assert.equal(store.getSnapshot().detail.content, content);
  store.editFileContent(content + '\nsaved'); assert.equal(store.requestSave(), true); assert.equal(writes, 0);
  store.editFileContent('must not change pending confirmation');
  assert.equal(store.getSnapshot().savePreview.after, content + '\nsaved');
  assert.equal(await store.confirmSave(), true); assert.equal(writes, 1);
  assert.equal(store.getSnapshot().detail.content, content + '\nsaved');
  assert.equal(store.getSnapshot().editor, undefined);
  store.dispose();
});

test('原文直编保持输入节点，只有草稿出现保存栏，元信息不回流到正文', () => {
  const source = read('workspace/FilesScreen.tsx');
  assert.match(source, /snapshot.editor\?\.mode === 'create' \? 'editor'/);
  assert.match(source, /value=\{sourceDraft\?\.content \?\? \(detail\?\.kind === 'text' \? detail.content : ''\)\}/);
  assert.match(source, /sourceDraft && !snapshot.savePreview && !snapshot.deleteTarget && !snapshot.uncertain/);
  assert.match(source, /disabled=\{!canWrite \|\| !!sourceDraft/);
  assert.match(source, /scrollEnabled=\{false\}/);
});

// 维护页每次重新进入都要重新确认，不能复用上次离开前的删除确认。
test('智能体维护只有重置，删除确认集中在全局管理并固定目标', () => {
  const screen = read('workspace/WorkspaceScreen.tsx');
  const maintenance = screen.slice(screen.indexOf('const maintenance ='), screen.indexOf('let otherPage'));
  assert.match(maintenance, /setResetTarget\(focusedAgentId\)/);
  assert.doesNotMatch(maintenance, /deleteConfirm|remove\(|删除/);
  assert.match(screen, /confirmRemoval = \(id: string\)/);
  assert.match(screen, /onPress: \(\) => void remove\(id\)/);
});
