import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
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

test('聊天空态只留短句，状态化形象承接助手状态且不叠加生成气泡', () => {
  const chat = read('src/workspace/ConversationView.tsx');
  assert.match(chat, /testID="conversation-empty"/);
  assert.match(chat, /有什么想聊的？/);
  assert.doesNotMatch(chat, /A LITTLE AGENT|想法，从这里开始|帮我梳理一个想法|一起拆解一个目标/);
  assert.doesNotMatch(chat, /TypingIndicator|发送中/);
  assert.match(read('src/workspace/WorkspaceScreen.tsx'), /mainProgressLabel\(\{/);
  const companion = read('src/workspace/MuseCompanion.tsx');
  const primitives = read('src/workspace/primitives.tsx');
  assert.doesNotMatch(primitives, /MuseAvatar|muse-companion|TypingIndicator|https?:\/\//);
  // 八张状态图全部随包提供；未同步降灰，减弱动效保持静态，不用动画冒充进度。
  for (const state of ['idle', 'thinking', 'responding', 'working', 'waiting-approval', 'success', 'error', 'stopped']) {
    assert.ok(existsSync(new URL(`assets/images/avatar/${state}.png`, root)), state);
    assert.match(read('src/companion/builtin-packs.ts'), new RegExp(`require\\('\\.\\./\\.\\./assets/images/avatar/${state}\\.png'\\)`));
  }
  assert.match(companion, /useReducedMotion\(\)/);
  assert.match(companion, /cancelAnimation\(scale\)/);
  assert.match(companion, /offline && \{ opacity: 0\.5 \}/);
});

test('形象选择器三主题共享语义色、48dp 预览与可伸展单选行，离线和失败诊断可见', async () => {
  const { availableThemes } = await import('../src/theme/registry.ts');
  const tokens = await import('../src/theme/tokens.ts');
  const source = read('src/workspace/CompanionPicker.tsx');
  const pack = { key: 'builtin:penguin', name: '冰蓝企鹅', description: '默认内置助手形象', images: { idle: 1 } };
  const nodes = (tree) => tree == null || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props.children)];
  const expand = (tree) => tree == null || typeof tree !== 'object' ? tree : Array.isArray(tree) ? Array.from(tree, expand) :
    typeof tree.type === 'function' ? expand(tree.type(tree.props)) : { ...tree, props: { ...tree.props, children: expand(tree.props.children) } };
  const style = (value) => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
  for (const { colors } of availableThemes) for (const connected of [true, false]) {
    const calls = []; const exports = {}; const element = (type, props) => ({ type, props });
    const modules = {
      'react/jsx-runtime': { jsx: element, jsxs: element },
      'react-native': { Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (value) => value } },
      'lucide-react-native': { Check: 'Check', Circle: 'Circle' },
      '../companion/builtin-packs': { builtinPacks: [pack] },
      '../companion/CompanionProvider': { useCompanion: () => ({ connected, selectedKey: 'builtin:penguin', cachedImages: {},
        serverPacks: [{ id: 'plumber', name: '服务端测试形象', description: '八张状态图' }], diagnostics: [{ id: 'broken', message: '缺少 working' }],
        error: '下载失败', notice: '已回退内置', select: (key) => calls.push(key), refresh: () => calls.push('refresh') }) },
      '../theme/ThemeProvider': { useTheme: () => ({ colors }) }, '../theme/tokens': tokens,
      '../ui/ActionButton': { ActionButton: 'ActionButton' }, '../ui/Surfaces': { Card: 'Card' },
    };
    const output = ts.transpileModule(source, { fileName: 'CompanionPicker.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(output, { exports, require: (name) => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
    const tree = expand(exports.CompanionPicker()); const all = nodes(tree);
    const radios = all.filter((node) => node.props.accessibilityRole === 'radio'); assert.equal(radios.length, connected ? 2 : 1);
    for (const row of radios) {
      assert.ok(style(row.props.style({ pressed: false })).minHeight >= 48);
      assert.equal(style(row.props.style({ pressed: false })).backgroundColor, colors.surface);
      assert.equal(style(row.props.style({ pressed: true })).backgroundColor, colors.selected);
      row.props.onPress();
    }
    assert.deepEqual(calls, connected ? ['builtin:penguin', 'server:plumber'] : ['builtin:penguin']);
    const preview = all.find((node) => node.type === 'Image'); assert.equal(style(preview.props.style).width, 48); assert.equal(style(preview.props.style).height, 48);
    const text = all.filter((node) => node.type === 'Text'); assert.ok(text.some((node) => node.props.children === '下载失败'));
    assert.ok(text.some((node) => String(node.props.children).includes('缺少 working')));
    if (!connected) assert.ok(text.some((node) => String(node.props.children).includes('请先连接服务器')));
    for (const node of text) { assert.equal(node.props.numberOfLines, undefined); assert.notEqual(node.props.allowFontScaling, false); }
  }
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|allowFontScaling=\{false\}|numberOfLines/i);
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
