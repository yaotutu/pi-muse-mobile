import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupComposer } from '../src/group/group-composer.ts';
const snapshot = (turns = [], running = null) => ({ id: 'main', defaultAgentId: 'local-main', turns, running, notifications: [] });

test('交接提交立即清空正文和定向，原文保留；模型未回复也可准备下一条', () => {
  const composer = new GroupComposer(); composer.setDraft('第一条'); composer.setTarget('news-internal');
  assert.equal(composer.submit({ id: 'one', content: '第一条', targetAgentId: 'news-internal' }), true);
  assert.equal(composer.getSnapshot().draft, ''); assert.equal(composer.getSnapshot().target, undefined);
  assert.equal(composer.getSnapshot().pending.draft, '第一条');
  composer.setDraft('下一条'); composer.setTarget('sms-internal');
  assert.equal(composer.submit({ id: 'two', content: '下一条' }), false);
  composer.accept('child'); assert.equal(composer.getSnapshot().pending.id, 'one');
  composer.accept('one');
  assert.equal(composer.getSnapshot().pending, undefined);
  assert.equal(composer.getSnapshot().draft, '下一条'); assert.equal(composer.getSnapshot().target, 'sms-internal');
  composer.reconcile(snapshot([{ id: 'one', messages: [{ role: 'user' }] }]));
  assert.equal(composer.getSnapshot().draft, '下一条');
});
test('断流后回读确认已收件，仅释放旧提交，保留下一条草稿', () => {
  const composer = new GroupComposer(); composer.setDraft('旧消息'); composer.submit({ id: 'one', content: '旧消息' });
  composer.setDraft('新草稿');
  composer.reconcile(snapshot([{ id: 'one', messages: [{ role: 'user' }] }]));
  assert.equal(composer.getSnapshot().pending, undefined); assert.equal(composer.getSnapshot().draft, '新草稿');
});
test('服务器仍在执行不能据空正文恢复或重发，确认未接收后恢复原文与定向', () => {
  const composer = new GroupComposer(); composer.setDraft('@新闻 帮我看看'); composer.setTarget('news-internal');
  composer.submit({ id: 'one', content: '帮我看看' });
  composer.reconcile(snapshot([], 'one')); assert.equal(composer.restore(), false); assert.equal(composer.getSnapshot().draft, '');
  composer.reconcile(snapshot());
  assert.equal(composer.getSnapshot().draft, '@新闻 帮我看看'); assert.equal(composer.getSnapshot().target, 'news-internal');
  assert.equal(composer.getSnapshot().pending, undefined);
});
test('确认未接收也不覆盖新草稿；显式恢复或丢弃只处理旧消息', () => {
  const composer = new GroupComposer(); composer.setDraft('旧消息'); composer.submit({ id: 'one', content: '旧消息' });
  composer.setDraft('新消息'); composer.reconcile(snapshot());
  assert.equal(composer.getSnapshot().draft, '新消息'); assert.equal(composer.getSnapshot().pending.absent, true);
  assert.equal(composer.restore(), false);
  composer.setDraft(''); assert.equal(composer.restore(), true); assert.equal(composer.getSnapshot().draft, '旧消息');
  composer.submit({ id: 'two', content: '旧消息' }); composer.setDraft('保留新稿');
  composer.discard(); assert.ok(composer.getSnapshot().pending); // 未核对不可丢弃未明提交
  composer.reconcile(snapshot()); composer.discard();
  assert.equal(composer.getSnapshot().draft, '保留新稿'); assert.equal(composer.getSnapshot().pending, undefined);
});
