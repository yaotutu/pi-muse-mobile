/** preview-state 的本地回归测试：fixture 隔离、reducer 行为与不变量。 */

import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  createPreviewState,
  previewReducer,
  MAIN_PREVIEW_THREAD,
} = await import('../src/preview/preview-state.ts');

// --- 1. fixture 深拷贝隔离 ---

test('createPreviewState 深拷贝：两个实例互不污染（顶层 + 嵌套字段）', () => {
  const a = createPreviewState();
  const b = createPreviewState();
  assert.notEqual(a, b);
  assert.notEqual(a.threads, b.threads);
  assert.notEqual(a.threads[0], b.threads[0]);
  assert.notEqual(a.threads[0].messages, b.threads[0].messages);
  assert.notEqual(a.threads[0].approvals, b.threads[0].approvals);

  // 改 a 的嵌套数组与字段，b 应保持原状。
  a.threads[0].messages.push({ id: 'pollute', role: 'assistant', text: '污染' });
  a.threads[0].draft = 'A 草稿';
  a.threads[0].running = false;
  a.threads[0].approvals[0].status = 'approved';
  assert.equal(b.threads[0].messages.length, 2, '嵌套数组不共享');
  assert.equal(b.threads[0].draft, '', 'draft 不共享');
  assert.equal(b.threads[0].running, true, 'running 不共享');
  assert.equal(b.threads[0].approvals[0].status, 'pending', 'approvals 不共享');
});

test('MAIN_PREVIEW_THREAD 是定值字符串 preview-main，主会话 ID 与当前会话都指向它', () => {
  const state = createPreviewState();
  assert.equal(MAIN_PREVIEW_THREAD, 'preview-main');
  assert.equal(state.threads[0].id, MAIN_PREVIEW_THREAD);
  assert.equal(state.currentThreadId, MAIN_PREVIEW_THREAD);
});

// --- 2. fixture 业务内容（产品已批准） ---

test('主会话名/状态/welcome image/用户消息/running 活动 内容正确', () => {
  const state = createPreviewState();
  const main = state.threads[0];
  assert.equal(main.name, 'Pi Muse');
  assert.equal(main.status, '调研生态圈');
  assert.equal(main.running, true);
  assert.equal(main.messages.length, 2);
  const welcome = main.messages[0];
  assert.equal(welcome.role, 'assistant');
  assert.equal(welcome.image, 'characters');
  assert.match(welcome.text, /示例|本地|预览/);
  const userMsg = main.messages[1];
  assert.equal(userMsg.role, 'user');
  assert.match(userMsg.text, /调研.*Pi.*生态圈/);
  // 1 个 running 活动，固定时间。
  assert.equal(main.activities.length, 1);
  assert.equal(main.activities[0].title, '调研 Pi 生态圈');
  assert.equal(main.activities[0].detail, '深入调研 Pi 生态圈及其发展');
  assert.equal(main.activities[0].time, '7:44pm');
  assert.equal(main.activities[0].status, 'running');
});

test('第二假会话 running=false、与主会话内容不同但 ID 不冲突', () => {
  const state = createPreviewState();
  const second = state.threads[1];
  assert.notEqual(second.id, MAIN_PREVIEW_THREAD);
  assert.equal(second.running, false);
  assert.notEqual(second.name, 'Pi Muse');
  assert.notDeepEqual(second.messages, state.threads[0].messages);
  assert.equal(second.activities.length, 0);
});

// --- 3. 抽屉 / 头像面板 / 页面互斥 ---

test('open-drawer 同时关闭 session 以保持互斥；close-drawer 不动 session', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'open-session' });
  assert.equal(state.sessionOpen, true);
  state = previewReducer(state, { type: 'open-drawer' });
  assert.equal(state.drawerOpen, true);
  assert.equal(state.sessionOpen, false, 'open-drawer 必须互斥关闭 session');
  state = previewReducer(state, { type: 'close-drawer' });
  assert.equal(state.drawerOpen, false);
  assert.equal(state.sessionOpen, false, 'close-drawer 不影响 session');
});

test('打开头像 (open-session) 必须关闭 drawer，其它字段保持不动', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'open-drawer' });
  assert.equal(state.drawerOpen, true);
  state = previewReducer(state, { type: 'open-session' });
  assert.equal(state.sessionOpen, true);
  assert.equal(state.drawerOpen, false, '打开头像必须关 drawer');
  assert.equal(state.page, 'chat', 'page 不变');
  assert.equal(state.currentThreadId, MAIN_PREVIEW_THREAD, 'currentThread 不变');
});

test('页面切换与头像面板互斥：set-page 自动收起 session', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'open-session' });
  assert.equal(state.sessionOpen, true);
  state = previewReducer(state, { type: 'set-page', page: 'activity' });
  assert.equal(state.page, 'activity');
  assert.equal(state.sessionOpen, false, '互斥：切 page 必须收 session');
});

// --- 4. 会话切换 / 创建 / no-op ---

test('select-thread 切到不同会话：关闭 drawer + session、回 chat；旧线程 running 不动；messages/draft 不重置', () => {
  let state = createPreviewState();
  // 先污染非线程层 + 给主会话加 draft，便于验证 select 是否会冲掉。
  state = previewReducer(state, { type: 'open-session' });
  state = previewReducer(state, { type: 'open-drawer' });
  state = previewReducer(state, { type: 'set-draft', text: 'A 草稿' });
  state = previewReducer(state, { type: 'set-page', page: 'goals' });

  const mainMsgCountBefore = state.threads[0].messages.length;
  const mainDraftBefore = state.threads[0].draft;

  state = previewReducer(state, { type: 'select-thread', id: state.threads[1].id });
  assert.equal(state.currentThreadId, state.threads[1].id);
  assert.equal(state.drawerOpen, false, 'select 必须收起 drawer');
  assert.equal(state.sessionOpen, false, 'select 必须收起 session');
  assert.equal(state.page, 'chat', 'select 必须回 chat');
  assert.equal(state.threads[0].running, true, '旧线程 running 不动');
  assert.equal(state.threads[0].messages.length, mainMsgCountBefore, 'messages 不重置');
  assert.equal(state.threads[0].draft, mainDraftBefore, 'draft 不重置');
});

test('select-thread 点击当前已选中会话：仅收起 drawer，messages/draft 完全保留', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'open-drawer' });
  state = previewReducer(state, { type: 'set-draft', text: '保留' });
  const msgBefore = state.threads[0].messages.length;
  const draftBefore = state.threads[0].draft;

  state = previewReducer(state, { type: 'select-thread', id: MAIN_PREVIEW_THREAD });
  assert.equal(state.currentThreadId, MAIN_PREVIEW_THREAD);
  assert.equal(state.drawerOpen, false, '同 id 选中也会收 drawer');
  assert.equal(state.sessionOpen, false, 'session 保持关闭');
  assert.equal(state.page, 'chat');
  assert.equal(state.threads[0].messages.length, msgBefore, 'messages 完全保留');
  assert.equal(state.threads[0].draft, draftBefore, 'draft 完全保留');
});

test('select-thread 未知 ID 为 no-op：不偷偷新建、不动任何字段', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'open-drawer' });
  state = previewReducer(state, { type: 'open-session' });
  state = previewReducer(state, { type: 'set-page', page: 'goals' });
  const snapshot = JSON.stringify(state);

  const beforeId = state.currentThreadId;
  state = previewReducer(state, { type: 'select-thread', id: 'unknown-id' });
  assert.equal(state.currentThreadId, beforeId);
  assert.equal(JSON.stringify(state), snapshot, '未知 id 不应改任何字段');
});

test('create-thread 新建会话、设为 current、收 drawer + session、回 chat；已有会话与主会话内容保留', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'open-drawer' });
  state = previewReducer(state, { type: 'open-session' });
  state = previewReducer(state, { type: 'set-page', page: 'goals' });

  const beforeCount = state.threads.length;
  state = previewReducer(state, { type: 'create-thread' });
  assert.equal(state.threads.length, beforeCount + 1);
  const fresh = state.threads[state.threads.length - 1];
  assert.equal(state.currentThreadId, fresh.id);
  assert.equal(state.drawerOpen, false, 'create 必须收 drawer');
  assert.equal(state.sessionOpen, false, 'create 必须收 session');
  assert.equal(state.page, 'chat', 'create 必须回 chat');
  assert.equal(fresh.running, false);
  assert.equal(fresh.messages.length, 0);
  assert.equal(fresh.activities.length, 0);
  // 已有会话内容不受影响。
  assert.equal(state.threads[0].name, 'Pi Muse');
  // 再次创建应递增 nextId 生成新 ID，不会撞。
  state = previewReducer(state, { type: 'create-thread' });
  const fresh2 = state.threads[state.threads.length - 1];
  assert.notEqual(fresh2.id, fresh.id);
});

// --- 5. set-session-tab & set-draft 不触发会话切换 ---

test('set-session-tab 不关 session、不动 currentThreadId（Tab 不切会话）', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'open-session' });
  state = previewReducer(state, { type: 'set-session-tab', tab: 'approvals' });
  assert.equal(state.sessionTab, 'approvals');
  assert.equal(state.sessionOpen, true);
  assert.equal(state.currentThreadId, MAIN_PREVIEW_THREAD);
});

test('set-draft 后切 drawer / Tab / session，草稿不被清除（不丢 draft）', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'set-draft', text: '调研草稿' });
  assert.equal(state.threads[0].draft, '调研草稿');

  state = previewReducer(state, { type: 'open-drawer' });
  state = previewReducer(state, { type: 'close-drawer' });
  assert.equal(state.threads[0].draft, '调研草稿');

  state = previewReducer(state, { type: 'open-session' });
  state = previewReducer(state, { type: 'set-session-tab', tab: 'workspace' });
  state = previewReducer(state, { type: 'close-session' });
  assert.equal(state.threads[0].draft, '调研草稿');

  // 切到第二会话再切回，主会话 draft 仍在。
  state = previewReducer(state, { type: 'select-thread', id: state.threads[1].id });
  state = previewReducer(state, { type: 'select-thread', id: MAIN_PREVIEW_THREAD });
  assert.equal(state.threads[0].draft, '调研草稿');
});

// --- 6. send: 条件守卫、原子追加 ---

test('send 在当前非 running 且 draft 非空时：trim 后追加 user、清 draft、running=true、追 activity/history', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'select-thread', id: state.threads[1].id });
  state = previewReducer(state, { type: 'set-draft', text: '  你好 Pi  ' });

  const msgBefore = state.threads[1].messages.length;
  const actBefore = state.threads[1].activities.length;
  const histBefore = state.threads[1].history.length;

  state = previewReducer(state, { type: 'send' });
  const t = state.threads[1];
  assert.equal(t.running, true);
  assert.equal(t.draft, '');
  assert.equal(t.messages.length, msgBefore + 1);
  assert.equal(t.messages.at(-1).role, 'user');
  assert.equal(t.messages.at(-1).text, '你好 Pi', '应被 trim');
  assert.equal(t.activities.length, actBefore + 1);
  assert.equal(t.activities.at(-1).status, 'running');
  assert.equal(t.activities.at(-1).title, '你好 Pi');
  assert.equal(t.history.length, histBefore + 1);
});

test('send 在当前 running 时为 no-op，不清 draft、不追加消息', () => {
  let state = createPreviewState();
  // 主会话本来就 running=true。
  state = previewReducer(state, { type: 'set-draft', text: 'append' });
  const draftBefore = state.threads[0].draft;
  const msgBefore = state.threads[0].messages.length;

  state = previewReducer(state, { type: 'send' });
  assert.equal(state.threads[0].draft, draftBefore, 'running 中 send 不清 draft');
  assert.equal(state.threads[0].messages.length, msgBefore, 'running 中 send 不追加');
  assert.equal(state.threads[0].running, true);
});

test('send 在 draft 为空 / 全空白时为 no-op', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'select-thread', id: state.threads[1].id });
  const msgBefore = state.threads[1].messages.length;

  // 空 draft。
  state = previewReducer(state, { type: 'send' });
  assert.equal(state.threads[1].messages.length, msgBefore);

  // 全空白。
  state = previewReducer(state, { type: 'set-draft', text: '   \n  \t' });
  state = previewReducer(state, { type: 'send' });
  assert.equal(state.threads[1].messages.length, msgBefore, '纯空白不发送');
});

// --- 7. stop / late complete ---

test('stop 标记当前线程活动 done，详情补充说明，running=false', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'stop' });
  const t = state.threads[0];
  assert.equal(t.running, false);
  assert.equal(t.activities[0].status, 'done');
  assert.match(t.activities[0].detail, /已手动停止/);
});

test('stop 仅作用于当前线程；其它会话 running 与状态保持', () => {
  let state = createPreviewState();
  // 把第二会话推到 running。
  state = previewReducer(state, { type: 'select-thread', id: state.threads[1].id });
  state = previewReducer(state, { type: 'set-draft', text: '触发' });
  state = previewReducer(state, { type: 'send' });
  assert.equal(state.threads[1].running, true);

  // 切到主会话 stop。
  state = previewReducer(state, { type: 'select-thread', id: MAIN_PREVIEW_THREAD });
  state = previewReducer(state, { type: 'stop' });
  assert.equal(state.threads[0].running, false, '主会话 stop 后 running=false');
  assert.equal(state.threads[1].running, true, '第二会话仍 running（未受 stop 影响）');
});

test('stop 在没有 running 活动/线程本就停 时为 no-op', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'select-thread', id: state.threads[1].id });
  // 第二会话本就 running=false 且无 running 活动。
  const beforeActivities = JSON.stringify(state.threads[1].activities);
  const beforeRunning = state.threads[1].running;
  state = previewReducer(state, { type: 'stop' });
  assert.equal(state.threads[1].running, beforeRunning);
  assert.equal(JSON.stringify(state.threads[1].activities), beforeActivities);
});

test('late complete 在已经 stop 的线程上为 no-op（不追加回复）', () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: 'stop' });
  const msgBefore = state.threads[0].messages.length;
  const actBefore = JSON.stringify(state.threads[0].activities);
  state = previewReducer(state, { type: 'complete', threadId: MAIN_PREVIEW_THREAD });
  assert.equal(state.threads[0].messages.length, msgBefore, '已 stop complete 不加回复');
  assert.equal(JSON.stringify(state.threads[0].activities), actBefore, '活动未变');
});

test('complete 在仍 running 的线程上追加示例 assistant 回复 + running 活动 done', () => {
  let state = createPreviewState();
  // 在第二会话上 send 把线程推到 running。
  state = previewReducer(state, { type: 'select-thread', id: state.threads[1].id });
  state = previewReducer(state, { type: 'set-draft', text: '触发回复' });
  state = previewReducer(state, { type: 'send' });

  const msgBefore = state.threads[1].messages.length;
  const runningBefore = state.threads[1].activities.filter((a) => a.status === 'running').length;

  state = previewReducer(state, { type: 'complete', threadId: state.threads[1].id });
  assert.equal(state.threads[1].running, false);
  assert.equal(state.threads[1].messages.length, msgBefore + 1);
  assert.equal(state.threads[1].messages.at(-1).role, 'assistant');
  const runningAfter = state.threads[1].activities.filter((a) => a.status === 'running').length;
  assert.equal(runningAfter, runningBefore - 1, 'running 活动已标记 done');
});

test('complete 未知 threadId 为 no-op（无副作用）', () => {
  let state = createPreviewState();
  const before = JSON.stringify(state.threads);
  state = previewReducer(state, { type: 'complete', threadId: 'unknown' });
  assert.equal(JSON.stringify(state.threads), before);
});

// --- 8. 审批线程隔离 ---

test('decide 仅作用于当前线程的对应 pending approval；其它会话审批不变', () => {
  let state = createPreviewState();
  // 把主会话第一个 approval 的 id 记录下来；切到第二会话，决策它的 approval。
  const secondId = state.threads[1].approvals[0].id;
  state = previewReducer(state, { type: 'select-thread', id: state.threads[1].id });

  const mainBefore = state.threads[0].approvals.map((a) => ({ id: a.id, status: a.status }));
  state = previewReducer(state, { type: 'decide', id: secondId, decision: 'denied' });

  assert.equal(state.threads[1].approvals[0].status, 'denied');
  const mainAfter = state.threads[0].approvals.map((a) => ({ id: a.id, status: a.status }));
  assert.deepEqual(mainAfter, mainBefore, '主会话审批不受第二会话 decide 影响');
});

test('decide 未知 id 或对非 pending 项为 no-op', () => {
  let state = createPreviewState();
  const before = JSON.stringify(state.threads[0].approvals);

  // 未知 id。
  state = previewReducer(state, { type: 'decide', id: 'unknown-approval', decision: 'approved' });
  assert.equal(JSON.stringify(state.threads[0].approvals), before);

  // 对已决策项重复决策也不应回退（fixture 全部 pending，先决策再决策）。
  const firstId = state.threads[0].approvals[0].id;
  state = previewReducer(state, { type: 'decide', id: firstId, decision: 'approved' });
  state = previewReducer(state, { type: 'decide', id: firstId, decision: 'denied' });
  assert.equal(state.threads[0].approvals[0].status, 'approved', '已决策项不被覆盖');
});

// --- 9. 不可变性 / ID 分配 ---

test('reducer 不修改原 state：所有 action 都返回新对象，原 state 引用与 JSON 不变', () => {
  const state = createPreviewState();
  const snapshot = JSON.stringify(state);

  previewReducer(state, { type: 'open-drawer' });
  previewReducer(state, { type: 'close-drawer' });
  previewReducer(state, { type: 'select-thread', id: state.threads[1].id });
  previewReducer(state, { type: 'create-thread' });
  previewReducer(state, { type: 'set-draft', text: 'x' });
  previewReducer(state, { type: 'send' });
  previewReducer(state, { type: 'stop' });
  previewReducer(state, { type: 'open-session' });
  previewReducer(state, { type: 'set-session-tab', tab: 'workspace' });
  previewReducer(state, { type: 'set-page', page: 'goals' });
  previewReducer(state, { type: 'complete', threadId: MAIN_PREVIEW_THREAD });
  previewReducer(state, { type: 'decide', id: state.threads[0].approvals[0].id, decision: 'approved' });

  assert.equal(JSON.stringify(state), snapshot, 'reducer 必须不可变');
});

test('nextId 随 create-thread / send / complete 单调递增，新 ID 不与 fixture 撞', () => {
  let state = createPreviewState();
  const startId = state.nextId;

  // create-thread 占 1。
  state = previewReducer(state, { type: 'create-thread' });
  assert.equal(state.nextId, startId + 1);

  // send 占 3。
  state = previewReducer(state, { type: 'select-thread', id: state.threads[1].id });
  state = previewReducer(state, { type: 'set-draft', text: 'hi' });
  state = previewReducer(state, { type: 'send' });
  assert.equal(state.nextId, startId + 1 + 3);

  // complete 占 1。
  state = previewReducer(state, { type: 'complete', threadId: state.threads[1].id });
  assert.equal(state.nextId, startId + 1 + 3 + 1);

  // 新生成的 thread id 是 preview- 起头，不会与 fixture 现有 ID 重名。
  const createdIds = state.threads.map((t) => t.id);
  for (const id of createdIds) {
    assert.match(id, /^preview-(main|travel|-?\d+)$/);
  }
});
