import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { messageDelivery, mainProgressLabel } from '../src/chat/message-delivery.ts';

const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');

test('送达标记只用于用户，保存证据与回复运行失败相互独立', () => {
  for (const pending of [undefined, 'sending', 'failed', 'unconfirmed']) {
    assert.equal(messageDelivery('user', true, pending), 'saved');
    assert.equal(messageDelivery('assistant', true, pending), undefined);
  }
});

test('没有保存证据时不冒充成功，失败和未确认保持可区分', () => {
  assert.equal(messageDelivery('user', false, 'sending'), 'pending');
  assert.equal(messageDelivery('user', false), 'pending');
  assert.equal(messageDelivery('user', false, 'failed'), 'failed');
  assert.equal(messageDelivery('user', false, 'unconfirmed'), 'unconfirmed');
});

test('未同步用真实未知状态，已同步时审批优先，正常生成只在形象展示', () => {
  const base = { synchronized: true, running: false, label: '就绪', pendingApprovals: 0, runObserved: false };
  assert.equal(mainProgressLabel(base), '就绪');
  assert.equal(mainProgressLabel({ ...base, synchronized: false, label: '连接已断开，状态待同步', pendingApprovals: 2 }), '连接已断开，状态待同步');
  assert.equal(mainProgressLabel({ ...base, running: true, label: '正在生成回复', pendingApprovals: 1 }), '等待你的审批（1 项）');
  assert.equal(mainProgressLabel({ ...base, running: true, label: '正在生成回复', pending: 'sending' }), '正在生成回复');
});

test('暂存接纳、终态对账与异常不混成同一种发送中', () => {
  const base = { synchronized: true, running: false, label: '执行完成', pendingApprovals: 0, runObserved: false };
  assert.equal(mainProgressLabel({ ...base, pending: 'sending' }), '正在发送');
  assert.equal(mainProgressLabel({ ...base, pending: 'sending', runObserved: true }), '正在同步消息');
  assert.equal(mainProgressLabel({ ...base, pending: 'failed' }), '消息未发送');
  assert.equal(mainProgressLabel({ ...base, pending: 'unconfirmed' }), '消息保存结果待确认');
});

test('成功与发送中不显示任何标记；异常标记在气泡左侧且不占气泡内部空间', () => {
  const view = read('workspace/ConversationView.tsx');
  assert.doesNotMatch(view, /发送中|TypingIndicator|messageSubtext|消息已保存|deliveryIndicator|paddingRight: l\.chatMessagePadding \+ spacing\[20\]/);
  assert.match(view, /deliveryAlert = message\.role === 'user' && \(delivery === 'failed' \|\| delivery === 'unconfirmed'\)/);
  assert.match(view, /userMessageRow: \{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing\[8\] \}/);
  assert.match(view, /deliveryAlert: \{ width: sizing\[24\], height: sizing\[24\]/);
  assert.match(view, /AlertCircle size=\{sizing\[18\]\} color=\{colors\.danger\}/);
  assert.match(view, /CircleHelp size=\{sizing\[18\]\} color=\{colors\.warning\}/);
  assert.match(view, /streaming=\{message\.streaming === true\}/);
  for (const action of ['重新同步会话', '恢复到输入框', '放弃未发送消息']) assert.ok(view.includes(action), action);
});
