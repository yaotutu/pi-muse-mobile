import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PRIMARY_TABS, isRootWorkspacePage, resolveNotificationReturn, chatReturnForEntry } from '../src/workspace/primary-nav.ts';
import { reconcileConversationOwners, conversationRefreshKey } from '../src/workspace/conversation-host-state.ts';
const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
test('一级固定消息/新闻/设置，冷启动进入会话列表', () => {
  assert.deepEqual(PRIMARY_TABS.map(({ id, label }) => [id, label]), [['messages', '消息'], ['news', '新闻'], ['settings', '设置']]);
  assert.equal(PRIMARY_TABS[0].testID, 'primary-tab-messages');
  assert.match(read('workspace/WorkspaceScreen.tsx'), /useState<PrimaryTabId \| 'chat'>\('messages'\)/);
  assert.match(read('workspace/WorkspaceScreen.tsx'), /<SessionListScreen/);
});
test('仅一级根页显示底栏，所有二级与覆盖层隐藏', () => {
  for (const page of ['messages', 'news']) assert.equal(isRootWorkspacePage({ page }), true);
  assert.equal(isRootWorkspacePage({ page: 'settings', settingsSubpage: null }), true);
  for (const value of [{ page: 'chat' }, { page: 'news', newsDetailOpen: true }, { page: 'news', newsManaging: true }, { page: 'settings', settingsSubpage: 'files' }, { page: 'messages', sessionMounted: true }]) assert.equal(isRootWorkspacePage(value), false);
  assert.match(read('workspace/WorkspaceScreen.tsx'), /!keyboardVisible && root && <PrimaryTabBar/);
});
test('通知回跳精确命中会话，删除后安全返回消息并提示', () => {
  const origin = { type: 'chat', sessionId: 'missing', chatReturn: 'messages' };
  assert.deepEqual(resolveNotificationReturn(origin, ['main', 'missing']), { page: 'chat', sessionId: 'missing', chatReturn: 'messages' });
  const result = resolveNotificationReturn(origin, ['main']); assert.equal(result.page, 'messages'); assert.match(result.errorNotice, /missing.*已被删除/);
  assert.deepEqual(resolveNotificationReturn({ type: 'messages' }, ['main']), { page: 'messages' });
});
test('隐藏保留所有者，删除当前会话也必须释放，不因 currentId 复活', () => {
  const owners = reconcileConversationOwners(['main'], 'topic', ['main', 'topic']);
  assert.deepEqual(owners, ['main', 'topic']); assert.equal(reconcileConversationOwners(owners, 'main', ['main', 'topic']), owners);
  assert.deepEqual(reconcileConversationOwners(owners, 'topic', ['main']), ['main']);
  assert.deepEqual(reconcileConversationOwners([], 'main', []), []);
});
test('底层绑定变化也触发该公开会话的历史回读', () => {
  const runtime = { synchronized: true, conversationSyncVersion: 2, conversationInvalidationVersion: 3, conversationInvalidationPiSessionId: 'new' };
  assert.equal(conversationRefreshKey(1, runtime), '1:2:3'); assert.equal(conversationRefreshKey(1, { ...runtime, synchronized: false }), '1:0:0');
});
test('头像点击切换面板，面板与列表共用目录，新建是文字按钮', () => {
  assert.match(read('workspace/WorkspaceScreen.tsx'), /点击 Pi Muse 形象切换会话/);
  assert.match(read('workspace/WorkspaceScreen.tsx'), /setSwitcher\('switch'\)/);
  assert.match(read('workspace/SessionSwitcherSheet.tsx'), /<SessionRows sessions=\{sessions\}/);
  for (const file of ['workspace/SessionSwitcherSheet.tsx', 'workspace/SessionListScreen.tsx']) { assert.match(read(file), /label="新建会话"/); assert.doesNotMatch(read(file), /\bPlus\b/); }
});

test('新闻讨论聊天返回原文章，普通列表与头像切换不继承新闻来源', () => {
  let page = 'news'; const selectedArticleId = 'article-1';
  let chatReturn = chatReturnForEntry('news'); page = 'chat'; page = chatReturn;
  assert.equal(page, 'news'); assert.equal(selectedArticleId, 'article-1');
  chatReturn = chatReturnForEntry('switch'); assert.equal(chatReturn, 'messages');
  assert.equal(chatReturnForEntry('messages'), 'messages'); assert.equal(chatReturnForEntry('notification'), 'messages');
  const screen = read('workspace/WorkspaceScreen.tsx');
  assert.match(screen, /backLabel=\{chatReturn === 'news' \? '返回文章' : '返回消息'\}/);
  assert.match(screen, /if \(page === 'chat'\) \{ setPage\(chatReturn\)/);
});
test('长会话名保持单行且操作入口使用固定宽度图标，不挤成竖排文字', () => {
  const screen = read('workspace/WorkspaceScreen.tsx');
  const header = read('workspace/PageHeader.tsx');
  assert.match(screen, /action=\{<IconControl icon=\{MoreHorizontal\} label="会话操作"/);
  assert.match(header, /title: \{[^\n]*maxWidth: '100%'/);
  assert.match(header, /<Text numberOfLines=\{1\} accessibilityRole="header"/);
  assert.match(header, /side: \{[^\n]*flexShrink: 0/);
});
test('关闭新闻会话选择或取消新建只关闭弹层，不清掉已选文章', () => {
  const screen = read('workspace/WorkspaceScreen.tsx');
  assert.match(screen, /onClose=\{\(\) => \{ setSwitcher\(null\); setQuote\(undefined\); \}\}/);
  assert.match(screen, /onClose=\{\(\) => \{ if \(!directory.busy\) setEditor\(undefined\); \}\}/);
  const openChatBody = screen.slice(screen.indexOf('const openChat ='), screen.indexOf('const backSettings ='));
  assert.doesNotMatch(openChatBody, /closeArticle|openArticle/);
});
