/** 不依赖 React 的会话草稿、权威回读和删除竞态回归。 */

import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { ChatSessionStore } = await import('../src/sessions/chat-session-store.ts');
const deleteOptions = { scheduleDisposition: 'delete', scheduleRevision: 'schedule-rev' };
const { AssistantSettingsStore } = await import('../src/sessions/assistant-settings-store.ts');
const { ApiError } = await import('../src/api/errors.ts');
const { MAIN_SESSION_ID } = await import('../src/sessions/types.ts');

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

test('删除 500 保留草稿并锁住发送，不伪成功或自动重试', async () => {
  const stub = makeStub();
  const store = new ChatSessionStore(stub.api);
  store.setDraft('a', '消息草稿');
  const epoch = store.get('a').epoch;
  stub.enqueue('deleteSession', rejectWith(new ApiError(500, '删除部分失败')));
  await assert.rejects(store.deleteSession('a', deleteOptions), (error) => error.status === 500);
  assert.equal(store.canWrite('a'), false);
  assert.equal(store.isCurrent('a', epoch), false);
  assert.equal(store.get('a').deleted, false);
  assert.equal(store.get('a').draft, '消息草稿');
  assert.equal(stub.callCount('deleteSession'), 1);
});

test('技能保存 500 保留全部修改并释放写锁', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);
  stub.enqueue('getAssistantSkills', resolveWith({ skills: [makeSkill('web', true, true), makeSkill('write', true, true)] }));
  await store.loadSkills();
  store.setSkill('builtin/web', false);
  store.setSkill('builtin/write', false);
  stub.enqueue('saveAssistantSkills', rejectWith(new ApiError(500, '保存失败')));
  assert.equal(await store.saveSkills(), false);
  assert.deepEqual(store.state.skills.draft, { 'builtin/web': false, 'builtin/write': false });
  assert.equal(store.hasSettingsWrite(), false);
  assert.equal(store.state.skills.error, '保存失败');
  assert.equal(stub.callCount('saveAssistantSkills'), 1);
});

test('连接暂停后禁止网络写入，仍可保留消息草稿', async () => {
  let calls = 0;
  const api = new Proxy({}, { get: () => async () => { calls++; } });
  const store = new ChatSessionStore(api);
  const settings = new AssistantSettingsStore(api);
  store.setEnabled(false); settings.setEnabled(false);
  store.setDraft('a', '离线草稿');
  await settings.loadSettings();
  assert.equal(await settings.saveInstructions(), false);
  assert.equal(await settings.saveSkills(), false);
  assert.equal(await store.deleteSession('a', deleteOptions), undefined);
  assert.equal(calls, 0);
  assert.equal(store.get('a').draft, '离线草稿');
});

const METHODS = [
  'getAssistantInstructions',
  'saveAssistantInstructions',
  'getAssistantSkills',
  'getAssistantSkill',
  'saveAssistantSkills',
  'deleteSession',
  'resetSession',
];

function makeStub() {
  const queues = Object.fromEntries(METHODS.map((m) => [m, []]));
  const calls = Object.fromEntries(METHODS.map((m) => [m, []]));
  const api = {};
  for (const name of METHODS) {
    api[name] = async (...rest) => {
      const signal = rest.at(-1) instanceof AbortSignal ? rest.pop() : undefined;
      const assistant = name.includes('Assistant');
      const id = assistant ? undefined : rest[0];
      const args = assistant ? rest : rest.slice(1);
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
  ({ id: `builtin/${name}`, name, source: 'builtin', description: `${name} desc`, defaultEnabled, enabled });

// 列表 handler：自动 resolve 一个值
const resolveWith = (value) => (ctx) => ctx.resolve(value);
const rejectWith = (error) => (ctx) => ctx.reject(error);

// --- 1. A/B 草稿隔离 + 消息 draft 隔离 ---

test('不同会话仅隔离聊天草稿，助手设置跨会话共享', () => {
  const chats = new ChatSessionStore({});
  const settings = new AssistantSettingsStore({});
  chats.setDraft('a', 'A'); chats.setDraft('b', 'B');
  settings.setInstructions('所有会话使用的规则');
  chats.clear('a');
  assert.equal(chats.get('a').draft, '');
  assert.equal(chats.get('b').draft, 'B');
  assert.equal(settings.state.instructions.draft, '所有会话使用的规则');
});
test('loadSkills 回读时若草稿已偏离 saved，则保留草稿字段（去掉已移除项）', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);

  // 第一次拉取目录：A、B 都在。
  stub.enqueue('getAssistantSkills', resolveWith({
    skills: [makeSkill('a', true), makeSkill('b', false)],
  }));
  await store.loadSkills();
  // 草稿与 saved 对齐：开 a 关 b。
  assert.deepEqual(store.state.skills.saved, { 'builtin/a': true, 'builtin/b': false });
  assert.deepEqual(store.state.skills.draft, { 'builtin/a': true, 'builtin/b': false });

  // 用户改 dirty 草稿：关 a。
  store.setSkill('builtin/a', false);
  assert.deepEqual(store.state.skills.draft, { 'builtin/a': false, 'builtin/b': false });

  // 服务端目录变化：b 不再注册，新增 c。
  stub.enqueue('getAssistantSkills', resolveWith({
    skills: [makeSkill('a', true, true), makeSkill('c', false, false)],
  }));
  await store.loadSkills();

  // saved 更新成 {a: true, c: false}；草稿 a 字段保留、b（已移除）丢弃、c 用默认值。
  assert.deepEqual(store.state.skills.saved, { 'builtin/a': true, 'builtin/c': false });
  assert.deepEqual(store.state.skills.draft, { 'builtin/a': false, 'builtin/c': false });
  // 已移除项触发 notice。
  assert.ok(store.state.skills.notice?.includes('b'), `expected notice to mention b, got: ${store.state.skills.notice}`);
});

// --- 4. save 返回 trim 服务端结果回填 / 超 20k 本地阻止 ---

test('saveInstructions 回填服务端值；超长时不发起请求', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);

  // 先 load，让 target.loaded=true。
  stub.enqueue('getAssistantInstructions', resolveWith({ instructions: 'orig' }));
  await store.loadInstructions();
  // store 直发 draft，不在本层 trim；调用方有责任交给服务端前自己 trim。
  store.setInstructions('   新规则 ');

  let sentInstructions;
  stub.enqueue('saveAssistantInstructions', ({ args, resolve }) => {
    sentInstructions = args[0];
    // 服务端代表 trim 两侧空白。
    resolve({ instructions: '新规则' });
  });
  const ok = await store.saveInstructions();
  assert.equal(ok, true);
  // 客户端按原样提交 draft，trim 是调用方职责。
  assert.equal(sentInstructions, '   新规则 ');
  // 回填后 saved/draft 都与服务端响应一致。
  assert.equal(store.state.instructions.saved, '新规则');
  assert.equal(store.state.instructions.draft, '新规则');

  // 超长：本地拦截，不调用 saveAssistantInstructions。
  const longText = 'x'.repeat(20_001);
  store.setInstructions(longText);
  const before = stub.callCount('saveAssistantInstructions');
  const ok2 = await store.saveInstructions();
  const after = stub.callCount('saveAssistantInstructions');
  assert.equal(ok2, false);
  assert.equal(after, before, '超长不能调用 api.saveAssistantInstructions');
  assert.ok(store.state.instructions.error?.includes('20,000') || store.state.instructions.error?.includes('20000'), 'err 应包含数字限制');
});

// --- 5. save skills 完整目录包含 false / restore (defaults) 空表 ---

test('saveSkills 普通保存提交整个目录；defaults=true 提交空覆盖表', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);

  stub.enqueue('getAssistantSkills', resolveWith({
    skills: [makeSkill('a', false), makeSkill('b', true)],
  }));
  await store.loadSkills();
  store.setSkill('builtin/a', true);

  let sentOverrides;
  stub.enqueue('saveAssistantSkills', ({ args, resolve }) => {
    sentOverrides = args[0];
    resolve({
      skills: [makeSkill('a', true, false), makeSkill('b', true, true)],
    });
  });
  const ok = await store.saveSkills();
  assert.equal(ok, true);
  assert.deepEqual(sentOverrides, { 'builtin/a': true, 'builtin/b': true }, '普通保存覆盖整个目录，每个开关显式表达');

  // restore：发送空覆盖表。
  const before = stub.callCount('saveAssistantSkills');
  let restoreOverrides;
  stub.enqueue('saveAssistantSkills', ({ args, resolve }) => {
    restoreOverrides = args[0];
    resolve({
      skills: [makeSkill('a', false, false), makeSkill('b', true, true)],
    });
  });
  const okRestore = await store.saveSkills(true);
  assert.equal(okRestore, true);
  assert.deepEqual(restoreOverrides, {}, 'defaults=true 应发送 overrides: {}');
  assert.equal(stub.callCount('saveAssistantSkills'), before + 1);
});

// --- 6. 400 保留现存草稿且刷新移除未知名，不无限重试 ---

test('saveSkills 收到 400 时本地草稿保留、自动刷新目录移除未知名、且不无限重试', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);

  stub.enqueue('getAssistantSkills', resolveWith({
    skills: [makeSkill('a', true), makeSkill('b', false)],
  }));
  await store.loadSkills();
  // 用户改 a → false。
  store.setSkill('builtin/a', false);
  assert.deepEqual(store.state.skills.draft, { 'builtin/a': false, 'builtin/b': false });

  stub.enqueue('saveAssistantSkills', rejectWith(new ApiError(400, '技能不可写')));
  // 紧随其后，被 400 触发的内部 loadSkills。
  stub.enqueue('getAssistantSkills', resolveWith({
    skills: [makeSkill('a', true), makeSkill('c', false)],
  }));

  const callsBefore = stub.callCount('saveAssistantSkills');
  const loadsBefore = stub.callCount('getAssistantSkills');
  const ok = await store.saveSkills();
  const callsAfter = stub.callCount('saveAssistantSkills');
  const loadsAfter = stub.callCount('getAssistantSkills');
  assert.equal(ok, false);
  assert.equal(callsAfter, callsBefore + 1, '只发生一次 400，不再重试');
  assert.equal(loadsAfter, loadsBefore + 1, '刷新一次以移除未知名');
  // 等待内部 finally 中可能串起的 loadSkills 完成（refreshCatalog）。
  await new Promise(setImmediate);
  assert.equal(stub.callCount('getAssistantSkills'), loadsBefore + 1, '不无限重试，只一次刷新');
  // draft 中 a=false 仍保留；b 被从目录中移除。
  assert.deepEqual(store.state.skills.draft, { 'builtin/a': false, 'builtin/c': false });
  // error 内容是原始 400 文本。
  assert.equal(store.state.skills.error, '技能不可写');
});

// --- 7. delete 同步锁：saving 中禁保存/重复 delete；清除草稿缓存 ---

test('会话删除进行中拒绝重复请求，成功才清理草稿', async () => {
  const stub = makeStub();
  const store = new ChatSessionStore(stub.api);
  store.setDraft('a', '保留到成功');
  const pending = defer();
  stub.enqueue('deleteSession', () => pending.promise);
  const first = store.deleteSession('a', deleteOptions);
  assert.equal(await store.deleteSession('a', deleteOptions), undefined);
  assert.equal(store.get('a').draft, '保留到成功');
  pending.resolve({ ok: true, removed: { sessions: 1, jobs: 0, monitors: 0 }, moved: { jobs: 0, monitors: 0 } });
  await first;
  assert.equal(stub.callCount('deleteSession'), 1);
  assert.equal(store.get('a').deleted, true);
  assert.equal(store.get('a').draft, '');
});
test('MAIN_SESSION_ID (main) 删除时直接抛 409；保留可写', async () => {
  const stub = makeStub();
  const store = new ChatSessionStore(stub.api);
  await assert.rejects(store.deleteSession(MAIN_SESSION_ID, deleteOptions), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    return true;
  });
  assert.equal(stub.callCount('deleteSession'), 0);
  // 主会话只被拒绝删除，但仍可写入/修改。
  assert.equal(store.canWrite(MAIN_SESSION_ID), true);
});

// --- 8. 404 视为已不存在清理 ---

test('deleteSession 收到 404 时也清空 entry', async () => {
  const stub = makeStub();
  const store = new ChatSessionStore(stub.api);
  // 触发 entry 出现。
  store.setDraft('a', 'placeholder');
  stub.enqueue('deleteSession', rejectWith(new ApiError(404, '会话不存在')));
  const result = await store.deleteSession('a', deleteOptions);
  assert.deepEqual(result, { ok: true, removed: { sessions: 0, jobs: 0, monitors: 0 }, moved: { jobs: 0, monitors: 0 } });
  assert.equal(store.canWrite('a'), false);
});

test('删除中的 409 保留草稿和代次，不把冲突当作删除成功或自动重试', async () => {
  const stub = makeStub();
  const store = new ChatSessionStore(stub.api);
  store.setDraft('a', '待发送消息');
  const epoch = store.get('a').epoch;
  stub.enqueue('deleteSession', rejectWith(new ApiError(409, '会话正在删除', 'AGENT_DELETING')));
  await assert.rejects(store.deleteSession('a', deleteOptions), (error) => error.status === 409 && error.code === 'AGENT_DELETING');
  assert.equal(stub.callCount('deleteSession'), 1);
  assert.equal(store.get('a').deleting, false);
  assert.equal(store.get('a').deleted, false);
  assert.equal(store.isCurrent('a', epoch), true);
  assert.equal(store.get('a').draft, '待发送消息');
});

for (const kind of ['instructions', 'skills']) {
  test(`${kind} 保存遇到删除中的 409 保留草稿，不刷新目录或自动重试`, async () => {
    const stub = makeStub();
    const store = new AssistantSettingsStore(stub.api);
    const load = kind === 'instructions' ? 'getAssistantInstructions' : 'getAssistantSkills';
    const save = kind === 'instructions' ? 'saveAssistantInstructions' : 'saveAssistantSkills';
    stub.enqueue(load, resolveWith(kind === 'instructions'
      ? { instructions: '原规则' }
      : { skills: [makeSkill('web', true, true)] }));
    if (kind === 'instructions') {
      await store.loadInstructions();
      store.setInstructions('新规则');
    } else {
      await store.loadSkills();
      store.setSkill('builtin/web', false);
    }
    const draft = structuredClone(store.state[kind].draft);
    const saved = structuredClone(store.state[kind].saved);
    stub.enqueue(save, rejectWith(new ApiError(409, '会话正在删除，请刷新会话列表后重新选择', 'AGENT_DELETING')));
    const result = kind === 'instructions' ? await store.saveInstructions() : await store.saveSkills();
    assert.equal(result, false);
    assert.equal(stub.callCount(load), 1);
    assert.equal(stub.callCount(save), 1);
    assert.equal(store.hasSettingsWrite(), false);
    assert.deepEqual(store.state[kind].draft, draft);
    assert.deepEqual(store.state[kind].saved, saved);
    assert.match(store.state[kind].error, /刷新会话列表后重新选择/);
  });
}

// --- 9. 写入未明须显式回读 ---
for (const kind of ['instructions', 'skills']) {
  test(`${kind} 写入结果未明时保留草稿并锁定，显式回读失败仍保持锁`, async () => {
    const stub = makeStub();
    const store = new AssistantSettingsStore(stub.api);
    const rules = kind === 'instructions';
    const get = rules ? 'getAssistantInstructions' : 'getAssistantSkills';
    const put = rules ? 'saveAssistantInstructions' : 'saveAssistantSkills';
    const initial = rules ? { instructions: '原指令' } : { skills: [makeSkill('web', true, true)] };
    const committed = rules ? { instructions: '新指令' } : { skills: [makeSkill('web', false, true)] };
    const load = (reconcile) => rules ? store.loadInstructions(reconcile) : store.loadSkills(reconcile);
    const save = () => rules ? store.saveInstructions() : store.saveSkills();
    stub.enqueue(get, resolveWith(initial));
    await load();
    if (rules) store.setInstructions('新指令');
    else store.setSkill('builtin/web', false);

    const draft = structuredClone(store.state[kind].draft);
    const previous = structuredClone(store.state[kind].saved);
    stub.enqueue(put, rejectWith(new ApiError(rules ? 500 : 408, '响应未确认')));
    assert.equal(await save(), false);
    assert.equal(store.state[kind].writeUncertain, true);
    assert.equal(store.state[kind].saving, false);
    assert.equal(await save(), false);
    await load();
    assert.equal(stub.callCount(put), 1);
    assert.equal(stub.callCount(get), 1);
    assert.deepEqual(store.state[kind].draft, draft);
    assert.deepEqual(store.state[kind].saved, previous);

    stub.enqueue(get, rejectWith(new ApiError(500, '核对失败')));
    await load(true);
    assert.equal(store.state[kind].writeUncertain, true);
    assert.equal(await save(), false);
    assert.deepEqual(store.state[kind].saved, previous);

    stub.enqueue(get, resolveWith(committed));
    await load(true);
    assert.equal(store.state[kind].writeUncertain, false);
    assert.deepEqual(store.state[kind].saved, draft, '回读发现首次修改已生效');
    assert.deepEqual(store.state[kind].draft, draft);
    assert.equal(stub.callCount(put), 1, '仅核对，不重新发出保存请求');
  });
}

// --- 10. delete 与晚到 GET（忽略 signal 的 promise）不得复活 ---

test('dispose 取消正在 loading 的 read；dispose 后 AbortController 应被 abort', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);

  let observedAbort = false;
  // 真实路径的服务端应响应 abort 抛 AbortError；这里从 ctx.reject 直接拒绝。
  stub.enqueue('getAssistantInstructions', ({ signal, reject }) => {
    signal?.addEventListener('abort', () => {
      observedAbort = true;
      const e = new Error('Aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
  const loading = store.loadInstructions();
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

test('discardFailedSubmission 仅释放精确匹配的 failed 暂存并保留当前输入框', async () => {
  const stub = makeStub();
  const store = new ChatSessionStore(stub.api);
  const attachment = {
    id: 'current-attachment',
    name: 'current.txt',
    kind: 'text',
    mimeType: 'text/plain',
    size: 4,
    dataBase64: 'dGVzdA==',
  };
  const epoch = store.get('a').epoch;
  store.setDraft('a', '当前草稿');
  assert.equal(store.setDraftAttachments('a', epoch, [attachment]).ok, true);
  store.setPendingSubmission('a', epoch, {
    messageId: 'message-1',
    runId: 'run-1',
    text: '失败的旧提交',
    epoch,
    status: 'failed',
    error: '服务器不可用',
    attachments: [{ ...attachment, id: 'pending-attachment', name: 'pending.txt' }],
  });

  assert.equal(store.discardFailedSubmission('b', epoch, 'message-1'), false);
  assert.equal(store.discardFailedSubmission('a', epoch + 1, 'message-1'), false);
  assert.equal(store.discardFailedSubmission('a', epoch, 'message-other'), false);
  assert.equal(store.get('a').pendingSubmission?.messageId, 'message-1');

  assert.equal(store.discardFailedSubmission('a', epoch, 'message-1'), true);
  assert.equal(store.get('a').pendingSubmission, null);
  assert.equal(store.get('a').draft, '当前草稿');
  assert.deepEqual(store.get('a').draftAttachments, [attachment]);
});

test('discardFailedSubmission 拒绝 sending 与 unconfirmed 暂存', async () => {
  const stub = makeStub();
  const store = new ChatSessionStore(stub.api);
  for (const [id, status] of [['sending-agent', 'sending'], ['unconfirmed-agent', 'unconfirmed']]) {
    const epoch = store.get(id).epoch;
    store.setPendingSubmission(id, epoch, {
      messageId: `${id}-message`,
      runId: `${id}-run`,
      text: '仍不能丢弃',
      epoch,
      status,
    });
    assert.equal(store.discardFailedSubmission(id, epoch, `${id}-message`), false);
    assert.equal(store.get(id).pendingSubmission?.status, status);
  }
});

test('discardFailedSubmission 在真实删除、重置不确定与销毁生命周期中均拒绝', async () => {
  const stub = makeStub();
  const store = new ChatSessionStore(stub.api);
  const deleting = makeStub();
  const deletingStore = new ChatSessionStore(deleting.api);
  const deletingEpoch = deletingStore.get('deleting-agent').epoch;
  deletingStore.setPendingSubmission('deleting-agent', deletingEpoch, {
    messageId: 'deleting-message',
    runId: 'deleting-run',
    text: '删除中的旧提交',
    epoch: deletingEpoch,
    status: 'failed',
  });
  let finishDelete;
  deleting.enqueue('deleteSession', () => new Promise((resolve) => { finishDelete = resolve; }));
  const deletePromise = deletingStore.deleteSession('deleting-agent', deleteOptions);
  await new Promise(setImmediate);
  assert.equal(deletingStore.get('deleting-agent').deleting, true);
  assert.equal(deletingStore.discardFailedSubmission('deleting-agent', deletingEpoch, 'deleting-message'), false);
  finishDelete({ ok: true, removed: { sessions: 0, jobs: 0, monitors: 0 }, moved: { jobs: 0, monitors: 0 } });
  await deletePromise;
  assert.equal(deletingStore.canWrite('deleting-agent'), false);
  assert.equal(deletingStore.discardFailedSubmission('deleting-agent', deletingEpoch, 'deleting-message'), false);

  stub.enqueue('resetSession', rejectWith(new ApiError(0, 'network unavailable')));
  await assert.rejects(store.resetSession('reset-agent'));
  assert.equal(store.get('reset-agent').resetUncertain, true);
  assert.equal(store.canWrite('reset-agent'), false);
  assert.equal(store.discardFailedSubmission('reset-agent', store.get('reset-agent').epoch, 'reset-message'), false);

  const disposeEpoch = store.get('dispose-agent').epoch;
  store.setPendingSubmission('dispose-agent', disposeEpoch, {
    messageId: 'dispose-message',
    runId: 'dispose-run',
    text: '销毁后的旧提交',
    epoch: disposeEpoch,
    status: 'failed',
  });
  store.dispose();
  assert.equal(store.discardFailedSubmission('dispose-agent', disposeEpoch, 'dispose-message'), false);
  assert.equal(store.get('dispose-agent').pendingSubmission, null);
});

// --- 12. 技能来源 id 键、详情正文按需加载与错误分支 ---

test('saveSkills 优先以 id 身份（source/name）作为键发送 overrides', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);

  const skills = [
    { id: 'builtin/web', name: 'web', description: 'web desc', source: 'builtin', defaultEnabled: true, enabled: true },
    { id: 'shared/git', name: 'git', description: 'git desc', source: 'shared', defaultEnabled: false, enabled: false },
  ];
  stub.enqueue('getAssistantSkills', resolveWith({ skills }));
  await store.loadSkills();

  assert.deepEqual(store.state.skills.saved, { 'builtin/web': true, 'shared/git': false });
  assert.deepEqual(store.state.skills.draft, { 'builtin/web': true, 'shared/git': false });

  // 使用来源身份设置，避免同名技能混用。
  store.setSkill('shared/git', true);
  assert.deepEqual(store.state.skills.draft, { 'builtin/web': true, 'shared/git': true });

  let sentOverrides;
  stub.enqueue('saveAssistantSkills', ({ args, resolve }) => {
    sentOverrides = args[0];
    resolve({
      skills: [
        { ...skills[0], enabled: true },
        { ...skills[1], enabled: true },
      ],
    });
  });
  const ok = await store.saveSkills();
  assert.equal(ok, true);
  assert.deepEqual(sentOverrides, { 'builtin/web': true, 'shared/git': true });
});

test('同名来源切换不继承草稿，并取消旧来源在途正文和缓存', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);
  const shared = { ...makeSkill('demo'), id: 'shared/demo', source: 'shared' };
  const own = { ...shared, id: 'user/demo', source: 'user' };
  stub.enqueue('getAssistantSkills', resolveWith({ skills: [shared] }));
  await store.loadSkills();
  store.setSkill(shared.id, true);
  store.state.skills.details.demo = { content: '旧来源正文', loading: false };
  let complete;
  let requestSignal;
  stub.enqueue('getAssistantSkill', ({ resolve, signal }) => { complete = resolve; requestSignal = signal; });
  const pending = store.loadSkillDetail('demo');
  await new Promise(setImmediate);
  stub.enqueue('getAssistantSkills', resolveWith({ skills: [own] }));
  await store.loadSkills();
  assert.equal(requestSignal.aborted, true);
  complete({ ...shared, content: '迟到的旧来源正文' });
  await pending;
  assert.deepEqual(store.state.skills.draft, { 'user/demo': false });
  assert.equal(store.state.skills.details.demo, undefined);
});

test('技能正文返回不同来源时不挂到旧标签下', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);
  const shared = { ...makeSkill('demo'), id: 'shared/demo', source: 'shared' };
  stub.enqueue('getAssistantSkills', resolveWith({ skills: [shared] }));
  await store.loadSkills();
  stub.enqueue('getAssistantSkill', resolveWith({ ...shared, id: 'user/demo', source: 'user', content: '另一个来源' }));
  await store.loadSkillDetail('demo');
  assert.equal(store.state.skills.details.demo.content, undefined);
  assert.match(store.state.skills.details.demo.error, /来源已变化/);
});

test('loadSkillDetail 成功加载正文，404 映射为技能正文不可用', async () => {
  const stub = makeStub();
  const store = new AssistantSettingsStore(stub.api);

  // 成功分支
  stub.enqueue('getAssistantSkill', resolveWith({
    id: 'builtin/web',
    name: 'web',
    description: 'web desc',
    source: 'builtin',
    defaultEnabled: true,
    enabled: true,
    content: '# Web 技能说明',
  }));

  const promise = store.loadSkillDetail('web');
  assert.equal(store.state.skills.details.web?.loading, true);
  await promise;

  assert.equal(store.state.skills.details.web?.loading, false);
  assert.equal(store.state.skills.details.web?.content, '# Web 技能说明');
  assert.equal(store.state.skills.details.web?.error, undefined);

  // 404 分支
  stub.enqueue('getAssistantSkill', rejectWith(new ApiError(404, 'Skill not found', 'SKILL_NOT_FOUND')));
  await store.loadSkillDetail('missing');
  assert.equal(store.state.skills.details.missing?.loading, false);
  assert.equal(store.state.skills.details.missing?.content, undefined);
  assert.equal(store.state.skills.details.missing?.error, '技能正文不可用');

  // 通用 500 错误分支
  stub.enqueue('getAssistantSkill', rejectWith(new ApiError(500, '读取技能失败')));
  await store.loadSkillDetail('fail');
  assert.equal(store.state.skills.details.fail?.loading, false);
  assert.equal(store.state.skills.details.fail?.error, '读取技能失败');
});

test('离开助手技能页面取消读取，重新打开可再次读取正文', async () => {
  const stub = makeStub();
  const settings = new AssistantSettingsStore(stub.api);
  const skill = makeSkill('web');
  stub.enqueue('getAssistantSkills', resolveWith({ skills: [skill] }));
  await settings.loadSkills();
  let pending;
  stub.enqueue('getAssistantSkill', (request) => { pending = request; });
  const first = settings.loadSkillDetail(skill.name);
  settings.cancelReads();
  assert.equal(pending.signal.aborted, true);
  assert.equal(settings.state.skills.details.web.loading, false);
  stub.enqueue('getAssistantSkill', resolveWith({ ...skill, content: '新正文' }));
  await settings.loadSkillDetail(skill.name);
  pending.resolve({ ...skill, content: '旧正文' });
  await first;
  assert.equal(settings.state.skills.details.web.content, '新正文');
});
