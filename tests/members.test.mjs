import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgents } from '../src/api/agent-contracts.ts';
import { AgentLabels, isBuiltinMember } from '../src/workspace/agent-labels.ts';
import { workspaceBackAction } from '../src/workspace/workspace-back.ts';
import { createMember } from '../src/agents/create-member.ts';

test('创建真实成员后返回服务端绑定，不依赖第一条聊天', async () => {
  const member = { id: 'side-created', sessionId: 'session-created', updatedAt: new Date(0).toISOString() };
  const calls = [];
  const api = { createAgent: async (id) => { calls.push(id); return member; }, listAgents: async () => { throw new Error('Unexpected readback'); } };
  assert.deepEqual(await createMember(api, member.id, new AbortController().signal), member);
  assert.deepEqual(calls, [member.id]);
});

test('创建响应丢失只回读原成员，目录未确认时不伪造成功、不自动重发', async () => {
  const member = { id: 'side-created', sessionId: 'session-created', updatedAt: new Date(0).toISOString(), extensions: [] };
  const error = new Error('Response lost'); let writes = 0; let reads = 0;
  const api = { createAgent: async () => { writes++; throw error; }, listAgents: async () => { reads++; return [member]; } };
  assert.equal((await createMember(api, member.id, new AbortController().signal)).id, member.id);
  assert.equal(writes, 1); assert.equal(reads, 1);
  api.listAgents = async () => [];
  await assert.rejects(createMember(api, member.id, new AbortController().signal), (e) => e === error);
  assert.equal(writes, 2);
  api.listAgents = async () => { throw new Error('Read unavailable'); };
  await assert.rejects(createMember(api, member.id, new AbortController().signal), (e) => e === error);
  assert.equal(writes, 3);
});

test('取消创建不回读或修改其他连接', async () => {
  const controller = new AbortController(); let reads = 0;
  const api = { createAgent: async () => { controller.abort(); throw new Error('Cancelled'); }, listAgents: async () => { reads++; return []; } };
  await assert.rejects(createMember(api, 'side-cancelled', controller.signal));
  assert.equal(reads, 0);
});

test('全部智能体共用目录契约，专属扩展不影响真实会话绑定', () => {
  const member = { id: 'sms-internal', sessionId: 'sms-session', updatedAt: new Date(0).toISOString(), extensions: ['sms'], name: '短信' };
  assert.deepEqual(parseAgents({ agents: [member] }), [member]);
  for (const agents of [[member, member], [{ ...member, extensions: ['unknown'] }], [{ ...member, sessionId: null }]]) {
    assert.throws(() => parseAgents({ agents }));
  }
});

test('内置成员有自己的身份，不占用普通成员编号', () => {
  const entries = ['local-main', 'news-internal', 'sms-internal', 'research'].map((id) => ({ id, sessionId: null, updatedAt: new Date(0).toISOString() }));
  const labels = new AgentLabels().sync(entries);
  assert.equal(labels.title('news-internal'), '新闻');
  assert.equal(labels.title('sms-internal'), '短信');
  assert.equal(labels.title('research'), '成员 1');
  assert.equal(isBuiltinMember('sms-internal'), true);
  assert.equal(isBuiltinMember('sms-internal-extra'), false);
});

test('私聊返回群聊，功能设置返回成员层，覆盖层优先', () => {
  const state = { page: 'chat', keyboardVisible: false, sessionMounted: false, settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction(state), 'group');
  assert.equal(workspaceBackAction({ ...state, page: 'feature' }), 'feature');
  assert.equal(workspaceBackAction({ ...state, page: 'agent' }), 'agent');
  assert.equal(workspaceBackAction({ ...state, page: 'feature', sessionMounted: true }), 'session');
});


test('群聊是返回根层，阅读器保留独立返回来源，子页先退一层', () => {
  const state = { page: 'group', keyboardVisible: false, sessionMounted: false, settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction(state), 'none');
  assert.equal(workspaceBackAction({ ...state, page: 'news' }), 'group');
  assert.equal(workspaceBackAction({ ...state, page: 'news', newsManaging: true }), 'news-sources');
  assert.equal(workspaceBackAction({ ...state, page: 'news', newsManaging: true, newsArticleOpen: true }), 'news-article');
  assert.equal(workspaceBackAction({ ...state, page: 'news', newsArticleOpen: true, sessionMounted: true }), 'session');
});
