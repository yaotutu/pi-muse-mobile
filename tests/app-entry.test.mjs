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
    'src/spaces',
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

test('审批页面只渲染固定全文，决定需完整预览与新同步边界，不执行正文中的标记', () => {
  const source = read('src/workspace/ApprovalPanel.tsx');
  assert.match(source, /content === '' \? empty : content/);
  assert.doesNotMatch(source, /numberOfLines|dangerouslySetInnerHTML|<WebView|<Markdown|\.slice\(|\.substring\(/);
  assert.match(source, /confirmation\.syncVersion !== store\.getSnapshot\(\)\.syncVersion/);
  assert.match(source, /确认批准/);
  assert.match(source, /确认拒绝/);
  assert.match(source, /hasApprovalPreview\(selected\)/);
});
