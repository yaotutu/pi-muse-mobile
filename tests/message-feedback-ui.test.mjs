import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('反馈只挂载到服务端允许、当前会话已落盘且有反馈初值的消息', () => {
  const source = read('src/workspace/ConversationView.tsx');
  assert.match(source, /message\.feedbackAvailable === true && conversation\.sessionId &&\s+conversation\.persistedMessageIds\.has\(message\.id\) && message\.feedback/);
  assert.match(source, /key=\{`\$\{feedbackScope\.sessionId\}:\$\{message\.id\}`\}/);
  assert.match(source, /initialFeedback=\{feedbackScope\.initialFeedback\}/);
  assert.ok(source.indexOf('<MessageFeedbackControls') > source.indexOf('message.toolCalls.map'));
  assert.doesNotMatch(read('src/workspace/MessageContent.tsx'), /MessageFeedbackControls|useMessageFeedback/);
});

test('反馈 UI 独立于聊天发送，并保留撤销、评论草稿和结果待核对入口', () => {
  const source = read('src/feedback/MessageFeedbackControls.tsx');
  assert.match(source, /useMessageFeedback\(\{ spaceId, sessionId, messageId, initialFeedback \}\)/);
  assert.match(source, /feedback\.reaction === reaction \? null : reaction/);
  assert.match(source, /if \(await addComment\(text\)\) setDraft\(''\)/);
  assert.match(source, /if \(await editComment\(editingId, text\)\)/);
  assert.match(source, /if \(await deleteComment\(id\)\) setDeletingId\(null\)/);
  assert.match(source, /const locked = loading \|\| busy \|\| uncertain/);
  assert.match(source, /const openComments = \(\) => \{\s+setCommentsOpen\(true\);[\s\S]*?if \(!busy && !loading\) void refresh\(\);\s+\}/);
  assert.match(source, /onPress=\{openComments\}/);
  assert.match(source, /!loading && !error && !uncertain && count === 0 && <Text style=\{styles\.caption\}>还没有评论<\/Text>/);
  assert.match(source, /feedback\.comments\.map\(/);
  assert.match(source, /label="刷新核对反馈"/);
  assert.match(source, /onRequestClose=\{closeComments\}/);
  assert.match(source, /const closeComments = \(\) => \{\s+Keyboard\.dismiss\(\);\s+setCommentsOpen\(false\);/);
  assert.doesNotMatch(source, /inputFocused|setInputFocused|onFocus=|onBlur=/);
  assert.match(source, /<FormInput multiline maxLength=\{4000\} accessibilityLabel="新评论"/);
  assert.match(source, /<FormInput multiline maxLength=\{4000\} accessibilityLabel="编辑评论"/);
  assert.doesNotMatch(source, /runAgent\(|send\(|nextClientId\(|setDraft\(''\);\s*await addComment/);
});
