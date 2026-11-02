import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMembers } from '../src/api/space-contracts.ts';
import { SpaceLabels, isBuiltinMember } from '../src/workspace/space-labels.ts';
import { workspaceBackAction } from '../src/workspace/workspace-back.ts';

test('成员目录保留空 session，拒绝重复或非法类型，不伪造聊天绑定', () => {
  const member = { id: 'sms-internal', sessionId: null, updatedAt: new Date(0).toISOString(), kind: 'feature', name: '短信' };
  assert.deepEqual(parseMembers({ members: [member] }), [member]);
  for (const members of [[member, member], [{ ...member, kind: 'contact' }], [{ ...member, sessionId: '' }]]) {
    assert.throws(() => parseMembers({ members }));
  }
});

test('内置成员有自己的身份，不占用普通成员编号', () => {
  const entries = ['local-main', 'news-internal', 'sms-internal', 'research'].map((id) => ({ id, sessionId: null, updatedAt: new Date(0).toISOString() }));
  const labels = new SpaceLabels().sync(entries);
  assert.equal(labels.title('news-internal'), '新闻');
  assert.equal(labels.title('sms-internal'), '短信');
  assert.equal(labels.title('research'), '成员 1');
  assert.equal(isBuiltinMember('sms-internal'), true);
  assert.equal(isBuiltinMember('sms-internal-extra'), false);
});

test('私聊返回消息列表，功能设置返回成员层，覆盖层优先', () => {
  const state = { page: 'chat', keyboardVisible: false, sessionMounted: false, settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction(state), 'inbox');
  assert.equal(workspaceBackAction({ ...state, page: 'feature' }), 'feature');
  assert.equal(workspaceBackAction({ ...state, page: 'space' }), 'space');
  assert.equal(workspaceBackAction({ ...state, page: 'feature', sessionMounted: true }), 'session');
});
