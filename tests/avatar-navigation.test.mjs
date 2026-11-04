import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { avatarTargets, adjacentAvatar, swipeDirection } from '../src/workspace/avatar-navigation.ts';
import { workspaceBackAction } from '../src/workspace/workspace-back.ts';
const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');

test('头像固定群聊优先、内置顺序、自定义按 ID，不受活跃排序影响且去重', () => {
  const ids = ['z', 'sms-internal', 'local-main', 'a', 'news-internal', 'a'];
  const expected = ['group', 'local-main', 'news-internal', 'sms-internal', 'a', 'z'];
  assert.deepEqual(avatarTargets(ids), expected);
  assert.deepEqual(avatarTargets([...ids].reverse()), expected);
  assert.deepEqual(avatarTargets([]), ['group']);
});
test('左右只切邻居，不循环，已删除目标不猜方向', () => {
  const targets = avatarTargets(['local-main', 'sms-internal']);
  assert.equal(adjacentAvatar(targets, 'group', 1), 'local-main');
  assert.equal(adjacentAvatar(targets, 'local-main', -1), 'group');
  assert.equal(adjacentAvatar(targets, 'sms-internal', 1), undefined);
  assert.equal(adjacentAvatar(targets, 'group', -1), undefined);
  assert.equal(adjacentAvatar(targets, 'deleted', 1), undefined);
});
test('只有快速明显横扫才切换，点击、短滑、纵向、慢选字不切换', () => {
  assert.equal(swipeDirection(-120, 10, 200), 1);
  assert.equal(swipeDirection(120, -15, 200), -1);
  for (const args of [[0, 0, 100], [71, 0, 200], [100, 90, 200], [120, 0, 600], [120, 0, -1]]) {
    assert.equal(swipeDirection(...args), undefined);
  }
});
test('头像具备选中语义、资料入口和自动滚入视口，群/私聊右侧操作分离', () => {
  const strip = read('workspace/AgentAvatarStrip.tsx');
  assert.match(strip, /accessibilityRole="tab".*accessibilityState={{ selected: active, disabled }}/);
  assert.match(strip, /active \? onProfile\(id\) : onSelect\(id\)/);
  assert.match(strip, /onLongPress={\(\) => onProfile\(id\)}/);
  assert.match(strip, /scroll.current\?\.scrollTo/);
  const root = read('workspace/WorkspaceScreen.tsx');
  assert.match(root, /page === 'group' \? <IconControl icon={Ellipsis}/);
  assert.match(root, /openProfile\(agents.currentAgent, 'settings'\)/);
  assert.doesNotMatch(root, /MemberDirectory|inbox|groupPreview/);
});
test('只给消息区加手势，不接管 responder；横向内容屏蔽起手、多指与取消不切换', () => {
  for (const file of ['workspace/ConversationView.tsx', 'group/GroupChat.tsx']) {
    assert.match(read(file), /<ChatSwipeArea onSwipe={onSwipe}><ScrollView/);
    assert.match(read(file), /<\/ScrollView><\/ChatSwipeArea>/);
  }
  const area = read('ui/ChatSwipeArea.tsx');
  assert.doesNotMatch(area, /PanResponder|onMoveShouldSetResponder/);
  assert.match(area, /onTouchStartCapture={\(\) => { start.current = null; }}/);
  assert.match(area, /onTouchCancel={\(\) => { start.current = null; }}/);
  assert.match(area, /touches.length !== 1/);
  assert.equal((read('ui/MarkdownContent.tsx').match(/horizontal onTouchStart={\(event\) => event.stopPropagation\(\)}/g) ?? []).length, 2);
});
test('系统返回以群聊为根，全局设置先返回群信息，子页优先于切换', () => {
  const state = { keyboardVisible: false, sessionMounted: false, settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction({ ...state, page: 'group' }), 'none');
  assert.equal(workspaceBackAction({ ...state, page: 'chat' }), 'group');
  assert.equal(workspaceBackAction({ ...state, page: 'settings' }), 'group-info');
  assert.equal(workspaceBackAction({ ...state, page: 'settings', settingsSubpage: 'memory' }), 'settings');
  assert.equal(workspaceBackAction({ ...state, page: 'agent' }), 'agent');
});
