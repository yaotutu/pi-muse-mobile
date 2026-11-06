import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DockPreferenceStore,
  DOCK_PIN_LIMIT,
  getDockStorageKey,
} from '../src/workspace/dock-preferences.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('有序持久化：加载保持原始顺序，固定追加末尾，取消保持相对顺序，写盘内容严格一致', async () => {
  let saved = JSON.stringify(['agent-a', 'agent-b']);
  const writes = [];
  const storage = {
    read: async () => saved,
    write: async (value) => {
      saved = value;
      writes.push(JSON.parse(value));
    },
  };

  const store = new DockPreferenceStore(storage);
  await store.load();
  assert.deepEqual(store.getSnapshot().pinned, ['agent-a', 'agent-b']);
  assert.equal(store.getSnapshot().loading, false);

  // 固定新 agent-c：追加到末尾
  const pinSuccess = await store.togglePin('agent-c');
  assert.equal(pinSuccess, true);
  assert.deepEqual(store.getSnapshot().pinned, ['agent-a', 'agent-b', 'agent-c']);
  assert.deepEqual(JSON.parse(saved), ['agent-a', 'agent-b', 'agent-c']);

  // 取消中间的 agent-b：其余项顺序不变
  const unpinSuccess = await store.togglePin('agent-b');
  assert.equal(unpinSuccess, true);
  assert.deepEqual(store.getSnapshot().pinned, ['agent-a', 'agent-c']);
  assert.deepEqual(JSON.parse(saved), ['agent-a', 'agent-c']);

  // 重新加载验证落盘一致性
  const reloaded = new DockPreferenceStore(storage);
  await reloaded.load();
  assert.deepEqual(reloaded.getSnapshot().pinned, ['agent-a', 'agent-c']);
});

test('上限拒绝：达到 DOCK_PIN_LIMIT (3) 后拒绝追加并保留原状态，不静默截断，允许取消固定', async () => {
  let saved = JSON.stringify(['slot-1', 'slot-2', 'slot-3']);
  let writeCalls = 0;
  const storage = {
    read: async () => saved,
    write: async (value) => {
      writeCalls++;
      saved = value;
    },
  };

  const store = new DockPreferenceStore(storage);
  await store.load();
  assert.equal(store.getSnapshot().pinned.length, DOCK_PIN_LIMIT);

  // 已满状态下尝试固定第 4 个：必须拒绝，返回 false，且不触发存储写入
  const overflowResult = await store.togglePin('slot-4');
  assert.equal(overflowResult, false);
  assert.deepEqual(store.getSnapshot().pinned, ['slot-1', 'slot-2', 'slot-3']);
  assert.equal(writeCalls, 0);
  assert.deepEqual(JSON.parse(saved), ['slot-1', 'slot-2', 'slot-3']);

  // 取消已固定项：正常成功并落盘
  const unpinResult = await store.togglePin('slot-2');
  assert.equal(unpinResult, true);
  assert.deepEqual(store.getSnapshot().pinned, ['slot-1', 'slot-3']);
  assert.equal(writeCalls, 1);

  // 现在有空槽位，可以再次固定新 agent
  const pinNewResult = await store.togglePin('slot-4');
  assert.equal(pinNewResult, true);
  assert.deepEqual(store.getSnapshot().pinned, ['slot-1', 'slot-3', 'slot-4']);
  assert.equal(writeCalls, 2);
});

test('reorder：支持完整数组重排与索引移动，非法参数拒绝且不破坏原偏好', async () => {
  let saved = JSON.stringify(['first', 'second', 'third']);
  const storage = {
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
  };

  const store = new DockPreferenceStore(storage);
  await store.load();

  // 数组重排
  const reorderArrayResult = await store.reorder(['third', 'first', 'second']);
  assert.equal(reorderArrayResult, true);
  assert.deepEqual(store.getSnapshot().pinned, ['third', 'first', 'second']);
  assert.deepEqual(JSON.parse(saved), ['third', 'first', 'second']);

  // 索引移动 (fromIndex: 0, toIndex: 2) -> 'third' 移到最后
  const reorderIndexResult = await store.reorder(0, 2);
  assert.equal(reorderIndexResult, true);
  assert.deepEqual(store.getSnapshot().pinned, ['first', 'second', 'third']);
  assert.deepEqual(JSON.parse(saved), ['first', 'second', 'third']);

  // 拒绝非法重排：包含无效字符、包含 'group'、存在重复、超上限
  assert.equal(await store.reorder(['first', 'group', 'second']), false);
  assert.equal(await store.reorder(['first', 'first', 'second']), false);
  assert.equal(await store.reorder(['first', 'second', 'third', 'fourth']), false);
  assert.equal(await store.reorder(-1, 2), false);
  assert.equal(await store.reorder(0, 5), false);

  // 状态未受破坏
  assert.deepEqual(store.getSnapshot().pinned, ['first', 'second', 'third']);
});

test('迟到写入不覆盖新值：在途旧写入完成后不能回滚更新代次的值与错误状态', async () => {
  const firstGate = deferred();
  const writes = [];
  let callIndex = 0;

  const storage = {
    read: async () => JSON.stringify([]),
    write: async (value) => {
      callIndex++;
      const currentCall = callIndex;
      if (currentCall === 1) {
        await firstGate.promise;
      }
      writes.push(JSON.parse(value));
    },
  };

  const store = new DockPreferenceStore(storage);
  await store.load();

  // 发起第 1 次写入：被 firstGate 阻塞在 storage.write
  const write1Promise = store.togglePin('agent-slow');
  assert.equal(store.getSnapshot().saving, true);
  assert.deepEqual(store.getSnapshot().pinned, ['agent-slow']);

  // 发起第 2 次操作：调整顺序为 agent-fast
  const write2Promise = store.reorder(['agent-fast']);
  assert.deepEqual(store.getSnapshot().pinned, ['agent-fast']);

  // 释放第 1 次写入
  firstGate.resolve();
  await write1Promise;
  await write2Promise;
  await store.whenSaved();

  // 迟到的第 1 次写入不覆写第 2 次的最新结果
  assert.deepEqual(store.getSnapshot().pinned, ['agent-fast']);
  assert.equal(store.getSnapshot().saving, false);
  assert.equal(store.getSnapshot().error, undefined);
});

test('迟到写入失败不污染新状态；迟到读取不覆盖用户已操作的值', async () => {
  // 1. 迟到写入失败
  const slowWrite = deferred();
  let writes = 0;
  const storage = {
    read: async () => JSON.stringify([]),
    write: async () => {
      writes++;
      if (writes === 1) {
        await slowWrite.promise;
        throw new Error('disk fail');
      }
    },
  };

  const store = new DockPreferenceStore(storage);
  await store.load();

  const op1 = store.togglePin('agent-a');
  const op2 = store.togglePin('agent-b');

  // 让 op1 发生错误
  slowWrite.resolve();
  await op1;
  await op2;
  await store.whenSaved();

  // op1 的迟到失败不能把 op2 的状态重置或把 error 误标到 op2 上
  assert.deepEqual(store.getSnapshot().pinned, ['agent-a', 'agent-b']);
  assert.equal(store.getSnapshot().error, undefined);

  // 2. 迟到读取
  const slowRead = deferred();
  const readStore = new DockPreferenceStore({
    read: () => slowRead.promise,
    write: async () => {},
  });

  const loading = readStore.load();
  await readStore.togglePin('agent-immediate');
  assert.deepEqual(readStore.getSnapshot().pinned, ['agent-immediate']);

  // 迟到的旧数据返回 []，不能覆盖用户最新固定
  slowRead.resolve(JSON.stringify(['agent-old']));
  await loading;
  assert.deepEqual(readStore.getSnapshot().pinned, ['agent-immediate']);
});

test('存储键规则复用置顶存储键（编码服务器地址），且 group 禁止固定', async () => {
  const key = getDockStorageKey('https://example.com:8080');
  assert.ok(key.startsWith('pi-muse-avatar-pins-'));
  assert.doesNotMatch(key, /[/:.]/);

  const store = new DockPreferenceStore({ read: async () => null, write: async () => {} });
  await store.load();
  assert.equal(await store.togglePin('group'), false);
  assert.deepEqual(store.getSnapshot().pinned, []);
});
