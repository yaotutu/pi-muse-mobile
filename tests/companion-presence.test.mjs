import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as layout from '../src/workspace/companion-layout.ts';
import * as tokens from '../src/ui/tokens.ts';
import { availableThemes } from '../src/theme/registry.ts';
import { mainProgressLabel } from '../src/chat/message-delivery.ts';
import { companionState } from '../src/workspace/companion-state.ts';
import { flattenStyle as style, sandboxElement as jsx, transpileTsx } from './helpers/tsx-sandbox.mjs';

const nodes = (tree) => tree == null || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const byId = (tree, id) => nodes(tree).find((node) => node.props?.testID === id);
const source = (file) => readFileSync(new URL('../src/workspace/' + file, import.meta.url), 'utf8');
function load(file, modules, extra = '') {
  const exports = {};
  const output = transpileTsx(file, source(file) + extra);
  runInNewContext(output, { exports, require: (name) => {
    assert.ok(Object.hasOwn(modules, name), `missing ${name}`); return modules[name];
  }, setTimeout, clearTimeout });
  return exports;
}

// 仅模拟 hooks/原生宿主/动画时钟，执行实际转译组件。不是 React renderer 或原生验收。
function hooks() {
  const slots = []; let cursor = 0; let pending = [];
  const depsChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || depsChanged(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || depsChanged(slots[i].deps, deps)) {
      const old = slots[i]; slots[i] = { deps }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
    } },
  };
  react.useLayoutEffect = react.useEffect;
  return { react, render(fn, props) { cursor = 0; const tree = fn(props); const effects = pending; pending = []; effects.forEach((fn) => fn()); return tree; },
    unmount() { for (const item of slots) item?.cleanup?.(); } };
}
function companionHarness({ reduced = false, colors = availableThemes[0].colors, fontScale = 1 } = {}) {
  const runner = hooks(); const animations = []; const jsQueue = []; const shared = [];
  const environment = { reduced, dimensions: { width: 320, height: 680, fontScale }, colors };
  const reanimated = {
    __esModule: true, default: { View: 'AnimatedView' },
    Easing: { quad: 'quad', inOut: (value) => value },
    useSharedValue(initial) {
      const ref = runner.react.useRef();
      if (!ref.current) { const value = { current: initial }; Object.defineProperty(value, 'value', {
        get: () => value.current, set: (next) => {
          if (next?.timing) { const task = { ...next, shared: value, start: value.current }; animations.push(task); value.active = task; }
          else { value.current = next; value.active = undefined; }
        },
      }); ref.current = value; shared.push(value); }
      return ref.current;
    },
    useAnimatedStyle: (fn) => ({ __animated: fn }),
    cancelAnimation(value) { if (value.active) value.active.cancelled = true; value.active = undefined; },
    withTiming: (target, config, callback) => ({ timing: true, target, config, callback }),
    runOnJS: (fn) => (...args) => jsQueue.push(() => fn(...args)),
  };
  const modules = {
    react: runner.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      useWindowDimensions: () => environment.dimensions, StyleSheet: { create: (v) => v, hairlineWidth: 1 } },
    'react-native-reanimated': reanimated,
    '../theme/ThemeProvider': { useTheme: () => ({ colors: environment.colors }) }, '../ui/tokens': tokens,
    '../ui/use-reduced-motion': { useReducedMotion: () => environment.reduced },
    'lucide-react-native': { ArrowLeft: 'ArrowLeft' }, '../ui/IconControl': { IconControl: 'IconControl' },
    './MuseCompanion': { MuseCompanion: 'MuseCompanion' }, './companion-layout': layout,
  };
  const component = load('FloatingCompanion.tsx', modules).FloatingCompanion;
  const calls = []; const props = { state: 'working', images: { working: 1 }, offline: false, statusLabel: '正在核对很长的真实工具执行与文件审批状态',
    visible: true, expanded: false, presented: false, onToggle: () => calls.push('toggle'), onCollapsed: () => calls.push('collapsed'),
    onReturnArticle: () => calls.push('article'), children: jsx('SessionPanel', { sessionId: 'main' }) };
  return { ...runner, environment, animations, jsQueue, shared, props, calls,
    render(patch = {}) { Object.assign(props, patch); return runner.render(component, props); },
    complete(task = animations.at(-1)) { task.shared.current = task.target; task.callback?.(true); },
    flushJS() { jsQueue.splice(0).forEach((fn) => fn()); },
  };
}

test('纯几何覆盖三种字体和窄屏，新增状态的起排空间随内容滚走，背景从同一人物中心覆盖四角', () => {
  assert.equal(layout.COMPANION_CONTENT_INSET, 114);
  for (const scale of [1, 1.3, 2, 3]) {
    assert.ok(layout.companionContentInset(scale) >= 8 + 64 + 4 + 18 * scale + 8 + 12);
    for (const [width, height] of [[280, 540], [320, 680], [720, 320]]) {
      const geo = layout.companionSurfaceGeometry(width, height);
      const radius = geo.diameter / 2; const cx = geo.left + radius; const cy = geo.top + radius;
      assert.equal(cx, width / 2); assert.equal(cy, 40);
      for (const x of [0, width]) for (const y of [0, height]) assert.ok(Math.hypot(x - cx, y - cy) <= radius);
    }
  }
  assert.equal(layout.companionContentInset(NaN), 114);
});

test('实际转译compact/expanded：唯一a11y入口含完整状态、单64dp人物、无复制描边，状态不消失且三主题只用语义胶囊', () => {
  for (const { colors } of availableThemes) {
    const h = companionHarness({ colors });
    let tree = h.render(); const compactEntry = byId(tree, 'workspace-avatar-status');
    assert.equal(tree.props.pointerEvents, 'box-none');
    assert.equal(nodes(tree).filter((n) => n.props?.accessibilityRole === 'button').length, 1);
    assert.ok(compactEntry.props.accessibilityLabel.includes(h.props.statusLabel));
    assert.equal(compactEntry.props.accessibilityState.expanded, false);
    assert.ok(style(compactEntry.props.style).minHeight >= 48);
    assert.equal(style(compactEntry.props.style).backgroundColor, undefined);
    const muse = nodes(tree).filter((n) => n.type === 'MuseCompanion');
    assert.equal(muse.length, 1); assert.equal(muse[0].props.size, 64); assert.equal(muse[0].key, undefined);
    assert.equal(nodes(tree).filter((n) => n.type === 'Image').length, 0);
    const pill = nodes(compactEntry).find((n) => style(n.props?.style).backgroundColor === colors.floatingSurface);
    assert.equal(style(pill.props.style).borderColor, colors.floatingLine);
    assert.equal(style(pill.props.style).maxWidth, 220);
    const label = nodes(pill).find((n) => n.type === 'Text');
    assert.equal(label.props.numberOfLines, 1); assert.equal(label.props.ellipsizeMode, 'tail');
    assert.equal(label.props.children, h.props.statusLabel); assert.equal(pill.props.accessibilityElementsHidden, true);
    const article = byId(tree, 'workspace-return-article');
    assert.equal(article.type, 'IconControl'); assert.equal(article.props.label, '返回文章');
    const articleStyle = style(article.props.style);
    assert.ok(articleStyle.minHeight >= 48); assert.equal(articleStyle.position, 'absolute');
    assert.equal(articleStyle.top, layout.COMPANION_TOP); assert.equal(articleStyle.left, 12);
    // 200dp窄屏仍不触碰居中人物；返回按钮也不会多占一行而遮住第一条消息。
    assert.ok(articleStyle.left + tokens.workspaceTheme.layout.controlSize < 200 / 2 - layout.COMPANION_SIZE / 2);
    article.props.onPress();
    compactEntry.props.onPress(); assert.deepEqual(h.calls.slice(-2), ['article', 'toggle']);
    tree = h.render({ expanded: true, presented: true });
    assert.equal(tree.props.pointerEvents, 'auto'); assert.equal(tree.props.accessibilityViewIsModal, true);
    const expandedEntry = byId(tree, 'workspace-avatar-status');
    assert.equal(expandedEntry.type, compactEntry.type); assert.equal(expandedEntry.key, compactEntry.key);
    assert.equal(expandedEntry.props.accessibilityState.expanded, true);
    assert.equal(nodes(expandedEntry).find((n) => n.type === 'Text').props.children, label.props.children);
    assert.equal(nodes(tree).filter((n) => n.type === 'MuseCompanion').length, 1);
    assert.equal(byId(tree, 'workspace-return-article'), undefined);
    assert.equal(nodes(tree).filter((n) => n.type === 'SessionPanel').length, 1);
    h.unmount();
  }
});

test('280ms有限动画可原位反转，取消/卸载和迟到UI->JS完成不会关闭新展开态，减弱动效立即到位', () => {
  const h = companionHarness(); h.render();
  h.render({ expanded: true, presented: true }); const opening = h.animations.at(-1);
  assert.equal(opening.target, 1); assert.equal(opening.config.duration, 280);
  opening.shared.current = 0.6;
  let closingTree = h.render({ expanded: false }); const closing = h.animations.at(-1);
  assert.equal(opening.cancelled, true); assert.equal(closing.start, 0.6); assert.equal(closing.target, 0);
  assert.equal(closingTree.props.pointerEvents, 'auto');
  assert.equal(nodes(closingTree).filter((n) => n.type === 'SessionPanel').length, 1);
  h.complete(closing); // 完成已排进JS，但在JS收到前再次打开。
  h.render({ expanded: true }); h.flushJS(); assert.equal(h.calls.includes('collapsed'), false);
  h.render({ expanded: false }); const cancelled = h.animations.at(-1);
  h.unmount(); cancelled.callback(true); h.flushJS(); assert.equal(h.calls.includes('collapsed'), false);
  const reduced = companionHarness({ reduced: true });
  reduced.render({ expanded: true, presented: true }); assert.equal(reduced.shared[0].value, 1); assert.equal(reduced.animations.length, 0);
  reduced.render({ expanded: false }); assert.equal(reduced.shared[0].value, 0); assert.deepEqual(reduced.calls, ['collapsed']);
  const normal = companionHarness(); normal.render({ expanded: true, presented: true }); normal.render({ expanded: false }); normal.complete(); normal.flushJS();
  assert.deepEqual(normal.calls, ['collapsed']);
});

test('隐藏页/键盘尺寸和换主题不改变同一Muse结构路径，状态胶囊和字体起排高度持续匹配', () => {
  const h = companionHarness();
  const pathToMuse = (tree, path = []) => {
    if (!tree || typeof tree !== 'object') return undefined;
    if (Array.isArray(tree)) { for (let i = 0; i < tree.length; i++) { const found = pathToMuse(tree[i], [...path, i]); if (found) return found; } return; }
    if (tree.type === 'MuseCompanion') return path;
    return pathToMuse(tree.props?.children, [...path, tree.type, tree.key]);
  };
  const initial = h.render(); const stablePath = pathToMuse(initial);
  const anchorTop = style(nodes(initial).find((n) => style(n.props?.style).alignItems === 'center' && style(n.props?.style).position === 'absolute').props.style).top;
  for (const visible of [false, true]) for (const fontScale of [1, 2]) for (const width of [200, 280]) {
    h.environment.dimensions = { width, height: 300, fontScale }; h.environment.colors = availableThemes[2].colors;
    const tree = h.render({ visible });
    assert.deepEqual(pathToMuse(tree), stablePath);
    assert.equal(tree.props.accessibilityElementsHidden, !visible);
    if (!visible) { assert.equal(tree.props.pointerEvents, 'none'); assert.equal(style(tree.props.style).display, 'none'); }
    const anchor = nodes(tree).find((n) => style(n.props?.style).position === 'absolute' && style(n.props?.style).alignItems === 'center');
    assert.equal(style(anchor.props.style).top, anchorTop);
    const pill = nodes(byId(tree, 'workspace-avatar-status')).find((n) => style(n.props?.style).backgroundColor === h.environment.colors.floatingSurface);
    assert.equal(style(pill.props.style).maxWidth, Math.min(220, width - 24));
    assert.equal(style(byId(tree, 'workspace-companion-expanded').props.style).top, layout.companionContentInset(fontScale));
  }
});

test('实际Muse组件跨姿态保留同一组挂载共享值，减弱动效零timing，正常有限动效卸载取消', () => {
  const h = hooks(); const shared = []; const timing = []; const cancelled = [];
  let reduced = true;
  const reanimated = { __esModule: true, default: { View: 'AnimatedView' },
    Easing: { quad: 'quad', inOut: (x) => x, out: (x) => x, in: (x) => x },
    useSharedValue(initial) { const ref = h.react.useRef(); if (!ref.current) { ref.current = { value: initial }; shared.push(ref.current); } return ref.current; },
    cancelAnimation: (value) => cancelled.push(value), useAnimatedStyle: (fn) => fn(),
    withTiming: (value, config) => { timing.push(config); return value; }, withSequence: (...values) => values.at(-1),
  };
  const { MuseCompanion } = load('MuseCompanion.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Image: 'Image', View: 'View', StyleSheet: { create: (x) => x } },
    '../companion/builtin-packs': { builtinPenguin: { images: {} } }, 'react-native-reanimated': reanimated,
    '../ui/use-reduced-motion': { useReducedMotion: () => reduced }, './companion-state': { describeCompanionState: (x) => x },
  });
  const images = { working: 1, responding: 2, idle: 3 };
  let tree = h.render(MuseCompanion, { state: 'working', images });
  const sameMuseValues = [...shared];
  assert.deepEqual(shared.map((x) => x.value), [1, 0, 0, 0]); assert.equal(timing.length, 0);
  tree = h.render(MuseCompanion, { state: 'responding', images });
  assert.equal(shared.length, 4); shared.forEach((value, index) => assert.equal(value, sameMuseValues[index]));
  assert.equal(nodes(tree).find((n) => n.type === 'Image').props.source, 2);
  reduced = false; h.render(MuseCompanion, { state: 'idle', images });
  assert.ok(timing.length > 0 && timing.length < 20, '有限次数，不创建常驻循环');
  const before = cancelled.length; h.unmount(); assert.equal(cancelled.length, before + 4);
});

function workspaceHarness() {
  const runner = hooks(); const listeners = {}; let back; let dismissed = 0;
  const noop = () => {}; const fakeStore = { setActive: noop, dispose: noop, open: noop, close: noop, invalidate: noop, reload: noop, getSnapshot: () => ({}) };
  const state = { epoch: 0, draft: '保留草稿', resetUncertain: false };
  const runtime = { synchronized: true, running: false, label: '', runs: [] };
  const modules = {};
  // 其余业务组件只作为宿主占位，不执行Store/API；实际执行ConnectedWorkspace的集成接线。
  const ast = ts.createSourceFile('WorkspaceScreen.tsx', source('WorkspaceScreen.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const imp of ast.statements.filter(ts.isImportDeclaration)) {
    const bindings = imp.importClause?.namedBindings;
    modules[imp.moduleSpecifier.text] = Object.fromEntries(bindings && ts.isNamedImports(bindings) ? bindings.elements.map((n) => [n.name.text, n.name.text]) : []);
  }
  Object.assign(modules, {
    react: runner.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, Alert: { alert: noop },
      Keyboard: { dismiss: () => dismissed++, addListener: (event, fn) => { listeners[event] = fn; return { remove: () => delete listeners[event] }; } },
      AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) }, BackHandler: { addEventListener: (_, fn) => { back = fn; return { remove: noop }; } } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24 }) },
    '../companion/CompanionProvider': { useCompanion: () => ({ activePack: { images: { idle: 1 } } }) },
    '../api/ApiProvider': { useApi: () => ({}) }, '../connection/ConnectionProvider': { useServiceConnection: () => ({ snapshot: { serverUrl: 'https://test.invalid' } }) },
    '../sessions/useSessions': { useSessions: () => ({ store: fakeStore }) },
    '../sessions/SessionProvider': { useChatSessionStore: () => fakeStore, useSessionState: () => state },
    '../theme/ThemeProvider': { useTheme: () => ({ colors: availableThemes[0].colors }) }, '../update/UpdateProvider': { useAppUpdate: () => undefined },
    '../runtime/RuntimeProvider': { useRuntimeStore: () => fakeStore, useSessionRuntime: () => runtime },
    '../approvals/ApprovalProvider': { useApprovals: () => ({ snapshot: { pendingIds: [], records: {} } }) },
    '../files/FilesProvider': { useFiles: () => ({ store: fakeStore }) }, '../jobs/JobProvider': { useJobs: () => ({ store: fakeStore }) },
    '../monitors/MonitorProvider': { useMonitors: () => ({ store: fakeStore }) }, '../goals/GoalProvider': { useGoals: () => ({ store: fakeStore }) },
    '../news/news-store': { createNewsStore: () => fakeStore }, '../news/useNews': { useNews: () => ({ snapshot: {} }) },
    '../news/news-preferences-store': { NewsPreferencesStore: class { setActive() {} dispose() {} } },
    '../browser/browser-store': { createBrowserStore: () => fakeStore }, '../chat/message-delivery': { mainProgressLabel },
    '../ui/tokens': tokens, './companion-state': { companionState },
    './primary-nav': { isRootWorkspacePage: ({ sessionMounted }) => !sessionMounted },
  });
  const component = load('WorkspaceScreen.tsx', modules, '\nexport { ConnectedWorkspace };').ConnectedWorkspace;
  return { ...runner, state, listeners, render: () => runner.render(component, { openConnection: noop }), back: () => back(), dismissed: () => dismissed };
}

test('实际转译Workspace：唯一ConversationHost/稳定Floating无key，审批同一展开态、关闭/Back反向、页切换与键盘不卸载聊天', () => {
  const h = workspaceHarness(); let tree = h.render();
  const find = (type) => nodes(tree).find((n) => n.type === type);
  const originalHost = find('ConversationHost'); const floating = find('FloatingCompanion');
  assert.equal(nodes(tree).filter((n) => n.type === 'ConversationHost').length, 1); assert.equal(originalHost.key, undefined); assert.equal(floating.key, undefined);
  assert.equal(floating.props.visible, true); assert.equal(floating.props.expanded, false); assert.equal(floating.props.statusLabel, '就绪');
  originalHost.props.onOpenApprovals(); tree = h.render();
  assert.equal(find('FloatingCompanion').props.expanded, true); assert.equal(find('FloatingCompanion').props.presented, true);
  assert.equal(nodes(find('FloatingCompanion')).find((n) => n.type === 'SessionPanel').props.tab, 'approvals');
  const lateCollapsed = find('FloatingCompanion').props.onCollapsed;
  find('FloatingCompanion').props.onToggle(); tree = h.render();
  find('FloatingCompanion').props.onToggle(); tree = h.render();
  lateCollapsed(); tree = h.render();
  assert.equal(find('FloatingCompanion').props.expanded, true); assert.equal(find('FloatingCompanion').props.presented, true);
  assert.equal(nodes(find('FloatingCompanion')).find((n) => n.type === 'SessionPanel').props.tab, 'approvals');
  const hiddenChat = nodes(tree).find((n) => n.props?.importantForAccessibility === 'no-hide-descendants');
  assert.equal(hiddenChat.props.pointerEvents, 'none'); assert.equal(hiddenChat.props.accessibilityElementsHidden, true);
  byId(tree, 'workspace-companion-close').props.onPress(); tree = h.render();
  assert.equal(find('FloatingCompanion').props.expanded, false); assert.equal(find('FloatingCompanion').props.presented, true);
  find('FloatingCompanion').props.onCollapsed(); tree = h.render();
  assert.equal(find('FloatingCompanion').props.presented, false);
  find('FloatingCompanion').props.onToggle(); tree = h.render();
  // 完全收起后重新打开回到动态默认页；关闭中途重开才保留当前 tab（上方已覆盖）。
  assert.equal(find('FloatingCompanion').props.expanded, true);
  assert.equal(nodes(find('FloatingCompanion')).find((n) => n.type === 'SessionPanel').props.tab, 'activity');
  assert.equal(h.back(), true); tree = h.render();
  assert.equal(find('FloatingCompanion').props.expanded, false); find('FloatingCompanion').props.onCollapsed(); tree = h.render();
  for (const page of ['news', 'settings', 'messages']) {
    find('PrimaryTabBar').props.onSelectTab(page); tree = h.render();
    assert.equal(find('FloatingCompanion').props.visible, page === 'messages');
    assert.equal(find('ConversationHost').key, originalHost.key); assert.equal(nodes(tree).filter((n) => n.type === 'ConversationHost').length, 1);
  }
  h.listeners.keyboardDidShow(); tree = h.render(); assert.equal(find('PrimaryTabBar'), undefined);
  assert.equal(find('FloatingCompanion').props.visible, true); assert.equal(find('ConversationHost').props.chatVisible, true);
  assert.equal(h.back(), true); assert.ok(h.dismissed() > 0); assert.equal(h.state.draft, '保留草稿');
  h.unmount(); assert.deepEqual(Object.keys(h.listeners), []);
});
