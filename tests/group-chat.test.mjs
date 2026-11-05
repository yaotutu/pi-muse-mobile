import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGroup, parseGroupEvent, groupRows, resolveGroupTarget, discussionTurns, notificationKey } from '../src/group/contracts.ts';
import { workspaceBackAction } from '../src/workspace/workspace-back.ts';

const members = [{ id: 'local-main', name: 'Muse' }, { id: 'sms-internal', name: '短信' }, { id: 'news-internal', name: '新闻' }];
const turn = { id: 'group-one', rootId: 'group-one', sourceAgentId: null, targetAgentId: 'local-main', discussionId: '00000000-0000-4000-8000-000000000000', createdAt: '2026-11-02T00:00:00.000Z', finishedAt: '2026-11-02T00:00:02.000Z', status: 'completed', messages: [{ id: 'group-one', role: 'user', content: 'hello' }, { id: 'reply-group-one', role: 'assistant', content: 'hello back' }] };

test('群聊不艾特时不发送目标，显式艾特只发送一个成员，未知目标不回退 main', () => {
  assert.deepEqual(resolveGroupTarget('hello', members), { content: 'hello' });
  assert.deepEqual(resolveGroupTarget('hello', members, 'sms-internal'), { content: 'hello', targetAgentId: 'sms-internal' });
  assert.deepEqual(resolveGroupTarget('@短信 查一下', members), { content: '查一下', targetAgentId: 'sms-internal' });
  assert.deepEqual(resolveGroupTarget('@news-internal news please', members), { content: 'news please', targetAgentId: 'news-internal' });
  assert.throws(() => resolveGroupTarget('@不存在 hello', members));
});
test('群聊读取与流事件校验真实归属，重复身份和非法状态拒绝', () => {
  const snapshot = { id: 'main', defaultAgentId: 'local-main', memberIds: ['local-main', 'sms-internal', 'news-internal'], running: null, turns: [turn], notifications: [] };
  assert.deepEqual(parseGroup(snapshot), snapshot);
  assert.throws(() => parseGroup({ ...snapshot, turns: [turn, turn] }));
  assert.throws(() => parseGroup({ ...snapshot, turns: [{ ...turn, targetAgentId: '../escape' }] }));
  assert.throws(() => parseGroup({ ...snapshot, turns: [{ ...turn, status: 'success' }] }));
  assert.deepEqual(parseGroupEvent({ type: 'delta', id: 'group-one', text: 'hello' }), { type: 'delta', id: 'group-one', text: 'hello' });
  assert.throws(() => parseGroupEvent({ type: 'guessed-speaker', text: '@短信' }));
});
const notification = { id: 'notice-one', featureId: 'sms', targetAgentId: 'local-main', sessionId: 'private-session', messageId: 'private-notice', createdAt: '2026-11-02T00:00:01.000Z', content: '明天出行请提前准备' };
test('功能通知必须有真实来源、归属、时间，旧快照、重复身份和非法归属不能默默接受', () => {
  const snapshot = { id: 'main', defaultAgentId: 'local-main', memberIds: ['local-main', 'sms-internal', 'news-internal'], running: null, turns: [], notifications: [notification] };
  assert.deepEqual(parseGroup(snapshot), snapshot);
  for (const item of [{ ...notification, featureId: 'guessed' }, { ...notification, featureId: ['sms'] }, { ...notification, targetAgentId: '../escape' }, { ...notification, sessionId: '' }, { ...notification, createdAt: 'unknown' }, { ...notification, messageId: null }]) {
    assert.throws(() => parseGroup({ ...snapshot, notifications: [item] }));
  }
  assert.throws(() => parseGroup({ ...snapshot, notifications: undefined }));
  assert.throws(() => parseGroup({ ...snapshot, notifications: [notification, notification] }));
  const other = { ...notification, targetAgentId: 'other' };
  assert.equal(parseGroup({ ...snapshot, notifications: [notification, other] }).notifications.length, 2);
});
test('通知按投递时间合入时间线，头像来自功能而非承接方；只读展示不伪造定向或反馈', () => {
  const before = JSON.stringify(notification);
  const rows = groupRows([turn], [notification]);
  assert.deepEqual(rows.map((row) => row.at), [turn.createdAt, notification.createdAt, turn.finishedAt]);
  const row = rows[1];
  assert.equal(row.sender, 'sms-internal'); assert.equal(row.target, undefined);
  assert.equal(row.notification.targetAgentId, 'local-main');
  assert.equal(row.message.feedbackAvailable, false); assert.deepEqual(row.message.toolCalls, []);
  assert.equal(JSON.stringify(notification), before);
  assert.equal(new Set(groupRows([], [notification, { ...notification, targetAgentId: 'other' }]).map((item) => item.key)).size, 2);
});
test('功能通知同步共用 Runtime，隐藏时仍读快照；继续处理显式打开来源讨论', () => {
  const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const ui = read('group/GroupChat.tsx');
  assert.match(ui, /useSyncExternalStore\(runtimeStore.subscribe/);
  assert.match(ui, /\[visible, scope, runtime.conversationSyncVersion, notificationVersion, reload\]/);
  assert.match(ui, /if \(!request.current\) void reload\(\)/);
  assert.match(ui, /onOpenNotification\(row.notification!\)/);
  assert.doesNotMatch(ui, /subscribeRuntime\(|setInterval\(/);
  assert.match(read('workspace/WorkspaceScreen.tsx'), /onOpenNotification={openNotification}/);
});
test('群聊按真实发送/回复时序排列，成员请求与回复使用不同发送者，不从正文猜头像', () => {
  const nested = { ...turn, id: 'child-one', rootId: turn.id, sourceAgentId: 'local-main', targetAgentId: 'sms-internal', createdAt: '2026-11-02T00:00:00.500Z', finishedAt: '2026-11-02T00:00:01.000Z', messages: [{ id: 'child-one', role: 'user', content: '查一下' }, { id: 'reply-child-one', role: 'assistant', content: '@新闻 取件码1234' }] };
  const rows = groupRows([turn, nested]);
  assert.deepEqual(rows.map((row) => row.sender), [null, 'local-main', 'sms-internal', 'local-main']);
  assert.deepEqual(rows.map((row) => row.message.text), ['hello', '查一下', '@新闻 取件码1234', 'hello back']);
});
test('停止和失败贴在原回复位置，无正文也保留成员身份；后续成功不重复旧状态', () => {
  const stopped = { ...turn, id: 'stopped', status: 'cancelled', messages: [turn.messages[0]] };
  const failed = { ...turn, id: 'failed', targetAgentId: 'sms-internal', status: 'failed', createdAt: '2026-11-02T00:01:00.000Z', finishedAt: '2026-11-02T00:01:02.000Z' };
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
  assert.match(root, /<AgentAvatarStrip targets={targets}/);
  assert.doesNotMatch(root, /chatHeader:/);
  const group = read('group/GroupChat.tsx');
  assert.doesNotMatch(group, /compactHeader|chatContentTop|combined.filter\(\(turn\) => turn.status/);
  assert.match(group, /<Message message={row.message} layout="group" recipient=/);
  assert.match(group, /row.status === 'cancelled'/);
  assert.match(read('workspace/ConversationView.tsx'), /layout === 'group'\s*\? <ToolCallSummary tools={message.toolCalls}/);
  assert.match(read('workspace/ToolResultCard.tsx'), /const collapsible = !embedded && generic/);
});
test('群信息返回群聊，群聊为根层；群所有者持续挂载，私聊设置保持独立', () => {
  const state = { keyboardVisible: false, sessionMounted: false, settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction({ ...state, page: 'settings' }), 'chat-return');
  assert.equal(workspaceBackAction({ ...state, page: 'group' }), 'none');
  const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const root = read('workspace/WorkspaceScreen.tsx');
  assert.match(root, /useState<WorkspacePage>\('group'\)/);
  assert.match(root, /<GroupChat visible={page === 'group' \|\| page === 'discussion'}/);
  assert.match(root, /const openGlobalSettings =/);
  assert.match(root, /onAgentSettings={openAgentSettings}/);
  assert.match(root, /私聊历史、「全部」中的讨论与显示记录/);
  assert.match(read('workspace/ResetSessionDialog.tsx'), /本成员的私聊历史、在「全部」中的讨论与显示记录/);
  const ui = read('group/GroupChat.tsx');
  assert.doesNotMatch(ui, /getConversation|subscribeRuntime/);
  assert.match(ui, /resolveGroupTarget\(draft, availableMembers, target\)/);
});
test('定向成员与正文共用原生 Text 流，无底色；蓝气泡保留白字，浅色气泡才用强调色', () => {
  const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const view = read('workspace/ConversationView.tsx');
  assert.match(view, /const mention = recipient \? <Text style={\[styles.recipient, message.role === 'user' && styles.userRecipient\]}>\{recipient\}/);
  assert.match(view, />\{mention\}\{mention && ' '\}\{message.text\}<\/Text>/);
  assert.doesNotMatch(view, /!!recipient && <Text|\\u00a0/);
  assert.match(view, /recipient: \{ color: c.accentText, fontWeight: '600' \}/);
  assert.match(view, /userRecipient: \{ color: c.onAccent \}/);
  assert.match(view, /<MessageContent text={message.text} compact={layout === 'group'} inlinePrefix=/);
  assert.match(read('workspace/MessageContent.tsx'), /<MarkdownContent text={cleaned} compact={compact} inlinePrefix={inlinePrefix}/);
});
test('群工具每条回复只用一个可展开摘要，失败和缺失结果不隐藏，私聊保留工具卡', () => {
  const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const summary = read('workspace/ToolCallSummary.tsx');
  assert.match(summary, /summary.failed.*项失败/);
  assert.match(summary, /summary.pending.*项尚无结果/);
  assert.match(summary, /accessibilityState={{ expanded }}/);
  assert.match(summary, /accessibilityValue={{ text: `\$\{summary.total\} 项，\$\{status\}` }}/);
  assert.match(summary, /expanded && <View style={styles.details}>/);
  assert.match(summary, /<ToolResultCard key={tool.id} tool={tool} embedded/);
  assert.match(summary, /minHeight: sizing.touchTarget/);
  assert.match(read('workspace/ConversationView.tsx'), /: message.toolCalls.map\(\(tool\) => <ToolResultCard/);
  const renderer = read('ui/MarkdownContent.tsx');
  assert.match(renderer, /compact = false/);
  assert.match(renderer, /width: compact \? 'auto' : '100%'/);
  assert.match(renderer, /compact \? t.groupMessage : t.message/);
  assert.match(renderer, /horizontalContent: \{[^\n]*flexGrow: 0/);
});
test('成员间 Markdown 请求只在首段内联目标，不改正文、代码复制或普通私聊默认值', () => {
  const markdown = readFileSync(new URL('../src/ui/MarkdownContent.tsx', import.meta.url), 'utf8');
  assert.match(markdown, /inlinePrefix\?: ReactNode/);
  assert.match(markdown, /const prefix = prefixIsInline && part === firstToken \? inlinePrefix : undefined/);
  assert.match(markdown, /style={styles.body}>\{prefix\}\{inline\(part.tokens, value\)\}<\/Text>/);
  assert.match(markdown, /marked.lexer\(text,/);
  assert.match(markdown, /<CodeBlock key={key} code={value}/);
  assert.doesNotMatch(markdown, /text\.replace|inlinePrefix\s*\+/);
});

test('通知讨论按完整来源隔离，普通群消息不含追问；来源字段非法必须报错', () => {
  const ref = { targetAgentId: notification.targetAgentId, sessionId: notification.sessionId, messageId: notification.messageId };
  const followup = { ...turn, id: 'followup', targetAgentId: 'sms-internal', notification: ref };
  const other = { ...followup, id: 'other', notification: { ...ref, messageId: 'other-notice' } };
  const nested = { ...followup, id: 'nested', sourceAgentId: 'sms-internal', targetAgentId: 'news-internal' };
  assert.deepEqual(discussionTurns([turn, followup, other, nested]), [turn]);
  assert.deepEqual(discussionTurns([turn, followup, other, nested], ref), [followup, nested]);
  assert.notEqual(notificationKey(ref), notificationKey(other.notification));
  assert.equal(parseGroupEvent({ type: 'turn', turn: followup }).turn.notification.messageId, ref.messageId);
  for (const invalid of [{ ...ref, sessionId: '' }, { ...ref, targetAgentId: '../x' }, { ...ref, messageId: null }])
    assert.throws(() => parseGroupEvent({ type: 'turn', turn: { ...followup, notification: invalid } }));
});
test('通知页 Back 返回来源，输入直发来源而非解析艾特，草稿按讨论交接', () => {
  assert.equal(workspaceBackAction({ keyboardVisible: false, sessionMounted: false, page: 'discussion', settingsSubpage: null, goalCreating: false }), 'discussion');
  assert.equal(workspaceBackAction({ keyboardVisible: true, sessionMounted: false, page: 'discussion', settingsSubpage: null, goalCreating: false }), 'keyboard');
  const ui = readFileSync(new URL('../src/group/GroupChat.tsx', import.meta.url), 'utf8');
  assert.match(ui, /notification \? \{ content: draft.trim\(\) \} : resolveGroupTarget/);
  assert.match(ui, /new Map<string, GroupComposer>/);
  assert.match(ui, /const composer = composers.get\(scope\)!/);
  assert.match(ui, /for \(const item of composers.values\(\)\) item.reconcile\(next\)/);
  assert.match(ui, /composer.submit\(\{ id, ...input, ...\(notification/);
  assert.match(ui, /notification && !source/);
  assert.match(ui, /notification \? undefined : onSwipe/);
  assert.match(ui, /!notification \|\| !!row.sender/);
  assert.doesNotMatch(ui, /onPrivateChat/);
  const workspace = readFileSync(new URL('../src/workspace/WorkspaceScreen.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /'chat' \| 'group' \| 'news' \| 'discussion'/);
  assert.match(workspace, /else setPage\(chatReturn\)/);
  assert.match(workspace, /focusedAgentId === agents.currentAgent && \(chatReturn === 'chat' \|\| chatReturn === 'news'\)/);
});
