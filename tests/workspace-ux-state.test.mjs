import assert from 'node:assert/strict';
import test from 'node:test';
import { SpaceLabels, headerSpaceNames, spaceTime } from '../src/workspace/space-labels.ts';

const entry = (id, updatedAt) => ({ id, sessionId: null, updatedAt });

test('空间编号按首次读到的时间分配，刷新与重排不改当前连接标签', () => {
  let labels = new SpaceLabels();
  labels = labels.sync([
    entry('side-new', '2026-10-30T09:00:00Z'),
    entry('side-old', '2026-10-29T09:00:00Z'),
    entry('local-main', '2026-10-30T10:00:00Z'),
  ]);
  assert.equal(labels.title('local-main'), '主空间');
  assert.equal(labels.title('side-old'), '空间 1');
  assert.equal(labels.title('side-new'), '空间 2');
  const same = labels.sync([
    entry('side-new', '2026-11-01T09:00:00Z'),
    entry('side-old', '2026-11-02T09:00:00Z'),
    entry('local-main', '2026-11-02T10:00:00Z'),
  ]);
  assert.equal(same, labels);
  assert.equal(same.title('side-old'), '空间 1');
  assert.equal(same.title('side-new'), '空间 2');
});

test('新空间获得新编号，删除不影响已有标签，坏时间不伪造日期', () => {
  let labels = new SpaceLabels().sync([entry('local-main', '2026-10-30T00:00:00Z'), entry('side-a', '2026-10-30T01:00:00Z')]);
  labels = labels.sync([entry('local-main', '2026-10-30T00:00:00Z'), entry('side-a', '2026-10-30T01:00:00Z'), entry('side-b', '2026-10-30T02:00:00Z')]);
  assert.equal(labels.title('side-b'), '空间 2');
  labels = labels.sync([entry('local-main', '2026-10-30T00:00:00Z'), entry('side-b', '2026-10-30T02:00:00Z')]);
  assert.equal(labels.title('side-b'), '空间 2');
  assert.equal(spaceTime('bad-date'), '时间未知');
});

test('主空间与键盘态无聊天名称，非主空间仅键盘收起时显示，面板只给非主空间名称', () => {
  const labels = new SpaceLabels().sync([
    entry('local-main', '2026-10-30T00:00:00Z'),
    entry('side-a', '2026-10-30T01:00:00Z'),
  ]);
  assert.equal(labels.title('local-main'), '主空间', '侧栏主空间名称不变');
  assert.deepEqual(headerSpaceNames(labels, 'local-main', false), { chat: null, session: null });
  assert.deepEqual(headerSpaceNames(labels, 'local-main', true), { chat: null, session: null });
  assert.deepEqual(headerSpaceNames(labels, 'side-a', false), { chat: '空间 1', session: '空间 1' });
  assert.deepEqual(headerSpaceNames(labels, 'side-a', true), { chat: null, session: '空间 1' });
});

test('空主空间的精确 epoch0 显示暂无聊天，真实日期照常显示', () => {
  assert.equal(spaceTime('1970-01-01T00:00:00.000Z'), '暂无聊天');
  assert.equal(spaceTime('1970-01-01T00:00:00.001Z'), new Date('1970-01-01T00:00:00.001Z').toLocaleString());
  assert.equal(spaceTime('2026-10-30T09:00:00Z'), new Date('2026-10-30T09:00:00Z').toLocaleString());
  assert.equal(spaceTime('bad-date'), '时间未知');
});

const { ScrollAnchorFrame, ScrollFollow } = await import('../src/workspace/scroll-follow.ts');

test('布局纠偏只排一帧，迟到帧不抢手动阅读，发送清除旧拖动', () => {
  const follow = new ScrollFollow();
  const pending = new Map();
  let nextFrame = 1;
  let anchors = 0;
  let visible = true;
  let mounted = true;
  const frame = new ScrollAnchorFrame(
    (callback) => { const id = nextFrame++; pending.set(id, callback); return id; },
    (id) => { pending.delete(id); },
    () => visible && mounted && follow.shouldAnchor(),
    () => { anchors += 1; },
  );
  const fire = () => {
    const [id, callback] = pending.entries().next().value;
    pending.delete(id);
    callback();
  };

  assert.equal(follow.onLayout(), true);
  frame.schedule();
  assert.equal(follow.onContentSizeChange(), true);
  frame.schedule();
  assert.equal(follow.onScroll(false).anchor, true);
  frame.schedule();
  assert.equal(pending.size, 1, '布局、内容和最终偏移共用下一帧');
  fire();
  assert.equal(anchors, 1);

  frame.schedule();
  const lateFrame = pending.values().next().value;
  follow.onDrag();
  frame.cancel();
  assert.equal(follow.shouldAnchor(), false, '拖动开始立即停止自动锚定');
  assert.equal(pending.size, 0);
  lateFrame();
  assert.equal(anchors, 1, '已取出的迟到帧也不得抢走手动阅读位置');
  follow.onDragEnd(false);
  frame.schedule();
  fire();
  assert.equal(anchors, 1);

  follow.onDrag();
  follow.beginSend();
  assert.equal(follow.shouldAnchor(), true, '发送清除旧拖动状态');
  frame.schedule();
  fire();
  assert.equal(anchors, 2);
  visible = false;
  frame.schedule();
  fire();
  assert.equal(anchors, 2, '隐藏空间不执行排队锚定');
  visible = true;
  mounted = false;
  frame.schedule();
  fire();
  assert.equal(anchors, 2, '卸载后不执行排队锚定');
});

test('从旧历史发送先锚到最新，流式增长与布局变化继续跟随', () => {
  const follow = new ScrollFollow();
  assert.deepEqual(follow.onScroll(false), { anchor: true, showLatest: false }, '初次布局偏移应纠正，不能误判为手动上滚');
  follow.onDrag();
  assert.deepEqual(follow.onScroll(false), { anchor: false, showLatest: true });
  follow.onDragEnd(false);
  assert.equal(follow.shouldAnchor(), false);
  follow.beginSend();
  assert.equal(follow.shouldAnchor(), true);
  assert.deepEqual(follow.onScroll(false), { anchor: false, showLatest: false }, '新消息尚未入列表时忽略旧偏移');
  assert.equal(follow.onContentSizeChange(), true);
  assert.deepEqual(follow.onScroll(false), { anchor: true, showLatest: false }, '新消息入列表后强制滚到底');
  assert.deepEqual(follow.onScroll(true), { anchor: false, showLatest: false });
  assert.equal(follow.onContentSizeChange(), true, '后续流式增长继续跟随');
});

test('键盘收起的视口与内容布局事件保持最新锚定，只有用户拖动会停止', () => {
  const follow = new ScrollFollow();
  assert.deepEqual(follow.onScroll(false), { anchor: true, showLatest: false }, '键盘改变视口产生的偏移要立即纠正');
  assert.equal(follow.onLayout(), true, '视口变大后重新锚到回复末尾');
  assert.equal(follow.onContentSizeChange(), true, '紧凑顶栏恢复产生的内容尺寸变化也重新锚定');
  assert.deepEqual(follow.onScroll(false), { anchor: true, showLatest: false }, '最终布局迟到的非底部 scroll 必须再次滚到回复末尾');
  assert.deepEqual(follow.onScroll(true), { anchor: false, showLatest: false }, '到底后不再发起重复锚定');
  follow.onDrag();
  assert.deepEqual(follow.onScroll(false), { anchor: false, showLatest: true });
  assert.deepEqual(follow.onDragEnd(false), { anchor: false, showLatest: true });
  assert.equal(follow.onLayout(), false, '手动阅读旧消息时键盘变化不抢走位置');
  assert.equal(follow.onContentSizeChange(), false);
  assert.deepEqual(follow.onScroll(true), { anchor: false, showLatest: true }, '程序滚动也不覆盖用户意图');
  follow.returnLatest();
  assert.equal(follow.onLayout(), true);
  assert.deepEqual(follow.onScroll(false), { anchor: true, showLatest: false }, '手动返回最新后的迟到布局偏移也应纠正');
});

test('手动上滚保持旧消息阅读，重新进入空间只在原本跟随时锚定', () => {
  const follow = new ScrollFollow();
  follow.beginSend();
  follow.onContentSizeChange();
  follow.onScroll(true);
  follow.onDrag();
  assert.deepEqual(follow.onScroll(false), { anchor: false, showLatest: true });
  follow.onDragEnd(false);
  assert.equal(follow.shouldAnchor(), false);
  assert.equal(follow.onContentSizeChange(), false, '隐藏空间的后续流内容不抢走手动位置');
  follow.returnLatest();
  assert.equal(follow.shouldAnchor(), true);
});

const { workspaceBackAction } = await import('../src/workspace/workspace-back.ts');

test('浏览器覆盖时 Back 先收键盘再关闭 viewer，不触发底层会话或设置', () => {
  const state = { keyboardVisible: true, browserOpen: true, sessionMounted: true, drawerOpen: true,
    page: 'settings', settingsSubpage: 'profile', goalCreating: true };
  assert.equal(workspaceBackAction(state), 'keyboard');
  assert.equal(workspaceBackAction({ ...state, keyboardVisible: false }), 'browser');
  assert.equal(workspaceBackAction({ ...state, keyboardVisible: false, browserOpen: false }), 'session');
});

test('Android Back 优先关闭键盘、会话面板和侧栏，然后返回设置子页', () => {
  const state = { keyboardVisible: true, sessionMounted: true, drawerOpen: true, page: 'settings', settingsSubpage: 'profile', goalCreating: false };
  assert.equal(workspaceBackAction(state), 'keyboard');
  assert.equal(workspaceBackAction({ ...state, keyboardVisible: false }), 'session');
  assert.equal(workspaceBackAction({ ...state, keyboardVisible: false, sessionMounted: false }), 'drawer');
  assert.equal(workspaceBackAction({ ...state, keyboardVisible: false, sessionMounted: false, drawerOpen: false }), 'settings');
  assert.equal(workspaceBackAction({ ...state, keyboardVisible: false, sessionMounted: false, drawerOpen: false, settingsSubpage: null }), 'none');
});

test('目标创建态 Back 先由创建流程消费，不落到系统退出', () => {
  const state = { keyboardVisible: false, sessionMounted: false, drawerOpen: false, page: 'goals', settingsSubpage: null, goalCreating: true };
  assert.equal(workspaceBackAction(state), 'goal');
  assert.equal(workspaceBackAction({ ...state, goalCreating: false }), 'none');
});

test('新闻 Back 先关闭键盘和阅读子页，再回聊天', () => {
  const state = { keyboardVisible: true, sessionMounted: false, drawerOpen: false, page: 'news',
    newsArticleOpen: true, newsManaging: true, settingsSubpage: null, goalCreating: false };
  assert.equal(workspaceBackAction(state), 'keyboard');
  assert.equal(workspaceBackAction({ ...state, keyboardVisible: false }), 'news-article');
  assert.equal(workspaceBackAction({ ...state, keyboardVisible: false, newsArticleOpen: false }), 'news-sources');
  assert.equal(workspaceBackAction({ ...state, keyboardVisible: false, newsArticleOpen: false, newsManaging: false }), 'chat');
});
