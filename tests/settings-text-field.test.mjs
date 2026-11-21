import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { sandboxElement, transpileTsx } from './helpers/tsx-sandbox.mjs';

test('长文本设置默认只读，取消保留原值，完成才更新设置草稿', () => {
  const source = readFileSync(new URL('../src/ui/SettingsTextField.tsx', import.meta.url), 'utf8');
  const state = [];
  let cursor = 0;
  let confirmation;
  const modules = {
    'lucide-react-native': { ChevronRight: 'ChevronRight', FileText: 'FileText', Pencil: 'Pencil' },
    react: { useRef: () => ({ current: null }), useState: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = value; }];
    } },
    'react/jsx-runtime': { jsx: sandboxElement, jsxs: sandboxElement, Fragment: 'Fragment' },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', Alert: { alert(_title, _text, actions) { confirmation = actions; } }, Keyboard: { dismiss() {} }, StyleSheet: { create: (styles) => styles } },
    '../theme/ThemeProvider': { useTheme: () => ({ colors: {} }) },
    './ActionButton': { ActionButton: 'ActionButton' },
    './FormInput': { FormInput: 'FormInput' },
    './Sheet': { Sheet: 'Sheet' },
    './Surfaces': { Card: 'Card' },
    './tokens': { spacing: {}, workspaceTheme: { typography: {}, radius: {} } },
  };
  const exports = {};
  runInNewContext(transpileTsx('SettingsTextField.tsx', source), { exports, require: (name) => modules[name] });
  const changes = [];
  const props = { label: '规则', value: '已保存正文', maxLength: 100, empty: '暂无规则', onChangeText: (value) => changes.push(value) };
  const walk = (node) => Array.isArray(node) ? node.flatMap(walk)
    : node?.props ? [node, ...walk(node.props.children), ...walk(node.props.footer)] : [];
  const render = (overrides = {}) => {
    cursor = 0;
    return walk(exports.SettingsTextField({ ...props, ...overrides }));
  };
  const action = (nodes, label) => nodes.find((node) => node.props.label === label).props;
  assert.equal(render().some((node) => node.type === 'FormInput'), false);
  render().find((node) => node.type === 'Pressable').props.onPress();
  assert.equal(render().some((node) => node.props.selectable && node.props.children === props.value), true);
  action(render(), '编辑规则').onPress();
  render().find((node) => node.type === 'FormInput').props.onChangeText('取消后的内容');
  action(render(), '取消编辑').onPress();
  assert.deepEqual(changes, []);
  assert.equal(render().find((node) => node.type === 'FormInput').props.value, '取消后的内容');
  confirmation.find((item) => item.text === '放弃编辑').onPress();
  render().find((node) => node.type === 'Pressable').props.onPress();
  action(render(), '编辑规则').onPress();
  assert.equal(render().find((node) => node.type === 'FormInput').props.value, props.value);
  render().find((node) => node.type === 'FormInput').props.onChangeText('新的规则');
  assert.equal(action(render({ editable: false }), '完成编辑').disabled, true);
  action(render(), '完成编辑').onPress();
  assert.deepEqual(changes, ['新的规则']);
});
