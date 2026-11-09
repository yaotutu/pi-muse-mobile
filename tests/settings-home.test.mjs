import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { availableThemes } from '../src/theme/registry.ts';
import { spacing, themeTokens } from '../src/theme/tokens.ts';

const source = readFileSync(new URL('../src/workspace/SettingsHome.tsx', import.meta.url), 'utf8');
const expectedTitles = {
  profile: '身份与人设', memory: '长期记忆', dream: 'Dream 记忆整理', goals: '目标',
  jobs: '定时任务', monitors: '网页监控', files: '工作区文件', sms: '短信设置',
  rules: '会话指令', skills: '会话技能', activity: '动态与审批',
  'news-sources': '新闻来源', 'news-preferences': '新闻偏好', appearance: '外观主题',
};

// 这里只执行组件函数并检查元素属性/回调，不模拟原生布局、读屏或渲染快照。
function loadHome(colors = availableThemes[0].colors) {
  const exports = {};
  const element = (type, props) => ({ type, props });
  const modules = {
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': {
      Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
    },
    'lucide-react-native': new Proxy({}, { get: (_, name) => `Icon:${name}` }),
    '../theme/ThemeProvider': { useTheme: () => ({ colors }) },
    '../theme/tokens': { spacing, themeTokens },
    '../ui/Surfaces': { Card: 'Card' },
  };
  const output = ts.transpileModule(source, {
    fileName: 'SettingsHome.tsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(output, {
    exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `未声明的 UI 测试依赖：${name}`);
      return modules[name];
    },
  });
  return exports;
}

function expand(element) {
  if (element == null || typeof element !== 'object') return element;
  if (Array.isArray(element)) return Array.from(element, expand);
  if (typeof element.type === 'function') return expand(element.type(element.props));
  return { ...element, props: { ...element.props, children: expand(element.props.children) } };
}

function nodes(tree) {
  if (tree == null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props.children)];
}

function style(value) {
  return Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
}

function render({ colors, update = false } = {}) {
  const { SettingsHome, SETTINGS_PAGE_TITLES } = loadHome(colors);
  const calls = [];
  const tree = expand(SettingsHome({
    onOpen: (page) => calls.push(['open', page]),
    onConnection: () => calls.push(['connection']),
    onBrowser: () => calls.push(['browser']),
    ...(update ? { onUpdate: () => calls.push(['update']) } : {}),
  }));
  return { tree, calls, titles: SETTINGS_PAGE_TITLES, rows: nodes(tree).filter((node) => node.type === 'Pressable') };
}

test('设置首页公开全部页面标题，四组入口完整且无重复', () => {
  const { tree, rows, titles } = render({ update: true });
  assert.deepEqual({ ...titles }, expectedTitles);
  const headers = nodes(tree).filter((node) => node.props.accessibilityRole === 'header');
  assert.deepEqual(headers.map((node) => node.props.children), ['设置', '助手', '资料与任务', '信息', '应用']);
  const expectedLabels = [...Object.values(expectedTitles), '浏览器', '服务器连接', '应用更新'].sort();
  assert.deepEqual(rows.map((row) => row.props.accessibilityLabel).sort(), expectedLabels);
  const ids = rows.map((row) => row.props.testID);
  assert.equal(new Set(ids).size, rows.length);
  assert.equal(rows.length, 17);
  const cards = nodes(tree).filter((node) => node.type === 'Card');
  assert.deepEqual(cards.map((card) => nodes(card).filter((node) => node.type === 'Pressable')
    .map((row) => row.props.accessibilityLabel)), [
    ['身份与人设', '会话指令', '会话技能', 'Dream 记忆整理'],
    ['长期记忆', '目标', '定时任务', '网页监控', '工作区文件', '动态与审批'],
    ['新闻来源', '新闻偏好', '短信设置'],
    ['浏览器', '外观主题', '服务器连接', '应用更新'],
  ]);
});

test('每个页面和独立操作仅调用对应目标，浏览器保留原 testID', () => {
  const { rows, calls } = render({ update: true });
  for (const page of Object.keys(expectedTitles)) {
    const row = rows.find((item) => item.props.testID === `settings-open-${page}`);
    assert.ok(row, page);
    row.props.onPress();
    assert.deepEqual(calls.splice(0), [['open', page]], page);
  }
  for (const [id, action] of [['viewer-open', 'browser'], ['settings-connection', 'connection'], ['settings-update', 'update']]) {
    rows.find((row) => row.props.testID === id).props.onPress();
    assert.deepEqual(calls.splice(0), [[action]]);
  }
});

test('未提供 onUpdate 时不展示更新入口，其余功能不变', () => {
  const { rows } = render();
  assert.equal(rows.length, 16);
  assert.equal(rows.some((row) => row.props.testID === 'settings-update'), false);
  assert.equal(rows.some((row) => row.props.accessibilityLabel === '应用更新'), false);
});

test('首页自带滚动和留白，主题只作为二级入口而非横向主题选择器', () => {
  const { tree } = render();
  assert.equal(tree.type, 'ScrollView');
  assert.equal(tree.props.keyboardShouldPersistTaps, 'handled');
  assert.equal(style(tree.props.style).flex, 1);
  const content = style(tree.props.contentContainerStyle);
  assert.equal(content.width, '100%');
  assert.equal(content.maxWidth, themeTokens.layout.maxWidth);
  assert.ok(content.paddingHorizontal >= 16);
  assert.ok(content.paddingTop > 0 && content.paddingBottom > 0);
  assert.doesNotMatch(source, /ThemePicker|horizontal|numberOfLines|adjustsFontSizeToFit|allowFontScaling=\{false\}/);
});

test('三主题共用可伸展行、语义色和至少 48dp 命中区，无嵌套可点控件', () => {
  for (const { id, colors } of availableThemes) {
    const { tree, rows } = render({ colors, update: true });
    assert.equal(style(tree.props.style).backgroundColor, colors.canvas, id);
    for (const row of rows) {
      assert.equal(row.props.accessibilityRole, 'button');
      assert.ok(row.props.accessibilityLabel.length > 0);
      assert.equal(nodes(row).filter((node) => node.type === 'Pressable').length, 1);
      const normal = style(row.props.style({ pressed: false }));
      const pressed = style(row.props.style({ pressed: true }));
      assert.ok(normal.minHeight >= 48);
      assert.equal(normal.backgroundColor, colors.surface);
      assert.equal(pressed.backgroundColor, colors.selected);
      const children = nodes(row);
      const textColumn = children.find((node) => node.type === 'View' && style(node.props.style).flex === 1);
      assert.ok(textColumn);
      assert.equal(style(textColumn.props.style).minWidth, 0);
      const title = nodes(textColumn).find((node) => node.type === 'Text');
      assert.equal(style(title.props.style).color, colors.ink);
      assert.equal(title.props.numberOfLines, undefined);
      const chevron = children.find((node) => node.type === 'Icon:ChevronRight');
      assert.ok(chevron);
      assert.equal(chevron.props.color, colors.muted);
      const decorations = children.filter((node) => node.props.accessibilityElementsHidden);
      assert.equal(decorations.length, 2);
      for (const decoration of decorations) {
        assert.equal(decoration.props.importantForAccessibility, 'no-hide-descendants');
        assert.equal(decoration.props.pointerEvents, 'none');
        assert.equal(style(decoration.props.style).flexShrink, 0);
      }
      // 320dp 时图标、箭头和留白不会吃完文字宽度；实际折行仍须 Android 验收。
      const icon = style(decorations[0].props.style);
      const textWidth = 320 - spacing[16] * 2 - normal.paddingHorizontal * 2
        - normal.gap * 2 - icon.width - chevron.props.size;
      assert.ok(textWidth >= 140, `${id} ${row.props.accessibilityLabel}`);
    }
  }
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(|presets\//i);
});
