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
test('头像单击仅切换、选中无操作，长按及无障碍动作直接进入设置', () => {
  const strip = read('workspace/AgentAvatarStrip.tsx');
  assert.match(strip, /accessibilityRole="tab".*accessibilityState={{ selected: active, disabled }}/);
  assert.match(strip, /onPress={\(event\) => { if \(!heldForSettings\(event.nativeEvent.timestamp\) && !active\) onSelect\(id\); }}/);
  assert.match(strip, /onLongPress={\(\) => { settingsPress.current = true; }}/);
  assert.match(strip, /onPressOut={[\s\S]*requestAnimationFrame\(\(\) => onSettings\(id\)\)/);
  assert.match(strip, /delayLongPress={SETTINGS_HOLD_MS}/);
  assert.match(strip, /pressedAt.current = event.nativeEvent.timestamp/);
  assert.match(strip, /const heldForSettings = \(timestamp: number\) => settingsPress.current \|\| timestamp - pressedAt.current >= SETTINGS_HOLD_MS/);
  assert.match(strip, /settingsPress.current = heldForSettings\(event.nativeEvent.timestamp\)/);
  assert.match(strip, /accessibilityActions=.*name: 'settings'/);
  assert.match(strip, /actionName === 'settings'\) onSettings\(id\)/);
  assert.match(strip, /scroll.current\?\.scrollTo/);
  assert.doesNotMatch(strip, /onProfile|action\??:/);
  const root = read('workspace/WorkspaceScreen.tsx');
  assert.match(root, /onSettings={\(id\) => id === 'group' \? openGlobalSettings\(\) : openAgentSettings\(id\)}/);
  assert.doesNotMatch(root, /MemberDirectory|inbox|group-info|GroupInfo|openProfile|Ellipsis|workspace-open-agent-settings/);
});
test('全部保留独立讨论路由，设置不再经过成员页', () => {
  const root = read('workspace/WorkspaceScreen.tsx');
  assert.match(root, /id === 'group' \? '全部' : labels.title\(id\)/);
  assert.match(root, /<AgentHeader title="全局设置" backLabel="返回聊天"/);
  assert.match(root, /title="智能体管理" label="打开智能体管理"/);
  const group = read('group/GroupChat.tsx');
  assert.match(group, /accessibilityLabel={notification \? '通知讨论输入框' : '全部消息输入框'}/);
  assert.match(group, /resolveGroupTarget\(draft, members, target\)/);
  assert.match(group, /onAgentSettings/);
});
test('只在明确横扫后接管消息区；横向内容屏蔽起手、多指与取消不切换', () => {
  for (const file of ['workspace/ConversationView.tsx', 'group/GroupChat.tsx']) {
    assert.match(read(file), /<ChatSwipeArea onSwipe={(?:notification \? undefined : )?onSwipe}><ScrollView/);
    assert.match(read(file), /<\/ScrollView><\/ChatSwipeArea>/);
  }
  const area = read('ui/ChatSwipeArea.tsx');
  assert.match(area, /onMoveShouldSetResponderCapture=/);
  assert.match(area, /return direction\(event\) !== undefined/);
  assert.match(area, /onTouchStartCapture={clear}/);
  assert.match(area, /onResponderTerminate={clear}/);
  assert.match(area, /onResponderRelease=/);
  assert.match(area, /touches.length !== 1/);
  assert.match(read('workspace/NewsPage.tsx'), /<ChatSwipeArea onSwipe={onSwipe}><ScrollView/);
  assert.match(read('news/NewsArticleActions.tsx'), /onTouchStart={\(event\) => event.stopPropagation\(\)}/);
  assert.equal((read('ui/MarkdownContent.tsx').match(/horizontal onTouchStart={\(event\) => event.stopPropagation\(\)}/g) ?? []).length, 2);
});
test('系统返回以全部为根，全局设置返回原聊天，子页优先于切换', () => {
  const state = { keyboardVisible: false, sessionMounted: false, settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction({ ...state, page: 'group' }), 'none');
  assert.equal(workspaceBackAction({ ...state, page: 'chat' }), 'group');
  assert.equal(workspaceBackAction({ ...state, page: 'settings' }), 'chat-return');
  assert.equal(workspaceBackAction({ ...state, page: 'settings', settingsSubpage: 'memory' }), 'settings');
  assert.equal(workspaceBackAction({ ...state, page: 'agent' }), 'agent');
});
