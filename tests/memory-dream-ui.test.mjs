import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`../src/workspace/${name}`, import.meta.url), 'utf8');

test('设置子页自行挂载共享固定顶栏，返回与刷新不占用正文行', () => {
  const wsSource = read('WorkspaceScreen.tsx');
  assert.match(wsSource, /page === 'settings' && !inSettingsSubpage/);
  assert.doesNotMatch(wsSource, /<ScrollView[^>]*><(?:ProfilePanel|MemoryPanel|DreamPanel)/);
  for (const name of ['ProfilePanel.tsx', 'MemoryPanel.tsx', 'DreamPanel.tsx']) {
    const source = read(name);
    assert.match(source, /<Subpage title="[^"]+" backLabel="返回设置" onBack=\{onBack\} backTestID="settings-subpage-back"/);
    assert.match(source, /action=\{<IconControl transparent icon=\{RefreshCw\}[\s\S]*?onPress=\{\(\) => void store\.refresh\(\)\} busy=\{snapshot\.loading\} disabled=\{!!snapshot\.writing\}/);
    assert.doesNotMatch(source, /styles\.(?:topRow|pageTitle|heading)|onBack\?:/);
    assert.doesNotMatch(source, /<ActionButton label="返回设置"/);
    assert.doesNotMatch(source, /返回应用设置|返回应用/);
  }
  const shell = readFileSync(new URL('../src/ui/Subpage.tsx', import.meta.url), 'utf8');
  assert.ok(shell.indexOf('<SubpageHeader {...header}') < shell.indexOf('<ScrollView'));
  assert.match(shell, /keyboardShouldPersistTaps="handled"/);
  assert.match(shell, /textAlign: 'center', flex: 1, minWidth: 0/);
  assert.match(shell, /action: \{ width: workspaceTheme\.layout\.controlSize/);
  assert.doesNotMatch(shell, /height: workspaceTheme\.layout\.headerTop|numberOfLines/);
});

test('长期记忆保留直接操作和提交安全提示，紧凑展示真实结果', () => {
  const source = read('MemoryPanel.tsx');
  assert.doesNotMatch(source, /SectionHeading|KEEP WHAT MATTERS|<EmptyState/);
  assert.match(source, /<Subpage title="长期记忆"/);
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

test('Dream 展开平级分组，保留独立保存、切换确认、开关与待决归属', () => {
  const source = read('DreamPanel.tsx');
  assert.doesNotMatch(source, /SectionHeading|eyebrow="DREAM"/);
  assert.match(source, /<Subpage title="Dream 记忆整理"/);
  for (const label of ['全局概览', '全局整理提示词', '选择整理空间', '当前空间设置', '最近整理', '待决建议', '保存全局Dream提示词', '取消全局Dream提示词修改', '保存当前空间Dream设置', '取消当前空间Dream设置修改', '立即整理当前Dream空间']) {
    assert.ok(source.includes(label), label);
  }
  assert.match(source, /if \(snapshot\.spaceDirty\) \{ setNextSpaceId\(spaceId\); return; \}/);
  assert.match(source, /accessibilityRole="switch"[^>]+accessibilityState=\{\{ checked: selected, disabled \}\}/);
  assert.match(source, /\['user', 'soul', 'instructions', 'memory'\]/);
  assert.match(source, /当前目标：\{targetText\(chosen, current\.spaceId\)\}/);
  assert.match(source, /<Text selectable style=\{styles\.fullText\}>\{item\.text\}/);
  assert.match(source, /确认应用Dream建议/);
  assert.match(source, /确认忽略Dream建议/);
  assert.match(source, /showDefault && <Text selectable/);
  assert.match(source, /<ActionButton label="保存全局Dream提示词"[^>]+wide/);
});
