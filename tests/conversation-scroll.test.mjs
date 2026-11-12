import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationScroll, selectReadingAnchor } from '../src/workspace/conversation-scroll.ts';
import { ScrollAnchorFrame } from '../src/workspace/scroll-follow.ts';

const saved = { messageId: 'b', offset: -25, following: false };
const ids = ['a', 'b', 'c'];
function measure(scroll, shift = 0) {
  scroll.onViewport(100);
  scroll.onContent(500 + shift);
  ids.forEach((id, index) => scroll.onRowLayout(id, { y: index * 150 + shift, height: 120 }));
}
function restored(position = saved) {
  const scroll = new ConversationScroll();
  scroll.updateMessages(true, position, ids);
  measure(scroll);
  return scroll;
}

test('消息锚点选择首个相交行，offset 是行顶部相对视口，间隙与零高度行可用', () => {
  const rows = new Map([
    ['empty', { y: 0, height: 0 }],
    ['a', { y: 100, height: 100 }],
    ['b', { y: 220, height: 300 }],
  ]);
  assert.deepEqual(selectReadingAnchor(['empty', 'a', 'b'], rows, 150), { messageId: 'a', offset: -50, following: false });
  assert.deepEqual(selectReadingAnchor(['a', 'b'], rows, 210), { messageId: 'b', offset: 10, following: false });
  assert.equal(selectReadingAnchor(['empty'], rows, 0), null);
  assert.deepEqual(selectReadingAnchor(['a', 'b'], rows, 600), { messageId: 'b', offset: -380, following: false });
});

test('冷启动等待本地读取、非空 views commit 和锚点行测量，不让首帧覆盖磁盘位置', () => {
  const scroll = new ConversationScroll();
  scroll.updateMessages(false, null, []);
  measure(scroll);
  assert.equal(scroll.target(), null);
  assert.equal(scroll.position(), null);
  scroll.updateMessages(true, saved, []);
  assert.equal(scroll.position(), null, 'localLoaded 的通知可早于 views commit');
  scroll.updateMessages(true, saved, ids);
  assert.equal(scroll.target(), null, '等待行测量，不消费恢复资格');
  assert.deepEqual(scroll.position(), saved, '程序事件尚未恢复时保留原位置');
  measure(scroll);
  assert.deepEqual(scroll.target(), { y: 175 });
  scroll.onViewportScroll(175, false);
  assert.equal(scroll.target(), null);
  assert.deepEqual(scroll.position(), saved);
});

test('缓存到相同权威消息不跳位，新增消息与布局重排按同一个 ID 保阅读', () => {
  const scroll = restored();
  scroll.onViewportScroll(175, false);
  scroll.updateMessages(true, saved, [...ids]);
  assert.equal(scroll.target(), null);
  scroll.updateMessages(true, saved, [...ids, 'd']);
  scroll.onContent(700);
  scroll.onRowLayout('d', { y: 500, height: 150 });
  assert.equal(scroll.target(), null, '新消息不拉到底');
  measure(scroll, 40);
  assert.deepEqual(scroll.target(), { y: 215 }, '字体/附件使前面行变高时按消息 ID 补偿');
  scroll.onViewportScroll(215, false);
  assert.equal(scroll.target(), null);
  assert.deepEqual(scroll.position(), saved);
});

test('锚点被近期缓存裁掉回退到最早可用行，底部夹取后仍不转为跟随', () => {
  const scroll = restored({ messageId: 'trimmed', offset: -999, following: false });
  assert.equal(scroll.isFollowing(), false);
  assert.deepEqual(scroll.position(), { messageId: 'a', offset: 0, following: false });
  assert.equal(scroll.target(), null, '首行在当前视口已到位');
  scroll.onRowLayout('a', { y: 114, height: 120 });
  assert.deepEqual(scroll.target(), { y: 114 });
  const tail = restored({ messageId: 'c', offset: -200, following: false });
  assert.deepEqual(tail.target(), { y: 400 });
  tail.onViewportScroll(400, true);
  assert.equal(tail.isFollowing(), false, '布局夹取到尾部不是用户回到底部');
});

test('用户先于 hydrate/布局主动滚动，取消迟到恢复且惯性也持续更新锚点', () => {
  const scroll = new ConversationScroll();
  scroll.onDrag();
  scroll.updateMessages(true, saved, ids);
  measure(scroll);
  scroll.onViewportScroll(50, false);
  assert.equal(scroll.target(), null, '拖动期间不布局纠偏');
  scroll.onDragEnd(false);
  assert.deepEqual(scroll.position(), { messageId: 'a', offset: -50, following: false });
  scroll.onMomentumBegin();
  scroll.onViewportScroll(190, false);
  scroll.onRowLayout('b', { y: 170, height: 120 });
  assert.equal(scroll.target(), null, '惯性期间也不抢位置');
  scroll.onViewportScroll(210, false);
  scroll.onDragEnd(false);
  assert.deepEqual(scroll.position(), { messageId: 'b', offset: -40, following: false });
  scroll.updateMessages(true, saved, ids);
  assert.deepEqual(scroll.position(), { messageId: 'b', offset: -40, following: false }, '后续 state 通知不能重新恢复旧锚点');
});

test('Tab 隐藏/返回和键盘尺寸变化保留阅读锚点，非用户 scroll 不修改意图', () => {
  const scroll = restored();
  scroll.onViewportScroll(175, false);
  const before = scroll.position();
  scroll.onViewport(0);
  scroll.onContent(0);
  scroll.onRowLayout('b', { y: 0, height: 0 });
  assert.deepEqual(scroll.position(), before);
  scroll.onViewport(220);
  scroll.onViewportScroll(120, false);
  assert.deepEqual(scroll.target(), { y: 175 });
  scroll.onViewportScroll(175, false);
  scroll.updateMessages(true, before, ids);
  assert.equal(scroll.target(), null);
  assert.deepEqual(scroll.position(), before);
  scroll.onDrag();
  scroll.onViewportScroll(185, false);
  scroll.suspendInteraction();
  scroll.onMomentumBegin();
  assert.equal(scroll.isInteracting(), false, '隐藏/后台废弃未结束的手势与迟到惯性资格');
  assert.deepEqual(scroll.position(), { messageId: 'b', offset: -35, following: false });
});

test('只有发送、点最新或用户拖到底恢复跟随；程序惯性事件不获得手势资格', () => {
  const scroll = restored();
  scroll.onViewportScroll(175, false);
  scroll.onMomentumBegin();
  assert.equal(scroll.isInteracting(), false);
  scroll.beginSend();
  assert.deepEqual(scroll.position(), { messageId: null, offset: 0, following: true });
  assert.deepEqual(scroll.target(), { latest: true });
  scroll.onContent(600);
  scroll.onViewportScroll(500, true);
  assert.deepEqual(scroll.target(), { latest: true });
  scroll.onDrag();
  scroll.onViewportScroll(80, false);
  scroll.onDragEnd(false);
  assert.equal(scroll.target(), null);
  scroll.returnLatest();
  scroll.onMomentumBegin();
  assert.equal(scroll.isInteracting(), false, '点最新废弃旧惯性资格');
  assert.deepEqual(scroll.target(), { latest: true });
  scroll.onDrag();
  scroll.onViewportScroll(500, true);
  scroll.onDragEnd(true);
  assert.equal(scroll.isFollowing(), true);
});

test('本地 miss 的首批历史默认跟随；空聊天发送不等待 hydrate 的空视图', () => {
  const scroll = restored(null);
  assert.deepEqual(scroll.target(), { latest: true });
  const empty = new ConversationScroll();
  empty.updateMessages(true, null, []);
  empty.onViewport(100);
  assert.equal(empty.target(), null);
  empty.beginSend();
  assert.deepEqual(empty.position(), { messageId: null, offset: 0, following: true });
  empty.updateMessages(true, null, ['sent']);
  empty.onContent(150);
  assert.deepEqual(empty.target(), { latest: true });
});

test('隐藏后快速返回，已取消的旧帧不能借新资格执行或抹掉新帧', () => {
  const scroll = restored();
  let next = 0;
  const queue = new Map();
  let visible = true;
  let anchors = 0;
  const frame = new ScrollAnchorFrame(
    (callback) => { queue.set(++next, callback); return next; },
    (id) => queue.delete(id),
    () => visible && scroll.target() !== null,
    () => anchors++,
  );
  frame.schedule();
  const late = queue.get(1);
  visible = false;
  frame.cancel();
  visible = true;
  frame.schedule();
  late();
  assert.equal(anchors, 0);
  frame.schedule();
  assert.equal(queue.size, 1, '旧帧不清空当前新帧标记');
  queue.get(2)();
  assert.equal(anchors, 1);
  frame.schedule();
  const beforeDrag = queue.get(3);
  scroll.onDrag();
  frame.cancel();
  scroll.onDragEnd(false);
  beforeDrag();
  assert.equal(anchors, 1, '用户停止拖动后，旧恢复帧仍然作废');
});
