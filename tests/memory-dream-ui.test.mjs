import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
test('长期记忆保留直接操作和提交安全提示，紧凑展示真实结果', () => {
  const source = read('workspace/MemoryPanel.tsx');
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

test('全局设置子页使用固定返回栏，资料记忆与 Dream 不绑定聊天所有者', () => {
 const screen = read('workspace/WorkspaceScreen.tsx');
 for (const panel of ['MemoryPanel', 'DreamPanel', 'ProfilePanel']) assert.match(screen, new RegExp('<'+panel+' />'));
 assert.match(screen, /<PageHeader title=.*backLabel="返回设置"/);
});
test('Dream 全局设置和待决项保留完整正文、确认与未明解锁', () => {
 const panel = read('workspace/DreamPanel.tsx');
 assert.match(panel, /全局 Dream 提示词/); assert.match(panel, /启用定期记忆整理/); assert.match(panel, /立即整理/);
 assert.match(panel, /<Text selectable.*\{item.text\}/); assert.match(panel, /确认处理建议/); assert.match(panel, /sourceMissing/);
 assert.match(panel, /已回读核对 Dream 结果，解除锁定/);
});
