import assert from 'node:assert/strict';
import './register-source.mjs';
import test from 'node:test';

const {
  LOCAL_MAIN_ID,
  PROMPT_MAX,
  TITLE_MAX,
  normalizeTaskInput,
  isValid,
  defaultSourceId,
  isCurrentPersisted,
  ensureLocalMain,
} = await import('../src/activity/task-source.ts');

/** 来源列表里只描述 id/updatedAt，与服务端 ThreadInfo 形状一致。 */
const sourceThreads = [
  { id: 'local-main', updatedAt: '2026-10-01T00:00:00Z' },
  { id: 'thread-a', updatedAt: '2026-10-02T00:00:00Z' },
  { id: 'thread-b', updatedAt: '2026-10-03T00:00:00Z' },
];

// --- 来源默认选择 ---

test('currentThread 已在 sourceThreads 中则沿用', () => {
  assert.equal(defaultSourceId(sourceThreads, 'thread-a'), 'thread-a');
});

test('currentThread 未在 sourceThreads 中则默认 local-main', () => {
  // 客户端未持久化会话，不能作为通知来源，必须回退主会话。
  assert.equal(defaultSourceId(sourceThreads, 'unsaved/thread'), LOCAL_MAIN_ID);
});

test('sourceThreads 为空时仍能退回 local-main（防御性补位）', () => {
  assert.equal(defaultSourceId([], 'thread-x'), LOCAL_MAIN_ID);
});

test('isCurrentPersisted 区分已存/未存', () => {
  assert.equal(isCurrentPersisted(sourceThreads, 'thread-a'), true);
  assert.equal(isCurrentPersisted(sourceThreads, 'local-new'), false);
  // sourceThreads 之外的会话即便名字相近也不匹配。
  assert.equal(isCurrentPersisted(sourceThreads, 'thread'), false);
});

test('ensureLocalMain 缺补一份在头部，已含则原样返回', () => {
  const without = ensureLocalMain([{ id: 'thread-a', updatedAt: '' }]);
  assert.equal(without[0].id, LOCAL_MAIN_ID);
  assert.equal(without.length, 2);

  const withMain = ensureLocalMain(sourceThreads);
  assert.equal(withMain.length, sourceThreads.length);
  assert.deepEqual(withMain, sourceThreads);
});

// --- 表单 trim 与边界 ---

test('normalizeTaskInput 仅 trim prompt 与 title，不擅自改大小写', () => {
  const result = normalizeTaskInput({ prompt: '  汇总今天  ', title: '  日报  ' });
  assert.deepEqual(result, {
    prompt: '汇总今天',
    title: '日报',
    errors: {},
  });
});

test('normalizeTaskInput 空 prompt（或只有空白）报 prompt 错', () => {
  const blank = normalizeTaskInput({ prompt: '   ' });
  assert.equal(blank.prompt, '');
  assert.equal(blank.errors.prompt, '任务指令不能为空');

  const empty = normalizeTaskInput({ prompt: '' });
  assert.equal(empty.errors.prompt, '任务指令不能为空');
});

test('normalizeTaskInput 缺标题时 title 为 undefined 而非空串', () => {
  const result = normalizeTaskInput({ prompt: '汇总' });
  assert.equal(result.title, undefined);
  assert.deepEqual(result.errors, {});
});

test('normalizeTaskInput prompt 超长报错，title 留空不报', () => {
  const longPrompt = 'x'.repeat(PROMPT_MAX + 1);
  const result = normalizeTaskInput({ prompt: longPrompt, title: '日报' });
  assert.equal(result.errors.prompt, `指令最多 ${PROMPT_MAX} 字`);
  assert.equal(result.errors.title, undefined);
  // 即使超长也保留 trim 结果，调用方可选择错误态下也提交一次。
  assert.equal(result.prompt.length, PROMPT_MAX + 1);
});

test('normalizeTaskInput title 超长报错，prompt 通过', () => {
  const longTitle = 't'.repeat(TITLE_MAX + 1);
  const result = normalizeTaskInput({ prompt: '汇总', title: longTitle });
  assert.equal(result.errors.title, `标题最多 ${TITLE_MAX} 字`);
  assert.equal(result.errors.prompt, undefined);
});

test('prompt 长度恰为上限时不出错', () => {
  const result = normalizeTaskInput({ prompt: 'p'.repeat(PROMPT_MAX), title: 't'.repeat(TITLE_MAX) });
  assert.deepEqual(result.errors, {});
});

test('isValid 只看 errors 是否都空', () => {
  assert.equal(isValid({}), true);
  assert.equal(isValid({ prompt: undefined, title: undefined }), true);
  assert.equal(isValid({ prompt: 'x' }), false);
  assert.equal(isValid({ title: 'x' }), false);
});
