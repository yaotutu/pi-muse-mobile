import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { workspaceBackAction } from '../src/workspace/workspace-back.ts';

const read = (name) => readFileSync(new URL(`../src/workspace/${name}`, import.meta.url), 'utf8');

test('管理子页共用滚动区外的固定标题与返回设置入口，不重复标题和返回按钮', () => {
  const screen = read('WorkspaceScreen.tsx');
  const management = screen.slice(screen.indexOf('const management ='), screen.indexOf('return <ScrollView key="settings"'));
  for (const title of ['长期记忆', '助手与用户资料', 'Dream 记忆整理']) assert.ok(management.includes(title), title);
  assert.match(management, /<AgentHeader title=\{management.title\} backLabel="返回设置" onBack=\{\(\) => onSubpage\(null\)\} \/>\s*<ScrollView/);
  assert.match(management, /\{management.content\}<\/ScrollView>/);
  for (const name of ['ProfilePanel.tsx', 'MemoryPanel.tsx', 'DreamPanel.tsx']) {
    const source = read(name);
    assert.doesNotMatch(source, /返回设置|onBack|styles\.pageTitle|styles\.heading/);
  }
});

test('动态与审批覆盖原成员页面，打开时不切私聊且总从动态开始', () => {
  const screen = read('WorkspaceScreen.tsx');
  assert.match(screen, /onActivity=\{\(\) => openSession\('activity'\)\}/);
  const close = screen.slice(screen.indexOf('const closeSession ='), screen.indexOf('const leaveAgentChild ='));
  assert.match(close, /setSessionOpen\(false\)/);
  assert.doesNotMatch(close, /setPage|setAgentView|setProfileReturn|setAgentSection/);
  assert.match(screen, /else if \(action === 'session'\) closeSession\(\)/);
  assert.match(screen, /onPress=\{sessionOpen \? closeSession : openSession\}/);
});

test('三个全局管理页的系统返回均先收键盘和覆盖层，再回设置首页', () => {
  for (const settingsSubpage of ['profile', 'memory', 'dream']) {
    const state = { page: 'settings', settingsSubpage, keyboardVisible: false, sessionMounted: false, goalCreating: false };
    assert.equal(workspaceBackAction(state), 'settings');
    assert.equal(workspaceBackAction({ ...state, keyboardVisible: true }), 'keyboard');
    assert.equal(workspaceBackAction({ ...state, sessionMounted: true }), 'session');
    assert.equal(workspaceBackAction({ ...state, settingsSubpage: null }), 'group-info');
  }
});

test('长期记忆保留直接操作和提交安全提示，紧凑展示真实结果', () => {
  const source = read('MemoryPanel.tsx');
  assert.doesNotMatch(source, /SectionHeading|KEEP WHAT MATTERS|<EmptyState/);
  assert.match(source, /styles\.topRow/);
  assert.match(source, /snapshot\.memories\.length/);
  for (const label of ['刷新记忆', '搜索记忆', '全部记忆', '新增记忆', '记忆搜索关键词', '记忆内容', '确认删除记忆', '取消删除记忆']) {
    assert.ok(source.includes(label), label);
  }
  assert.match(source, /snapshot\.uncertain && <Card[^>]+testID="memory-uncertain"/);
  assert.match(source, /snapshot\.reviewed && <ActionButton label="已核对，解除提交锁定"/);
  assert.match(source, /snapshot\.stale && snapshot\.loaded/);
  assert.match(source, /<Text selectable style=\{styles\.body\}>\{memory\.text\}/);
  assert.match(source, /<Text selectable style=\{styles\.body\}>\{snapshot\.deleteTarget\.text\}/);
  assert.match(source, /<ActionButton label="确认删除记忆"[^\n]+tone="danger" wide/);
});

test('Dream 常用操作先于折叠配置，保留独立保存、切换确认、开关与待决归属', () => {
  const source = read('DreamPanel.tsx');
  assert.doesNotMatch(source, /SectionHeading|eyebrow="DREAM"/);
  assert.match(source, /styles\.topRow/);
  for (const label of ['全局整理提示词', '选择整理智能体', '当前智能体设置', '最近整理', '待决建议', '保存全局Dream提示词', '取消全局Dream提示词修改', '保存当前智能体Dream设置', '取消当前智能体Dream设置修改', '立即整理当前Dream智能体']) {
    assert.ok(source.includes(label), label);
  }
  assert.match(source, /if \(snapshot\.agentDirty\) \{ setNextAgentId\(agentId\); return; \}/);
  assert.match(source, /accessibilityRole="switch"[^>]+accessibilityState=\{\{ checked: selected, disabled \}\}/);
  assert.match(source, /\['user', 'soul', 'instructions', 'memory'\]/);
  assert.match(source, /当前目标：\{targetText\(chosen, current\.agentId\)\}/);
  assert.match(source, /<Text selectable style=\{styles\.fullText\}>\{item\.text\}/);
  assert.match(source, /确认应用Dream建议/);
  assert.match(source, /确认忽略Dream建议/);
  assert.match(source, /showDefault && <Text selectable/);
  assert.match(source, /<ActionButton label="保存全局Dream提示词"[^>]+wide/);
  const order = ['>选择整理智能体</Text>', '>最近整理</Text>', '>待决建议 ·', '>当前智能体设置</Text>', '>全局整理提示词</Text>'];
  assert.deepEqual([...order].sort((a, b) => source.indexOf(a) - source.indexOf(b)), order);
  for (const name of ['GlobalSettings', 'AgentSettings']) {
    assert.match(source, new RegExp(`const \\[show${name}, setShow${name}\\] = useState\\(false\\)`));
    assert.match(source, new RegExp(`expanded=\\{show${name}\\}`));
    assert.match(source, new RegExp(`\\{show${name} && <>`));
    assert.match(source, new RegExp(`setShow${name}\\(!show${name}\\)`));
  }
  assert.match(source, /snapshot\.globalDirty \? '有未保存修改'/);
  assert.match(source, /snapshot\.agentDirty \? '有未保存修改'/);
  assert.match(source, /disabled=\{!canRun\}/);
  assert.doesNotMatch(source, /setShow\w+\([^;]+;\s*(?:store\.discard|void store\.save|void store\.run)/);
});
