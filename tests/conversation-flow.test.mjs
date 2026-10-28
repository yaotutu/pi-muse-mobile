/**
 * A01 核心回归测试：模拟 React 支架驱动真实 useConversation Hook 与 SpaceStore 生产路径。
 *
 * 覆盖场景：
 * 1) 终态 RUN_ERROR + 权威历史缺失原 ID：判 failed、保留输入与错误、不锁历史、不自动重发；
 * 2) 恢复未发送正文后可手动发送一次，且不留下重复乐观消息；
 * 3) 原 ID 已持久化后 RUN_ERROR：只保留服务端记录，无重复草稿与暂存；
 * 4) 同步失败后 reload：终态证据对账、旧快照竞态、仍 running / 404 保守待确认；
 * 5) 契约前置拒绝（503 MODEL_NOT_CONFIGURED / 400）判未发送，网络错误保持待确认；
 * 6) 发送后新草稿不被覆盖；恢复按钮拒绝覆盖任何已有草稿（含纯空白）；
 * 7) 卸载/重挂保留暂存；reset / delete / dispose 真实清理与旧回调隔离。
 */

import './helpers/register-conversation-tests.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const { SpaceStore } = await import('../src/spaces/space-store.ts');
const { ApiError } = await import('../src/api/errors.ts');
const { createMockApi, agentStatusOf } = await import('./helpers/conversation-test-harness.ts');
const { renderConversationHook } = await import('./helpers/hook-runner.ts');

const feedback = { reaction: null, comments: [] };
const metadata = (feedbackAvailable = true) => ({
  createdAt: '2026-10-28T00:00:00.000Z', source: 'chat', runId: null, jobId: null,
  notificationId: null, feedbackAvailable,
});
const userMessage = (id, content) => ({ id, role: 'user', content, metadata: metadata(), feedback });
const conversation = (messages, revision, sessionId = 'mock-session') => ({ sessionId, revision, messages });

test('1) 终态 RUN_ERROR + 无原ID历史：failed 保留输入和错误，不锁历史、不自动重发', async () => {
  let runAgentCalled = 0;
  const api = createMockApi({
    getConversation: async () => conversation([], 'rev-initial'),
    runAgent: async (_input, onEvent) => {
      runAgentCalled++;
      // 触发流内终态 RUN_ERROR，随后请求正常 resolve（原始 A01 路径）。
      onEvent({ type: 'RUN_ERROR', code: 'MODEL_ERROR', message: '模型初始化失败' });
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    store.setDraft('space-1', '重要用户灵感');
    let accepted = false;
    await hook.result.current.send(
      '重要用户灵感',
      () => { accepted = true; store.setDraft('space-1', ''); },
    );

    assert.equal(accepted, true, '发送被受理');
    assert.equal(runAgentCalled, 1, '只调用一次 runAgent');
    const pending = store.get('space-1').pendingSubmission;
    assert.ok(pending, 'pending 条目必须保留');
    assert.equal(pending.status, 'failed', '终态 RUN_ERROR + 完整历史缺失 = failed');
    assert.equal(pending.text, '重要用户灵感');
    assert.equal(pending.error, '模型初始化失败');
    assert.equal(hook.result.current.historyFailed, false, 'failed 不冒充历史失败');
    // 权威历史为空，乐观视图失败后被替换；pending 叠加展示唯一一条消息。
    assert.equal(hook.result.current.views.length, 1);
    assert.equal(hook.result.current.views[0].text, '重要用户灵感');
    assert.equal(runAgentCalled, 1, '绝不自动重发');
    // pending 仍然阻塞直接发送，必须先恢复草稿。
    let secondAccepted = false;
    await hook.result.current.send('另一条', () => { secondAccepted = true; });
    assert.equal(secondAccepted, false, 'pending 未处理前禁止发送');
    assert.equal(runAgentCalled, 1);
  } finally {
    hook.unmount();
  }
});

test('2) 恢复未发送正文后可手动发送一次：无重复乐观消息、服务端落盘后释放', async () => {
  let runAgentCalled = 0;
  let submittedId = '';
  const api = createMockApi({
    getConversation: async () => {
      if (!submittedId) return conversation([], 'rev-0');
      return conversation([userMessage(submittedId, '重要用户灵感')], 'rev-1');
    },
    runAgent: async (input, onEvent) => {
      runAgentCalled++;
      if (runAgentCalled === 1) {
        onEvent({ type: 'RUN_ERROR', code: 'MODEL_ERROR', message: '模型失败' });
        return;
      }
      // 第二次（恢复后手动发送）模拟服务端在运行期间落盘 user 消息。
      submittedId = input.message.id;
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    store.setDraft('space-1', '重要用户灵感');
    await hook.result.current.send('重要用户灵感', () => store.setDraft('space-1', ''));
    assert.equal(store.get('space-1').pendingSubmission?.status, 'failed');

    // 恢复正文到草稿（发送按钮此刻被 pending 锁住，恢复是唯一通道）。
    assert.equal(store.restorePendingSubmissionToDraft('space-1'), true);
    assert.equal(store.get('space-1').draft, '重要用户灵感');
    assert.equal(store.get('space-1').pendingSubmission, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 恢复后视图中不能残留旧失败消息（避免恢复后重复展示）。
    assert.equal(hook.result.current.views.length, 0);

    // 手动发送恢复的草稿：pending 已释放、历史未失败，必须放行。
    let accepted = false;
    await hook.result.current.send(
      store.get('space-1').draft,
      () => { accepted = true; store.setDraft('space-1', ''); },
    );
    assert.equal(accepted, true, '恢复后必须能手动发送');
    assert.equal(runAgentCalled, 2, '恰好重发一次');
    // 服务端已落盘原 ID：释放暂存、无重复视图。
    assert.equal(store.get('space-1').pendingSubmission, null);
    assert.equal(hook.result.current.views.length, 1);
    assert.equal(hook.result.current.views[0].id, submittedId);
    assert.equal(store.get('space-1').draft, '', '已落盘消息不能回到草稿');
  } finally {
    hook.unmount();
  }
});

test('3) 原ID已持久化后 RUN_ERROR：只保留服务端记录，无重复草稿与暂存', async () => {
  let submittedId = '';
  const api = createMockApi({
    getConversation: async () => {
      if (!submittedId) return conversation([], 'rev-0');
      return conversation([userMessage(submittedId, '已落盘的消息')], 'rev-1');
    },
    runAgent: async (input, onEvent) => {
      submittedId = input.message.id;
      onEvent({ type: 'RUN_ERROR', code: 'MODEL_ERROR', message: '模型生成阶段失败' });
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    store.setDraft('space-1', '已落盘的消息');
    await hook.result.current.send('已落盘的消息', () => store.setDraft('space-1', ''));

    assert.equal(store.get('space-1').pendingSubmission, null, '原ID已落盘，暂存必须释放');
    assert.equal(store.get('space-1').draft, '', '已落盘消息不能恢复为草稿');
    assert.equal(hook.result.current.views.length, 1);
    assert.equal(hook.result.current.views[0].id, submittedId);
    assert.equal(hook.result.current.historyFailed, false, '历史与版本读取成功，不锁历史');
  } finally {
    hook.unmount();
  }
});

test('4a) 同步失败后 reload：终态证据 + 完整历史对账为 failed，仍 running / 404 保持待确认', async () => {
  let historyReads = 0;
  let statusQueries = 0;
  let terminalStatus = 'failed';
  const api = createMockApi({
    getConversation: async () => {
      historyReads++;
      if (historyReads === 2) throw new Error('网络同步中断');
      return conversation([], `rev-${historyReads}`);
    },
    runAgent: async () => {},
    getAgentStatus: async (spaceId, runId) => {
      statusQueries++;
      if (terminalStatus === 'missing') throw new ApiError(404, '运行不存在');
      return agentStatusOf(spaceId, runId, terminalStatus);
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    store.setDraft('space-1', '网络波动时的提问');
    await hook.result.current.send('网络波动时的提问', () => store.setDraft('space-1', ''));

    const pending = store.get('space-1').pendingSubmission;
    assert.ok(pending, '待确认条目保留');
    assert.equal(pending.status, 'unconfirmed');
    assert.equal(hook.result.current.historyFailed, true, '同步失败锁发送');
    assert.equal(statusQueries, 0, '未重载前不做终态查询');

    // 网络恢复后 reload：首读缺失原 ID -> 查询终态 -> 终态后历史确认缺失 -> failed。
    hook.result.current.reload();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(statusQueries, 1, 'reload 必须查询原 run 终态');
    assert.equal(store.get('space-1').pendingSubmission?.status, 'failed', '终态证据对账后为 failed');
    assert.equal(hook.result.current.historyFailed, false, '终态 + 完整历史后解除发送锁');
    // 恢复草稿后可手动发送一次。
    assert.equal(store.restorePendingSubmissionToDraft('space-1'), true);
    let accepted = false;
    await hook.result.current.send('网络波动时的提问', () => { accepted = true; store.setDraft('space-1', ''); });
    assert.equal(accepted, true);

    // 仍 running：保持待确认、不解除发送锁、不允许重发。
    terminalStatus = 'running';
    const epoch = store.get('space-1').epoch;
    store.setPendingSubmission('space-1', epoch, {
      messageId: 'u-running', runId: 'r-running', text: '未确认的提问', epoch, status: 'unconfirmed',
    });
    hook.result.current.reload();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(store.get('space-1').pendingSubmission?.status, 'unconfirmed', '仍 running 不得判未发送');
    assert.equal(store.restorePendingSubmissionToDraft('space-1'), false, '待确认不得恢复重发');

    // 查询 404（run 记录不存在）：同样保守待确认。
    terminalStatus = 'missing';
    hook.result.current.reload();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(store.get('space-1').pendingSubmission?.status, 'unconfirmed', '404 不得判未发送');
  } finally {
    hook.unmount();
  }
});

test('4b) 旧快照竞态：终态查询期间 run 落盘，不得误判为未发送', async () => {
  let submittedId = '';
  let latePersist = false;
  const api = createMockApi({
    getConversation: async () => {
      if (!submittedId) return conversation([], 'rev-0');
      if (!latePersist) return conversation([], 'rev-stale');
      return conversation([userMessage(submittedId, '迟到落盘的消息')], 'rev-fresh');
    },
    runAgent: async () => {},
    getAgentStatus: async (spaceId, runId) => {
      // 终态查询刚结束，run 才落盘：之后读到的历史包含原 ID。
      latePersist = true;
      return agentStatusOf(spaceId, runId, 'succeeded');
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    // 构造发送后同步失败留下的待确认条目（通过真实发送路径）。
    const epoch = store.get('space-1').epoch;
    store.setDraft('space-1', '迟到落盘的消息');
    // 第一次发送时同步会成功并标记 unconfirmed（无 RUN_ERROR 且历史缺失）。
    await hook.result.current.send('迟到落盘的消息', () => store.setDraft('space-1', ''));
    const pending = store.get('space-1').pendingSubmission;
    assert.ok(pending);
    assert.equal(pending.status, 'unconfirmed');
    submittedId = pending.messageId;

    // reload：首读旧快照缺失（rev-stale），但终态查询后重读已含原 ID -> 直接释放，绝不能判 failed。
    hook.result.current.reload();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(store.get('space-1').pendingSubmission, null, '终态后的历史含原 ID，必须释放而非判未发送');
    assert.equal(store.get('space-1').draft, '', '已落盘消息绝不能恢复成新草稿');
  } finally {
    hook.unmount();
  }
});

test('5) 契约前置拒绝判未发送；网络错误 / 不明 5xx 保持待确认', async () => {
  // 503 + MODEL_NOT_CONFIGURED：请求未被接受；先对账完整历史（保留旧历史），再判 failed。
  const rejectingApi = createMockApi({
    getConversation: async () => conversation([userMessage('u-old', '旧历史消息')], 'rev-1'),
    runAgent: async () => { throw new ApiError(503, 'Configure the server model before sending', 'MODEL_NOT_CONFIGURED'); },
  });
  const rejectingStore = new SpaceStore(rejectingApi);
  const rejectingHook = await renderConversationHook('space-1', rejectingApi, rejectingStore);
  try {
    rejectingStore.setDraft('space-1', '模型未配置时的提问');
    await rejectingHook.result.current.send('模型未配置时的提问', () => rejectingStore.setDraft('space-1', ''));
    const pending = rejectingStore.get('space-1').pendingSubmission;
    assert.equal(pending?.status, 'failed', '前置拒绝必须判未发送，不得永久待确认');
    assert.equal(rejectingHook.result.current.historyFailed, false, '前置拒绝不是历史失败');
    // 拒绝后保留已加载历史 + 待恢复消息，绝不清空视图。
    assert.ok(rejectingHook.result.current.views.some((v) => v.id === 'u-old'), '旧历史必须保留');
    assert.ok(rejectingHook.result.current.views.some((v) => v.text === '模型未配置时的提问'), '未发送消息仍展示');
    assert.equal(rejectingStore.restorePendingSubmissionToDraft('space-1'), true);
  } finally {
    rejectingHook.unmount();
  }

  // 400 schema 拒绝（code 缺省视为契约 schema 拒绝）同样属于未接受。
  const badRequestApi = createMockApi({
    getConversation: async () => conversation([], 'rev-0'),
    runAgent: async () => { throw new ApiError(400, 'Invalid conversation request'); },
  });
  const badRequestStore = new SpaceStore(badRequestApi);
  const badRequestHook = await renderConversationHook('space-1', badRequestApi, badRequestStore);
  try {
    badRequestStore.setDraft('space-1', '非法载荷');
    await badRequestHook.result.current.send('非法载荷', () => badRequestStore.setDraft('space-1', ''));
    assert.equal(badRequestStore.get('space-1').pendingSubmission?.status, 'failed');
  } finally {
    badRequestHook.unmount();
  }

  // 409 HISTORY_CONFLICT：对账后拿到新 revision 判 failed，恢复后可手动重提，绝不自动发送。
  let conflictRuns = 0;
  let conflictSubmittedId = '';
  const conflictApi = createMockApi({
    getConversation: async () => {
      if (!conflictSubmittedId) return conversation([], conflictRuns === 0 ? 'rev-0' : 'rev-2');
      return conversation([userMessage(conflictSubmittedId, '冲突后的提问')], 'rev-3');
    },
    runAgent: async (input) => {
      conflictRuns++;
      if (conflictRuns === 1) throw new ApiError(409, 'Conversation changed; reload history before sending', 'HISTORY_CONFLICT');
      conflictSubmittedId = input.message.id;
    },
  });
  const conflictStore = new SpaceStore(conflictApi);
  const conflictHook = await renderConversationHook('space-1', conflictApi, conflictStore);
  try {
    conflictStore.setDraft('space-1', '冲突后的提问');
    await conflictHook.result.current.send('冲突后的提问', () => conflictStore.setDraft('space-1', ''));
    assert.equal(conflictStore.get('space-1').pendingSubmission?.status, 'failed', 'HISTORY_CONFLICT 对账后判未发送');
    assert.equal(conflictHook.result.current.historyFailed, false, '对账成功拿到新 revision，不锁历史');
    assert.equal(conflictRuns, 1, '绝不自动重发');
    assert.equal(conflictStore.restorePendingSubmissionToDraft('space-1'), true);
    let accepted = false;
    await conflictHook.result.current.send('冲突后的提问', () => { accepted = true; conflictStore.setDraft('space-1', ''); });
    assert.equal(accepted, true, '新 revision 就位后允许手动重提');
    assert.equal(conflictRuns, 2, '恰好重提一次');
  } finally {
    conflictHook.unmount();
  }

  // 409 agent_thread_locked：同属前置拒绝白名单，对账后判 failed。
  const lockedApi = createMockApi({
    getConversation: async () => conversation([], 'rev-1'),
    runAgent: async () => { throw new ApiError(409, 'Wait for the current response to stop', 'agent_thread_locked'); },
  });
  const lockedStore = new SpaceStore(lockedApi);
  const lockedHook = await renderConversationHook('space-1', lockedApi, lockedStore);
  try {
    lockedStore.setDraft('space-1', '线程占用时的提问');
    await lockedHook.result.current.send('线程占用时的提问', () => lockedStore.setDraft('space-1', ''));
    assert.equal(lockedStore.get('space-1').pendingSubmission?.status, 'failed');
  } finally {
    lockedHook.unmount();
  }

  // 409 MESSAGE_ID_CONFLICT：服务端已持有同 ID 消息，对账后按权威历史释放（不能误判未发送）。
  let conflictIdSubmitted = '';
  const idConflictApi = createMockApi({
    getConversation: async () => {
      if (!conflictIdSubmitted) return conversation([], 'rev-0');
      return conversation([userMessage(conflictIdSubmitted, '服务端已有同 ID')], 'rev-1');
    },
    runAgent: async (input) => {
      conflictIdSubmitted = input.message.id;
      throw new ApiError(409, 'Message ID was already used for another message', 'MESSAGE_ID_CONFLICT');
    },
  });
  const idConflictStore = new SpaceStore(idConflictApi);
  const idConflictHook = await renderConversationHook('space-1', idConflictApi, idConflictStore);
  try {
    idConflictStore.setDraft('space-1', '服务端已有同 ID');
    await idConflictHook.result.current.send('服务端已有同 ID', () => idConflictStore.setDraft('space-1', ''));
    assert.equal(idConflictStore.get('space-1').pendingSubmission, null, '权威历史含原 ID，必须释放而非判未发送');
  } finally {
    idConflictHook.unmount();
  }

  // 409 但 code 不在契约白名单：不泛化，保守待确认。
  const unknownConflictApi = createMockApi({
    getConversation: async () => conversation([], 'rev-0'),
    runAgent: async () => { throw new ApiError(409, 'unknown conflict', 'SOMETHING_ELSE'); },
  });
  const unknownConflictStore = new SpaceStore(unknownConflictApi);
  const unknownConflictHook = await renderConversationHook('space-1', unknownConflictApi, unknownConflictStore);
  try {
    unknownConflictStore.setDraft('space-1', '未知冲突');
    await unknownConflictHook.result.current.send('未知冲突', () => unknownConflictStore.setDraft('space-1', ''));
    assert.equal(unknownConflictStore.get('space-1').pendingSubmission?.status, 'unconfirmed', '白名单外 409 不等于未接受');
  } finally {
    unknownConflictHook.unmount();
  }

  // 网络错误（无状态码）：绝不能泛化为未发送。
  const networkApi = createMockApi({
    getConversation: async () => conversation([], 'rev-0'),
    runAgent: async () => { throw new Error('fetch failed'); },
  });
  const networkStore = new SpaceStore(networkApi);
  const networkHook = await renderConversationHook('space-1', networkApi, networkStore);
  try {
    networkStore.setDraft('space-1', '断网时的提问');
    await networkHook.result.current.send('断网时的提问', () => networkStore.setDraft('space-1', ''));
    const pending = networkStore.get('space-1').pendingSubmission;
    assert.equal(pending?.status, 'unconfirmed', '网络错误必须保守待确认');
    assert.equal(networkHook.result.current.historyFailed, true, '未知结果锁发送');
    assert.equal(networkStore.restorePendingSubmissionToDraft('space-1'), false, '待确认不得恢复重发');
  } finally {
    networkHook.unmount();
  }

  // 不明 5xx（无契约 code）：同样保守待确认。
  const serverApi = createMockApi({
    getConversation: async () => conversation([], 'rev-0'),
    runAgent: async () => { throw new ApiError(500, 'Internal error'); },
  });
  const serverStore = new SpaceStore(serverApi);
  const serverHook = await renderConversationHook('space-1', serverApi, serverStore);
  try {
    serverStore.setDraft('space-1', '服务端异常时的提问');
    await serverHook.result.current.send('服务端异常时的提问', () => serverStore.setDraft('space-1', ''));
    assert.equal(serverStore.get('space-1').pendingSubmission?.status, 'unconfirmed', '不明 5xx 不等于未接受');
  } finally {
    serverHook.unmount();
  }
});

test('6) 发送后新草稿不被覆盖；恢复拒绝覆盖任何已有草稿（含纯空白）', async () => {
  const api = createMockApi({
    getConversation: async () => conversation([], 'rev-0'),
    runAgent: async (_input, onEvent) => {
      onEvent({ type: 'RUN_ERROR', code: 'MODEL_ERROR', message: '服务拒绝' });
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    store.setDraft('space-1', '消息一');
    await hook.result.current.send(
      '消息一',
      () => {
        store.setDraft('space-1', '');
        // 用户在失败期间另写了新草稿。
        store.setDraft('space-1', '用户新草稿二');
      },
    );
    assert.equal(store.get('space-1').draft, '用户新草稿二', '新草稿不被覆盖');
    assert.equal(store.get('space-1').pendingSubmission?.text, '消息一');
    assert.equal(store.get('space-1').pendingSubmission?.status, 'failed');
    assert.equal(store.restorePendingSubmissionToDraft('space-1'), false, '有草稿拒绝恢复');
    assert.equal(store.get('space-1').draft, '用户新草稿二');

    // 纯空白草稿同样视为用户输入，不得覆盖。
    store.setDraft('space-1', '   ');
    assert.equal(store.restorePendingSubmissionToDraft('space-1'), false, '纯空白草稿也不得被覆盖');
    assert.equal(store.get('space-1').draft, '   ');
  } finally {
    hook.unmount();
  }
});

test('7) 卸载/重挂保留暂存；首次绑定不清暂存，reset/delete/dispose 真实清理且旧回调隔离', async () => {
  const api = createMockApi({
    getConversation: async () => conversation([], 'rev-0'),
    runAgent: async (_input, onEvent) => {
      onEvent({ type: 'RUN_ERROR', code: 'MODEL_ERROR', message: '错误' });
    },
  });
  const store = new SpaceStore(api);
  const hook1 = await renderConversationHook('space-1', api, store);

  store.setDraft('space-1', '需跨卸载保留的文本');
  await hook1.result.current.send('需跨卸载保留的文本', () => store.setDraft('space-1', ''));
  hook1.unmount();
  assert.equal(store.get('space-1').pendingSubmission?.text, '需跨卸载保留的文本', '卸载不清暂存');

  // 首次绑定（null -> firstSession）不得清空正在提交的暂存。
  store.bindSession('space-1', 'first-session');
  assert.equal(store.get('space-1').pendingSubmission?.text, '需跨卸载保留的文本', '首次绑定不得清暂存');

  // 重挂同空间同代次：暂存叠加展示。
  const hook2 = await renderConversationHook('space-1', api, store);
  try {
    assert.equal(hook2.result.current.pendingSubmission?.text, '需跨卸载保留的文本');
    assert.equal(hook2.result.current.views.length, 1);
  } finally {
    hook2.unmount();
  }

  // 会话切换（old -> new）推进代次并清暂存；旧代次的迟到状态更新不得写入新暂存。
  store.bindSession('space-1', 'new-session');
  assert.equal(store.get('space-1').pendingSubmission, null, '切会话必须清旧暂存');
  const newEpoch = store.get('space-1').epoch;
  store.setPendingSubmission('space-1', newEpoch, {
    messageId: 'u-new', runId: 'r-new', text: '新一轮消息', epoch: newEpoch, status: 'sending',
  });
  store.updatePendingSubmissionStatus('space-1', newEpoch - 1, 'u-old', { status: 'unconfirmed', error: '旧代次迟到' });
  assert.equal(store.get('space-1').pendingSubmission?.status, 'sending', '旧代次迟到更新被忽略');
  store.updatePendingSubmissionStatus('space-1', newEpoch, 'u-other', { status: 'failed' });
  assert.equal(store.get('space-1').pendingSubmission?.status, 'sending', 'messageId 不匹配的迟到响应不得清掉/改写下一条');

  // reset 真实调用：清暂存并推进代次。
  await store.resetSpace('space-1');
  assert.equal(store.get('space-1').pendingSubmission, null, 'reset 必须清暂存');

  // delete 真实调用：清暂存并标记删除。
  store.setPendingSubmission('space-2', store.get('space-2').epoch, {
    messageId: 'u-2', runId: 'r-2', text: 't-2', epoch: store.get('space-2').epoch, status: 'failed',
  });
  await store.deleteSpace('space-2');
  assert.equal(store.get('space-2').pendingSubmission, null, 'delete 必须清暂存');

  // dispose 真实调用：释放全部暂存正文并拒绝后续写入；离线 setEnabled(false) 则保留草稿。
  const epoch3 = store.get('space-3').epoch;
  store.setDraft('space-3', '离线草稿');
  store.setPendingSubmission('space-3', epoch3, {
    messageId: 'u-3', runId: 'r-3', text: '待确认正文', epoch: epoch3, status: 'unconfirmed',
  });
  store.setEnabled(false);
  assert.equal(store.get('space-3').draft, '离线草稿', '离线保留草稿');
  assert.equal(store.get('space-3').pendingSubmission?.text, '待确认正文', '离线保留暂存');
  store.setEnabled(true);
  store.dispose();
  assert.equal(store.get('space-3').pendingSubmission, null, 'dispose 必须清暂存正文');
  assert.equal(store.get('space-3').draft, '', 'dispose 清空草稿');
  store.setPendingSubmission('space-3', epoch3, {
    messageId: 'u-late', runId: 'r-late', text: '迟到正文', epoch: epoch3, status: 'sending',
  });
  assert.equal(store.get('space-3').pendingSubmission, null, 'dispose 后拒绝旧代次迟到写入');
  store.updatePendingSubmissionStatus('space-3', epoch3, 'u-late', { status: 'failed' });
  assert.equal(store.get('space-3').pendingSubmission, null, 'dispose 后拒绝迟到状态更新');
});

test('8) 已落盘后 RUN_ERROR：运行失败错误保留展示，不被释放分支抹掉', async () => {
  let submittedId = '';
  const api = createMockApi({
    getConversation: async () => {
      if (!submittedId) return conversation([], 'rev-0');
      return conversation([userMessage(submittedId, '已落盘但运行失败')], 'rev-1');
    },
    runAgent: async (input, onEvent) => {
      submittedId = input.message.id;
      onEvent({ type: 'RUN_ERROR', code: 'MODEL_ERROR', message: '模型生成阶段失败' });
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    store.setDraft('space-1', '已落盘但运行失败');
    await hook.result.current.send('已落盘但运行失败', () => store.setDraft('space-1', ''));
    assert.equal(store.get('space-1').pendingSubmission, null, '原 ID 已落盘，暂存释放');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(hook.result.current.error, '模型生成阶段失败', 'RUN_ERROR 必须保留展示，不能因落盘释放被抹掉');
    assert.equal(hook.result.current.historyFailed, false);
  } finally {
    hook.unmount();
  }
});

test('9) RUN_ERROR 终态 + 首次回读失败：内存终态证据让 reload 后直接判 failed，无需 getAgentStatus', async () => {
  let historyReads = 0;
  let statusQueries = 0;
  const api = createMockApi({
    getConversation: async () => {
      historyReads++;
      if (historyReads === 2) throw new Error('同步中断');
      return conversation([], `rev-${historyReads}`);
    },
    runAgent: async (_input, onEvent) => {
      onEvent({ type: 'RUN_ERROR', code: 'MODEL_ERROR', message: '终态失败证据' });
    },
    getAgentStatus: async () => {
      statusQueries++;
      throw new ApiError(404, '运行不存在');
    },
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  try {
    store.setDraft('space-1', '带终态证据的提问');
    await hook.result.current.send('带终态证据的提问', () => store.setDraft('space-1', ''));
    const pending = store.get('space-1').pendingSubmission;
    assert.equal(pending?.status, 'unconfirmed', '回读失败仍保守待确认');
    assert.equal(pending?.terminalError, '终态失败证据', '终态证据保存在条目内存');

    // 卸载/切回：证据随条目保留。
    hook.unmount();
    const hook2 = await renderConversationHook('space-1', api, store);
    try {
      assert.equal(store.get('space-1').pendingSubmission?.terminalError, '终态失败证据');
    } finally {
      hook2.unmount();
    }

    const hook3 = await renderConversationHook('space-1', api, store);
    try {
      // reload 历史成功且缺原 ID：内存终态证据足以判定 failed，404 查询不再阻塞。
      hook3.result.current.reload();
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(store.get('space-1').pendingSubmission?.status, 'failed', '内存终态证据 + 完整历史 = failed');
      assert.equal(hook3.result.current.historyFailed, false, '终态对账后解除发送锁');
      assert.equal(store.restorePendingSubmissionToDraft('space-1'), true);
    } finally {
      hook3.unmount();
    }
  } finally {
    hook.unmount();
  }
});

test('10) dispose 后：迟到 setDraft/setPending/send 全部不执行', async () => {
  const api = createMockApi({
    getConversation: async () => conversation([], 'rev-0'),
    runAgent: async () => {},
  });
  const store = new SpaceStore(api);
  const hook = await renderConversationHook('space-1', api, store);
  const epoch = store.get('space-1').epoch;
  hook.unmount();
  store.dispose();

  store.setDraft('space-1', 'late body');
  assert.equal(store.get('space-1').draft, '', 'dispose 后迟到 setDraft 不得写入正文');
  store.setPendingSubmission('space-1', epoch, {
    messageId: 'u-late', runId: 'r-late', text: 'late pending', epoch, status: 'sending',
  });
  assert.equal(store.get('space-1').pendingSubmission, null, 'dispose 后迟到 setPending 不得写入');
  assert.equal(store.isCurrent('space-1', epoch), false, 'dispose 后 isCurrent 必须为 false');
  assert.equal(store.canWrite('space-1'), false, 'dispose 后 canWrite 必须为 false');
  let accepted = false;
  await hook.result.current.send('late body', () => { accepted = true; });
  assert.equal(accepted, false, 'dispose 后旧 Hook 不得发起新 send');

  // 对照：离线 setEnabled(false) 保留草稿与暂存。
  const store2 = new SpaceStore(api);
  const epoch2 = store2.get('space-x').epoch;
  store2.setDraft('space-x', '离线草稿');
  store2.setPendingSubmission('space-x', epoch2, {
    messageId: 'u-x', runId: 'r-x', text: '离线暂存', epoch: epoch2, status: 'unconfirmed',
  });
  store2.setEnabled(false);
  assert.equal(store2.get('space-x').draft, '离线草稿', '离线保留草稿');
  assert.equal(store2.get('space-x').pendingSubmission?.text, '离线暂存', '离线保留暂存');
});

test('11) UI 入口契约：unconfirmed 待确认时“重新同步”按钮始终渲染（源码条件断言 + 重挂状态）', async () => {
  // 源码契约：按钮渲染条件必须覆盖 pending 待确认，否则 banner 要求重新同步却没有入口。
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/workspace/ConversationView.tsx', import.meta.url), 'utf8');
  const buttonBlock = source.match(/\{([\s\S]{0,220})<ActionButton label="重新同步会话"/);
  assert.ok(buttonBlock, '找到“重新同步会话”按钮');
  assert.ok(
    /conversation\.historyFailed \|\| pending\?\.status === 'unconfirmed' \|\| connection\?\.snapshot\.status === 'authentication-required'/.test(buttonBlock[1]),
    '按钮条件必须包含 pending unconfirmed、historyFailed 与鉴权要求三个入口',
  );

  // Hook 场景：无终态断网 -> unconfirmed -> 卸载重挂后 historyFailed=false 且 pending 保留，
  // 此时按钮唯一入口就是 pending?.status === 'unconfirmed'。
  const api = createMockApi({
    getConversation: async () => conversation([], 'rev-0'),
    runAgent: async () => {},
    getAgentStatus: async () => { throw new ApiError(404, '运行不存在'); },
  });
  const store = new SpaceStore(api);
  const hook1 = await renderConversationHook('space-1', api, store);
  store.setDraft('space-1', '断网未确认的提问');
  await hook1.result.current.send('断网未确认的提问', () => store.setDraft('space-1', ''));
  assert.equal(store.get('space-1').pendingSubmission?.status, 'unconfirmed');
  hook1.unmount();

  const hook2 = await renderConversationHook('space-1', api, store);
  try {
    assert.equal(hook2.result.current.historyFailed, false, '重挂后历史读取成功，historyFailed 初值为 false');
    assert.equal(hook2.result.current.pendingSubmission?.status, 'unconfirmed', '无终态证据保持待确认');
    assert.ok(hook2.result.current.views.some((v) => v.text === '断网未确认的提问'), '原文保留展示');
  } finally {
    hook2.unmount();
  }
});
