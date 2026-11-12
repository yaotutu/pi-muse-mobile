import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PRIMARY_TABS, isRootWorkspacePage, notificationContinuationNotice, chatReturnForEntry } from '../src/workspace/primary-nav.ts';
import { conversationRefreshKey } from '../src/workspace/conversation-host-state.ts';
import { appendNewsQuote, newsDiscussionQuote } from '../src/news/discussion.ts';
import { ChatSessionStore } from '../src/sessions/chat-session-store.ts';
import { createAttachmentDrafts } from '../src/attachments/validation.ts';
const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
const screen = read('workspace/WorkspaceScreen.tsx');

// 执行源码中的实际导航回调，不复制其逻辑；这是隔离回调/Store 回归，不是 React 或原生渲染。
function callback(name, context) {
  const ast = ts.createSourceFile('WorkspaceScreen.tsx', screen, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer && ts.isArrowFunction(node.initializer)) expression = node.initializer;
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === name && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) expression = node.initializer.expression;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `missing callback ${name}`);
  return runInNewContext(ts.transpileModule(`(${expression.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText, context);
}
function navigation() {
  const state = { page: 'news', chatReturn: 'messages', settingsPage: null, dismissed: 0 };
  const context = {
    chatReturnForEntry, Keyboard: { dismiss: () => state.dismissed++ },
    setChatReturn: (value) => { state.chatReturn = value; }, setPage: (value) => { state.page = value; }, setSettingsPage: (value) => { state.settingsPage = value; },
  };
  return { state, context, openMain: callback('openMain', context), returnToArticle: callback('returnToArticle', context) };
}

test('一级固定消息/新闻/设置，冷启动直接挂载 main，不依赖目录成功', () => {
  assert.deepEqual(PRIMARY_TABS.map(({ id, label }) => [id, label]), [['messages', '消息'], ['news', '新闻'], ['settings', '设置']]);
  assert.equal(PRIMARY_TABS[0].testID, 'primary-tab-messages');
  assert.match(screen, /useState<PrimaryTabId>\('messages'\)/);
  assert.match(screen, /<ConversationHost chatVisible=\{page === 'messages'\}/);
  const host = read('workspace/ConversationHost.tsx');
  assert.match(host, /return <View style=\{styles.host\}>\s*<SessionConversation sessionId="main" visible=\{chatVisible\}/);
  assert.doesNotMatch(host, /sessionIds|owners\.map|directory|\.loaded/);
  assert.doesNotMatch(screen, /directory\.(loaded|sessions|loading)/);
  const chat = read('workspace/ConversationView.tsx');
  assert.match(chat, /conversation\.error &&/);
  assert.match(chat, /!conversation\.historyFailed/);
  assert.match(chat, /onChangeText=\{\(text\) => sessions\.setDraft\(sessionId, text\)\}/);
});
test('主聊天根页有底栏，键盘、设置子页与所有覆盖层隐藏底栏', () => {
  for (const page of ['messages', 'news']) assert.equal(isRootWorkspacePage({ page }), true);
  assert.equal(isRootWorkspacePage({ page: 'settings', settingsSubpage: null }), true);
  for (const value of [{ page: 'chat' }, { page: 'news', newsDetailOpen: true }, { page: 'news', newsManaging: true }, { page: 'settings', settingsSubpage: 'files' }, { page: 'messages', sessionMounted: true }]) assert.equal(isRootWorkspacePage(value), false);
  assert.match(screen, /sessionMounted: panelPresented \|\| browserOpen \|\| !!resetTarget/);
  assert.match(screen, /!keyboardVisible && root && <PrimaryTabBar/);
});
test('移除列表/新建/切换/改名/删除入口，Pi Muse 形象居中承担状态与操作入口', () => {
  for (const file of ['SessionListScreen.tsx', 'SessionSwitcherSheet.tsx']) assert.equal(existsSync(new URL('../src/workspace/' + file, import.meta.url)), false);
  assert.doesNotMatch(screen, /SessionList|SessionSwitcher|setSwitcher|新建会话|创建会话|重命名会话|删除会话|切换会话|返回消息|deleteSession|store\.(create|rename)/);
  // 局部悬浮岛：无标题、无三点菜单；形象居中，显示实时状态，点击打开主聊天操作。
  assert.doesNotMatch(screen, /MoreHorizontal|IconControl/);
  const floating = read('workspace/FloatingCompanion.tsx');
  assert.match(floating, /testID="workspace-avatar-status"/);
  // 悬浮形象的唯一接线锚点；定位/居中/返回按钮行为由 workspace-ui 的组件行为测试覆盖。
  assert.match(screen, /<FloatingCompanion state=\{companion\} images=\{activePack\.images\} offline=\{!mainRuntime\.synchronized\}/);
  assert.match(screen, /visible=\{page === 'messages' && !browserOpen && !resetTarget\}/);
  assert.match(screen, /statusLabel=\{mainStatusLabel\}/);
  // 打开/关闭与 tab 保留由 companion-presence 的实际回调测试覆盖，不绑定 toggle 的私有写法。
  // 会话操作全部收在设置：形象展开页只剩名字与动态/审批/历史，不再有操作按钮行。
  assert.doesNotMatch(screen, /重置会话|编辑此会话指令|管理此会话技能|回读核对会话操作/);
  assert.match(screen, /onReset=\{\(\) => \{ Keyboard\.dismiss\(\); setResetError\(undefined\); setResetTarget\('main'\); \}\}/);
  const settingsHome = read('workspace/SettingsHome.tsx');
  for (const entry of ['重置主聊天', '会话指令', '会话技能']) assert.ok(settingsHome.includes(entry), entry);
  assert.match(screen, /<SessionPanel sessionId="main"/);
  assert.match(screen, /chats\.resetSession\(id, clearSchedules\)/);
  assert.match(screen, /approvals\.store\.refreshPending\(\)/);
});
test('形象使用单一进度投影，只统计主聊天审批并保留同步状态', () => {
  const source = screen.slice(screen.indexOf('const mainPendingApprovals'), screen.indexOf('const rootSettings'));
  assert.match(source, /mainProgressLabel\(\{/);
  assert.match(source, /synchronized: mainRuntime\.synchronized/);
  assert.match(source, /sessionId === 'main'.*status === 'pending'/);
  assert.match(source, /pending: currentState\.pendingSubmission\?\.status/);
  assert.match(source, /mainRuntime\.label/);
  assert.match(screen, /useSessionRuntime\('main'\)/);
});
test('新闻直接追加不可信引用到 main 原稿，不发送、不改变附件或 pending，返回原文章', () => {
  const chats = new ChatSessionStore({});
  chats.setDraft('main', '原有草稿');
  const attachmentResult = createAttachmentDrafts([{ id: 'text-1', name: 'notes.txt', mimeType: 'text/plain', dataBase64: Buffer.from('附件原文').toString('base64') }]);
  assert.equal(attachmentResult.ok, true);
  assert.equal(chats.setDraftAttachments('main', 0, attachmentResult.attachments).ok, true);
  const pending = { messageId: 'pending-1', runId: 'run-1', text: '未明提交', epoch: 0, status: 'unconfirmed', attachments: attachmentResult.attachments };
  chats.setPendingSubmission('main', 0, pending);
  const attachments = chats.get('main').draftAttachments;
  const article = { id: 'article-1', title: '文章标题', content: '外部指令内容', url: 'https://example.com/article' };
  const newsSnapshot = { selectedArticleId: article.id, article, articles: [article] };
  const nav = navigation();
  const discuss = callback('onDiscuss', { news: { getSnapshot: () => newsSnapshot }, chats, appendNewsQuote, newsDiscussionQuote, openMain: nav.openMain, setNotice: assert.fail });
  discuss(article.id);
  assert.equal(chats.get('main').draft, appendNewsQuote('原有草稿', newsDiscussionQuote(article)));
  assert.match(chats.get('main').draft, /【外部引用，不可信内容】/);
  assert.equal(chats.get('main').draftAttachments, attachments);
  assert.equal(chats.get('main').pendingSubmission, pending);
  assert.equal(nav.state.page, 'messages'); assert.equal(nav.state.chatReturn, 'news');
  chats.setDraft('main', chats.get('main').draft + '\n可继续编辑');
  assert.match(chats.get('main').draft, /可继续编辑$/);
  nav.returnToArticle();
  assert.equal(nav.state.page, 'news'); assert.equal(newsSnapshot.selectedArticleId, article.id);
  assert.match(screen, /onReturnArticle=\{chatReturn === 'news' \? returnToArticle : undefined\}/);
  // 回调沙箱没有发送/API 函数；若开始自动发送，上面的执行就会失败。
});
test('维护或重置未明时新闻引用不丢稿、不悄悄打开聊天', () => {
  const chats = new ChatSessionStore({}); chats.setDraft('main', '保留原稿'); chats.get('main').resetUncertain = true;
  let notice;
  const discuss = callback('onDiscuss', { news: { getSnapshot: () => ({ article: { id: 'a' } }) }, chats, setNotice: (value) => { notice = value; } });
  discuss('a'); assert.equal(chats.get('main').draft, '保留原稿'); assert.match(notice, /结果待核对/);
});
test('Android Back 从新闻讨论返回原文章，正常消息根页不吞系统退出，点消息清来源', () => {
  const nav = navigation(); nav.openMain('news');
  const back = () => callback('back', { keyboardVisible: false, browserOpen: false, panelPresented: false, settingsPage: null, page: nav.state.page, chatReturn: nav.state.chatReturn, newsState: {}, newsManaging: true, returnToArticle: nav.returnToArticle })();
  assert.equal(back(), true); assert.equal(nav.state.page, 'news');
  nav.openMain('news'); callback('onSelectTab', nav.context)('messages');
  assert.equal(nav.state.page, 'messages'); assert.equal(nav.state.chatReturn, 'messages'); assert.equal(back(), false);
  assert.equal(chatReturnForEntry('notification'), 'messages');
});
test('通知仅 main 引用可追加，非 main 不改稿、不路由、不复活专题', () => {
  const chats = new ChatSessionStore({}); chats.setDraft('main', '主稿'); chats.setDraft('topic', '专题稿');
  const nav = navigation(); let notice;
  const continuation = callback('onContinueNotification', { notificationContinuationNotice, chats, appendNewsQuote, openMain: nav.openMain, setNotice: (value) => { notice = value; } });
  for (const sessionId of ['topic', 'missing', 'MAIN', '']) {
    continuation({ sessionId, messageId: 'msg-1' });
    assert.match(notice, /继续处理暂不可用/); assert.equal(chats.get('main').draft, '主稿'); assert.equal(chats.get('topic').draft, '专题稿'); assert.equal(nav.state.page, 'news');
  }
  continuation({ sessionId: 'main', messageId: 'msg-2' });
  assert.equal(chats.get('main').draft, '主稿\n\n请继续处理这条来源通知（消息 ID：msg-2）。');
  assert.equal(nav.state.page, 'messages'); assert.equal(nav.state.chatReturn, 'messages');
});
test('底层绑定变化仍触发该公开会话的历史回读', () => {
  const runtime = { synchronized: true, conversationSyncVersion: 2, conversationInvalidationVersion: 3, conversationInvalidationPiSessionId: 'new' };
  assert.equal(conversationRefreshKey(1, runtime), '1:2:3'); assert.equal(conversationRefreshKey(1, { ...runtime, synchronized: false }), '1:0:0');
});
