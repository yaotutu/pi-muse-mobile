import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('唯一主题由根级持有，聊天与独立更新弹层共享而不重建业务 Provider', () => {
  const source = read('src/app/AppRoot.tsx');
  assert.ok(source.indexOf('<ThemeProvider>') < source.indexOf('<UpdateProvider'));
  assert.ok(source.indexOf('<UpdateProvider') < source.indexOf('<WorkspaceScreen'));
  assert.doesNotMatch(read('src/workspace/WorkspaceScreen.tsx'), /<ThemeProvider/);
  assert.doesNotMatch(read('src/theme/ThemeProvider.tsx'), /key=|ApiProvider|useConnection|setServer/);
  assert.equal(existsSync(new URL('src/ui/ThemeProvider.tsx', root)), false);
  assert.equal(existsSync(new URL('src/workspace/WorkspaceTheme.tsx', root)), false);
});

test('所有视觉消费者使用唯一语义主题，不恢复旧固定亮色调色板', () => {
  for (const directory of ['src/ui', 'src/workspace', 'src/update', 'src/theme']) {
    for (const file of readdirSync(new URL(directory + '/', root)).filter((file) => file.endsWith('.tsx'))) {
      const path = `${directory}/${file}`;
      const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
        if (!statement.moduleSpecifier.text.endsWith('/tokens')) continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          assert.equal(bindings.elements.some((node) => node.name.text === 'colors'), false, path);
        }
      }
      assert.doesNotMatch(read(path), /#[0-9a-f]{3,8}\b/i, `${path} hardcoded color`);
    }
  }
});

test('主题定义、选择器、快捷键与状态栏集中管理，不再散落在业务页面', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(source, /<ThemePicker\s*\/>/);
  assert.match(source, /<ThemeToggle/);
  assert.doesNotMatch(source, /setMode|selectTheme|晨光白|深夜黑|切换到暗色主题|切换到亮色主题/);
  const picker = read('src/theme/ThemePicker.tsx');
  assert.match(picker, /availableThemes\.map/);
  assert.match(picker, /themeId === theme\.id/);
  assert.match(picker, /accessibilityRole="radio"/);
  assert.match(read('src/theme/ThemeToggle.tsx'), /onPress=\{toggleAppearance\}/);
  for (const path of ['src/ui/Sheet.tsx', 'src/workspace/ConnectionPanel.tsx', 'src/workspace/SessionPanel.tsx']) {
    assert.match(read(path), /<ThemeStatusBar\s*\/>/);
    assert.doesNotMatch(read(path), /from 'expo-status-bar'|mode === 'dark'/);
  }
  assert.doesNotMatch(read('src/ui/tokens.ts'), /#[0-9a-f]|workspacePalettes|colors:/i);
});

test('主题模块不依赖业务领域，独立偏好存储不接触连接地址或凭据', () => {
  for (const file of readdirSync(new URL('src/theme/', root)).filter((file) => /\.tsx?$/.test(file))) {
    const ast = ts.createSourceFile(file, read(`src/theme/${file}`), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
      assert.doesNotMatch(statement.moduleSpecifier.text, /connection|runtime|spaces|workspace|activities|approvals|memories|update|\/api\//, file);
    }
  }
  assert.match(read('src/theme/device-preferences.ts'), /pi-muse-mobile-theme-v1/);
  assert.doesNotMatch(read('src/theme/device-preferences.ts'), /deviceConnectionStore|serverUrl|token|accessKey/);
});

test('聊天空态有稳定入口，建议仅填草稿；真实流使用可关闭的原生动画', () => {
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /testID="conversation-empty"/);
  assert.match(chat, /onPress=\{\(\) => sessions\.setDraft\(spaceId, prompt\)\}/);
  assert.match(chat, /conversation\.running && <TypingIndicator/);
  const primitives = read('src/workspace/primitives.tsx');
  assert.match(primitives, /if \(reduced\)/);
  assert.match(primitives, /return \(\) => animation\.stop\(\)/);
  assert.doesNotMatch(primitives, /https?:\/\//);
});

test('会话信息区在聊天正文之前独立占位，长历史不滚入顶栏背后', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.ok(source.indexOf('<View style={[styles.chatHeader,') < source.indexOf('<ConversationView key='));
  assert.match(source, /chatHeader: \{ height: l\.headerHeight, flexShrink: 0/);
  assert.doesNotMatch(read('src/workspace/ConversationView.tsx'), /paddingTop: l\.chatContentTop/);
  assert.match(read('src/workspace/SessionPanel.tsx'), /<ScrollView\s+key=\{tab\}/);
});

test('原生输入时压缩会话信息区并隐藏主导航，键盘事件监听随宿主卸载清理', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(source, /keyboardVisible && styles\.chatHeaderCompact/);
  assert.match(source, /!\(page === 'chat' && keyboardVisible\) && <Navigation/);
  assert.match(source, /return \(\) => \{ show\.remove\(\); hide\.remove\(\); \}/);
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /onLayout=\{followLatest\}/);
  assert.match(chat, /onContentSizeChange=\{followLatest\}/);
  assert.match(chat, /if \(nearBottom\.current\) scroll\.current\?\.scrollToEnd/);
});

test('工具结果缺席不是运行中证据，结束或停止后的空结果保持中性提示', () => {
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /尚未收到工具结果/);
  assert.doesNotMatch(chat, /工具执行中| · 执行中/);
});

test('侧栏只切换或创建空间，不复制参考产品的功能导航；搜索只过滤本地已读空间', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(source, /spaceQuery\.toLowerCase\(\)\.trim\(\)/);
  assert.match(source, /accessibilityLabel="搜索空间"/);
  assert.match(source, /no-hide-descendants/);
  assert.doesNotMatch(source, /label: '点子'|label: '资源库'|label: '旁聊'/);
  for (const page of ['chat', 'activity', 'goals', 'apps']) assert.match(source, new RegExp(`id: '${page}'`));
});
