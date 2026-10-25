import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('共享控件保留受控输入、选择语义及最小点击区', () => {
  const input = read('ui/FormInput.tsx');
  const chip = read('ui/ChoiceChip.tsx');
  const button = read('ui/ActionButton.tsx');
  const feedback = read('ui/Feedback.tsx');

  assert.match(input, /forwardRef<TextInput, TextInputProps/);
  assert.match(input, /<TextInput \{\.\.\.props\} ref=\{ref\} multiline=\{multiline\} editable=\{editable\}/);
  assert.match(input, /onFocus=\{\(event\) => \{ setFocused\(true\); onFocus\?\.\(event\); \}\}/);
  assert.match(input, /onBlur=\{\(event\) => \{ setFocused\(false\); onBlur\?\.\(event\); \}\}/);
  assert.match(chip, /role === 'radio' \? \{ checked: selected, disabled \} : \{ selected, disabled \}/);
  assert.match(chip, /minHeight: themeTokens\.layout\.smallControl/);
  assert.match(button, /const locked = disabled \|\| busy/);
  assert.match(button, /disabled=\{locked\} onPress=\{onPress\}/);
  assert.match(button, /minHeight: themeTokens\.layout\.smallControl/);
  assert.match(feedback, /tone === 'danger' \? 'alert'/);
});

test('各页面共用文字操作与输入，保留专用聊天输入和安全属性', () => {
  const pages = ['ActivityPanel', 'ApprovalPanel', 'ConnectionPanel', 'DreamPanel', 'FilesPanel',
    'GoalsPanel', 'JobsPanel', 'MemoryPanel', 'MonitorsPanel', 'ProfilePanel', 'SpaceSettings', 'WorkspaceScreen'];
  for (const page of pages) {
    const source = read(`workspace/${page}.tsx`);
    assert.match(source, /<ActionButton\b/, `${page} 使用共享文字操作`);
    assert.doesNotMatch(source, /function (?:Button|Action)\(/, `${page} 不保留页内按钮工厂`);
    assert.doesNotMatch(source, /<TextInput\b/, `${page} 不保留裸输入`);
  }
  for (const page of ['ConnectionPanel', 'DreamPanel', 'FilesPanel', 'GoalsPanel', 'JobsPanel',
    'MemoryPanel', 'ProfilePanel', 'SpaceSettings', 'WorkspaceScreen']) {
    assert.match(read(`workspace/${page}.tsx`), /<FormInput\b/, `${page} 使用共享输入`);
  }
  const connection = read('workspace/ConnectionPanel.tsx');
  assert.match(connection, /secureTextEntry=\{!showKey\}/);
  assert.match(connection, /autoComplete="off"/);
  assert.match(connection, /workspace-connection-confirm-accept/);
  const files = read('workspace/FilesPanel.tsx');
  assert.match(files, /<FormInput variant="code"/);
  assert.match(files, /MAX_WORKSPACE_TEXT_BYTES/);
  assert.match(read('workspace/ConversationView.tsx'), /<TextInput\b/);
  assert.equal(existsSync(new URL('../src/ui/Buttons.tsx', import.meta.url)), false);
});
