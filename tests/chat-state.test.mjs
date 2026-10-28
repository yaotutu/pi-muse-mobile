import assert from 'node:assert/strict';
import test from 'node:test';
import { projectHistory, StreamAggregator } from '../src/chat/chat-state.ts';

// 只重放协议事件，不加载 UI、网络或原生模块，确保回归结果不依赖运行环境。
const aggregate = (events) => events.reduce((state, event) => {
  state.push(event);
  return state;
}, new StreamAggregator([]));

const start = (messageId) => ({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
const content = (messageId, delta) => ({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta });
const tool = (parentMessageId, toolCallId) => ({
  type: 'TOOL_CALL_START', parentMessageId, toolCallId, toolCallName: 'lookup',
});
const snapshot = (messages) => ({ type: 'MESSAGES_SNAPSHOT', messages });
const feedback = { reaction: null, comments: [] };
const metadata = (feedbackAvailable = true) => ({
  createdAt: '2026-10-28T00:00:00.000Z', source: 'chat', runId: null, jobId: null,
  notificationId: null, feedbackAvailable,
});
const user = (id, content) => ({ id, role: 'user', content, metadata: metadata(), feedback });
const assistant = (id, content) => ({ id, role: 'assistant', content, metadata: metadata(), feedback });

test('文本增量和结束事件按 messageId 路由，不误写当前消息', () => {
  const state = aggregate([
    start('first'), start('second'),
    content('first', '第一段'), content('second', '第二段'), content('first', '继续'),
    { type: 'TEXT_MESSAGE_END', messageId: 'first' },
  ]);
  assert.deepEqual(state.messages.map(({ id, text, streaming }) => ({ id, text, streaming })), [
    { id: 'first', text: '第一段继续', streaming: false },
    { id: 'second', text: '第二段', streaming: true },
  ]);
});

test('未知或指向 user 的显式 messageId 不得回退到 current', () => {
  const state = aggregate([
    snapshot([user('user', '问题')]), start('active'),
    content('missing', '忽略'), content('user', '不可写入'),
    { type: 'TEXT_MESSAGE_END', messageId: 'missing' },
  ]);
  assert.equal(state.messages[0].text, '问题');
  assert.equal(state.messages[1].text, '');
  assert.equal(state.messages[1].streaming, true);
});

test('兼容无 ID 的内容和结束事件，仍更新当前文本段', () => {
  const state = aggregate([
    start('active'), { type: 'TEXT_MESSAGE_CONTENT', delta: '内容' },
    { type: 'TEXT_MESSAGE_END' },
  ]);
  assert.equal(state.messages[0].text, '内容');
  assert.equal(state.messages[0].streaming, false);
});

test('工具按 parentMessageId 复用已有宿主或新建宿主，不误挂 current', () => {
  const state = aggregate([
    start('first'), start('second'), tool('first', 'call-first'), tool('third', 'call-third'),
  ]);
  assert.deepEqual(state.messages.map(({ id, toolCalls }) => [id, toolCalls.map((call) => call.id)]), [
    ['first', ['call-first']], ['second', []], ['third', ['call-third']],
  ]);
});

test('纯工具轮先创建宿主，同 ID 的文本开始不得重复消息或丢失工具', () => {
  const state = aggregate([
    tool('active', 'call'), start('active'), content('active', '工具后的回复'),
  ]);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].text, '工具后的回复');
  assert.equal(state.messages[0].toolCalls[0].id, 'call');
});

test('可缺省或为 null 的 parentMessageId 沿用当前宿主', () => {
  // 服务端 schema 允许 null；客户端运行期须与缺省字段同样处理，不能创建错误宿主。
  const state = aggregate([start('active'), tool(undefined, 'one'), tool(null, 'two')]);
  assert.equal(state.messages.length, 1);
  assert.deepEqual(state.messages[0].toolCalls.map((call) => call.id), ['one', 'two']);
});

test('工具参数分片及迟到结果按 toolCallId 回填，空参数保持 {}', () => {
  const state = aggregate([
    tool('first', 'one'), tool('second', 'two'),
    { type: 'TOOL_CALL_ARGS', toolCallId: 'one', delta: '{"query":' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'one', delta: '"天气"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'two' },
    { type: 'TOOL_CALL_END', toolCallId: 'one' },
    { type: 'TOOL_CALL_RESULT', toolCallId: 'one', content: '晴天' },
  ]);
  assert.deepEqual(state.messages[0].toolCalls, [
    { id: 'one', name: 'lookup', args: '{"query":"天气"}', result: '晴天' },
  ]);
  assert.equal(state.messages[1].toolCalls[0].args, '{}');
});

test('快照权威替换后重新绑定 current，后续增量与工具仍可见', () => {
  const state = aggregate([start('active'), content('active', '旧内容')]);
  const oldView = state.messages[0];
  const messages = state.messages;
  state.push(snapshot([assistant('active', '快照内容')]));
  state.push(content('active', '显式增量'));
  state.push({ type: 'TEXT_MESSAGE_CONTENT', delta: '兼容增量' });
  state.push(tool(undefined, 'call'));
  assert.equal(state.messages, messages);
  assert.notEqual(state.messages[0], oldView);
  assert.equal(oldView.text, '旧内容');
  assert.equal(state.messages[0].text, '快照内容显式增量兼容增量');
  assert.equal(state.messages[0].streaming, true);
  assert.equal(state.messages[0].toolCalls[0].id, 'call');
});

test('快照不包含旧 current 时清空指针，后续按显式 ID 路由到新视图', () => {
  const state = aggregate([
    start('old'), snapshot([assistant('new', '新历史')]),
    { type: 'TEXT_MESSAGE_CONTENT', delta: '不可误写' },
    content('new', '后续'), tool('new', 'call'),
  ]);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].text, '新历史后续');
  assert.equal(state.messages[0].toolCalls[0].id, 'call');
  state.push(snapshot([]));
  state.push(content('new', '不可复活'));
  assert.deepEqual(state.messages, []);
});

test('快照保留未完成调用的参数缓冲，已有完整参数不被无增量 END 覆盖', () => {
  const calls = [
    { id: 'pending', type: 'function', function: { name: 'lookup', arguments: '' } },
    { id: 'complete', type: 'function', function: { name: 'lookup', arguments: '{"ready":true}' } },
  ];
  const state = aggregate([
    tool('active', 'pending'),
    { type: 'TOOL_CALL_ARGS', toolCallId: 'pending', delta: '{"query":' },
    snapshot([{ ...assistant('active', ''), toolCalls: calls }]),
    { type: 'TOOL_CALL_ARGS', toolCallId: 'pending', delta: '"天气"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'pending' },
    { type: 'TOOL_CALL_END', toolCallId: 'complete' },
    { type: 'TOOL_CALL_RESULT', toolCallId: 'complete', content: '成功' },
  ]);
  assert.equal(state.messages[0].toolCalls[0].args, '{"query":"天气"}');
  assert.equal(state.messages[0].toolCalls[1].args, '{"ready":true}');
  assert.equal(state.messages[0].toolCalls[1].result, '成功');
  assert.equal(calls[1].function.arguments, '{"ready":true}');
});

test('RUN_ERROR 暴露受控错误并结束所有 streaming，保留已有回复和工具', () => {
  const state = aggregate([
    start('first'), content('first', '部分回复'), tool('second', 'call'),
    { type: 'RUN_ERROR', code: 'BUSY', message: '会话正在运行，请稍后再试' },
  ]);
  assert.equal(state.error, '会话正在运行，请稍后再试');
  assert.ok(state.messages.every((message) => message.streaming === false));
  assert.equal(state.messages[0].text, '部分回复');
  assert.equal(state.messages[1].toolCalls[0].id, 'call');
  assert.equal(aggregate([{ type: 'RUN_ERROR', code: 'BUSY' }]).error, 'BUSY');
  assert.equal(aggregate([{ type: 'RUN_ERROR' }]).error, '运行失败');
});

test('历史允许无正文的纯工具消息，空正文不影响按调用 ID 关联', () => {
  const assistantTools = assistant('assistant-tools', '');
  delete assistantTools.content;
  const history = [
    { ...assistantTools, toolCalls: [
      { id: 'lookup-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
    ] },
    { id: 'tool-result', role: 'tool', toolCallId: 'lookup-1' },
  ];
  const views = projectHistory(history);
  assert.deepEqual(views, [{
    id: 'assistant-tools', role: 'assistant', text: '',
    toolCalls: [{ id: 'lookup-1', name: 'lookup', args: '{}', result: '' }],
    feedbackAvailable: true, feedback,
  }]);
  assert.equal('content' in history[0], false);
  assert.equal('content' in history[1], false);
});

test('历史投影按调用 ID 回填结果且不修改输入，settle 可重复收尾', () => {
  const history = [
    user('user', '问题'),
    { ...assistant('active', '回答'), toolCalls: [
      { id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } },
    ] },
    { id: 'tool-call', role: 'tool', toolCallId: 'call', content: '结果' },
  ];
  const before = structuredClone(history);
  const views = projectHistory(history);
  assert.equal(views.length, 2);
  assert.equal(views[1].toolCalls[0].result, '结果');
  assert.deepEqual(history, before);
  const state = new StreamAggregator(views);
  assert.equal(state.error, undefined);
  state.settle();
  state.settle();
  assert.ok(state.messages.every((message) => message.streaming === false));
});
