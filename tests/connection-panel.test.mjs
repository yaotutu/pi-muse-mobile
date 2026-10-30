import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectionSaveAvailability,
  describeStatus,
  isPlainHttp,
  ownsConnectionDraft,
  runConnectionOperation,
  tryNormalize,
} from '../src/workspace/connection-panel-helpers.ts';

test('保存不依赖测试证明，换服和未知旧配置必须先确认', () => {
  const base = { serverUrl: 'https://new.example', storedUrl: undefined, status: 'unconfigured', confirmed: false, busy: false, locked: false };
  assert.deepEqual(connectionSaveAvailability(base), { requiresConfirmation: false, enabled: true });
  assert.deepEqual(connectionSaveAvailability({ ...base, storedUrl: base.serverUrl, status: 'online' }),
    { requiresConfirmation: false, enabled: true }, '同址空密钥可直接尝试沿用当前登录状态');
  assert.deepEqual(connectionSaveAvailability({ ...base, storedUrl: 'https://old.example', status: 'online' }),
    { requiresConfirmation: true, enabled: false });
  assert.deepEqual(connectionSaveAvailability({ ...base, storedUrl: 'https://old.example', status: 'online', confirmed: true }),
    { requiresConfirmation: true, enabled: true });
  assert.deepEqual(connectionSaveAvailability({ ...base, status: 'storage-error' }),
    { requiresConfirmation: true, enabled: false }, '旧配置不可读也不能跳过清理确认');
  assert.deepEqual(connectionSaveAvailability({ ...base, status: 'storage-error', confirmed: true }),
    { requiresConfirmation: true, enabled: true });
  for (const changes of [{ serverUrl: undefined }, { busy: true }, { locked: true }]) {
    assert.equal(connectionSaveAvailability({ ...base, ...changes }).enabled, false);
  }
});

test('直接保存的探测被关闭或改草稿取消后释放 busy，迟到结果不关闭新草稿', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const operation = { current: false };
  const busy = [];
  let draftId = 1;
  let closed = false;
  const save = runConnectionOperation(operation, () => false, () => true, (value) => busy.push(value), async () => {
    await pending;
    if (ownsConnectionDraft(1, draftId, false)) closed = true;
  });
  draftId++;
  finish();
  await save;
  assert.deepEqual(busy, [true, false]);
  assert.equal(closed, false);
  assert.equal(operation.current, false);
});

test('retry/start 期间改草稿仍释放 busy，旧成功不关闭新表单', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const operation = { current: false };
  const transitions = [];
  let draftId = 1;
  let closed = false;
  const first = runConnectionOperation(operation, () => false, () => true, (value) => transitions.push(value), async () => {
    await pending;
    if (ownsConnectionDraft(1, draftId, false)) closed = true;
  });
  assert.deepEqual(transitions, [true]);
  draftId++;
  finish();
  await first;
  assert.deepEqual(transitions, [true, false]);
  assert.equal(operation.current, false);
  assert.equal(closed, false);
  await runConnectionOperation(operation, () => false, () => true, (value) => transitions.push(value), async () => {});
  assert.deepEqual(transitions, [true, false, true, false], '新草稿可以再次测试或保存');
});

test('旧请求失败不覆盖新草稿错误，卸载后只释放操作锁', async () => {
  let rejectRequest;
  const pending = new Promise((_, reject) => { rejectRequest = reject; });
  const operation = { current: false };
  const transitions = [];
  let draftId = 3;
  let error;
  const first = runConnectionOperation(operation, () => false, () => true, (value) => transitions.push(value), async () => {
    try { await pending; }
    catch (caught) { if (ownsConnectionDraft(3, draftId, false)) error = caught.message; }
  });
  draftId++;
  rejectRequest(new Error('旧地址失败'));
  await first;
  assert.equal(error, undefined);
  assert.deepEqual(transitions, [true, false]);
  assert.equal(ownsConnectionDraft(4, 4, true), false);
  await runConnectionOperation(operation, () => false, () => false, (value) => transitions.push(value), async () => {});
  assert.equal(operation.current, false);
  assert.deepEqual(transitions, [true, false, true], '卸载后不写 React state');
});

// describeStatus 必须覆盖 ConnectionStatus 全部取值并保持 stable tone。

for (const status of [
  'loading',
  'unconfigured',
  'connecting',
  'online',
  'offline',
  'authentication-required',
  'resetting',
  'reset-error',
  'storage-error',
]) {
  test(`describeStatus 翻译 ${status} 返回中文 label + detail + tone`, () => {
    const view = describeStatus(status);
    assert.equal(typeof view.label, 'string');
    assert.ok(view.label.length > 0, `status=${status} 应有中文 label`);
    assert.equal(typeof view.detail, 'string');
    assert.ok(['neutral', 'success', 'warning', 'danger'].includes(view.tone));
  });
}

test('online 用 success tone；offline / reset-error / storage-error 用 danger tone', () => {
  assert.equal(describeStatus('online').tone, 'success');
  assert.equal(describeStatus('offline').tone, 'danger');
  assert.equal(describeStatus('reset-error').tone, 'danger');
  assert.equal(describeStatus('storage-error').tone, 'danger');
});

test('connecting / authentication-required / resetting 使用 warning tone 提示用户等待', () => {
  assert.equal(describeStatus('connecting').tone, 'warning');
  assert.equal(describeStatus('authentication-required').tone, 'warning');
  assert.equal(describeStatus('resetting').tone, 'warning');
});

// isPlainHttp 必须区分大小写并允许前后空白；同时 https 必须返回 false。

for (const [input, expected] of [
  ['http://example.com', true],
  ['HTTP://EXAMPLE.COM', true],
  ['  http://192.0.2.1:8788  ', true],
  ['https://example.com', false],
  ['ws://example.com', false],
  ['', false],
]) test(`isPlainHttp：${JSON.stringify(input)} → ${expected}`, () => assert.equal(isPlainHttp(input), expected));

// tryNormalize 必须与 normalizeServerAddress 行为一致：成功路径返回规范化值，失败返回错误文案。

test('tryNormalize 接受合法 https 基础地址', () => {
  const result = tryNormalize('https://example.com');
  assert.equal(result.ok, true);
  assert.equal(result.value, 'https://example.com');
});

test('tryNormalize 接受带尾斜杠的 http 地址并去除', () => {
  const result = tryNormalize('http://192.0.2.1:8788/');
  assert.equal(result.ok, true);
  assert.equal(result.value, 'http://192.0.2.1:8788');
});

test('tryNormalize 拒绝非法地址并返回错误文案，不抛异常', () => {
  const result = tryNormalize('example.com');
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
});

test('tryNormalize 拒绝带账号信息的地址', () => {
  const result = tryNormalize('https://user:secret@example.com');
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('账号') || result.error.includes('密码'));
});

test('tryNormalize 拒绝查询参数', () => {
  const result = tryNormalize('https://example.com?token=abc');
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('查询参数') || result.error.includes('基础地址'));
});
