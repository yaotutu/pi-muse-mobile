import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const imports = (path) => {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return source.statements.filter(ts.isImportDeclaration).map((node) => node.moduleSpecifier.text);
};

test('冷启动只有新版工作区，更新与安全区仍由根级持有', () => {
  const dependencies = imports('src/app/AppRoot.tsx');
  assert.deepEqual(dependencies, [
    'react-native-safe-area-context',
    '../ui/ErrorBoundary',
    '../update/UpdateProvider',
    '../update/update-manager',
    '../workspace/WorkspaceScreen',
    '../theme/ThemeProvider',
  ]);
  const source = read('src/app/AppRoot.tsx');
  assert.match(source, /<WorkspaceScreen\s*\/>/);
  assert.doesNotMatch(source, /useConnection|ServiceRoot|DemoRoot|PreviewRoot|setPreview|display:/);
});

test('旧工作区、旧演示与旁路预览源码已移除，不保留可回退的界面', () => {
  for (const path of [
    'src/app/AppShell.tsx',
    'src/threads',
    'src/chat/ChatScreen.tsx',
    'src/connection/ConnectionScreen.tsx',
    'src/connection/ServerSettingsScreen.tsx',
    'src/demo',
    'src/preview',
    'src/workspace/sample-state.ts',
    'src/workspace/useWorkspaceSnapshot.ts',
    'src/approvals/decisions.ts',
    'src/shared/format.ts',
    'src/activity',
    'tests/helpers/demo-api-client.ts',
  ]) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }
});

test('新版侧栏职责不变，真实连接与更新从应用页进入', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.doesNotMatch(source, /onExit|退出预览|新 UI 预览|退出 UI|onPreview|sampleReducer|createSampleState/);
  assert.match(source, /<AppSettingRow title="应用更新"[^\n]*onPress=\{update.open\}/);
  assert.match(source, /<AppSettingRow title="服务器连接"[^\n]*onPress=\{openConnection\}/);
  assert.match(source, /accessibilityLabel=\{label\} accessibilityState=\{\{ disabled \}\} disabled=\{disabled\} onPress=\{onPress\}/);
  assert.match(source, /<RuntimeProvider>/);
  assert.match(source, /<SpaceProvider>/);
  assert.match(source, /<ApiProvider client=\{connection.client\}/);
  assert.doesNotMatch(source, /getSnapshot\(|useWorkspaceSnapshot/);
});

test('会话面板当前执行与文件入口消费真实连接，不消费示例数组', () => {
  const source = read('src/workspace/SessionPanel.tsx');
  assert.doesNotMatch(source, /sample-state|SampleThread|SampleActivity|thread\.approvals|thread\.files|thread\.history/);
  assert.match(source, /<CurrentExecution spaceId=\{spaceId\}/);
  assert.match(source, /<ApprovalPanel key=\{spaceId\} spaceId=\{spaceId\}/);
  assert.doesNotMatch(source, /审批尚未接入/);
  assert.match(source, /<FilesPanel currentSpaceId=\{spaceId\} \/>/);
  assert.doesNotMatch(source, /工作区文件尚未接入/);
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(screen, /<FilesProvider currentSpaceId=\{spaces\.currentSpace\}>/);
  assert.ok(screen.indexOf('<FilesProvider currentSpaceId=') < screen.indexOf('<SessionPanel spaceId='));
  const files = read('src/workspace/FilesPanel.tsx');
  assert.match(files, /store\.open\(\); return \(\) => store\.close\(\)/);
  assert.match(files, /saveWorkspaceFileToDevice\(file\)/);
  assert.match(files, /snapshot\.savePreview\.before/);
  assert.match(files, /snapshot\.savePreview\.after/);
  assert.doesNotMatch(files, /<WebView|dangerouslySetInnerHTML|https?:\/\//);
});

test('设备下载反馈按当前范围和路径保留，详情回读不吞掉系统选择器结果', () => {
  const files = read('src/workspace/FilesPanel.tsx');
  assert.match(files, /const selectedKey = snapshot\.selectedPath/);
  assert.match(files, /download\.key === selectedKey/);
  assert.match(files, /current\.selectedPath !== undefined/);
  assert.match(files, /current\.scope.*current\.selectedSpaceId.*current\.selectedPath/);
  assert.ok(files.indexOf('{!!shownDownload') < files.indexOf('{detail && <>'));
  assert.match(files, /设备保存结果（下载时读取的内容，不代表服务端当前版本）/);
  assert.doesNotMatch(files, /current\.detail === detail|!current\.detailStale && current\.selectedPath/);
});

test('审批页面只渲染固定全文，决定需完整预览与新同步边界，不执行正文中的标记', () => {
  const source = read('src/workspace/ApprovalPanel.tsx');
  assert.match(source, /content === '' \? empty : content/);
  assert.doesNotMatch(source, /numberOfLines|dangerouslySetInnerHTML|<WebView|<Markdown|\.slice\(|\.substring\(/);
  assert.match(source, /confirmation\.syncVersion !== store\.getSnapshot\(\)\.syncVersion/);
  assert.match(source, /确认批准/);
  assert.match(source, /确认拒绝/);
  assert.match(source, /hasApprovalPreview\(selected\)/);
});
