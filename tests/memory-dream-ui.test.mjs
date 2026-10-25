import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`../src/workspace/${name}`, import.meta.url), 'utf8');

test('长期记忆保留直接操作和提交安全提示，紧凑展示真实结果', () => {
  const source = read('MemoryPanel.tsx');
  assert.doesNotMatch(source, /SectionHeading|KEEP WHAT MATTERS|<EmptyState/);
  assert.match(source, /styles\.topRow/);
  assert.match(source, /snapshot\.memories\.length/);
  for (const label of ['返回应用设置', '刷新记忆', '搜索记忆', '全部记忆', '新增记忆', '记忆搜索关键词', '记忆内容', '确认删除记忆', '取消删除记忆']) {
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
  assert.match(source, /styles\.topRow/);
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
