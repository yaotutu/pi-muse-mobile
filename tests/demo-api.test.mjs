import assert from 'node:assert/strict';
import './register-source.mjs';
import test from 'node:test';

const { DemoApiClient } = await import('./helpers/demo-api-client.ts');

/**
 * DemoApiClient 的行为锁定用例：全部在内存中运行，tickMs=1 把演示节奏压到最短。
 * 只确认现有实现的行为，不引入新的产品假设。
 */

const TICK = 1;

/** 采集一轮 run 的全部 AG-UI 事件，并允许在指定事件上挂一次性副作用。 */
const collect = () => {
  const events = [];
  const onEvent = (event) => events.push(event);
  const types = () => events.map((event) => event.type);
  const first = (type) => events.find((event) => event.type === type);
  return { events, onEvent, types, first };
};

/** 有界轮询快照直到出现目标 runId 的挂起审批；不 sleep 盲等，也不无限挂起。 */
const waitForApproval = async (client, runId, attempts = 500) => {
  for (let i = 0; i < attempts; i++) {
    const snapshot = await client.getSnapshot();
    const found = snapshot.notifications.find((n) => n.runId === runId && n.status === 'pending');
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, TICK));
  }
  throw new Error(`等待审批超时：runId=${runId}`);
};

const isAbortError = (error) => error.name === 'AbortError';
const isApiError = (status, pattern) => (error) =>
  error.name === 'ApiError' && error.status === status && pattern.test(error.message);

test('独立实例之间不串数据：记忆、任务、目标互不影响', async () => {
  const a = new DemoApiClient(true, TICK);
  const b = new DemoApiClient(true, TICK);

  await a.addMemory('只属于 A 的记忆', '测试');
  await a.createTask('只属于 A 的任务');
  await a.createGoal({ title: '只属于 A 的目标', milestones: ['第一步'] });

  const sa = await a.getSnapshot();
  const sb = await b.getSnapshot();
  assert.equal(sa.memories.length, 1);
  assert.equal(sb.memories.length, 0);
  assert.equal(sa.tasks.length, 1);
  assert.equal(sb.tasks.length, 0);
  assert.equal(sa.goals.length, 1);
  assert.equal(sb.goals.length, 0);
  assert.deepEqual(sb, { identity: { name: 'Pi Muse', tone: 'warm', avatar: 'sky', showChatUpdates: true }, worker: { running: true }, tasks: [], goals: [], monitors: [], memories: [], notifications: [] });
});

test('快照与列表返回深拷贝，改动返回值不会污染内部状态', async () => {
  const client = new DemoApiClient(false, TICK);

  const snapshot = await client.getSnapshot();
  snapshot.goals[0].title = '被测试改坏的标题';
  snapshot.goals[0].milestones[0].done = false;
  snapshot.tasks.length = 0;
  snapshot.notifications.length = 0;

  const task = await client.createTask('拷贝契约检查');
  task.title = '被测试改坏的任务标题';
  task.status = 'succeeded';

  const threads = client.listDemoThreads();
  threads[0].title = '被测试改坏的会话标题';

  const again = await client.getSnapshot();
  assert.equal(again.goals[0].title, '把运动变成每周的习惯');
  assert.equal(again.goals[0].milestones[0].done, true);
  assert.equal(again.tasks.length, 5);
  assert.equal(again.notifications.length, 1);
  assert.equal(again.tasks[0].title, '拷贝契约检查');
  assert.equal(again.tasks[0].status, 'queued');
  assert.notEqual(client.listDemoThreads()[0].title, '被测试改坏的会话标题');
});

test('目标置为 completed 会勾选全部里程碑，重新激活不回退勾选', async () => {
  const client = new DemoApiClient(false, TICK);

  const before = (await client.getSnapshot()).goals.find((g) => g.id === 'demo-health');
  assert.deepEqual(before.milestones.map((m) => m.done), [true, false, false]);

  const completed = await client.setGoalStatus('demo-health', 'completed');
  assert.equal(completed.status, 'completed');
  assert.ok(completed.milestones.every((m) => m.done));
  assert.ok(completed.milestones.every((m) => typeof m.doneAt === 'string' && m.doneAt.length > 0));
  const firstDoneAt = completed.milestones[0].doneAt;
  assert.equal(firstDoneAt, before.milestones[0].doneAt, '原本已完成的里程碑保留原 doneAt');

  const reactivated = await client.setGoalStatus('demo-health', 'active');
  assert.equal(reactivated.status, 'active');
  assert.ok(reactivated.milestones.every((m) => m.done), '重新激活不应回退里程碑勾选');
  assert.equal(reactivated.milestones[0].doneAt, firstDoneAt);

  // 勾选状态确实落到了工作区快照里，而不是只存在于返回值。
  const stored = (await client.getSnapshot()).goals.find((g) => g.id === 'demo-health');
  assert.ok(stored.milestones.every((m) => m.done));
});

test('审批只能决定一次：重复决定 409，未知条目 404', async () => {
  const client = new DemoApiClient(false, TICK);
  const pending = (await client.getSnapshot()).notifications[0];
  assert.equal(pending.id, 'demo-approval');
  assert.equal(pending.status, 'pending');

  const approved = await client.decideAction('demo-approval', 'approve');
  assert.equal(approved.status, 'approved');
  assert.ok(approved.decidedAt);

  await assert.rejects(
    client.decideAction('demo-approval', 'deny'),
    isApiError(409, /审批已经处理/),
  );
  await assert.rejects(
    client.decideAction('demo-approval', 'approve'),
    isApiError(409, /审批已经处理/),
  );
  await assert.rejects(
    client.decideAction('不存在的审批', 'approve'),
    isApiError(404, /演示条目不存在/),
  );

  // 决定后的审批从 pending 列表消失，进入历史且不会被二次改动。
  assert.equal((await client.getSnapshot()).notifications.length, 0);
  assert.equal(client.approvalHistory().find((n) => n.id === 'demo-approval').status, 'approved');
});

test('write 工具挂起审批：批准与拒绝都能放行本轮并产出工具结果', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  const threadId = 'local-main';

  // --- 批准 ---
  const approveRun = collect();
  const first = client.runAgent(
    { threadId, runId: 'run-write-approve', expectedRevision: 'demo:0', message: { id: 'm-w1', content: '请把周末计划写入文件' } },
    approveRun.onEvent,
  );
  const approval = await waitForApproval(client, 'run-write-approve');
  assert.equal(approval.kind, 'file_write');
  assert.equal(approval.threadId, threadId);
  assert.equal(approval.payload.path, 'weekend-plan.md');
  assert.equal(approval.runId, 'run-write-approve');
  // 审批挂起期间本轮不结束，也不会发 RUN_ERROR。
  assert.deepEqual(approveRun.types().filter((type) => type === 'RUN_FINISHED' || type === 'RUN_ERROR'), []);

  assert.equal((await client.decideAction(approval.id, 'approve')).status, 'approved');
  await first;

  const approvedResult = JSON.parse(approveRun.first('TOOL_CALL_RESULT').content);
  assert.equal(approvedResult.success, true);
  assert.equal(approvedResult.status, 'approved');
  assert.equal(approveRun.types().at(-1), 'RUN_FINISHED');
  assert.deepEqual(approveRun.types().filter((type) => type === 'TOOL_CALL_RESULT'), ['TOOL_CALL_RESULT']);

  // --- 拒绝 ---
  const denyRun = collect();
  const second = client.runAgent(
    { threadId, runId: 'run-write-deny', expectedRevision: (await client.getConversation(threadId)).revision, message: { id: 'm-w2', content: '请把周末计划写入文件' } },
    denyRun.onEvent,
  );
  const deniedApproval = await waitForApproval(client, 'run-write-deny');
  assert.equal((await client.decideAction(deniedApproval.id, 'deny')).status, 'denied');
  await second;

  const deniedResult = JSON.parse(denyRun.first('TOOL_CALL_RESULT').content);
  assert.equal(deniedResult.success, false);
  assert.equal(deniedResult.status, 'denied');
  assert.equal(denyRun.types().at(-1), 'RUN_FINISHED');
  assert.equal((await client.getSnapshot()).notifications.length, 0);
});

test('线程重命名与归档只影响本实例，归档后会话不再出现在活跃列表', async () => {
  const a = new DemoApiClient(false, TICK);
  const b = new DemoApiClient(false, TICK);

  a.renameThread('demo-weekend', '  A 改过的标题  ');
  a.archiveThread('demo-weekend', true);

  const threadA = a.listDemoThreads().find((t) => t.id === 'demo-weekend');
  assert.equal(threadA.title, 'A 改过的标题');
  assert.equal(threadA.archived, true);

  const threadB = b.listDemoThreads().find((t) => t.id === 'demo-weekend');
  assert.equal(threadB.title, '周末旅行计划');
  assert.equal(threadB.archived, false);

  // 归档只影响活跃列表，演示专用列表仍能看到归档会话。
  assert.deepEqual(a.listDemoThreads().map((t) => t.id).sort(), ['demo-weekend', 'local-main']);
  assert.deepEqual((await a.listThreads()).map((t) => t.id), ['local-main']);
  assert.deepEqual((await b.listThreads()).map((t) => t.id).sort(), ['demo-weekend', 'local-main']);
});

test('revision 冲突与同线程并发占用都返回 409', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  const threadId = 'local-main';
  const run = (runId, content, revision = 'demo:0', onEvent = () => {}) =>
    client.runAgent({ threadId, runId, expectedRevision: revision, message: { id: `m-${runId}`, content } }, onEvent);

  // 过期 revision。
  await assert.rejects(run('run-stale', '你好', 'demo:9'), isApiError(409, /会话已更新/));

  // runAgent 在第一个 await 之前就登记了运行，同线程第二次请求立即冲突。
  const slow = collect();
  const first = run('run-first', '慢流', 'demo:0', slow.onEvent);
  await assert.rejects(run('run-second', '你好'), isApiError(409, /会话已更新/));
  assert.deepEqual(slow.types(), ['RUN_STARTED', 'TEXT_MESSAGE_START']);

  assert.equal(await client.stopRun(threadId, 'run-first'), true);
  await assert.rejects(first, isAbortError);

  // 中止同样会推进版本号，因此旧 revision 继续冲突，最新 revision 可正常发起。
  const current = await client.getConversation(threadId);
  await assert.rejects(run('run-stale-2', '你好', 'demo:0'), isApiError(409, /会话已更新/));
  await run('run-ok', '你好', current.revision);
  const after = await client.getConversation(threadId);
  assert.notEqual(after.revision, current.revision);
  assert.ok(after.messages.some((m) => m.role === 'user' && m.content === '你好'));
});

test('工具调用事件完整成对：START/ARGS/END/RESULT 关联同一个 toolCallId', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  const stream = collect();
  await client.runAgent(
    { threadId: 'local-main', runId: 'run-tool', expectedRevision: 'demo:0', message: { id: 'm-tool', content: '杭州今天天气怎么样' } },
    stream.onEvent,
  );

  assert.equal(stream.types()[0], 'RUN_STARTED');
  assert.equal(stream.types().at(-1), 'RUN_FINISHED');
  assert.deepEqual(
    stream.types().filter((type) => type.startsWith('TOOL_')),
    ['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT'],
  );

  const start = stream.first('TOOL_CALL_START');
  const args = stream.first('TOOL_CALL_ARGS');
  const result = stream.first('TOOL_CALL_RESULT');
  const assistant = stream.first('TEXT_MESSAGE_START');
  assert.equal(start.toolCallName, 'get_weather');
  assert.equal(start.parentMessageId, assistant.messageId);
  assert.equal(args.toolCallId, start.toolCallId);
  assert.equal(result.toolCallId, start.toolCallId);
  assert.deepEqual(JSON.parse(args.delta), { location: '杭州' });
  assert.deepEqual(JSON.parse(result.content), {
    location: '杭州', temperature: 23, condition: '晴间多云', low: 18, high: 25,
    humidity: 62, wind: '东风 2 级', summary: '仅为演示天气，不是实时预报。',
  });

  const deltas = stream.events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT');
  assert.ok(deltas.length > 1, '正文按增量分片流出');
  assert.ok(deltas.every((e) => e.messageId === assistant.messageId));
});

test('权威历史能重建工具卡：丢失增量流也能凭 getConversation 复原', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  const stream = collect();
  await client.runAgent(
    { threadId: 'local-main', runId: 'run-recover', expectedRevision: 'demo:0', message: { id: 'm-recover', content: '帮我创建一个后台任务' } },
    stream.onEvent,
  );

  // 只依赖权威历史重建：assistant.toolCalls 建立调用，role=tool 消息回填结果。
  const rebuild = (messages) => {
    const calls = new Map();
    const cards = [];
    for (const message of messages) {
      if (message.role === 'assistant' && message.toolCalls) {
        for (const call of message.toolCalls) {
          const card = { id: call.id, type: call.type, name: call.function.name, args: JSON.parse(call.function.arguments), result: undefined };
          calls.set(call.id, card);
          cards.push(card);
        }
      }
      if (message.role === 'tool' && calls.has(message.toolCallId)) calls.get(message.toolCallId).result = JSON.parse(message.content);
    }
    return cards;
  };

  const conversation = await client.getConversation('local-main');
  const cards = rebuild(conversation.messages);
  assert.equal(cards.length, 1);

  const streamed = stream.first('TOOL_CALL_START');
  const streamedResult = JSON.parse(stream.first('TOOL_CALL_RESULT').content);
  assert.equal(cards[0].id, streamed.toolCallId);
  assert.equal(cards[0].name, 'delegate_task');
  assert.equal(cards[0].type, 'function');
  assert.deepEqual(cards[0].args, { prompt: '整理一个轻松的周末旅行计划', title: '周末旅行计划' });
  assert.equal(cards[0].result.success, true);
  assert.equal(cards[0].result.status, 'queued');
  assert.equal(cards[0].result.id, streamedResult.id);

  // 历史里的工具结果与流式结果指向同一个新建任务，且没有重复条目。
  assert.equal(conversation.messages.filter((m) => m.role === 'tool').length, 1);
  assert.equal((await client.getSnapshot()).tasks.filter((task) => task.id === streamedResult.id).length, 1);
});

test('stopRun 用错误的 runId 返回 false 且不打断进行中的运行', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  const stream = collect();
  let wrongStop;
  const run = client.runAgent(
    { threadId: 'local-main', runId: 'run-real', expectedRevision: 'demo:0', message: { id: 'm-stop-wrong', content: '慢流' } },
    (event) => {
      stream.events.push(event);
      if (event.type === 'TEXT_MESSAGE_CONTENT' && !wrongStop) wrongStop = client.stopRun('local-main', 'run-typo');
    },
  );

  await run;
  assert.equal(await wrongStop, false, '错误的 runId 不应停止运行');
  assert.equal(stream.types().at(-1), 'RUN_FINISHED', '运行应当正常收尾');
  assert.deepEqual(stream.types().filter((type) => type === 'RUN_ERROR'), []);

  // 运行结束后再停止，已经是迟到请求。
  assert.equal(await client.stopRun('local-main', 'run-real'), false);
  assert.equal(await client.stopRun('local-main', 'run-real'), false);
  assert.equal(await client.stopRun('不存在的线程', 'run-real'), false);
});

test('stopRun 用正确 runId 中止运行：抛 AbortError、不发 RUN_FINISHED，随后可继续新一轮', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  const stream = collect();
  let stopped;
  const run = client.runAgent(
    { threadId: 'local-main', runId: 'run-stop', expectedRevision: 'demo:0', message: { id: 'm-stop', content: '慢流' } },
    (event) => {
      stream.events.push(event);
      if (event.type === 'TEXT_MESSAGE_CONTENT' && !stopped) stopped = client.stopRun('local-main', 'run-stop');
    },
  );

  await assert.rejects(run, isAbortError);
  assert.equal(await stopped, true);
  assert.equal(stream.types().at(-1), 'TEXT_MESSAGE_CONTENT', '中止后不再有任何事件');
  assert.deepEqual(stream.types().filter((type) => type === 'RUN_FINISHED' || type === 'RUN_ERROR'), []);

  // 中止释放了线程占用：带最新 revision 可以立刻开始下一轮。
  const revision = (await client.getConversation('local-main')).revision;
  const next = collect();
  await client.runAgent(
    { threadId: 'local-main', runId: 'run-after-stop', expectedRevision: revision, message: { id: 'm-after', content: '你好' } },
    next.onEvent,
  );
  assert.equal(next.types().at(-1), 'RUN_FINISHED');
});

test('外部 AbortSignal 中断运行，中止后的历史不伪造空助手消息', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  const controller = new AbortController();
  const stream = collect();
  const run = client.runAgent(
    { threadId: 'local-main', runId: 'run-signal', expectedRevision: 'demo:0', message: { id: 'm-signal', content: '慢流' } },
    (event) => {
      stream.events.push(event);
      if (event.type === 'TEXT_MESSAGE_CONTENT') controller.abort();
    },
    controller.signal,
  );

  await assert.rejects(run, isAbortError);
  assert.deepEqual(stream.types().filter((type) => type === 'RUN_FINISHED' || type === 'RUN_ERROR'), []);

  const conversation = await client.getConversation('local-main');
  const user = conversation.messages.filter((m) => m.role === 'user');
  const assistant = conversation.messages.filter((m) => m.role === 'assistant');
  assert.equal(user.length, 1, '用户消息仍然入库');
  assert.equal(assistant.length, 1, '已产出正文片段的助手消息保留');
  assert.ok(assistant[0].content.length > 0);
  assert.notEqual(conversation.revision, 'demo:0', '中止也会推进 revision');
});

test('已完成的 run 可幂等重放且不重复副作用，同 runId 不同输入 409', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  const input = { threadId: 'local-main', runId: 'run-idem', expectedRevision: 'demo:0', message: { id: 'm-idem', content: '帮我创建一个后台任务' } };

  const first = collect();
  await client.runAgent(input, first.onEvent);
  const afterFirst = await client.getSnapshot();
  const conversationAfterFirst = await client.getConversation(input.threadId);
  assert.equal(afterFirst.tasks.length, 1);

  // 幂等重放：只补发快照与完成事件，不再执行工具。
  const replay = collect();
  await client.runAgent({ ...input }, replay.onEvent);
  assert.deepEqual(replay.types(), ['MESSAGES_SNAPSHOT', 'RUN_FINISHED']);
  assert.deepEqual(replay.first('MESSAGES_SNAPSHOT').messages, conversationAfterFirst.messages);
  assert.equal(replay.first('RUN_FINISHED').threadId, input.threadId);
  assert.equal(replay.first('RUN_FINISHED').runId, input.runId);

  const afterReplay = await client.getSnapshot();
  assert.equal(afterReplay.tasks.length, 1, '重放不得重复创建任务');
  assert.deepEqual((await client.getConversation(input.threadId)).messages, conversationAfterFirst.messages);
  assert.equal(afterReplay.tasks[0].id, afterFirst.tasks[0].id);

  // 同一个 runId 配上不同输入视为冲突。
  await assert.rejects(
    client.runAgent({ ...input, message: { id: 'm-idem', content: '帮我创建一个后台任务，但内容变了' } }, () => {}),
    isApiError(409, /运行 ID 已被使用/),
  );
});

test('dispose 停掉挂起的 write 审批并把审批标记为 cancelled', async (t) => {
  const client = new DemoApiClient(true, TICK);
  const stream = collect();
  const run = client.runAgent(
    { threadId: 'local-main', runId: 'run-dispose', expectedRevision: 'demo:0', message: { id: 'm-dispose', content: '请把周末计划写入文件' } },
    stream.onEvent,
  );

  // 先等到审批真的挂起，再 dispose，避免与审批创建竞态。
  const approval = await waitForApproval(client, 'run-dispose');
  client.dispose();

  await assert.rejects(run, isAbortError);
  assert.deepEqual(stream.types().filter((type) => type === 'RUN_FINISHED' || type === 'RUN_ERROR' || type === 'TOOL_CALL_RESULT'), []);

  const cancelled = client.approvalHistory().find((n) => n.id === approval.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.threadId, 'local-main');
  assert.equal(cancelled.runId, 'run-dispose');
  assert.deepEqual((await client.getSnapshot()).notifications, [], '已取消的审批不再挂在待办列表');

  // 运行已登记的消息进入权威历史，工具调用保持未完成（不伪造结果）。
  const conversation = await client.getConversation('local-main');
  const assistant = conversation.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant.toolCalls[0].function.name, 'write');
  assert.equal(conversation.messages.filter((m) => m.role === 'tool').length, 0);

  // dispose 之后再发新请求不受影响：挂起的那一轮已经释放了线程。
  const revision = conversation.revision;
  const next = collect();
  await client.runAgent(
    { threadId: 'local-main', runId: 'run-after-dispose', expectedRevision: revision, message: { id: 'm-after-dispose', content: '你好' } },
    next.onEvent,
  );
  assert.equal(next.types().at(-1), 'RUN_FINISHED');
});
