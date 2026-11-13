import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { flattenStyle, sandboxElement, transpileTsx } from './helpers/tsx-sandbox.mjs';
import { availableThemes } from '../src/theme/registry.ts';
import { spacing, themeTokens } from '../src/theme/tokens.ts';

const source = readFileSync(new URL('../src/workspace/SessionSettings.tsx', import.meta.url), 'utf8');

function nodes(tree) {
  if (tree == null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props.children)];
}

test('SessionSettings 源码符合规范：来源分组、紧凑排版、最小点击区与语义Token', () => {
  // 分组与文案
  assert.match(source, /自有技能 ·/);
  assert.match(source, /通用技能（共享目录）·/);
  assert.match(source, /来自服务端运行用户的共享目录（~\/\.agents\/skills），只读、其中的脚本不会执行、默认关闭。/);

  // 来源标签与默认提示
  assert.match(source, /skill\.sourceDeclared &&/);
  assert.match(source, /sourceLabel\(skill\.source\)/);
  assert.match(source, /function sourceLabel\(/);
  assert.match(source, /'实例自建'/);
  assert.match(source, /'通用'/);
  assert.match(source, /'内置'/);
  assert.match(source, /skill\.defaultEnabled &&/);
  assert.match(source, /默认开启/);

  // 描述1行截断
  assert.match(source, /numberOfLines=\{1\}/);

  // 展开说明
  assert.match(source, /expanded \? '收起说明' : '查看说明'/);
  assert.match(source, /store\.loadSkillDetail/);
  assert.match(source, /<MarkdownContent\b/);
  assert.match(source, /正在读取技能说明…/);
  assert.match(source, /<FeedbackNotice text=\{detailState\.error\}/);

  // 无障碍
  assert.match(source, /accessibilityRole="switch"/);
  assert.match(source, /accessibilityLabel=\{`技能 \$\{skill\.name\}`\}/);

  // 触控尺寸
  assert.match(source, /minHeight: workspaceTheme\.layout\.smallControl/);

  // 无硬编码色
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i);
});

test('SessionSettings 在沙箱中正确渲染分组、标签、默认开启和展开详情', () => {
  const expand = (tree) =>
    tree == null || typeof tree !== 'object'
      ? tree
      : Array.isArray(tree)
        ? Array.from(tree, expand)
        : typeof tree.type === 'function'
          ? expand(tree.type(tree.props))
          : { ...tree, props: { ...tree.props, children: expand(tree.props.children) } };

  const catalog = [
    { id: 'builtin/web_search', name: 'web_search', description: '网页查询', source: 'builtin', sourceDeclared: true, defaultEnabled: true, enabled: true },
    { id: 'user/custom_tool', name: 'custom_tool', description: '自建工具', source: 'user', sourceDeclared: true, defaultEnabled: false, enabled: false },
    { id: 'legacy_tool', name: 'legacy_tool', description: '旧工具', source: 'builtin', sourceDeclared: false, defaultEnabled: false, enabled: false },
    { id: 'shared/shell_cmd', name: 'shell_cmd', description: '通用脚本', source: 'shared', sourceDeclared: true, defaultEnabled: false, enabled: false },
  ];

  const draft = {
    'builtin/web_search': true,
    'user/custom_tool': false,
    legacy_tool: false,
    'shared/shell_cmd': false,
  };

  const details = {
    web_search: { loading: false, content: '# Web Search 正文' },
    custom_tool: { loading: true },
    shell_cmd: { loading: false, error: '技能正文不可用' },
  };

  const calls = [];
  const mockStore = {
    canWrite: () => true,
    hasSettingsWrite: () => false,
    loadSkills: (sessionId) => calls.push(['loadSkills', sessionId]),
    loadInstructions: () => {},
    cancelReads: () => {},
    setSkill: (sessionId, id, enabled) => calls.push(['setSkill', sessionId, id, enabled]),
    saveSkills: () => Promise.resolve(true),
    loadSkillDetail: (sessionId, name) => calls.push(['loadSkillDetail', sessionId, name]),
  };

  const mockSession = {
    instructions: { loaded: true, loading: false, saving: false, saved: '', draft: '' },
    skills: {
      loaded: true,
      loading: false,
      saving: false,
      saved: draft,
      draft,
      catalog,
      diagnostics: [],
      details,
    },
  };

  const colors = availableThemes[0].colors;
  const modules = {
    react: {
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useState: (init) => {
        let val = typeof init === 'function' ? init() : init;
        return [val, (updater) => {
          val = typeof updater === 'function' ? updater(val) : updater;
        }];
      },
    },
    'react/jsx-runtime': { jsx: sandboxElement, jsxs: sandboxElement },
    'react-native': {
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      Text: 'Text',
      View: 'View',
      StyleSheet: { create: (s) => s, hairlineWidth: 1 },
    },
    'lucide-react-native': { Check: 'Check' },
    '../sessions/SessionProvider': {
      useSessionState: () => mockSession,
      useChatSessionStore: () => mockStore,
    },
    '../sessions/chat-session-store': {
      INSTRUCTIONS_LIMIT: 20000,
      equalSwitches: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
    '../ui/tokens': { workspaceTheme: themeTokens, spacing },
    '../theme/ThemeProvider': { useTheme: () => ({ colors }) },
    '../ui/ActionButton': { ActionButton: (props) => sandboxElement('ActionButton', props) },
    '../ui/FormInput': { FormInput: (props) => sandboxElement('FormInput', props) },
    '../ui/MarkdownContent': { MarkdownContent: (props) => sandboxElement('MarkdownContent', props) },
    '../ui/Surfaces': { Card: (props) => sandboxElement('Card', props) },
    '../ui/Feedback': { FeedbackNotice: (props) => sandboxElement('FeedbackNotice', props) },
  };

  const output = transpileTsx('SessionSettings.tsx', source);
  const exports = {};
  runInNewContext(output, {
    exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `未声明的模块：${name}`);
      return modules[name];
    },
  });

  const tree = expand(exports.SessionSettings({ sessionId: 'main', section: 'skills', onSaved: () => {} }));
  const allNodes = nodes(tree);

  // 1) 验证两个分组标题与数量
  const textNodes = allNodes.filter((n) => n.type === 'Text');
  const texts = textNodes.map((n) => {
    const c = n.props.children;
    return Array.isArray(c) ? c.flat(Infinity).join('') : String(c ?? '');
  });
  assert.ok(texts.some((t) => t.includes('自有技能 · 3')), '自有技能标题包含数量3');
  assert.ok(texts.some((t) => t.includes('通用技能（共享目录）· 1')), '通用技能标题包含数量1');

  // 2) 验证通用技能只读短句说明
  assert.ok(texts.some((t) => t.includes('来自服务端运行用户的共享目录（~/.agents/skills），只读、其中的脚本不会执行、默认关闭。')), '通用组说明文案完整');

  // 3) 验证来源标签：仅在 sourceDeclared 时显示
  assert.ok(texts.includes('内置'), '显示内置标签');
  assert.ok(texts.includes('实例自建'), '显示实例自建标签');
  assert.ok(texts.includes('通用'), '显示通用标签');
  // legacy_tool 没有 sourceDeclared，因此不应有额外的未知标签
  const badgeTexts = texts.filter((t) => ['内置', '实例自建', '通用'].includes(t));
  assert.equal(badgeTexts.length, 3, '只有3个声明来源的技能显示来源标签，旧服务端技能不显示');

  // 4) 验证默认开启提示：仅 web_search (defaultEnabled: true) 显示
  const defaultHints = texts.filter((t) => t === '默认开启');
  assert.equal(defaultHints.length, 1, '仅 defaultEnabled 为 true 的技能显示默认开启');

  // 5) 验证无障碍与开关触控
  const switches = allNodes.filter((n) => n.props?.accessibilityRole === 'switch');
  assert.equal(switches.length, 4, '4个技能行均有 switch 角色');
  const labels = switches.map((s) => s.props.accessibilityLabel);
  assert.deepEqual(labels, [
    '技能 web_search',
    '技能 custom_tool',
    '技能 legacy_tool',
    '技能 shell_cmd',
  ]);

  // 6) 验证查看说明按钮存在
  const detailButtons = allNodes.filter((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel?.includes('说明'));
  assert.equal(detailButtons.length, 4, '4个技能均有查看说明按钮');

  // 7) 验证点击开关调用 store.setSkill，并以技能 id 为键
  switches[0].props.onPress();
  assert.deepEqual(calls.at(-1), ['setSkill', 'main', 'builtin/web_search', false]);

  switches[1].props.onPress();
  assert.deepEqual(calls.at(-1), ['setSkill', 'main', 'user/custom_tool', true]);

  // 8) 验证点击说明按钮触发 store.loadSkillDetail（点击说明与开关分离）
  detailButtons[0].props.onPress();
  // web_search 已有 content，不重复请求
  detailButtons[1].props.onPress();
  // custom_tool loading=true，不重复请求
  detailButtons[2].props.onPress();
  // legacy_tool 没有 content 且未 loading，发出请求
  assert.deepEqual(calls.at(-1), ['loadSkillDetail', 'main', 'legacy_tool']);
});
