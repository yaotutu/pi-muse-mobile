import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PRIMARY_TABS, filterMembers, isRootWorkspacePage, resolveNotificationReturn } from '../src/workspace/primary-nav.ts';
import { workspaceBackAction } from '../src/workspace/workspace-back.ts';

const read = (file) => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');

test('三Tab文字、顺序、定义与冷启动初始状态', () => {
  // 一级三项：消息 / 新闻 / 设置，顺序严格固定
  assert.equal(PRIMARY_TABS.length, 3);
  assert.deepEqual(
    PRIMARY_TABS.map((t) => ({ id: t.id, label: t.label })),
    [
      { id: 'group', label: '消息' },
      { id: 'news', label: '新闻' },
      { id: 'settings', label: '设置' },
    ],
  );

  const workspace = read('workspace/WorkspaceScreen.tsx');
  // 冷启动进入消息（原群聊），初始状态为 group
  assert.match(workspace, /useState<WorkspacePage>\('group'\)/);
  // UI 顶栏为「消息」，不叫「全部」
  const group = read('group/GroupChat.tsx');
  assert.match(group, /<Text accessibilityRole="header" [^>]*>消息<\/Text>/);
  assert.match(group, /testID="group-members-button"/);
  assert.doesNotMatch(group, /<Text accessibilityRole="header" [^>]*>全部<\/Text>/);
});

test('filterMembers 纯函数：不区分大小写匹配 id 与 name，严格保留原数组顺序', () => {
  const list = [
    { id: 'local-main', name: 'OpenMuse' },
    { id: 'news-internal', name: '新闻早报' },
    { id: 'sms-internal', name: '短信助理' },
    { id: 'coder-bot', name: '代码小帮手' },
  ];

  // 空串或空白返回全量原顺序拷贝
  assert.deepEqual(filterMembers(list, ''), list);
  assert.deepEqual(filterMembers(list, '   '), list);

  // 按中文名称匹配
  assert.deepEqual(filterMembers(list, '新闻'), [{ id: 'news-internal', name: '新闻早报' }]);
  assert.deepEqual(filterMembers(list, '小帮手'), [{ id: 'coder-bot', name: '代码小帮手' }]);

  // 按 id 匹配（大小写不敏感）
  assert.deepEqual(filterMembers(list, 'NEWS'), [{ id: 'news-internal', name: '新闻早报' }]);
  assert.deepEqual(filterMembers(list, 'sms'), [{ id: 'sms-internal', name: '短信助理' }]);
  assert.deepEqual(filterMembers(list, 'main'), [{ id: 'local-main', name: 'OpenMuse' }]);

  // 匹配多项时保持原顺序
  assert.deepEqual(filterMembers(list, 'internal'), [
    { id: 'news-internal', name: '新闻早报' },
    { id: 'sms-internal', name: '短信助理' },
  ]);

  // 无匹配返回空数组
  assert.deepEqual(filterMembers(list, 'not-found'), []);
});

test('根页 vs 二级页 Back 契约：根页不消费返回，二级页与弹层逐层返回', () => {
  const base = {
    keyboardVisible: false,
    browserOpen: false,
    sessionMounted: false,
    settingsSubpage: null,
    goalCreating: false,
    newsArticleOpen: false,
    newsManaging: false,
  };

  // 三个根页：消息、新闻、设置均返回 none
  assert.equal(workspaceBackAction({ ...base, page: 'group' }), 'none');
  assert.equal(workspaceBackAction({ ...base, page: 'news' }), 'none');
  assert.equal(workspaceBackAction({ ...base, page: 'settings' }), 'none');

  // 键盘与顶层覆盖优先于所有页面
  assert.equal(workspaceBackAction({ ...base, page: 'group', keyboardVisible: true }), 'keyboard');
  assert.equal(workspaceBackAction({ ...base, page: 'news', browserOpen: true }), 'browser');
  assert.equal(workspaceBackAction({ ...base, page: 'settings', sessionMounted: true }), 'session');

  // 二级私聊返回 chat-return
  assert.equal(workspaceBackAction({ ...base, page: 'chat' }), 'chat-return');

  // 通知讨论返回 discussion
  assert.equal(workspaceBackAction({ ...base, page: 'discussion' }), 'discussion');

  // 新闻二级：文章阅读与来源管理
  assert.equal(workspaceBackAction({ ...base, page: 'news', newsArticleOpen: true }), 'news-article');
  assert.equal(workspaceBackAction({ ...base, page: 'news', newsManaging: true }), 'news-sources');

  // 设置二级：设置子页
  assert.equal(workspaceBackAction({ ...base, page: 'settings', settingsSubpage: 'agents' }), 'settings');
  assert.equal(workspaceBackAction({ ...base, page: 'settings', settingsSubpage: 'group-routing' }), 'settings');
});

test('一级三Tab底栏条件渲染：仅在无键盘的根页显示，所有二级页无底栏', () => {
  // 纯函数判定：三个根页在无子状态时为根页
  assert.equal(isRootWorkspacePage({ page: 'group' }), true);
  assert.equal(isRootWorkspacePage({ page: 'news' }), true);
  assert.equal(isRootWorkspacePage({ page: 'settings', settingsSubpage: null }), true);

  // 任何二级页均不是根页
  assert.equal(isRootWorkspacePage({ page: 'chat' }), false);
  assert.equal(isRootWorkspacePage({ page: 'news', newsDetailOpen: true }), false);
  assert.equal(isRootWorkspacePage({ page: 'discussion' }), false);
  assert.equal(isRootWorkspacePage({ page: 'news', newsManaging: true }), false);
  assert.equal(isRootWorkspacePage({ page: 'settings', settingsSubpage: 'agents' }), false);
  assert.equal(isRootWorkspacePage({ page: 'agent' }), false);
  assert.equal(isRootWorkspacePage({ page: 'feature' }), false);
  assert.equal(isRootWorkspacePage({ page: 'goals' }), false);

  // 会话覆盖层处于挂载/动画期间时，任何页面均不得显示底栏（不露出、不被读屏访问）
  assert.equal(isRootWorkspacePage({ page: 'group', sessionMounted: true }), false);
  assert.equal(isRootWorkspacePage({ page: 'news', sessionMounted: true }), false);
  assert.equal(isRootWorkspacePage({ page: 'settings', sessionMounted: true }), false);

  // 残留的历史 notification 引用不破坏 group 根页判定；根页由当前 page 决定
  assert.equal(isRootWorkspacePage({ page: 'group', notification: { targetAgentId: 'sms-internal' } }), true);
  assert.equal(isRootWorkspacePage({ page: 'discussion', notification: { targetAgentId: 'sms-internal' } }), false);

  const workspace = read('workspace/WorkspaceScreen.tsx');
  assert.match(workspace, /isRootWorkspacePage/);
  assert.match(workspace, /!keyboardVisible && isRootPage && \(\s*<PrimaryTabBar/);
});

test('通知讨论返回解析纯函数：精确恢复来源私聊及其原来源，原Agent被删安全回消息', () => {
  const agents = ['local-main', 'agent-a', 'agent-b', 'news-internal'];

  // 来源于群聊：安全回群聊
  assert.deepEqual(resolveNotificationReturn({ type: 'group' }, agents), {
    page: 'group',
  });

  // 来源于私聊 A，且 A 的原返回是 group：返回 A，chatReturn 为 group
  assert.deepEqual(
    resolveNotificationReturn(
      { type: 'chat', agentId: 'agent-a', chatReturn: 'group' },
      agents,
    ),
    { page: 'chat', agentId: 'agent-a', chatReturn: 'group' },
  );

  // 来源于新闻讨论承接私聊，原返回是 news：返回该 Agent，chatReturn 为 news
  assert.deepEqual(
    resolveNotificationReturn(
      { type: 'chat', agentId: 'news-internal', chatReturn: 'news' },
      agents,
    ),
    { page: 'chat', agentId: 'news-internal', chatReturn: 'news' },
  );

  // 原私聊 Agent 已被删除：绝不复活或静默跳其他 Agent，安全回消息并给出提示
  const deletedResult = resolveNotificationReturn(
    { type: 'chat', agentId: 'deleted-agent', chatReturn: 'group' },
    agents,
  );
  assert.equal(deletedResult.page, 'group');
  assert.match(deletedResult.errorNotice ?? '', /deleted-agent 不存在或已被删除/);
});

test('完整时序回归：A私聊 → 通知讨论 → 点击B头像进B私聊 → 返回讨论 → 返回A私聊 → 返回原来源群聊（无循环回路）', () => {
  const directory = ['local-main', 'agent-a', 'agent-b'];

  // 1. 初始状态：在 Agent A 私聊，原返回为 group
  let state = {
    page: 'chat',
    currentAgent: 'agent-a',
    chatReturn: 'group',
    notificationOrigin: { type: 'group' },
  };

  // 2. 打开通知：捕获当前来源私聊 A 及 chatReturn
  state.notificationOrigin = {
    type: 'chat',
    agentId: state.currentAgent,
    chatReturn: state.chatReturn === 'news' ? 'news' : 'group',
  };
  state.page = 'discussion';

  // 3. 在讨论中点击 Agent B 头像进 B 私聊
  state.chatReturn = 'discussion';
  state.currentAgent = 'agent-b';
  state.page = 'chat';

  // 4. 从 B 私聊点返回：chatReturn 是 discussion，回到 discussion
  assert.equal(state.chatReturn, 'discussion');
  state.page = 'discussion';

  // 5. 从 discussion 点返回：调用 resolveNotificationReturn
  const ret = resolveNotificationReturn(state.notificationOrigin, directory);
  assert.deepEqual(ret, { page: 'chat', agentId: 'agent-a', chatReturn: 'group' });
  state.page = ret.page;
  state.currentAgent = ret.agentId;
  state.chatReturn = ret.chatReturn;

  // 6. 此时回到 Agent A 私聊，且其 chatReturn 为 group，再次返回安全回 group（避免循环进 discussion）
  assert.equal(state.page, 'chat');
  assert.equal(state.currentAgent, 'agent-a');
  assert.equal(state.chatReturn, 'group');
});

test('审批与会话覆盖层契约：使用临时检查对象打开覆盖层，不借路由去Agent设置，关闭后保留原页且底栏受控', () => {
  const workspace = read('workspace/WorkspaceScreen.tsx');
  // GroupChat onApprovals 不调用 setPage('agent')，直接驱动审批会话覆盖层
  assert.doesNotMatch(workspace, /onApprovals=\{.*setPage\('agent'\)/);
  assert.match(workspace, /onApprovals=\{\(agentId\) => openSession\('approvals', agentId\)\}/);

  // 覆盖层检查对象优先使用 sessionAgentId
  assert.match(workspace, /const inspectedSessionAgentId = sessionAgentId \?\? focusedAgentId;/);
  assert.match(workspace, /<SessionPanel agentId=\{inspectedSessionAgentId\}/);

  // 会话关闭完成时重置 sessionAgentId
  assert.match(workspace, /setSessionAgentId\(null\)/);

  // Agent 设置打开动态与审批保持自身所在页，不跳转
  assert.match(workspace, /onActivity=\{\(\) => openSession\('activity'\)\}/);

  // 统一的 returnFromNotification 函数驱动讨论页顶栏与物理 Back
  assert.match(workspace, /const returnFromNotification = useCallback\(/);
  assert.match(workspace, /onBack=\{returnFromNotification\}/);
  assert.match(workspace, /action === 'discussion'\) returnFromNotification\(\)/);

  // groupMembers 复用全量 agents 目录，不按 sessionId 筛选
  assert.match(workspace, /const groupMembers = agents\.agents\.map\(/);
  assert.doesNotMatch(workspace, /const groupMembers = agents\.agents\.filter\(.*sessionId/);
});

test('成员面板契约：完整服务端目录候选、未入组不可艾特但可单独聊、艾特不自发消息', () => {
  const group = read('group/GroupChat.tsx');
  // 顶栏明确的「成员」按钮，点击打开面板
  assert.match(group, /<ActionButton [^>]*text="成员"[^>]*testID="group-members-button"[^>]*onPress=\{\(\) => setChoosing\(true\)\}/);
  // 成员面板组件挂载并传入 candidateAgents（来自 agents 目录）
  assert.match(group, /<GroupMemberSheet/);
  assert.match(group, /agents=\{candidateAgents\}/);
  assert.match(group, /memberIds=\{snapshot\?\.memberIds \?\? \[\]\}/);
  assert.match(group, /defaultAgentId=\{snapshot\?\.defaultAgentId\}/);

  // 在群里 @ 只设置 composer target，绝不调用 send 或切换到私聊
  assert.match(group, /onMention=\{\(agentId\) => \{\s*composer\.setTarget\(agentId\);\s*setChoosing\(false\);/);
  assert.doesNotMatch(group, /onMention=\{.*(?:send|onPrivateChat)/);

  // GroupMemberSheet 中的按钮契约
  const sheet = read('workspace/GroupMemberSheet.tsx');
  assert.match(sheet, /disabled=\{!inGroup\}/);
  assert.match(sheet, /text="在群里 @"/);
  assert.match(sheet, /text="单独聊"/);
  assert.match(sheet, /!inGroup && \(\s*<Text [^>]*>\s*未加入组\s*<\/Text>\s*\)/);
  assert.match(sheet, /isDefault && \(\s*<View [^>]*>\s*<Text [^>]*>\s*默认回复\s*<\/Text>\s*<\/View>\s*\)/);
});

test('头像与标题点击交互：头像单击进独立私聊，无隐藏长按设置，标题不进设置', () => {
  const group = read('group/GroupChat.tsx');
  // 消息行中头像单击进入私聊
  assert.match(group, /onPress=\{\(\) => \{\s*Keyboard\.dismiss\(\);\s*onPrivateChat\(row\.sender!\);\s*\}\}/);
  // 没有在头像上保留长按
  assert.doesNotMatch(group, /MemberAvatar[^>]*onLongPress/);
  // 消息气泡内的复制/反馈长按继续保留
  const view = read('workspace/ConversationView.tsx');
  assert.match(view, /onLongPress=\{feedbackScope \? openFeedback : undefined\}/);

  // 群聊标题纯文本展示，不点击进设置
  assert.match(group, /<Text accessibilityRole="header"[^>]*>消息<\/Text>/);
  assert.doesNotMatch(group, /onPress=\{.*openGlobalSettings/);
});

test('独立私聊导航与返回：二级私聊带姓名和状态，返回不丢原上下文', () => {
  const workspace = read('workspace/WorkspaceScreen.tsx');
  // 私聊顶栏使用 AgentHeader，展示标题、状态与明确返回标签
  assert.match(workspace, /page === 'chat' && \(\s*<AgentHeader\s*title=\{labels\.title\(agents\.currentAgent\)\}\s*caption=\{avatarStatusDetail\(agents\.currentAgent\)\}\s*backLabel=\{chatReturn === 'news' \? '返回新闻' : chatReturn === 'discussion' \? '返回讨论' : '返回消息'\}\s*onBack=\{returnChat\}/);
  // returnChat 正确按 chatReturn 路由
  assert.match(workspace, /if \(chatReturn === 'news'\) \{\s*setPage\('news'\);\s*\} else if \(chatReturn === 'discussion'\) \{\s*setPage\('discussion'\);\s*\} else \{\s*setPage\('group'\);\s*\}/);
  // 新闻讨论带来源返回
  assert.match(workspace, /openPrivateChat\(agentId, 'news'\)/);
  // 设置检查对象不改变聊天所有者
  assert.match(workspace, /const focusedAgentId = settingsAgentId \?\? agents.currentAgent;/);
  // 运行所有者持续挂载（display: none 隐藏），切页不中断会话
  assert.match(workspace, /<ConversationHost currentAgentId=\{agents\.currentAgent\}/);
  assert.match(workspace, /<GroupChat visible=\{page === 'group' \|\| page === 'discussion'\}/);
  assert.match(workspace, /<NewsPage store=\{news\} visible=\{page === 'news'\}/);
});
