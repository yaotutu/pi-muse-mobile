import assert from 'node:assert/strict';
import test from 'node:test';
import { ScrollAnchorFrame, ScrollFollow } from '../src/workspace/scroll-follow.ts';

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
  assert.equal(anchors, 2, '隐藏会话不执行排队锚定');
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

test('手动上滚保持旧消息阅读，重新进入会话只在原本跟随时锚定', () => {
  const follow = new ScrollFollow();
  follow.beginSend();
  follow.onContentSizeChange();
  follow.onScroll(true);
  follow.onDrag();
  assert.deepEqual(follow.onScroll(false), { anchor: false, showLatest: true });
  follow.onDragEnd(false);
  assert.equal(follow.shouldAnchor(), false);
  assert.equal(follow.onContentSizeChange(), false, '隐藏会话的后续流内容不抢走手动位置');
  follow.returnLatest();
  assert.equal(follow.shouldAnchor(), true);
});
