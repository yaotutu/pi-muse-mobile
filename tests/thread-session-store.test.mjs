/** 不依赖 React 的会话草稿、权威回读和删除竞态回归。 */

import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { ThreadSessionStore } = await import('../src/threads/thread-session-store.ts');
const { ApiError } = await import('../src/api/errors.ts');
const { MAIN_THREAD } = await import('../src/threads/thread-state.ts');

// --- stub ApiClient：handler 列表 + 控制式 resolve/reject + signal 监听 ---

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('删除 500 保留草稿并恢复当前运行代次，不伪成功或自动重试', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);
  store.setDraft('a', '消息草稿');
  store.setInstructions('a', '规则草稿');
  const epoch = store.get('a').epoch;
  stub.enqueue('deleteThread', rejectWith(new ApiError(500, '删除部分失败')));
  await assert.rejects(store.deleteThread('a'), (error) => error.status === 500);
  assert.equal(store.canWrite('a'), true);
  assert.equal(store.isCurrent('a', epoch), true);
  assert.equal(store.get('a').deleted, false);
  assert.equal(store.get('a').draft, '消息草稿');
  assert.equal(store.get('a').instructions.draft, '规则草稿');
  assert.equal(stub.callCount('deleteThread'), 1);
});

test('技能保存 500 保留全部修改并释放写锁', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);
  stub.enqueue('getThreadSkills', resolveWith({ skills: [makeSkill('web', true, true), makeSkill('write', true, true)] }));
  await store.loadSkills('a');
  store.setSkill('a', 'web', false);
  store.setSkill('a', 'write', false);
  stub.enqueue('saveThreadSkills', rejectWith(new ApiError(500, '保存失败')));
  assert.equal(await store.saveSkills('a'), false);
  assert.deepEqual(store.get('a').skills.draft, { web: false, write: false });
  assert.equal(store.hasSettingsWrite('a'), false);
  assert.equal(store.get('a').skills.error, '保存失败');
  assert.equal(stub.callCount('saveThreadSkills'), 1);
});

test('连接暂停后禁止设置读写与删除，消息草稿仍可保留', async () => {
  let calls = 0;
  const api = new Proxy({}, { get: () => async () => { calls++; throw new Error('不应发出请求'); } });
  const store = new ThreadSessionStore(api);
  store.get('a').instructions.loaded = true;
  store.get('a').skills.loaded = true;
  store.setEnabled(false);
  store.setDraft('a', '离线草稿');
  store.setInstructions('a', '离线规则草稿');
  await store.loadSettings('a');
  assert.equal(await store.saveInstructions('a'), false);
  assert.equal(await store.saveSkills('a'), false);
  assert.equal(await store.deleteThread('a'), undefined);
  assert.equal(calls, 0);
  assert.equal(store.get('a').draft, '离线草稿');
  assert.equal(store.get('a').instructions.draft, '离线规则草稿');
});

const METHODS = [
  'getThreadInstructions',
  'saveThreadInstructions',
  'getThreadSkills',
  'saveThreadSkills',
  'deleteThread',
];

function makeStub() {
  const queues = Object.fromEntries(METHODS.map((m) => [m, []]));
  const calls = Object.fromEntries(METHODS.map((m) => [m, []]));
  const api = {};
  for (const name of METHODS) {
    api[name] = async (...rest) => {
      const signal = rest.at(-1) instanceof AbortSignal ? rest.pop() : undefined;
      const id = rest[0];
      const args = rest.slice(1);
      const queue = queues[name];
      if (queue.length === 0) {
        throw new Error(`No queued stub for ${name}; ensure tests enqueue enough handlers.`);
      }
      const handler = queue.shift();
      const entry = { id, args, signal };
      calls[name].push(entry);
      const d = defer();
      // handler 是 (ctx) => ...，ctx 提供 resolve/reject 与 abort 监听器。
      // 若 handler 返回 thenable，自动绑定到对外 promise；否则 handler 必须通过
      // resolve/reject 自行控制（避免 handler 返回非 promise 时错误地提早 resolve）。
      let returned;
      try {
        returned = handler({
          id,
          args,
          signal,
          resolve: d.resolve,
          reject: d.reject,
          abortEmitted: new Promise((resolveAbort) => {
            if (signal?.aborted) return resolveAbort({ aborted: true });
            const cleanup = () => resolveAbort({ aborted: true });
            signal?.addEventListener('abort', cleanup, { once: true });
            queueMicrotask(() => {
              if (!signal?.aborted) resolveAbort({ aborted: false });
            });
          }),
        });
      } catch (e) {
        d.reject(e);
        return d.promise;
      }
      if (returned && typeof returned.then === 'function') {
        returned.then(d.resolve, d.reject);
      }
      return d.promise;
    };
  }
  return {
    api,
    enqueue(name, handler) {
      if (!queues[name]) throw new Error(`Unknown method ${name}`);
      queues[name].push(handler);
    },
    call(name, index = 0) {
      return calls[name][index];
    },
    callCount(name) {
      return calls[name].length;
    },
  };
}

const makeSkill = (name, enabled = false, defaultEnabled = false) =>
  ({ name, description: `${name} desc`, defaultEnabled, enabled });

// 列表 handler：自动 resolve 一个值
const resolveWith = (value) => (ctx) => ctx.resolve(value);
const rejectWith = (error) => (ctx) => ctx.reject(error);

// --- 1. A/B 草稿隔离 + 消息 draft 隔离 ---

test('不同会话的 settings 草稿与消息草稿彼此隔离', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);
  store.setDraft('a', 'A 草稿消息');
  store.setDraft('b', 'B 草稿消息');
  assert.equal(store.get('a').draft, 'A 草稿消息');
  assert.equal(store.get('b').draft, 'B 草稿消息');
  // 互改不影响对方。
  store.setDraft('a', 'A 草稿消息 2');
  assert.equal(store.get('a').draft, 'A 草稿消息 2');
  assert.equal(store.get('b').draft, 'B 草稿消息');

  // settings 草稿也隔离。
  store.setInstructions('a', 'A rules');
  store.setInstructions('b', 'B rules');
  assert.equal(store.get('a').instructions.draft, 'A rules');
  assert.equal(store.get('b').instructions.draft, 'B rules');
  // 一个会话在保存中，另一个仍可继续修改自己的草稿。
  stub.enqueue('getThreadInstructions', resolveWith({ instructions: '' }));
  await store.loadInstructions('a');
  // 让 a 进入 saving：直接通过 stub 模拟一次成功保存。
  stub.enqueue('saveThreadInstructions', resolveWith({ instructions: 'A rules' }));
  const saveA = store.saveInstructions('a');
  store.setInstructions('b', 'B rules 改');
  // a 的草稿被允许修改（因为是另一会话）；b 的草稿也已更新。
  assert.equal(store.get('b').instructions.draft, 'B rules 改');
  await saveA;
  // a 保存后 draft=saved 即被对齐。
  assert.equal(store.get('a').instructions.draft, 'A rules');
  assert.equal(store.get('a').instructions.saved, 'A rules');
});

// --- 2. delayed A read 切 B 不污染 B ---

test('A 的延迟读返回时切到 B，不能把 A 的内容应用到 B', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);

  // A 第一条 read：延迟但故意忽略 signal，等 store 切到 B 后才 resolve。
  let resolveA;
  const gateA = new Promise((res) => { resolveA = res; });
  stub.enqueue('getThreadInstructions', () => gateA);
  const loadA = store.loadInstructions('a');

  // 第二步：切到 B，读自己的内容。
  stub.enqueue('getThreadInstructions', resolveWith({ instructions: 'B rules' }));
  await store.loadInstructions('b');
  assert.equal(store.get('b').instructions.draft, 'B rules');
  assert.equal(store.get('b').instructions.saved, 'B rules');

  // 第三步：A 的延迟终于回来——不污染 B。
  resolveA({ instructions: 'A rules' });
  await loadA;
  // A 自身的状态已收尾：被 abort / 已删除 epoch —— 让我们看 A 的内容。
  assert.equal(store.get('a').instructions.saved, 'A rules');
  // B 的内容依然只有 B 自己的。
  assert.equal(store.get('b').instructions.saved, 'B rules');
  assert.equal(store.get('b').instructions.draft, 'B rules');
});

// --- 3. read 最新规则保留 dirty draft（saved 回读更新） ---

test('loadSkills 回读时若草稿已偏离 saved，则保留草稿字段（去掉已移除项）', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);

  // 第一次拉取目录：A、B 都在。
  stub.enqueue('getThreadSkills', resolveWith({
    skills: [makeSkill('a', true), makeSkill('b', false)],
  }));
  await store.loadSkills('a');
  // 草稿与 saved 对齐：开 a 关 b。
  assert.deepEqual(store.get('a').skills.saved, { a: true, b: false });
  assert.deepEqual(store.get('a').skills.draft, { a: true, b: false });

  // 用户改 dirty 草稿：关 a。
  store.setSkill('a', 'a', false);
  assert.deepEqual(store.get('a').skills.draft, { a: false, b: false });
  assert.equal(store.hasDirtySettings('a'), true);

  // 服务端目录变化：b 不再注册，新增 c。
  stub.enqueue('getThreadSkills', resolveWith({
    skills: [makeSkill('a', true, true), makeSkill('c', false, false)],
  }));
  await store.loadSkills('a');

  // saved 更新成 {a: true, c: false}；草稿 a 字段保留、b（已移除）丢弃、c 用默认值。
  assert.deepEqual(store.get('a').skills.saved, { a: true, c: false });
  assert.deepEqual(store.get('a').skills.draft, { a: false, c: false });
  // 已移除项触发 notice。
  assert.ok(store.get('a').skills.notice?.includes('b'), `expected notice to mention b, got: ${store.get('a').skills.notice}`);
});

// --- 4. save 返回 trim 服务端结果回填 / 超 20k 本地阻止 ---

test('saveInstructions 回填服务端值；超长时不发起请求', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);

  // 先 load，让 target.loaded=true。
  stub.enqueue('getThreadInstructions', resolveWith({ instructions: 'orig' }));
  await store.loadInstructions('a');
  // store 直发 draft，不在本层 trim；调用方有责任交给服务端前自己 trim。
  store.setInstructions('a', '   新规则 ');

  let sentInstructions;
  stub.enqueue('saveThreadInstructions', ({ args, resolve }) => {
    sentInstructions = args[0];
    // 服务端代表 trim 两侧空白。
    resolve({ instructions: '新规则' });
  });
  const ok = await store.saveInstructions('a');
  assert.equal(ok, true);
  // 客户端按原样提交 draft，trim 是调用方职责。
  assert.equal(sentInstructions, '   新规则 ');
  // 回填后 saved/draft 都与服务端响应一致。
  assert.equal(store.get('a').instructions.saved, '新规则');
  assert.equal(store.get('a').instructions.draft, '新规则');

  // 超长：本地拦截，不调用 saveThreadInstructions。
  const longText = 'x'.repeat(20_001);
  store.setInstructions('a', longText);
  const before = stub.callCount('saveThreadInstructions');
  const ok2 = await store.saveInstructions('a');
  const after = stub.callCount('saveThreadInstructions');
  assert.equal(ok2, false);
  assert.equal(after, before, '超长不能调用 api.saveThreadInstructions');
  assert.ok(store.get('a').instructions.error?.includes('20,000') || store.get('a').instructions.error?.includes('20000'), 'err 应包含数字限制');
});

// --- 5. save skills 完整目录包含 false / restore (defaults) 空表 ---

test('saveSkills 普通保存提交整个目录；defaults=true 提交空覆盖表', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);

  stub.enqueue('getThreadSkills', resolveWith({
    skills: [makeSkill('a', false), makeSkill('b', true)],
  }));
  await store.loadSkills('a');
  store.setSkill('a', 'a', true);

  let sentOverrides;
  stub.enqueue('saveThreadSkills', ({ args, resolve }) => {
    sentOverrides = args[0];
    resolve({
      skills: [makeSkill('a', true, false), makeSkill('b', true, true)],
    });
  });
  const ok = await store.saveSkills('a');
  assert.equal(ok, true);
  assert.deepEqual(sentOverrides, { a: true, b: true }, '普通保存覆盖整个目录，每个开关显式表达');

  // restore：发送空覆盖表。
  const before = stub.callCount('saveThreadSkills');
  let restoreOverrides;
  stub.enqueue('saveThreadSkills', ({ args, resolve }) => {
    restoreOverrides = args[0];
    resolve({
      skills: [makeSkill('a', false, false), makeSkill('b', true, true)],
    });
  });
  const okRestore = await store.saveSkills('a', true);
  assert.equal(okRestore, true);
  assert.deepEqual(restoreOverrides, {}, 'defaults=true 应发送 overrides: {}');
  assert.equal(stub.callCount('saveThreadSkills'), before + 1);
});

// --- 6. 400 保留现存草稿且刷新移除未知名，不无限重试 ---

test('saveSkills 收到 400 时本地草稿保留、自动刷新目录移除未知名、且不无限重试', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);

  stub.enqueue('getThreadSkills', resolveWith({
    skills: [makeSkill('a', true), makeSkill('b', false)],
  }));
  await store.loadSkills('a');
  // 用户改 a → false。
  store.setSkill('a', 'a', false);
  assert.deepEqual(store.get('a').skills.draft, { a: false, b: false });

  stub.enqueue('saveThreadSkills', rejectWith(new ApiError(400, '技能不可写')));
  // 紧随其后，被 400 触发的内部 loadSkills。
  stub.enqueue('getThreadSkills', resolveWith({
    skills: [makeSkill('a', true), makeSkill('c', false)],
  }));

  const callsBefore = stub.callCount('saveThreadSkills');
  const loadsBefore = stub.callCount('getThreadSkills');
  const ok = await store.saveSkills('a');
  const callsAfter = stub.callCount('saveThreadSkills');
  const loadsAfter = stub.callCount('getThreadSkills');
  assert.equal(ok, false);
  assert.equal(callsAfter, callsBefore + 1, '只发生一次 400，不再重试');
  assert.equal(loadsAfter, loadsBefore + 1, '刷新一次以移除未知名');
  // 等待内部 finally 中可能串起的 loadSkills 完成（refreshCatalog）。
  await new Promise(setImmediate);
  assert.equal(stub.callCount('getThreadSkills'), loadsBefore + 1, '不无限重试，只一次刷新');
  // draft 中 a=false 仍保留；b 被从目录中移除。
  assert.deepEqual(store.get('a').skills.draft, { a: false, c: false });
  // error 内容是原始 400 文本。
  assert.equal(store.get('a').skills.error, '技能不可写');
});

// --- 7. delete 同步锁：saving 中禁保存/重复 delete；清除草稿缓存 ---

test('deleteThread 在 hasSettingsWrite 时返回 undefined；inFlight 后第二次直接拒绝', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);

  stub.enqueue('getThreadInstructions', resolveWith({ instructions: '' }));
  await store.loadInstructions('a');

  // 把 a 推进 saving 中：用一个永不 resolve 的 save 来保持锁。
  let resolveSave;
  const gate = new Promise((res) => { resolveSave = res; });
  stub.enqueue('saveThreadInstructions', () => gate);
  const savePromise = store.saveInstructions('a');
  // 微任务推进后再断言状态。
  await new Promise(setImmediate);
  assert.equal(store.hasSettingsWrite('a'), true);

  // deleteThread 在 saving 时拒绝。
  const result = await store.deleteThread('a');
  assert.equal(result, undefined, 'saving 中 delete 直接 undefined');
  assert.equal(stub.callCount('deleteThread'), 0, '不应发 delete 请求');

  // 释放 save 让其完成。
  resolveSave({ instructions: 'noop' });
  await savePromise;

  // 现在发起真正的 delete。
  let resolveDelete;
  const gateDel = new Promise((res) => { resolveDelete = res; });
  stub.enqueue('deleteThread', ({ resolve }) => resolve({ ok: true, removed: { jobs: 0, monitors: 0 } }));
  const firstDelete = store.deleteThread('a');

  // 等待 deleting=true 后，第二次 delete 进入应观察到 deleting=true 路径。
  await new Promise(setImmediate);
  const secondDelete = await store.deleteThread('a');
  assert.equal(secondDelete, undefined, 'deleting 中重复请求返回 undefined');
  // 并没有发第二条 delete 请求——canWrite 在 deleting 时也 false。
  await firstDelete;
  assert.equal(stub.callCount('deleteThread'), 1);

  // delete 完成后旧 entry 在 canWrite 视图上是 deleted，新 get 给出 deleted 状态，setDraft/setInstructions 都会被 canWrite 拦截。
  assert.equal(store.canWrite('a'), false);
  store.setDraft('a', '幽灵 draft');
  // setDraft 拒绝 silently，已删 entry 的 draft 仍保留以前值。
  assert.equal(store.get('a').deleted, true);
});

test('MAIN_THREAD (local-main) 删除时直接抛 409；保留可写', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);
  await assert.rejects(store.deleteThread(MAIN_THREAD), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    return true;
  });
  assert.equal(stub.callCount('deleteThread'), 0);
  // 主会话只被拒绝删除，但仍可写入/修改。
  assert.equal(store.canWrite(MAIN_THREAD), true);
});

// --- 8. 404 视为已不存在清理 ---

test('deleteThread 收到 404 时也清空 entry', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);
  // 触发 entry 出现。
  store.setDraft('a', 'placeholder');
  stub.enqueue('deleteThread', rejectWith(new ApiError(404, '会话不存在')));
  const result = await store.deleteThread('a');
  assert.deepEqual(result, { ok: true, removed: { jobs: 0, monitors: 0 } });
  assert.equal(store.canWrite('a'), false);
});

test('删除中的 409 保留草稿和代次，不把冲突当作删除成功或自动重试', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);
  store.setDraft('a', '待发送消息');
  store.setInstructions('a', '未保存规则');
  const epoch = store.get('a').epoch;
  stub.enqueue('deleteThread', rejectWith(new ApiError(409, '会话正在删除', 'THREAD_DELETING')));
  await assert.rejects(store.deleteThread('a'), (error) => error.status === 409 && error.code === 'THREAD_DELETING');
  assert.equal(stub.callCount('deleteThread'), 1);
  assert.equal(store.get('a').deleting, false);
  assert.equal(store.get('a').deleted, false);
  assert.equal(store.isCurrent('a', epoch), true);
  assert.equal(store.get('a').draft, '待发送消息');
  assert.equal(store.get('a').instructions.draft, '未保存规则');
});

for (const kind of ['instructions', 'skills']) {
  test(`${kind} 保存遇到删除中的 409 保留草稿，不刷新目录或自动重试`, async () => {
    const stub = makeStub();
    const store = new ThreadSessionStore(stub.api);
    const load = kind === 'instructions' ? 'getThreadInstructions' : 'getThreadSkills';
    const save = kind === 'instructions' ? 'saveThreadInstructions' : 'saveThreadSkills';
    stub.enqueue(load, resolveWith(kind === 'instructions'
      ? { instructions: '原规则' }
      : { skills: [makeSkill('web', true, true)] }));
    if (kind === 'instructions') {
      await store.loadInstructions('a');
      store.setInstructions('a', '新规则');
    } else {
      await store.loadSkills('a');
      store.setSkill('a', 'web', false);
    }
    const draft = structuredClone(store.get('a')[kind].draft);
    const saved = structuredClone(store.get('a')[kind].saved);
    const epoch = store.get('a').epoch;
    stub.enqueue(save, rejectWith(new ApiError(409, '会话正在删除，请刷新会话列表后重新选择', 'THREAD_DELETING')));
    const result = kind === 'instructions' ? await store.saveInstructions('a') : await store.saveSkills('a');
    assert.equal(result, false);
    assert.equal(stub.callCount(load), 1);
    assert.equal(stub.callCount(save), 1);
    assert.equal(store.hasSettingsWrite('a'), false);
    assert.equal(store.isCurrent('a', epoch), true);
    assert.deepEqual(store.get('a')[kind].draft, draft);
    assert.deepEqual(store.get('a')[kind].saved, saved);
    assert.match(store.get('a')[kind].error, /刷新会话列表后重新选择/);
  });
}

// --- 9. 500 保留草稿 + 解除锁 + 不伪成功 ---

test('saveInstructions 500 时草稿保留、saving=false、返回 false', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);
  stub.enqueue('getThreadInstructions', resolveWith({ instructions: 'orig' }));
  await store.loadInstructions('a');
  store.setInstructions('a', '新指令');
  stub.enqueue('saveThreadInstructions', rejectWith(new ApiError(500, '服务器开小差')));
  const ok = await store.saveInstructions('a');
  assert.equal(ok, false, '不能伪成功');
  assert.equal(store.get('a').instructions.saving, false, '保存结束应清 saving 锁');
  assert.equal(store.get('a').instructions.draft, '新指令', '草稿保留');
  assert.equal(store.get('a').instructions.saved, 'orig', 'saved 未更新');
  assert.equal(store.get('a').instructions.error, '服务器开小差');

  // 同会话再次提交仍可走：saving 锁已释放。
  stub.enqueue('saveThreadInstructions', resolveWith({ instructions: '新指令' }));
  const ok2 = await store.saveInstructions('a');
  assert.equal(ok2, true);
  assert.equal(store.get('a').instructions.saved, '新指令');
});

// --- 10. delete 与晚到 GET（忽略 signal 的 promise）不得复活 ---

test('deleteThread 期间 read 已经中途发出、忽略 signal 仍 resolve 时，不能复活 entry', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);

  // 第一条 getThreadInstructions：模拟忽略 signal 的服务端（不监听 abort，且仍 resolve）。
  let resolveLate;
  const gate = new Promise((res) => { resolveLate = res; });
  stub.enqueue('getThreadInstructions', ({ resolve }) => {
    // 不读 signal，直接 resolve。
    resolve(gate.then(() => ({ instructions: '路上迟到的旧读' })));
  });
  const loadingPromise = store.loadInstructions('a');
  await new Promise(setImmediate);

  // 启动 delete：delete 把 in-flight reads abort+移除。
  stub.enqueue('deleteThread', ({ resolve }) => {
    // 等到 GET 完全 resolve 后再继续，避免读到 epoch 旧状态。
    setTimeout(() => resolve({ ok: true, removed: { jobs: 0, monitors: 0 } }), 0);
  });
  const result = await store.deleteThread('a');
  assert.deepEqual(result, { ok: true, removed: { jobs: 0, monitors: 0 } });
  assert.equal(store.canWrite('a'), false);

  // 晚到的 GET 终于返回。
  resolveLate();
  await loadingPromise;

  // 迟到的内容不应"复活" a：canWrite 仍 false，entry 应处于 deleted 状态，saved 不应是旧读内容。
  assert.equal(store.canWrite('a'), false);
  const entry = store.get('a');
  assert.equal(entry.deleted, true);
  // 不会被错误地写入 instructions.saved（loadInstructions 的 apply 会因为 isCurrent=false 被拒绝）。
  assert.notEqual(entry.instructions.saved, '路上迟到的旧读');
});

// --- 11. saving 未完成禁止 delete ---

test('saveSkills 进行中触发 deleteThread 应直接 undefined', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);

  stub.enqueue('getThreadSkills', resolveWith({
    skills: [makeSkill('a', true)],
  }));
  await store.loadSkills('a');
  store.setSkill('a', 'a', false);

  let resolveSave;
  const gate = new Promise((res) => { resolveSave = res; });
  stub.enqueue('saveThreadSkills', () => gate);
  const savePromise = store.saveSkills('a');
  await new Promise(setImmediate);
  assert.equal(store.hasSettingsWrite('a'), true);

  const result = await store.deleteThread('a');
  assert.equal(result, undefined, 'saving 中 delete 拒绝');
  assert.equal(stub.callCount('deleteThread'), 0);

  // 释放 save。
  resolveSave({ skills: [makeSkill('a', false)] });
  await savePromise;
  // 再发起 delete 应成功（不残留 settings write 锁）。
  stub.enqueue('deleteThread', ({ resolve }) => resolve({ ok: true, removed: { jobs: 0, monitors: 0 } }));
  const ok2 = await store.deleteThread('a');
  assert.deepEqual(ok2, { ok: true, removed: { jobs: 0, monitors: 0 } });
});

// --- 12. dispose 取消所有进行中的 GET ---

test('dispose 取消正在 loading 的 read；dispose 后 AbortController 应被 abort', async () => {
  const stub = makeStub();
  const store = new ThreadSessionStore(stub.api);

  let observedAbort = false;
  // 真实路径的服务端应响应 abort 抛 AbortError；这里从 ctx.reject 直接拒绝。
  stub.enqueue('getThreadInstructions', ({ signal, reject }) => {
    signal?.addEventListener('abort', () => {
      observedAbort = true;
      const e = new Error('Aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
  const loading = store.loadInstructions('a');
  // 让 controller 注册与 stub handler 跑完。
  await new Promise(setImmediate);

  store.dispose();
  await new Promise(setImmediate);
  assert.equal(observedAbort, true, 'dispose 必须 abort 现有 GET 的 AbortController');

  // loadInstructions 应被 abort 路径 reject 收尾（store 静默跳过错设），避免悬挂。
  await loading.catch(() => {});
  // dispose 后再调用应不抛——只是不再做动作。
  store.dispose();
});
