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
    { threadId, runId: 'run-write-approve', expectedRevision: 'empty', message: { id: 'm-w1', content: '请把周末计划写入文件' } },
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
  const run = (runId, content, revision = 'empty', onEvent = () => {}) =>
    client.runAgent({ threadId, runId, expectedRevision: revision, message: { id: `m-${runId}`, content } }, onEvent);

  // 过期 revision。
  await assert.rejects(run('run-stale', '你好', 'demo:9'), isApiError(409, /会话已更新/));

  // runAgent 在第一个 await 之前就登记了运行，同线程第二次请求立即冲突。
  const slow = collect();
  const first = run('run-first', '慢流', 'empty', slow.onEvent);
  await assert.rejects(run('run-second', '你好'), isApiError(409, /会话已更新/));
  assert.deepEqual(slow.types(), ['RUN_STARTED', 'TEXT_MESSAGE_START']);

  assert.equal(await client.stopRun(threadId, 'run-first'), true);
  await assert.rejects(first, isAbortError);

  // 中止同样会推进版本号，因此旧 revision 继续冲突，最新 revision 可正常发起。
  const current = await client.getConversation(threadId);
  await assert.rejects(run('run-stale-2', '你好', 'empty'), isApiError(409, /会话已更新/));
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
    { threadId: 'local-main', runId: 'run-tool', expectedRevision: 'empty', message: { id: 'm-tool', content: '杭州今天天气怎么样' } },
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
    { threadId: 'local-main', runId: 'run-recover', expectedRevision: 'empty', message: { id: 'm-recover', content: '帮我创建一个后台任务' } },
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
    { threadId: 'local-main', runId: 'run-real', expectedRevision: 'empty', message: { id: 'm-stop-wrong', content: '慢流' } },
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
    { threadId: 'local-main', runId: 'run-stop', expectedRevision: 'empty', message: { id: 'm-stop', content: '慢流' } },
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
    { threadId: 'local-main', runId: 'run-signal', expectedRevision: 'empty', message: { id: 'm-signal', content: '慢流' } },
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
  assert.notEqual(conversation.revision, 'empty', '中止也会推进 revision');
});

test('已完成的 run 可幂等重放且不重复副作用，同 runId 不同输入 409', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  const input = { threadId: 'local-main', runId: 'run-idem', expectedRevision: 'empty', message: { id: 'm-idem', content: '帮我创建一个后台任务' } };

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
    { threadId: 'local-main', runId: 'run-dispose', expectedRevision: 'empty', message: { id: 'm-dispose', content: '请把周末计划写入文件' } },
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

// ---------------------------------------------------------------------------
// 线程规则 / 技能 / 删除 —— 新 ApiClient 对齐
// ---------------------------------------------------------------------------

const isAbort = (error) => error.name === 'AbortError';

test('getThreadInstructions / getThreadSkills 对未存在的线程返回默认快照且不创建会话', async () => {
  const client = new DemoApiClient(true, TICK);

  const instructions = await client.getThreadInstructions('phantom-thread');
  assert.deepEqual(instructions, { instructions: '' });

  const skills = await client.getThreadSkills('phantom-thread');
  assert.equal(skills.skills.length, 7);
  for (const skill of skills.skills) {
    assert.equal(skill.defaultEnabled, true);
    assert.equal(skill.enabled, true, '无覆盖时应回落 defaultEnabled');
  }

  // GET 路径绝不创建线程、不污染本地列表。
  const threads = await client.listThreads();
  assert.deepEqual(threads.map((t) => t.id).sort(), ['local-main']);
});

test('saveThreadInstructions > 20k 抛 400 且保留旧值；20k 边界合法；trim 与空串清空', async () => {
  const client = new DemoApiClient(true, TICK);
  await client.saveThreadInstructions('local-main', '初始规则');

  // 超过 20_000 字符必须抛 400，旧值原样保留（不截断）。
  const huge = 'a'.repeat(20_001);
  await assert.rejects(client.saveThreadInstructions('local-main', huge), isApiError(400, /超过/));
  const kept = await client.getThreadInstructions('local-main');
  assert.equal(kept.instructions, '初始规则', '超限拒绝后旧值必须保留');

  // 20_000 字符（含前后空白）应能成功保存，trim 后恰好 20_000。
  const exact = 'b'.repeat(20_000);
  const exactResult = await client.saveThreadInstructions('local-main', exact);
  assert.equal(exactResult.instructions.length, 20_000);

  // 空串与纯空白都视为清空。
  const cleared = await client.saveThreadInstructions('local-main', '');
  assert.equal(cleared.instructions, '');
  const wsCleared = await client.saveThreadInstructions('local-main', '   \n\t  ');
  assert.equal(wsCleared.instructions, '');
});

test('saveThreadSkills 整份替换：未知技能/非布尔抛 400；空对象恢复默认', async () => {
  const client = new DemoApiClient(true, TICK);

  // 整份替换：先写一组，再写另一组，原覆盖不应残留。
  await client.saveThreadSkills('local-main', { memory: false, write: false });
  const first = await client.getThreadSkills('local-main');
  assert.equal(first.skills.find((s) => s.name === 'memory').enabled, false);
  assert.equal(first.skills.find((s) => s.name === 'write').enabled, false);
  assert.equal(first.skills.find((s) => s.name === 'web').enabled, true);

  await client.saveThreadSkills('local-main', { web: false });
  const second = await client.getThreadSkills('local-main');
  // memory/write 的旧覆盖被整份替换清空，回落 defaultEnabled。
  assert.equal(second.skills.find((s) => s.name === 'memory').enabled, true);
  assert.equal(second.skills.find((s) => s.name === 'write').enabled, true);
  assert.equal(second.skills.find((s) => s.name === 'web').enabled, false);

  // 空对象 = 恢复默认。
  const restored = await client.saveThreadSkills('local-main', {});
  for (const skill of restored.skills) assert.equal(skill.enabled, skill.defaultEnabled);

  // 未知技能 / 非布尔值。
  await assert.rejects(client.saveThreadSkills('local-main', { unknown_skill: true }), isApiError(400, /未知技能/));
  await assert.rejects(client.saveThreadSkills('local-main', { memory: 'yes' }), isApiError(400, /必须为布尔/));
});

test('规则与技能按会话隔离：A 写规则不影响 B', async () => {
  const client = new DemoApiClient(false, TICK);

  await client.saveThreadInstructions('local-main', '主会话规则');
  await client.saveThreadInstructions('demo-weekend', '周末计划规则');
  await client.saveThreadSkills('local-main', { memory: false });

  const aInstructions = await client.getThreadInstructions('local-main');
  const bInstructions = await client.getThreadInstructions('demo-weekend');
  assert.equal(aInstructions.instructions, '主会话规则');
  assert.equal(bInstructions.instructions, '周末计划规则');

  const bSkills = await client.getThreadSkills('demo-weekend');
  // 周末会话没保存过覆盖，所有技能应保持 defaultEnabled=true。
  assert.equal(bSkills.skills.find((s) => s.name === 'memory').enabled, true);
});

test('saveThread* 让线程出现在本地活跃列表，GET 不会', async () => {
  const client = new DemoApiClient(true, TICK);

  const before = await client.listThreads();
  assert.deepEqual(before.map((t) => t.id).sort(), ['local-main']);

  // GET 不创建线程
  await client.getThreadInstructions('about-to-save');
  await client.getThreadSkills('about-to-save');
  const stillOne = await client.listThreads();
  assert.deepEqual(stillOne.map((t) => t.id).sort(), ['local-main']);

  // save 创建线程并出现在列表
  await client.saveThreadInstructions('about-to-save', '规则一');
  const afterSave = await client.listThreads();
  assert.deepEqual(afterSave.map((t) => t.id).sort(), ['about-to-save', 'local-main']);

  await client.saveThreadSkills('another-thread', { memory: false });
  const afterSkills = await client.listThreads();
  assert.deepEqual(afterSkills.map((t) => t.id).sort(), ['about-to-save', 'another-thread', 'local-main']);
});

test('保存规则/技能不影响 chat revision', async () => {
  const client = new DemoApiClient(true, TICK);
  const before = await client.getConversation('local-main');

  await client.saveThreadInstructions('local-main', '任何规则');
  await client.saveThreadSkills('local-main', { memory: false, write: false });

  const after = await client.getConversation('local-main');
  assert.equal(after.revision, before.revision);
});

test('deleteThread 保护主会话（409）且对未存在线程（404）', async () => {
  const client = new DemoApiClient(false, TICK);
  await assert.rejects(client.deleteThread('local-main'), isApiError(409, /主会话不可删除/));
  await assert.rejects(client.deleteThread('不存在的会话'), isApiError(404, /会话不存在/));
});

test('deleteThread 中止挂起 write 审批：run 落盘后线程消失，不复活（非主会话）', async (t) => {
  const client = new DemoApiClient(true, TICK);
  // 预先创建一个非主线程，让删除路径生效。
  await client.saveThreadInstructions('custom-thread', '用于删除的演示线程');
  const revision = (await client.getConversation('custom-thread')).revision;

  const stream = collect();
  const run = client.runAgent(
    { threadId: 'custom-thread', runId: 'run-delete', expectedRevision: revision, message: { id: 'm-d3', content: '请把周末计划写入文件' } },
    stream.onEvent,
  );
  // 先把 abort 的拒绝挂上处理器，避免 deleteThread 同步 abort 时被 Node 当作 unhandled rejection。
  const runAborted = assert.rejects(run, isAbort);
  const approval = await waitForApproval(client, 'run-delete');

  const beforeThreads = await client.listThreads();
  assert.ok(beforeThreads.some((t) => t.id === 'custom-thread'), '删除前线程应可见');

  const removed = await client.deleteThread('custom-thread');
  assert.equal(removed.ok, true);

  await runAborted;
  assert.deepEqual(stream.types().filter((t) => t === 'RUN_FINISHED' || t === 'RUN_ERROR' || t === 'TOOL_CALL_RESULT'), []);

  // 线程已从活跃列表移除。
  const afterThreads = await client.listThreads();
  assert.equal(afterThreads.some((t) => t.id === 'custom-thread'), false);

  // 审批状态变成 cancelled，不挂在待办列表里。
  const cancelled = client.approvalHistory().find((n) => n.id === approval.id);
  assert.equal(cancelled?.status, 'cancelled');
  assert.equal((await client.getSnapshot()).notifications.length, 0);

  // 配置记录已清理：再 GET 应返回默认快照。
  const refreshed = await client.getThreadInstructions('custom-thread');
  assert.equal(refreshed.instructions, '');
  const skills = await client.getThreadSkills('custom-thread');
  for (const skill of skills.skills) assert.equal(skill.enabled, skill.defaultEnabled);

  // finally 没有复活：旧 run 的助手消息不应出现在任何线程历史里。
  // 删除后 getConversation 严格只读，直接给空修订与空消息；assistant 不应被 commit 到任何线程。
  const refreshedConv = await client.getConversation('custom-thread');
  assert.equal(refreshedConv.messages.length, 0, '删除后旧 run 的助手消息不应复活');
  assert.equal(refreshedConv.revision, 'empty');
});

test('deleteThread 级联：绑定 job/monitor 直接删除；绑定 task queued/running 取消并保留终态', async () => {
  const client = new DemoApiClient(true, TICK);
  await client.saveThreadInstructions('cascade-thread', '回复级联规则');

  // delegate_task（受 task 技能门控）→ 创建 task（origin=cascade-thread）
  const taskStream = collect();
  await client.runAgent(
    { threadId: 'cascade-thread', runId: 'run-cascade-task', expectedRevision: 'empty', message: { id: 'm-cascade-2', content: '请创建一个后台任务整理计划' } },
    taskStream.onEvent,
  );
  const snapshot1 = await client.getSnapshot();
  const newTask = snapshot1.tasks.find((t) => t.prompt.includes('轻松的周末旅行计划'));
  assert.ok(newTask);
  // 任务快照通过 getThreadSkills('task-'+id) 反查，无需 debug 接口。
  const taskSnapshotSkills = await client.getThreadSkills(`task-${newTask.id}`);
  assert.equal(taskSnapshotSkills.skills.find((s) => s.name === 'memory').enabled, true);
  assert.equal(taskSnapshotSkills.skills.find((s) => s.name === 'task').enabled, true);

  // schedule（受 cron 技能门控）→ 创建 job（origin=cascade-thread）
  const jobStream = collect();
  await client.runAgent(
    { threadId: 'cascade-thread', runId: 'run-cascade-job', expectedRevision: (await client.getConversation('cascade-thread')).revision, message: { id: 'm-cascade-3', content: '给我创建一个定时简报任务' } },
    jobStream.onEvent,
  );
  const snapshot2 = await client.getSnapshot();
  const newJob = snapshot2.tasks.find((t) => t.kind === 'job' && t.prompt.includes('每周整理目标进展'));
  assert.ok(newJob);

  // monitor → 创建 monitor（origin=cascade-thread，originThreadId 真实写入 Monitor 字段）
  const monitorStream = collect();
  await client.runAgent(
    { threadId: 'cascade-thread', runId: 'run-cascade-monitor', expectedRevision: (await client.getConversation('cascade-thread')).revision, message: { id: 'm-cascade-4', content: '帮我监控一下车票页面' } },
    monitorStream.onEvent,
  );
  const snapshot3 = await client.getSnapshot();
  const newMonitor = snapshot3.monitors.find((m) => m.title === '关注旅行页面');
  assert.ok(newMonitor);
  assert.equal(newMonitor.originThreadId, 'cascade-thread', 'Monitor.originThreadId 真实写入');

  // 把 task 推到 running，再删除：queued/running → cancelled 并保留。
  client.advanceTask(newTask.id);

  const removed = await client.deleteThread('cascade-thread');
  assert.equal(removed.ok, true);
  assert.equal(removed.removed.jobs, 1);
  assert.equal(removed.removed.monitors, 1);

  const after = await client.getSnapshot();
  // task：保留为终态 cancelled。
  const survivingTask = after.tasks.find((t) => t.id === newTask.id);
  assert.ok(survivingTask, 'task 终态记录保留');
  assert.equal(survivingTask.status, 'cancelled');
  assert.equal(after.monitors.find((m) => m.id === newMonitor.id), undefined, 'monitor 直接删除');
  assert.equal(after.tasks.find((t) => t.id === newJob.id), undefined, 'job 直接删除');

  // 删除线程后任务快照同步清理：getThreadSkills('task-{id}') 不再返回快照。
  const afterSnapshot = await client.getThreadSkills(`task-${newTask.id}`);
  assert.ok(afterSnapshot.skills.every((skill) => skill.enabled === skill.defaultEnabled), '快照清理后返回技能默认值');
});

test('deleteThread 清理 finished 签名：新会话不复用旧 runId', async () => {
  const client = new DemoApiClient(true, TICK);
  await client.saveThreadInstructions('replay-thread', '幂等测试');
  await client.runAgent(
    { threadId: 'replay-thread', runId: 'run-replay-1', expectedRevision: 'empty', message: { id: 'm-r1', content: '你好' } },
    () => {},
  );

  await client.deleteThread('replay-thread');
  // 同 ID 重建线程：save 路径会让线程再次出现。
  await client.saveThreadInstructions('replay-thread', '同 ID 新会话');
  const revision = (await client.getConversation('replay-thread')).revision;

  // 旧的 finished 签名已被清空，重放应当重新走完整流程（这里以 RUN_FINISHED 事件验证）。
  const events = [];
  await client.runAgent(
    { threadId: 'replay-thread', runId: 'run-replay-1', expectedRevision: revision, message: { id: 'm-r1', content: '你好' } },
    (e) => events.push(e.type),
  );
  assert.deepEqual(events.filter((t) => t === 'MESSAGES_SNAPSHOT'), [], 'finished 被清空，不应直接走重放分支');
  assert.equal(events.at(-1), 'RUN_FINISHED');
});

test('未知/已删除线程的 getConversation 返回 empty 不创建；迟到 stopRun 不污染列表', async () => {
  const client = new DemoApiClient(true, TICK);

  // 未知线程：GET 严格只读，重复读取与列表都保持原样。
  const initial = await client.listThreads();
  const unknown1 = await client.getConversation('phantom-thread');
  const unknown2 = await client.getConversation('phantom-thread');
  assert.deepEqual(unknown1, { revision: 'empty', messages: [] });
  assert.deepEqual(unknown2, { revision: 'empty', messages: [] });
  assert.deepEqual(await client.listThreads(), initial, 'GET 不应出现在活跃列表');

  // 删后再次 GET：thread 已被清空，禁止重建。
  await client.saveThreadInstructions('doomed-thread', '待删除');
  await client.deleteThread('doomed-thread');
  const afterDelete = await client.getConversation('doomed-thread');
  assert.deepEqual(afterDelete, { revision: 'empty', messages: [] });

  // 迟到 stopRun 一律 false：不挂起新 run，也不把线程带回列表。
  assert.equal(await client.stopRun('doomed-thread', 'run-anything'), false);
  assert.equal(await client.stopRun('doomed-thread', 'run-other'), false);

  const finalList = await client.listThreads();
  assert.equal(finalList.some((t) => t.id === 'doomed-thread'), false, '删除后线程不应被迟到 stop 复活');
});

test('删除进行中 settings save/run 拒绝带 code THREAD_DELETING；GET 返回 empty', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  await client.saveThreadInstructions('deleting-thread', 'x');
  const stream = collect();
  let deletePromise;
  const run = client.runAgent(
    { threadId: 'deleting-thread', runId: 'run-slow', expectedRevision: 'empty', message: { id: 'm-slow', content: '慢流' } },
    (event) => {
      stream.onEvent(event);
      // 在运行回调内启动删除，固定住等待当前轮收尾的窗口，不依赖计时器竞速。
      if (event.type === 'RUN_STARTED') deletePromise = client.deleteThread('deleting-thread');
    },
  );
  const runAborted = assert.rejects(run, isAbort);
  assert.ok(deletePromise);
  const deleting = (error) => error.name === 'ApiError' && error.status === 409 && error.code === 'THREAD_DELETING';
  const checks = [
    assert.rejects(client.saveThreadInstructions('deleting-thread', '新规则'), deleting),
    assert.rejects(client.saveThreadSkills('deleting-thread', { memory: false }), deleting),
    assert.rejects(client.runAgent(
      { threadId: 'deleting-thread', runId: 'run-during-delete', expectedRevision: 'empty', message: { id: 'm-during', content: 'x' } },
      () => {},
    ), deleting),
    client.getConversation('deleting-thread').then((history) => assert.deepEqual(history, { revision: 'empty', messages: [] })),
    client.stopRun('deleting-thread', 'run-slow').then((stopped) => assert.equal(stopped, false)),
  ];
  await Promise.all([...checks, deletePromise, runAborted]);
  assert.equal((await client.listThreads()).some((thread) => thread.id === 'deleting-thread'), false);
});

test('同名线程删除后，显式 run 用 empty revision 创建新会话且无旧历史', async () => {
  const client = new DemoApiClient(true, TICK);

  // 首版：建会话，跑一轮产生历史。
  await client.saveThreadInstructions('reused-id', '首版规则');
  await client.runAgent(
    { threadId: 'reused-id', runId: 'run-original', expectedRevision: 'empty', message: { id: 'm-o1', content: '帮我创建一个后台任务' } },
    () => {},
  );

  const before = await client.getConversation('reused-id');
  assert.notEqual(before.revision, 'empty', '首轮 run 后会话应进入 demo:N');
  assert.ok(before.messages.some((m) => m.role === 'user' && m.content === '帮我创建一个后台任务'));
  assert.ok(before.messages.some((m) => m.role === 'assistant'));

  // 删除后 GET 返回 empty；线程不会复活。
  await client.deleteThread('reused-id');
  assert.deepEqual(await client.getConversation('reused-id'), { revision: 'empty', messages: [] });

  // 同名显式新 run：expectedRevision='empty'，新 runId。
  const stream = collect();
  await client.runAgent(
    { threadId: 'reused-id', runId: 'run-fresh', expectedRevision: 'empty', message: { id: 'm-fresh', content: '全新一轮' } },
    stream.onEvent,
  );

  const fresh = await client.getConversation('reused-id');
  assert.notEqual(fresh.revision, 'empty', '新 run 后会话进入 demo:N');
  const userMessages = fresh.messages.filter((m) => m.role === 'user');
  const assistantMessages = fresh.messages.filter((m) => m.role === 'assistant');
  assert.equal(userMessages.length, 1);
  assert.equal(assistantMessages.length, 1);
  assert.equal(userMessages[0].content, '全新一轮');
  assert.equal(
    fresh.messages.find((m) => m.role === 'user' && m.content === '帮我创建一个后台任务'),
    undefined,
    '新会话不应残留旧历史',
  );
});

test('createTask origin 快照：技能快照独立于会话后续变更，不影响 chat revision', async () => {
  const client = new DemoApiClient(true, TICK);

  // 关闭 local-main 的 memory 与 write 技能，然后创建一个 origin=local-main 的任务。
  await client.saveThreadSkills('local-main', { memory: false, write: false });
  const before = await client.getConversation('local-main');

  const task = await client.createTask('独立任务演示', '任务标题', 'local-main');
  const after = await client.getConversation('local-main');

  // createTask 不应推进 chat revision。
  assert.equal(after.revision, before.revision);

  // AgentTask 响应不包含 origin（服务端 Dto 无该字段）。
  assert.equal(task.originThreadId, undefined, 'AgentTask 响应类型不暴露 origin');

  // 技能快照通过 GET 路径反查：必须包含全部 7 个内置技能。
  const snapshot = await client.getThreadSkills(`task-${task.id}`);
  assert.equal(snapshot.skills.length, 7);
  assert.equal(snapshot.skills.find((s) => s.name === 'memory').enabled, false);
  assert.equal(snapshot.skills.find((s) => s.name === 'write').enabled, false);
  assert.equal(snapshot.skills.find((s) => s.name === 'web').enabled, true);
  assert.equal(snapshot.skills.find((s) => s.name === 'task').enabled, true);

  // 后续修改会话技能不影响已创建任务的快照（快照是创建时的副本）。
  await client.saveThreadSkills('local-main', { memory: true, write: true });
  const snapshotAfter = await client.getThreadSkills(`task-${task.id}`);
  assert.equal(snapshotAfter.skills.find((s) => s.name === 'memory').enabled, false);
  assert.equal(snapshotAfter.skills.find((s) => s.name === 'write').enabled, false);
});

test('createTask 不传 origin 时不继承主会话覆盖，GET 返回默认值', async () => {
  const client = new DemoApiClient(true, TICK);
  await client.saveThreadSkills('local-main', { web: false });
  const task = await client.createTask('没有来源');
  const snapshot = await client.getThreadSkills(`task-${task.id}`);
  assert.equal(snapshot.skills.length, 7);
  assert.ok(snapshot.skills.every((skill) => skill.enabled === skill.defaultEnabled));
});

test('createTask title 空时回落 prompt，保持原行为', async () => {
  const client = new DemoApiClient(true, TICK);
  const onlyPrompt = await client.createTask('仅传 prompt');
  assert.equal(onlyPrompt.title, '仅传 prompt');

  const emptyTitle = await client.createTask('另一个 prompt', '');
  assert.equal(emptyTitle.title, '另一个 prompt');
});

test('advanceTask 通知改变权威聊天历史必须 version++', async () => {
  const client = new DemoApiClient(true, TICK);
  await client.runAgent(
    { threadId: 'local-main', runId: 'run-task-create', expectedRevision: 'empty', message: { id: 'm-task', content: '请创建一个后台任务整理计划' } },
    () => {},
  );
  const task = (await client.getSnapshot()).tasks.find((t) => t.prompt.includes('轻松的周末旅行计划'));
  assert.ok(task);

  const before = await client.getConversation('local-main');

  // advanceTask → queued→running：在权威聊天历史里追加 demo 通知，version 必须 ++。
  client.advanceTask(task.id);
  const midRevision = (await client.getConversation('local-main')).revision;
  assert.notEqual(midRevision, before.revision, 'advanceTask 必须推进 chat revision');

  // 再推进：running→succeeded：version 再 ++。
  client.advanceTask(task.id);
  const afterRevision = (await client.getConversation('local-main')).revision;
  assert.notEqual(afterRevision, midRevision, '第二次推进应继续推进版本号');
});

test('runAgent 技能关闭时不派发对应工具，仅产普通回复', async (t) => {
  const client = new DemoApiClient(true, TICK);
  t.after(() => client.dispose());
  // 7 个内置技能全部关闭；read/get_weather 不在清单内不受影响。
  await client.saveThreadSkills('local-main', { cron: false, monitor: false, task: false, goal: false, memory: false, web: false, write: false });

  const stream = collect();
  await client.runAgent(
    { threadId: 'local-main', runId: 'run-skill-off', expectedRevision: 'empty', message: { id: 'm-skill-off', content: '请帮我记住今天去爬山' } },
    stream.onEvent,
  );

  // memory 关闭 → 不写入记忆。
  assert.equal(stream.types().at(-1), 'RUN_FINISHED');
  assert.deepEqual(stream.types().filter((t) => t.startsWith('TOOL_')), []);
  const snapshot = await client.getSnapshot();
  assert.equal(snapshot.memories.length, 0, 'memory 关闭 → 不写入记忆');
});

test('新方法对已 abort 的 signal 立即拒绝', async () => {
  const client = new DemoApiClient(true, TICK);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.getThreadInstructions('local-main', controller.signal), isAbort);
  await assert.rejects(client.saveThreadInstructions('local-main', 'x', controller.signal), isAbort);
  await assert.rejects(client.getThreadSkills('local-main', controller.signal), isAbort);
  await assert.rejects(client.saveThreadSkills('local-main', {}, controller.signal), isAbort);
  await assert.rejects(client.deleteThread('local-main', controller.signal), isAbort);
});

test('getThreadSkills 返回深拷贝：外部修改不污染内部', async () => {
  const client = new DemoApiClient(true, TICK);
  await client.saveThreadSkills('local-main', { memory: false });

  const first = await client.getThreadSkills('local-main');
  first.skills.find((s) => s.name === 'memory').enabled = true;
  first.skills.push({ name: 'memory', description: '注入', defaultEnabled: true, enabled: false });

  const second = await client.getThreadSkills('local-main');
  assert.equal(second.skills.find((s) => s.name === 'memory').enabled, false);
  assert.equal(second.skills.length, 7);
});
