import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const workspace = read('workspace/WorkspaceScreen.tsx');
const connection = read('workspace/ConnectionPanel.tsx');

test('根窗口避让对齐安全区与键盘屏幕坐标，不把状态栏偏移漏掉', () => {
  assert.match(workspace, /useSafeAreaInsets\(\)/);
  assert.match(workspace, /<KeyboardAvoidingView[^>]*keyboardVerticalOffset=\{insets\.top\}/);
  assert.match(workspace, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  assert.doesNotMatch(workspace, /keyboardVerticalOffset=\{\d+\}/);
});

test('连接 Modal 的独立窗口同样补偿安全区，表单触控不先被键盘吞掉', () => {
  assert.match(connection, /const insets = useSafeAreaInsets\(\)/);
  assert.match(connection, /<KeyboardAvoidingView[\s\S]*?keyboardVerticalOffset=\{insets\.top\}/);
  assert.match(connection, /keyboardShouldPersistTaps="handled"/);
  assert.doesNotMatch(connection, /keyboardVerticalOffset=\{\d+\}/);
});

test('主聊天不叠加另一层键盘高度补丁，仍只有根窗口一个避让所有者', () => {
  assert.equal((workspace.match(/<KeyboardAvoidingView\b/g) ?? []).length, 1);
  const conversation = read('workspace/ConversationView.tsx');
  assert.doesNotMatch(conversation, /KeyboardAvoidingView|keyboardHeight|keyboardVerticalOffset/);
  assert.match(workspace, /!keyboardVisible && root && <PrimaryTabBar/);
  assert.match(workspace, /<ScrollView keyboardShouldPersistTaps="handled"[^>]*>\{settingsContent\}/);
});

test('设置首页使用分组组件，主题选择只在外观二级页展开', () => {
  assert.match(workspace, /const rootSettings = <SettingsHome onOpen=\{setSettingsPage\}/);
  assert.match(workspace, /if \(settingsPage === 'appearance'\) settingsContent = <ThemePicker \/>/);
  assert.match(workspace, /title=\{SETTINGS_PAGE_TITLES\[settingsPage\]\}/);
  assert.doesNotMatch(workspace, /SETTINGS\.map|rootSettings = <ScrollView/);
});

test('未连接时共用设置布局，外观与形象可独立打开，其余资料先引导连接', () => {
  const offline = workspace.slice(workspace.indexOf('function DisconnectedWorkspace'), workspace.indexOf('function ConnectedWorkspace'));
  assert.match(offline, /<SettingsHome notice="尚未连接服务器/);
  assert.match(offline, /if \(target === 'appearance' \|\| target === 'companion'\) setLocalPage\(target\); else openConnection\(\)/);
  assert.match(offline, /onConnection=\{openConnection\} onBrowser=\{openConnection\}/);
  assert.match(offline, /if \(tab !== 'settings' \|\| !localPage\) return false/);
  assert.match(offline, /!\(tab === 'settings' && localPage\) && <PrimaryTabBar/);
});
