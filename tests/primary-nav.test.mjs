import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PRIMARY_TABS, isRootWorkspacePage, chatReturnForEntry } from '../src/workspace/primary-nav.ts';
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
    setRequestedSessionId: (id) => { state.sessionId = id; }, setStartedSessions: () => {}, setSessionDirectoryOpen: () => {},
    setChatReturn: (value) => { state.chatReturn = value; }, setPage: (value) => { state.page = value; }, setSettingsPage: (value) => { state.settingsPage = value; },
  };
  return { state, context, openSession: callback('openSession', context), returnToArticle: callback('returnToArticle', context) };
}

test('一级固定消息/新闻/设置，冷启动直接挂载 main，不依赖目录成功', () => {
  assert.deepEqual(PRIMARY_TABS.map(({ id, label }) => [id, label]), [['messages', '消息'], ['news', '新闻'], ['settings', '设置']]);
  assert.equal(PRIMARY_TABS[0].testID, 'primary-tab-messages');
  assert.match(screen, /useState<PrimaryTabId>\('messages'\)/);
  assert.match(screen, /<ConversationHost sessionIds=\{sessionIds\} activeSessionId=\{activeSessionId\} chatVisible=\{page === 'messages'\}/);
  const host = read('workspace/ConversationHost.tsx');
  assert.match(host, /sessionIds\.map\(\(sessionId\) => <SessionConversation key=\{sessionId\}/);
  assert.match(screen, /useState<string\[\]>\(\[MAIN_SESSION_ID\]\)/);
  const chat = read('workspace/ConversationView.tsx');
  assert.match(chat, /conversation\.error &&/);
  assert.match(chat, /!conversation\.historyFailed/);
  assert.match(chat, /onChangeText=\{\(text\) => sessions\.setDraft\(sessionId, composeDomainQuote\(draftQuote, text\)\)\}/);
});
test('主聊天根页有底栏，键盘、设置子页与所有覆盖层隐藏底栏', () => {
  for (const page of ['messages', 'news']) assert.equal(isRootWorkspacePage({ page }), true);
  assert.equal(isRootWorkspacePage({ page: 'settings', settingsSubpage: null }), true);
  for (const value of [{ page: 'chat' }, { page: 'news', newsDetailOpen: true }, { page: 'news', newsManaging: true }, { page: 'settings', settingsSubpage: 'files' }, { page: 'messages', sessionMounted: true }]) assert.equal(isRootWorkspacePage(value), false);
  assert.match(screen, /sessionMounted: panelPresented \|\| browserOpen \|\| !!resetTarget/);
  assert.match(screen, /!keyboardVisible && root && <PrimaryTabBar/);
});
test('消息提供会话目录，形象仍负责当前会话的活动与审批', () => {
  assert.match(screen, /testID="workspace-session-directory"/);
  assert.match(screen, /<SessionDirectory directory=\{directory\}/);
  assert.match(screen, /<SessionPanel key=\{activeSessionId\} sessionId=\{activeSessionId\}/);
  assert.match(read('workspace/FloatingCompanion.tsx'), /testID="workspace-avatar-status"/);
  assert.match(screen, /chats\.resetSession\(id\)/);
  const settingsHome = read('workspace/SettingsHome.tsx');
  for (const entry of ['重置主聊天', '助手指令', '助手技能']) assert.ok(settingsHome.includes(entry), entry);
});
test('形象使用单一进度投影，只统计当前会话审批并保留同步状态', () => {
  const source = screen.slice(screen.indexOf('const activePendingApprovals'), screen.indexOf('const rootSettings'));
  assert.match(source, /mainProgressLabel\(\{/);
  assert.match(source, /synchronized: activeRuntime\.synchronized/);
  assert.match(source, /sessionId === activeSessionId.*status === 'pending'/);
  assert.match(source, /pending: currentState\.pendingSubmission\?\.status/);
  assert.match(source, /activeRuntime\.label/);
  assert.match(screen, /useSessionRuntime\(activeSessionId\)/);
});
test('新闻直接追加不可信引用到当前会话原稿，不发送、不改变附件或 pending，返回原文章', () => {
  const chats = new ChatSessionStore({});
  chats.setDraft('topic', '原有草稿');
  const attachmentResult = createAttachmentDrafts([{ id: 'text-1', name: 'notes.txt', mimeType: 'text/plain', dataBase64: Buffer.from('附件原文').toString('base64') }]);
  assert.equal(attachmentResult.ok, true);
  assert.equal(chats.setDraftAttachments('topic', 0, attachmentResult.attachments).ok, true);
  const pending = { messageId: 'pending-1', runId: 'run-1', text: '未明提交', epoch: 0, status: 'unconfirmed', attachments: attachmentResult.attachments };
  chats.setPendingSubmission('topic', 0, pending);
  const attachments = chats.get('topic').draftAttachments;
  const article = { id: 'article-1', title: '文章标题', content: '外部指令内容', url: 'https://example.com/article' };
  const newsSnapshot = { selectedArticleId: article.id, article, articles: [article] };
  const nav = navigation();
  const discuss = callback('onDiscuss', { news: { getSnapshot: () => newsSnapshot }, chats, appendNewsQuote, newsDiscussionQuote, activeSessionId: 'topic', openSession: nav.openSession, setNotice: assert.fail });
  discuss(article.id);
  assert.equal(chats.get('topic').draft, appendNewsQuote('原有草稿', newsDiscussionQuote(article)));
  assert.match(chats.get('topic').draft, /^【领域引用:news】/);
  assert.match(chats.get('topic').draft, /外部引用，不可信内容/);
  assert.equal(chats.get('topic').draftAttachments, attachments);
  assert.equal(chats.get('topic').pendingSubmission, pending);
  assert.equal(nav.state.sessionId, 'topic'); assert.equal(nav.state.page, 'messages'); assert.equal(nav.state.chatReturn, 'news');
  chats.setDraft('topic', chats.get('topic').draft + '\n可继续编辑');
  assert.match(chats.get('topic').draft, /可继续编辑$/);
  nav.returnToArticle();
  assert.equal(nav.state.page, 'news'); assert.equal(newsSnapshot.selectedArticleId, article.id);
  assert.match(screen, /onReturnArticle=\{chatReturn === 'news' \? returnToArticle : undefined\}/);
  // 回调沙箱没有发送/API 函数；若开始自动发送，上面的执行就会失败。
});
test('维护或重置未明时新闻引用不丢稿、不悄悄打开聊天', () => {
  const chats = new ChatSessionStore({}); chats.setDraft('main', '保留原稿'); chats.get('main').resetUncertain = true;
  let notice;
  const discuss = callback('onDiscuss', { news: { getSnapshot: () => ({ article: { id: 'a' } }) }, chats, activeSessionId: 'main', setNotice: (value) => { notice = value; } });
  discuss('a'); assert.equal(chats.get('main').draft, '保留原稿'); assert.match(notice, /结果待核对/);
});
test('Android Back 从新闻讨论返回原文章，正常消息根页不吞系统退出，点消息清来源', () => {
  const nav = navigation(); nav.openSession('main', 'news');
  const back = () => callback('back', { keyboardVisible: false, browserOpen: false, panelPresented: false, settingsPage: null, page: nav.state.page, chatReturn: nav.state.chatReturn, newsState: {}, newsManaging: true, returnToArticle: nav.returnToArticle })();
  assert.equal(back(), true); assert.equal(nav.state.page, 'news');
  nav.openSession('main', 'news'); callback('onSelectTab', nav.context)('messages');
  assert.equal(nav.state.page, 'messages'); assert.equal(nav.state.chatReturn, 'messages'); assert.equal(back(), false);
  assert.equal(chatReturnForEntry('notification'), 'messages');
});
test('底层绑定变化仍触发该公开会话的历史回读', () => {
  const runtime = { synchronized: true, conversationSyncVersion: 2, conversationInvalidationVersion: 3, conversationInvalidationPiSessionId: 'new' };
  assert.equal(conversationRefreshKey(1, runtime), '1:2:3'); assert.equal(conversationRefreshKey(1, { ...runtime, synchronized: false }), '1:2:3');
});
