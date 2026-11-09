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

test('主题模块不依赖业务领域，独立偏好存储不接触连接地址或凭据', () => {
  for (const file of readdirSync(new URL('src/theme/', root)).filter((file) => /\.tsx?$/.test(file))) {
    const ast = ts.createSourceFile(file, read(`src/theme/${file}`), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
      assert.doesNotMatch(statement.moduleSpecifier.text, /connection|runtime|agents|workspace|activities|approvals|memories|update|\/api\//, file);
    }
  }
  assert.match(read('src/theme/device-preferences.ts'), /pi-muse-mobile-theme-v1/);
  assert.doesNotMatch(read('src/theme/device-preferences.ts'), /deviceConnectionStore|serverUrl|token|accessKey/);
});

test('聊天空态只留短句，保留本地头像且不叠加消息区生成气泡', () => {
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /testID="conversation-empty"/);
  assert.match(chat, /有什么想聊的？/);
  assert.doesNotMatch(chat, /A LITTLE AGENT|想法，从这里开始|帮我梳理一个想法|一起拆解一个目标/);
  assert.doesNotMatch(chat, /TypingIndicator|发送中/);
  assert.match(read('src/workspace/WorkspaceScreen.tsx'), /mainProgressLabel\(\{/);
  const primitives = read('src/workspace/primitives.tsx');
  assert.match(primitives, /require\('\.\.\/\.\.\/assets\/images\/muse-companion\.png'\)/);
  assert.ok(existsSync(new URL('assets/images/muse-companion.png', root)));
  assert.doesNotMatch(primitives, /TypingIndicator|https?:\/\//);
});

test('聊天顶部紧凑标题行在正常布局，隐藏会话不重复挂载其他页面', () => {
  assert.match(read('src/workspace/WorkspaceScreen.tsx'), /<PrimaryTabBar/);
  assert.match(read('src/workspace/ConversationView.tsx'), /paddingTop: spacing\[12\]/);
  assert.match(read('src/workspace/ConversationHost.tsx'), /!chatVisible && <View style={styles.owner}>{otherPage}/);
  assert.match(read('src/workspace/SessionPanel.tsx'), /<ScrollView\s+key={tab}/);
});

test('会话动态按 OpenMuse 极简时间线展示真实状态，去除冗余割裂按钮，关键警告与审批入口保持可见', () => {
  const execution = read('src/workspace/CurrentExecution.tsx');
  assert.doesNotMatch(execution, /IN THE MOMENT|<SectionHeading/);
  assert.match(execution, /!runtime\.synchronized && <View style=\{styles\.syncCard\}>/);
  assert.match(execution, /run\.status === 'failed' && styles\.danger/);
  assert.match(execution, /run\.pendingApprovalIds\.length/);
  assert.match(execution, /run\.activityId !== null/);
  assert.doesNotMatch(execution, /查看活动历史|状态说明/);
});

test('会话复用整组分段，新闻使用紧凑筛选菜单', () => {
  const control = read('src/ui/SegmentedControl.tsx');
  const session = read('src/workspace/SessionPanel.tsx');
  const news = read('src/workspace/NewsPage.tsx');
  assert.match(session, /<SegmentedControl value=\{tab\} options=\{TABS\}/);
  assert.doesNotMatch(news, /<SegmentedControl/);
  assert.match(news, /\(\['recommended', 'all'\] as const\)\.map/);
  assert.match(news, /store\.setView\(view\)/);
  assert.match(news, /selected=\{snapshot\.view === view\}/);
  for (const [id, label] of [['activity', '动态'], ['approvals', '审批'], ['history', '历史']]) {
    assert.match(session, new RegExp(`label: '${label}'.*testID: 'workspace-session-tab-${id}'`));
  }
  assert.match(session, /next === 'history'\) setHistoryActivityId\(undefined\)/);
  assert.match(control, /accessibilityState=\{\{ selected, disabled: locked, busy \}\}/);
  assert.match(control, /if \(locked \|\| !options.length\) return/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.match(control, new RegExp(key));
  assert.doesNotMatch(session, /onKeyDown|tabSelected|tabLabelSelected/);
});

test('共享分段仅用一块底板位移，初次和尺寸变化直定位，减少动画时静止', () => {
  const control = read('src/ui/SegmentedControl.tsx');
  const tokens = read('src/theme/tokens.ts');
  assert.match(control, /const translateX = useAnimatedValue\(0\)/);
  assert.match(control, /onLayout=\{\(event\) =>/);
  assert.match(control, /translateX\.setValue\(Math\.max\(0, selectedIndex\) \* nextItemWidth\)/);
  assert.match(control, /jumpAfterLayout\.current \|\| reducedMotion/);
  assert.match(control, /Animated\.timing\(translateX, \{/);
  assert.match(control, /useNativeDriver: true/);
  assert.match(control, /return \(\) => animation\.stop\(\)/);
  assert.match(control, /<Animated\.View pointerEvents="none" accessible=\{false\}/);
  assert.match(control, /importantForAccessibility="no-hide-descendants" aria-hidden/);
  assert.doesNotMatch(control, /selected: \{ backgroundColor: colors\.selected \}/);
  assert.match(tokens, /segmentDuration: 200/);
});

test('原生输入时压缩会话信息区且不挂载底栏，键盘事件监听随宿主卸载清理', () => {
  const source = read('src/workspace/WorkspaceScreen.tsx');
  assert.match(source, /!keyboardVisible[\s\S]*?<PrimaryTabBar/);
  assert.doesNotMatch(source, /<Navigation/);
  assert.match(source, /return \(\) => \{ show\.remove\(\); hide\.remove\(\); \}/);
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /onLayout=\{followLatest\}/);
  assert.match(chat, /onContentSizeChange=\{\(\) => \{ scrollFollow\.current\.onContentSizeChange\(\); followLatest\(\); \}\}/);
  assert.match(chat, /if \(visible && scrollFollow\.current\.onLayout\(\)\) anchorFrame\.current\?\.schedule\(\)/);
  assert.match(chat, /if \(next\.anchor\) anchorFrame\.current\?\.schedule\(\)/);
  assert.match(chat, /onScrollBeginDrag=\{\(\) => \{ scrollFollow\.current\.onDrag\(\); anchorFrame\.current\?\.cancel\(\); \}\}/);
});

test('工具结果缺席不是运行中证据，结束或停止后的空结果保持中性提示', () => {
  const card = read('src/workspace/ToolResultCard.tsx');
  assert.match(card, /尚无结果/);
  assert.doesNotMatch(card, /工具执行中| · 执行中/);
});

test('放弃 failed 暂存须二次确认并回读权威历史，当前草稿保持独立', () => {
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /pending\?\.status === 'failed'/);
  assert.match(chat, /discardTarget === pending\.messageId/);
  assert.match(chat, /sessions\.discardFailedSubmission\(sessionId, session\.epoch, pending\.messageId\)\) conversation\.reload\(\)/);
  assert.match(chat, /label="取消放弃未发送消息"/);
  assert.match(chat, /sessions\.restorePendingSubmissionToDraft\(sessionId\)/);
});
