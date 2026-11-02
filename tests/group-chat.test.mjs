import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGroup, parseGroupEvent, groupRows, resolveGroupTarget } from '../src/group/contracts.ts';
import { workspaceBackAction } from '../src/workspace/workspace-back.ts';

const members = [{ id: 'local-main', name: 'Muse' }, { id: 'sms-internal', name: '短信' }, { id: 'news-internal', name: '新闻' }];
const turn = { id: 'group-one', rootId: 'group-one', sourceSpaceId: null, targetSpaceId: 'local-main', discussionId: '00000000-0000-4000-8000-000000000000', createdAt: '2026-11-02T00:00:00.000Z', finishedAt: '2026-11-02T00:00:02.000Z', status: 'completed', messages: [{ id: 'group-one', role: 'user', content: 'hello' }, { id: 'reply-group-one', role: 'assistant', content: 'hello back' }] };

test('群聊不艾特时不发送目标，显式艾特只发送一个成员，未知目标不回退 main', () => {
  assert.deepEqual(resolveGroupTarget('hello', members), { content: 'hello' });
  assert.deepEqual(resolveGroupTarget('hello', members, 'sms-internal'), { content: 'hello', targetSpaceId: 'sms-internal' });
  assert.deepEqual(resolveGroupTarget('@短信 查一下', members), { content: '查一下', targetSpaceId: 'sms-internal' });
  assert.deepEqual(resolveGroupTarget('@news-internal news please', members), { content: 'news please', targetSpaceId: 'news-internal' });
  assert.throws(() => resolveGroupTarget('@不存在 hello', members));
});
test('群聊读取与流事件校验真实归属，重复身份和非法状态拒绝', () => {
  const snapshot = { id: 'main', defaultSpaceId: 'local-main', running: null, turns: [turn] };
  assert.deepEqual(parseGroup(snapshot), snapshot);
  assert.throws(() => parseGroup({ ...snapshot, turns: [turn, turn] }));
  assert.throws(() => parseGroup({ ...snapshot, turns: [{ ...turn, targetSpaceId: '../escape' }] }));
  assert.throws(() => parseGroup({ ...snapshot, turns: [{ ...turn, status: 'success' }] }));
  assert.deepEqual(parseGroupEvent({ type: 'delta', id: 'group-one', text: 'hello' }), { type: 'delta', id: 'group-one', text: 'hello' });
  assert.throws(() => parseGroupEvent({ type: 'guessed-speaker', text: '@短信' }));
});
test('群聊按真实发送/回复时序排列，成员请求与回复使用不同发送者，不从正文猜头像', () => {
  const nested = { ...turn, id: 'child-one', rootId: turn.id, sourceSpaceId: 'local-main', targetSpaceId: 'sms-internal', createdAt: '2026-11-02T00:00:00.500Z', finishedAt: '2026-11-02T00:00:01.000Z', messages: [{ id: 'child-one', role: 'user', content: '查一下' }, { id: 'reply-child-one', role: 'assistant', content: '@新闻 取件码1234' }] };
  const rows = groupRows([turn, nested]);
  assert.deepEqual(rows.map((row) => row.sender), [null, 'local-main', 'sms-internal', 'local-main']);
  assert.deepEqual(rows.map((row) => row.message.text), ['hello', '查一下', '@新闻 取件码1234', 'hello back']);
});
test('停止和失败贴在原回复位置，无正文也保留成员身份；后续成功不重复旧状态', () => {
  const stopped = { ...turn, id: 'stopped', status: 'cancelled', messages: [turn.messages[0]] };
  const failed = { ...turn, id: 'failed', targetSpaceId: 'sms-internal', status: 'failed', createdAt: '2026-11-02T00:01:00.000Z', finishedAt: '2026-11-02T00:01:02.000Z' };
  const later = { ...turn, id: 'later', createdAt: '2026-11-02T00:02:00.000Z', finishedAt: '2026-11-02T00:02:02.000Z' };
  const rows = groupRows([later, stopped, failed]);
  assert.deepEqual(rows.map((row) => row.key), ['stopped', 'reply-stopped', 'failed', 'reply-failed', 'later', 'reply-later']);
  assert.equal(rows[1].sender, 'local-main');
  assert.equal(rows[1].message.text, '');
  assert.equal(rows[1].status, 'cancelled');
  assert.equal(rows[3].sender, 'sms-internal');
  assert.equal(rows[3].message.text, 'hello back');
  assert.equal(rows[3].status, 'failed');
  assert.equal(rows[5].status, undefined);
  assert.equal(groupRows([{ ...stopped, status: 'running', messages: [] }]).length, 0);
});
test('群聊布局与私聊分离：顶栏不悬浮，收件人与紧凑工具跟随消息', () => {
  const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const root = read('workspace/WorkspaceScreen.tsx');
  assert.match(root, /page === 'group' && <View style={styles.groupHeader}>/);
  assert.match(root, /page === 'chat' && <View pointerEvents="box-none" style={\[styles.chatHeader/);
  const group = read('group/GroupChat.tsx');
  assert.doesNotMatch(group, /compactHeader|chatContentTop|combined.filter\(\(turn\) => turn.status/);
  assert.match(group, /<Message message={row.message} layout="group" recipient=/);
  assert.match(group, /row.status === 'cancelled'/);
  assert.match(read('workspace/ConversationView.tsx'), /compact={layout === 'group'}/);
  assert.match(read('workspace/ToolResultCard.tsx'), /const collapsible = compact \|\| generic/);
});
test('群信息返回群聊，群聊返回列表；群所有者持续挂载，私聊设置保持独立', () => {
  const state = { keyboardVisible: false, sessionMounted: false, settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction({ ...state, page: 'group-info' }), 'group');
  assert.equal(workspaceBackAction({ ...state, page: 'group' }), 'inbox');
  const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const root = read('workspace/WorkspaceScreen.tsx');
  assert.match(root, /useState<WorkspacePage>\('group'\)/);
  assert.match(root, /<GroupChat visible={page === 'group'}/);
  assert.match(root, /label="打开群组信息"/);
  assert.match(root, /openProfile\(spaces.currentSpace, 'settings'\)/);
  assert.match(root, /本成员的私聊历史、群聊讨论与显示记录/);
  assert.match(read('workspace/ResetSessionDialog.tsx'), /本成员的私聊历史、群聊讨论与显示记录/);
  const ui = read('group/GroupChat.tsx');
  assert.doesNotMatch(ui, /getConversation|subscribeRuntime/);
  assert.match(ui, /resolveGroupTarget\(draft, members, target\)/);
});
