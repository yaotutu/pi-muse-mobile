import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const { positionFeedbackMenu } = await import('../src/feedback/menu-position.ts');

const viewport = { width: 320, height: 640 };
const safe = { top: 24, bottom: 24 };
const menu = { width: 184, height: 160 };
const within = ({ x, y }) => {
  assert.ok(x >= 8 && x + menu.width <= viewport.width - 8);
  assert.ok(y >= safe.top + 8 && y + menu.height <= viewport.height - safe.bottom - 8);
};

test('锚定菜单在 320dp、首尾与长消息下不越界，并优先贴近消息', () => {
  const top = positionFeedbackMenu({ x: 220, y: 30, width: 90, height: 44 }, menu, viewport, safe, 'right', 8, 8, 0);
  within(top);
  assert.ok(top.y >= 82, '首条消息空间不足时放在下方');
  const bottom = positionFeedbackMenu({ x: 12, y: 540, width: 250, height: 48 }, menu, viewport, safe, 'left', 8, 8, 0);
  within(bottom);
  assert.ok(bottom.y < 540, '尾条消息空间不足时放在上方');
  const long = positionFeedbackMenu({ x: -6, y: -100, width: 300, height: 900 }, menu, viewport, safe, 'right', 8, 8, 0);
  within(long);
});

test('Android 全屏 Modal 用安全区修正测量原点，上下菜单与气泡保持 8dp 间隔', () => {
  // 来自本轮原生 XML 的像素尺寸；换成 dp 后用状态栏安全区对齐两个窗口原点。
  const density = 2.625;
  const inset = 136 / density;
  const screen = { width: 1080 / density, height: 2400 / density };
  const nativeMenu = { width: 483 / density, height: 414 / density };
  const nativeSafe = { top: inset, bottom: 24 };
  const short = { x: 53 / density, y: (676 - 136) / density,
    width: 897 / density, height: 150 / density };
  const below = positionFeedbackMenu(short, nativeMenu, screen, nativeSafe, 'left', 8, 8, inset);
  assert.ok(Math.abs(below.y - (826 / density + 8)) < 0.01);
  const long = { x: 53 / density, y: (1604 - 136) / density,
    width: 897 / density, height: 308 / density };
  const above = positionFeedbackMenu(long, nativeMenu, screen, nativeSafe, 'left', 8, 8, inset);
  assert.ok(Math.abs(above.y + nativeMenu.height - (1604 / density - 8)) < 0.01);
  assert.ok(above.y >= nativeSafe.top + 8);
  const web = positionFeedbackMenu({ ...short, y: 676 / density }, nativeMenu,
    screen, nativeSafe, 'left', 8, 8, 0);
  assert.equal(web.y, below.y, '同一原点的 Web/iOS 不额外偏移');
});

test('反馈归属、唯一 Hook、无反馈时零徽标与菜单生命周期', () => {
  const view = read('src/workspace/ConversationView.tsx');
  const controls = read('src/feedback/MessageFeedbackControls.tsx');
  assert.match(view, /message\.feedbackAvailable === true && conversation\.sessionId &&\s+conversation\.persistedMessageIds\.has\(message\.id\) && message\.feedback/);
  assert.match(view, /<Message\s+key=\{message\.id\}/);
  assert.match(view, /measureInWindow\(/);
  assert.match(view, /accessible=\{false\} focusable=\{false\}/);
  assert.match(view, /testID=\{feedbackScope \? `message-bubble-\$\{message\.id\}` : undefined\}/);
  assert.equal((view + controls).match(/useMessageFeedback\(/g)?.length, 1);
  assert.match(controls, /const hasBadge = feedback\.reaction !== null \|\| count > 0/);
  assert.match(controls, /\{hasBadge && bubbleLayout && <Pressable/);
  assert.match(controls, /testID=\{`message-feedback-badge-\$\{messageId\}`\}/);
  assert.match(controls, /positionFeedbackMenu\(/);
  assert.match(controls, /Platform\.OS === 'android' \? insets\.top : 0/);
  assert.match(controls, /statusBarTranslucent navigationBarTranslucent/);
  assert.match(controls, /useSharedValue\(0\)/);
  assert.match(controls, /reducedMotion \? 1 : withTiming/);
  assert.doesNotMatch(controls, /grabber|消息操作<\/Text>|助手消息<\/Text>|当前未选择/);
});

test('反应成功收起菜单，失败保留核对；评论和复制入口保持独立', () => {
  const source = read('src/feedback/MessageFeedbackControls.tsx');
  assert.match(source, /if \(await setReaction\(feedback\.reaction === reaction \? null : reaction\)\) closePanel\(\)/);
  assert.match(source, /if \(await addComment\(text\)\) setDraft\(''\)/);
  assert.match(source, /if \(await editComment\(editingId, text\)\)/);
  assert.match(source, /if \(await deleteComment\(id\)\) setDeletingId\(null\)/);
  assert.match(source, /const locked = loading \|\| busy \|\| uncertain/);
  assert.match(source, /if \(!busy && !loading\) void refresh\(\)/);
  assert.match(source, /testID=\{`message-comments-panel-\$\{messageId\}`\}/);
  assert.match(source, /label="刷新核对反馈"/);
  assert.match(source, /Clipboard\.setStringAsync\(messageText\)/);
  assert.match(source, /onRequestClose=\{closePanel\}/);
  assert.doesNotMatch(source, /onPress=\{send\}|MoreHorizontal|message-feedback-open-/);
});

test('正文链接、代码复制、附件及原生写入前记账保持', () => {
  const content = read('src/workspace/MessageContent.tsx');
  const view = read('src/workspace/ConversationView.tsx');
  const native = read('tools/e2e-message-feedback-native.py');
  assert.match(content, /accessibilityRole="link"[^>]*onLongPress=\{onMessageLongPress\}[\s\S]*?onPress=/);
  assert.match(content, /accessibilityLabel="复制代码" onPress=/);
  assert.match(view, /<MessageAttachments items=\{message\.attachments\} \/>/);
  assert.match(native, /def bubble_press_point\(message_id\):/);
  assert.match(native, /def badge_state\(message_id, reaction\):/);
  assert.match(native, /result\['steps'\]\.append\(\{'name': name, 'status': 'attempted'\}\)\s+save\(\)\s+click\(\)/);
});
