import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('只有已落盘且服务端允许的消息气泡有长按反馈入口', () => {
  const source = read('src/workspace/ConversationView.tsx');
  assert.match(source, /message\.feedbackAvailable === true && conversation\.sessionId &&\s+conversation\.persistedMessageIds\.has\(message\.id\) && message\.feedback/);
  assert.match(source, /<Pressable style=\{bubbleStyle\} disabled=\{!feedbackScope\}/);
  assert.match(source, /onLongPress=\{feedbackScope \? openFeedback : undefined\} accessible=\{false\} focusable=\{false\}/);
  assert.match(source, /testID=\{feedbackScope \? `message-bubble-\$\{message\.id\}` : undefined\}/);
  assert.doesNotMatch(source, /accessibilityLabel=\{`\$\{message\.role === 'user'/);
  assert.match(source, /selectable=\{!feedbackScope\} onLongPress=\{feedbackScope \? openFeedback : undefined\}/);
  assert.match(source, /accessibilityActions=\{feedbackScope \? \[\{ name: 'openMessageActions', label: '打开消息操作' \}\]/);
  assert.match(source, /onAccessibilityAction=\{feedbackScope \? \(event\) => \{ if \(event\.nativeEvent\.actionName === 'openMessageActions'\) openFeedback\(\); \} : undefined\}/);
  assert.match(source, /<Message\s+key=\{message\.id\}/);
  assert.match(source, /const \[feedbackOpenSessionId, setFeedbackOpenSessionId\] = useState<string \| null>\(null\)/);
  assert.match(source, /setFeedbackOpenSessionId\(feedbackScope\.sessionId\)/);
  assert.match(source, /<MessageFeedbackControls\s+key=\{`\$\{feedbackScope\.sessionId\}:\$\{message\.id\}`\}/);
  assert.match(source, /visible=\{feedbackOpenSessionId === feedbackScope\.sessionId\}/);
  assert.doesNotMatch(source, /key=\{message\.feedbackAvailable|setFeedbackOpen\(/);
  assert.match(source, /initialFeedback=\{feedbackScope\.initialFeedback\}/);
  assert.doesNotMatch(source, /conversation\.running.*feedbackScope|message-feedback-open-/);
});

test('Markdown 正文长按优先于文字选择，链接单击、代码复制与附件仍保留', () => {
  const source = read('src/workspace/MessageContent.tsx');
  assert.match(source, /selectable=\{!onMessageLongPress\} onLongPress=\{onMessageLongPress\}/);
  assert.match(source, /accessibilityRole="link"[^>]*onLongPress=\{onMessageLongPress\}[\s\S]*?messageActionAccessibility\(onMessageLongPress\)\} onPress=/);
  assert.match(source, /accessibilityActions: \[\{ name: 'openMessageActions', label: '打开消息操作' \}\]/);
  assert.match(source, /onAccessibilityAction: \(event\) => \{ if \(event\.nativeEvent\.actionName === 'openMessageActions'\) onOpen\(\); \}/);
  assert.doesNotMatch(source, /accessibilityLabel=\{text\}|accessibilityLabel="助手消息/);
  assert.match(source, /accessibilityLabel="复制代码" onPress=/);
  assert.match(read('src/workspace/ConversationView.tsx'), /<MessageAttachments items=\{message\.attachments\} \/>/);
});

test('单个面板管理互斥反应与多评论，聊天列表无常驻反馈节点', () => {
  const source = read('src/feedback/MessageFeedbackControls.tsx');
  assert.match(source, /useMessageFeedback\(\{ spaceId, sessionId, messageId, initialFeedback \}\)/);
  assert.match(source, /return visible && <Modal/);
  assert.match(source, /testID=\{section === 'actions' \? `message-feedback-menu-\$\{messageId\}`/);
  assert.match(source, /message-feedback-state-\$\{messageId\}/);
  assert.match(source, /feedback\.reaction === reaction \? null : reaction/);
  assert.match(source, /if \(await addComment\(text\)\) setDraft\(''\)/);
  assert.match(source, /if \(await editComment\(editingId, text\)\)/);
  assert.match(source, /if \(await deleteComment\(id\)\) setDeletingId\(null\)/);
  assert.match(source, /const locked = loading \|\| busy \|\| uncertain/);
  assert.match(source, /setSection\('comments'\);[\s\S]*?if \(!busy && !loading\) void refresh\(\)/);
  assert.match(source, /!loading && !error && !uncertain && count === 0/);
  assert.match(source, /onRequestClose=\{closePanel\}/);
  assert.match(source, /Keyboard\.dismiss\(\);\s+onClose\(\)/);
  assert.match(source, /label="复制消息"/);
  assert.match(source, /<FormInput multiline maxLength=\{4000\} accessibilityLabel="新评论"/);
  assert.match(source, /<FormInput multiline maxLength=\{4000\} accessibilityLabel="编辑评论"/);
  assert.doesNotMatch(source, /MoreHorizontal|message-feedback-open-|setExpanded|commentsOpen|inputFocused/);
});

test('原生辅助脚本长按可见目标气泡并继续保留写入前记账', () => {
  const source = read('tools/e2e-message-feedback-native.py');
  assert.match(source, /def bubble_press_point\(message_id\):/);
  assert.match(source, /find\('message-bubble-' \+ message_id\)/);
  assert.match(source, /box, viewport = bounds\(bubble\), chat_viewport\(\)/);
  assert.match(source, /sh\('shell', 'input', 'swipe', str\(point\[0\]\), str\(point\[1\]\),/);
  assert.match(source, /'900'\)/);
  assert.match(source, /result\['steps'\]\.append\(\{'name': name, 'status': 'attempted'\}\)\s+save\(\)\s+click\(\)/);
  assert.doesNotMatch(source, /message-feedback-open-|def seek_entry\(/);
});
