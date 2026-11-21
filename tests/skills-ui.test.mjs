import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { sandboxElement, transpileTsx } from './helpers/tsx-sandbox.mjs';
import { availableThemes } from '../src/theme/registry.ts';
import { spacing, themeTokens } from '../src/theme/tokens.ts';

const source = readFileSync(new URL('../src/workspace/AssistantSettings.tsx', import.meta.url), 'utf8');

function nodes(tree) {
  if (tree == null || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props.children)];
}

test('技能说明与开关分离，技能选择按来源身份更新', () => {
  const expand = (tree) =>
    tree == null || typeof tree !== 'object'
      ? tree
      : Array.isArray(tree)
        ? Array.from(tree, expand)
        : typeof tree.type === 'function'
          ? expand(tree.type(tree.props))
          : { ...tree, props: { ...tree.props, children: expand(tree.props.children) } };

  const catalog = [
    { id: 'builtin/web_search', name: 'web_search', description: '网页查询', source: 'builtin', defaultEnabled: true, enabled: true },
    { id: 'user/custom_tool', name: 'custom_tool', description: '自建工具', source: 'user', defaultEnabled: false, enabled: false },
    { id: 'builtin/legacy_tool', name: 'legacy_tool', description: '旧工具', source: 'builtin', defaultEnabled: false, enabled: false },
    { id: 'shared/shell_cmd', name: 'shell_cmd', description: '通用脚本', source: 'shared', defaultEnabled: false, enabled: false },
  ];

  const draft = {
    'builtin/web_search': true,
    'user/custom_tool': false,
    'builtin/legacy_tool': false,
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
    setSkill: (id, enabled) => calls.push(['setSkill', id, enabled]),
    saveSkills: () => Promise.resolve(true),
    loadSkillDetail: (name) => calls.push(['loadSkillDetail', name]),
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
      Switch: 'Switch', ScrollView: 'ScrollView',
      Text: 'Text',
      View: 'View',
      StyleSheet: { create: (s) => s, hairlineWidth: 1 },
    },
    'lucide-react-native': { ChevronDown: 'ChevronDown', ChevronUp: 'ChevronUp' },
    '../sessions/SessionProvider': {
      useAssistantSettings: () => ({ ...mockStore, state: mockSession }),
    },
    '../sessions/assistant-settings-store': {
      INSTRUCTIONS_LIMIT: 20000,
      equalSwitches: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
    '../ui/tokens': { workspaceTheme: themeTokens, spacing },
    '../theme/ThemeProvider': { useTheme: () => ({ colors }) },
    '../ui/ActionButton': { ActionButton: (props) => sandboxElement('ActionButton', props) },
    '../ui/SettingsTextField': { SettingsTextField: 'SettingsTextField' },
    '../ui/MarkdownContent': { MarkdownContent: (props) => sandboxElement('MarkdownContent', props) },
    '../ui/Surfaces': { Card: (props) => sandboxElement('Card', props) },
    '../ui/Feedback': { FeedbackNotice: (props) => sandboxElement('FeedbackNotice', props) },
  };

  const output = transpileTsx('AssistantSettings.tsx', source);
  const exports = {};
  runInNewContext(output, {
    exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `未声明的模块：${name}`);
      return modules[name];
    },
  });

  const tree = expand(exports.AssistantSettings({ section: 'skills', onSaved: () => {} }));
  const allNodes = nodes(tree);

  const headers = allNodes.filter((item) => item.props.accessibilityRole === 'header');
  assert.deepEqual(headers.map((item) => item.props.children), ['助手技能', '共享技能']);
  const switches = allNodes.filter((item) => item.type === 'Switch');
  assert.deepEqual(switches.map((item) => item.props.value), [true, false, false, false]);
  switches[0].props.onValueChange(false);
  switches[1].props.onValueChange(true);
  assert.deepEqual(calls.splice(0), [
    ['setSkill', 'builtin/web_search', false],
    ['setSkill', 'user/custom_tool', true],
  ]);

  const detail = allNodes.find((item) => item.props.accessibilityLabel === 'legacy_tool 说明');
  assert.ok(detail);
  assert.equal(detail.props.accessibilityState.expanded, false);
  detail.props.onPress();
  assert.deepEqual(calls, [['loadSkillDetail', 'legacy_tool']]);
});
