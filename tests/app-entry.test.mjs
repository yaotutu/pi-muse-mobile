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
  ]);
  const source = read('src/app/AppRoot.tsx');
  assert.match(source, /<WorkspaceScreen\s*\/>/);
  assert.doesNotMatch(source, /useConnection|ServiceRoot|DemoRoot|PreviewRoot|setPreview|display:/);
});

test('旧工作区、旧演示与旁路预览源码已移除，不保留可回退的界面', () => {
  for (const path of [
    'src/app/AppShell.tsx',
    'src/threads/ThreadsSheet.tsx',
    'src/threads/ThreadSettingsSheet.tsx',
    'src/chat/ChatScreen.tsx',
    'src/connection/ConnectionScreen.tsx',
    'src/connection/ServerSettingsScreen.tsx',
    'src/demo',
    'src/preview',
  ]) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }
});

test('新版侧栏没有退出旧工作区路径，应用页保留独立更新入口', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.doesNotMatch(source, /onExit|退出预览|新 UI 预览|退出 UI|onPreview|useApi|useConnection/);
  assert.match(source, /accessibilityLabel="应用更新"\s+onPress=\{update.open\}/);
  assert.match(source, /示例数据 · 尚未连接服务端/);
});

test('旧演示客户端只作为测试辅助源码，不成为运行入口', () => {
  assert.equal(existsSync(new URL('tests/helpers/demo-api-client.ts', root)), true);
  assert.equal(existsSync(new URL('src/demo/DemoApiClient.ts', root)), false);
  assert.match(read('tests/demo-api.test.mjs'), /\.\/helpers\/demo-api-client\.ts/);
});
