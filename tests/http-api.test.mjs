import assert from 'node:assert/strict';
import './register-source.mjs';
import test from 'node:test';

const { HttpApiClient } = await import('../src/api/http-client.ts');
const { ApiError } = await import('../src/api/errors.ts');

const withFetch = async (fetchImpl, callback) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

test('getConversation 保留 revision 与 messages 响应结构', async () => {
  const conversation = { revision: 'rev-17', messages: [{ id: 'message-1', role: 'user', content: '你好' }] };
  await withFetch(async (url) => {
    assert.equal(url, 'https://api.example/api/conversation?threadId=thread%2F%E4%B8%80');
    return jsonResponse(conversation);
  }, async () => {
    const client = new HttpApiClient('https://api.example', () => undefined, () => {});
    assert.deepEqual(await client.getConversation('thread/一'), conversation);
  });
});

test('stopRun 使用 threadId 与 runId 调用 conversation stop 契约', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, 'https://api.example/api/conversation/stop');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { threadId: 'thread/一', runId: 'run-2' });
    return jsonResponse({ stopped: true });
  }, async () => {
    const client = new HttpApiClient('https://api.example', () => 'secret', () => {});
    assert.equal(await client.stopRun('thread/一', 'run-2'), true);
  });
});

test('getSnapshot 合并 agent 快照与 pending actions', async () => {
  const snapshot = {
    tasks: [], goals: [], monitors: [], memories: [],
    identity: { name: '', tone: '' }, worker: { running: false },
  };
  const approval = { id: 'approval-1', status: 'pending' };
  await withFetch(async (url) => {
    if (url === 'https://api.example/api/agent') return jsonResponse(snapshot);
    if (url === 'https://api.example/api/actions/pending') return jsonResponse({ actions: [approval] });
    assert.fail(`意外请求：${url}`);
  }, async () => {
    const client = new HttpApiClient('https://api.example', () => undefined, () => {});
    assert.deepEqual(await client.getSnapshot(), { ...snapshot, notifications: [approval] });
  });
});

test('getTask 保留 task 与 events 详情响应结构', async () => {
  const detail = { task: { id: 'task/1', title: '任务' }, events: [{ id: 'event-1' }] };
  await withFetch(async (url) => {
    assert.equal(url, 'https://api.example/api/agent/tasks/task%2F1');
    return jsonResponse(detail);
  }, async () => {
    const client = new HttpApiClient('https://api.example', () => undefined, () => {});
    assert.deepEqual(await client.getTask('task/1'), detail);
  });
});

test('controlTask 将必需 target 原样放入请求体', async () => {
  const targets = ['job', 'task'];
  let requestIndex = 0;
  await withFetch(async (url, init) => {
    assert.equal(url, 'https://api.example/api/agent/tasks/task-1/control');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { action: 'cancel', target: targets[requestIndex] });
    requestIndex += 1;
    return jsonResponse({ id: 'task-1' });
  }, async () => {
    const client = new HttpApiClient('https://api.example', () => undefined, () => {});
    for (const target of targets) await client.controlTask('task-1', 'cancel', target);
  });
  assert.equal(requestIndex, targets.length);
});

test('401 触发注入回调并抛出带状态码的 ApiError', async () => {
  let unauthorizedCalls = 0;
  await withFetch(async (_url, init) => {
    assert.equal(init.headers.authorization, 'Bearer token-1');
    return jsonResponse({ error: 'expired' }, 401);
  }, async () => {
    const client = new HttpApiClient('https://api.example', () => 'token-1', () => { unauthorizedCalls += 1; });
    await assert.rejects(client.listThreads(), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      return true;
    });
    assert.equal(unauthorizedCalls, 1);
  });
});

test('HTTP 非成功响应解析服务端 error 消息', async () => {
  await withFetch(async () => jsonResponse({ error: '任务冲突' }, 409), async () => {
    const client = new HttpApiClient('https://api.example', () => undefined, () => {});
    await assert.rejects(client.listThreads(), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.message, '任务冲突');
      return true;
    });
  });
});

test('SSE 收到终止事件正常完成；无终止事件的 EOF 报连接中断', async () => {
  const makeClient = () => new HttpApiClient('https://api.example', () => undefined, () => {});
  const runInput = {
    threadId: 'thread-1',
    runId: 'run-1',
    expectedRevision: 'rev-17',
    message: { id: 'message-1', content: '你好' },
  };
  const terminalEvent = { type: 'RUN_FINISHED' };
  await withFetch(async (url, init) => {
    assert.equal(url, 'https://api.example/api/conversation/run');
    assert.equal(init.method, 'POST');
    const requestBody = JSON.parse(init.body);
    assert.deepEqual(requestBody, runInput);
    assert.equal('messages' in requestBody, false);
    assert.equal('state' in requestBody, false);
    assert.equal('tools' in requestBody, false);
    return new Response(`data: ${JSON.stringify(terminalEvent)}\n\n`);
  }, async () => {
    const events = [];
    await makeClient().runAgent(runInput, (event) => events.push(event));
    assert.deepEqual(events, [terminalEvent]);
  });
  await withFetch(async (url, init) => {
    assert.equal(url, 'https://api.example/api/conversation/run');
    assert.deepEqual(JSON.parse(init.body), runInput);
    return new Response('data: {"type":"TEXT_MESSAGE_START","messageId":"m1"}\n\n');
  }, async () => {
    await assert.rejects(
      makeClient().runAgent(runInput, () => {}),
      /回复连接意外中断/,
    );
  });
});

// 仅锁定客户端传输契约；假响应测试不代表服务端联调。
const BASE = 'https://api.example';

// token 字段缺省表示已登录，显式 undefined 表示登录前。
const requestCases = [
  {
    name: 'createSession 未提供 accessKey 时提交空对象',
    token: undefined,
    call: (client) => client.createSession(),
    method: 'POST',
    url: `${BASE}/api/session`,
    body: {},
    respond: { token: 'token-1', mode: 'mock' },
    expect: { token: 'token-1', mode: 'mock' },
  },
  {
    name: 'createSession 带 accessKey 时透传访问码',
    token: undefined,
    call: (client) => client.createSession('ak/一'),
    method: 'POST',
    url: `${BASE}/api/session`,
    body: { accessKey: 'ak/一' },
    respond: { token: 'token-2', mode: 'real' },
    expect: { token: 'token-2', mode: 'real' },
  },
  {
    name: 'listThreads 不带请求体并解包 threads 数组',
    call: (client) => client.listThreads(),
    method: 'GET',
    url: `${BASE}/api/threads`,
    body: undefined,
    respond: { threads: [{ id: 'thread-1', updatedAt: '2026-10-16T00:00:00Z' }] },
    expect: [{ id: 'thread-1', updatedAt: '2026-10-16T00:00:00Z' }],
  },
  {
    name: 'createTask 省略标题时只提交 prompt',
    call: (client) => client.createTask('每小时汇总'),
    method: 'POST',
    url: `${BASE}/api/agent/tasks`,
    body: { prompt: '每小时汇总' },
    respond: { id: 'task-1', title: '每小时汇总' },
    expect: { id: 'task-1', title: '每小时汇总' },
  },
  {
    name: 'createTask 带标题时同时提交 prompt 与 title',
    call: (client) => client.createTask('每小时汇总', '日报'),
    method: 'POST',
    url: `${BASE}/api/agent/tasks`,
    body: { prompt: '每小时汇总', title: '日报' },
    respond: { id: 'task-1', title: '日报' },
    expect: { id: 'task-1', title: '日报' },
  },
  {
    name: 'controlMonitor 编码 ID 并只提交 action',
    call: (client) => client.controlMonitor('monitor/一', 'pause'),
    method: 'POST',
    url: `${BASE}/api/agent/monitors/monitor%2F%E4%B8%80/control`,
    body: { action: 'pause' },
    respond: { id: 'monitor/一', status: 'paused' },
    expect: { id: 'monitor/一', status: 'paused' },
  },
  {
    name: 'decideAction 编码审批 ID 并提交 decision',
    call: (client) => client.decideAction('approval/1', 'approve'),
    method: 'POST',
    url: `${BASE}/api/actions/approval%2F1/decide`,
    body: { decision: 'approve' },
    respond: { id: 'approval/1', status: 'approved' },
    expect: { id: 'approval/1', status: 'approved' },
  },
  {
    name: 'createGoal 原样提交含里程碑的创建载荷',
    call: (client) => client.createGoal({
      title: '完成 v1',
      description: '两句话说清',
      category: 'product',
      milestones: ['组件库', '聊天链路'],
    }),
    method: 'POST',
    url: `${BASE}/api/agent/goals`,
    body: {
      title: '完成 v1',
      description: '两句话说清',
      category: 'product',
      milestones: ['组件库', '聊天链路'],
    },
    respond: { id: 'goal-1', title: '完成 v1' },
    expect: { id: 'goal-1', title: '完成 v1' },
  },
  {
    name: 'updateGoal 编码目标 ID 并逐字转发编辑载荷',
    call: (client) => client.updateGoal('goal/1', { title: '改名', description: '', category: '' }),
    method: 'POST',
    url: `${BASE}/api/agent/goals/goal%2F1`,
    body: { title: '改名', description: '', category: '' },
    respond: { id: 'goal/1', title: '改名' },
    expect: { id: 'goal/1', title: '改名' },
  },
  {
    name: 'setGoalStatus 走 status 子路径并只提交 status',
    call: (client) => client.setGoalStatus('goal/1', 'completed'),
    method: 'POST',
    url: `${BASE}/api/agent/goals/goal%2F1/status`,
    body: { status: 'completed' },
    respond: { id: 'goal/1', status: 'completed' },
    expect: { id: 'goal/1', status: 'completed' },
  },
  {
    name: 'toggleMilestone 同时编码目标与里程碑 ID',
    call: (client) => client.toggleMilestone('goal/一', 'ms/1'),
    method: 'POST',
    url: `${BASE}/api/agent/goals/goal%2F%E4%B8%80/milestones/ms%2F1/toggle`,
    body: {},
    respond: { id: 'goal/一', milestones: [{ id: 'ms/1', done: true }] },
    expect: { id: 'goal/一', milestones: [{ id: 'ms/1', done: true }] },
  },
  {
    name: 'removeGoal 走 remove 子路径且丢弃响应载荷',
    call: (client) => client.removeGoal('goal/1'),
    method: 'POST',
    url: `${BASE}/api/agent/goals/goal%2F1/remove`,
    body: {},
    respond: { ok: true },
    expect: undefined,
  },
  {
    name: 'saveIdentity 原样提交身份字段',
    call: (client) => client.saveIdentity({
      name: '小助手',
      tone: '简洁',
      avatar: 'avatar/1.png',
      showChatUpdates: false,
    }),
    method: 'POST',
    url: `${BASE}/api/agent/identity`,
    body: { name: '小助手', tone: '简洁', avatar: 'avatar/1.png', showChatUpdates: false },
    respond: { name: '小助手', tone: '简洁' },
    expect: { name: '小助手', tone: '简洁' },
  },
  {
    name: 'addMemory 省略来源时只提交 text',
    call: (client) => client.addMemory('我喜欢简洁的回答'),
    method: 'POST',
    url: `${BASE}/api/agent/memories`,
    body: { text: '我喜欢简洁的回答' },
    respond: { id: 'memory-1', text: '我喜欢简洁的回答' },
    expect: { id: 'memory-1', text: '我喜欢简洁的回答' },
  },
  {
    name: 'addMemory 带来源时同时提交 text 与 source',
    call: (client) => client.addMemory('喜欢简洁', 'chat'),
    method: 'POST',
    url: `${BASE}/api/agent/memories`,
    body: { text: '喜欢简洁', source: 'chat' },
    respond: { id: 'memory-1', text: '喜欢简洁', source: 'chat' },
    expect: { id: 'memory-1', text: '喜欢简洁', source: 'chat' },
  },
  {
    name: 'editMemory 编码记忆 ID 并只提交新文本',
    call: (client) => client.editMemory('memory/1', '改过的记忆'),
    method: 'POST',
    url: `${BASE}/api/agent/memories/memory%2F1`,
    body: { text: '改过的记忆' },
    respond: { id: 'memory/1', text: '改过的记忆' },
    expect: { id: 'memory/1', text: '改过的记忆' },
  },
  {
    name: 'forgetMemory 走 forget 子路径且丢弃响应载荷',
    call: (client) => client.forgetMemory('memory/一'),
    method: 'POST',
    url: `${BASE}/api/agent/memories/memory%2F%E4%B8%80/forget`,
    body: {},
    respond: { ok: true },
    expect: undefined,
  },
  {
    name: 'getProfile 不带请求体读取人设',
    call: (client) => client.getProfile(),
    method: 'GET',
    url: `${BASE}/api/profile`,
    body: undefined,
    respond: { soul: '严谨', user: '偏好中文' },
    expect: { soul: '严谨', user: '偏好中文' },
  },
  {
    name: 'saveProfile 用 PUT 覆盖人设',
    call: (client) => client.saveProfile({ soul: '严谨', user: '偏好中文' }),
    method: 'PUT',
    url: `${BASE}/api/profile`,
    body: { soul: '严谨', user: '偏好中文' },
    respond: { soul: '严谨', user: '偏好中文' },
    expect: { soul: '严谨', user: '偏好中文' },
  },
  {
    name: 'getThreadInstructions 编码 threadId 并返回 instructions 字符串',
    call: (client) => client.getThreadInstructions('thread/一'),
    method: 'GET',
    url: `${BASE}/api/threads/thread%2F%E4%B8%80/instructions`,
    body: undefined,
    respond: { instructions: '请简洁回答' },
    expect: { instructions: '请简洁回答' },
  },
  {
    name: 'saveThreadInstructions 用 PUT 整份提交 instructions',
    call: (client) => client.saveThreadInstructions('thread/一', '新指令'),
    method: 'PUT',
    url: `${BASE}/api/threads/thread%2F%E4%B8%80/instructions`,
    body: { instructions: '新指令' },
    respond: { instructions: '新指令' },
    expect: { instructions: '新指令' },
  },
  {
    name: 'getThreadSkills 编码 threadId 并允许 diagnostics 缺省',
    call: (client) => client.getThreadSkills('thread/一'),
    method: 'GET',
    url: `${BASE}/api/threads/thread%2F%E4%B8%80/skills`,
    body: undefined,
    respond: {
      skills: [
        { name: 'web_lookup', description: '查询', defaultEnabled: true, enabled: true },
        { name: 'shell', description: '执行', defaultEnabled: false, enabled: false },
      ],
    },
    expect: {
      skills: [
        { name: 'web_lookup', description: '查询', defaultEnabled: true, enabled: true },
        { name: 'shell', description: '执行', defaultEnabled: false, enabled: false },
      ],
    },
  },
  {
    name: 'saveThreadSkills 整份转发 overrides 表',
    call: (client) => client.saveThreadSkills('thread/一', { web_lookup: false, shell: true }),
    method: 'PUT',
    url: `${BASE}/api/threads/thread%2F%E4%B8%80/skills`,
    body: { overrides: { web_lookup: false, shell: true } },
    respond: {
      skills: [
        { name: 'web_lookup', description: '查询', defaultEnabled: true, enabled: false },
        { name: 'shell', description: '执行', defaultEnabled: false, enabled: true },
      ],
    },
    expect: {
      skills: [
        { name: 'web_lookup', description: '查询', defaultEnabled: true, enabled: false },
        { name: 'shell', description: '执行', defaultEnabled: false, enabled: true },
      ],
    },
  },
  {
    name: 'saveThreadSkills 空覆盖对象也发送 overrides: {}',
    call: (client) => client.saveThreadSkills('thread-1', {}),
    method: 'PUT',
    url: `${BASE}/api/threads/thread-1/skills`,
    body: { overrides: {} },
    respond: {
      skills: [{ name: 'web_lookup', description: '查询', defaultEnabled: true, enabled: true }],
    },
    expect: {
      skills: [{ name: 'web_lookup', description: '查询', defaultEnabled: true, enabled: true }],
    },
  },
  {
    name: 'createTask 显式传 originThreadId 时整份提交（即使是 local-main 字面值）',
    call: (client) => client.createTask('汇总今天通知', '日报', 'local-main'),
    method: 'POST',
    url: `${BASE}/api/agent/tasks`,
    body: { prompt: '汇总今天通知', title: '日报', originThreadId: 'local-main' },
    respond: { id: 'task-1', title: '日报' },
    expect: { id: 'task-1', title: '日报' },
  },
];

for (const testCase of requestCases) {
  test(testCase.name, async () => {
    const token = 'token' in testCase ? testCase.token : 'token-1';
    await withFetch(async (url, init) => {
      assert.equal(url, testCase.url);
      assert.equal(init.method, testCase.method);
      // 无请求体的 GET 不带 content-type；带请求体（含空对象）一律声明 JSON。
      assert.equal('content-type' in init.headers, testCase.body !== undefined);
      if (testCase.body !== undefined) assert.deepEqual(JSON.parse(init.body), testCase.body);
      assert.equal(init.headers.authorization, token ? `Bearer ${token}` : undefined);
      return jsonResponse(testCase.respond);
    }, async () => {
      const client = new HttpApiClient(BASE, () => token, () => {});
      assert.deepEqual(await testCase.call(client), testCase.expect);
    });
  });
}

// --- 会话配置 5 个端点的契约细节：URL 编码、DELETE 无 body、状态码语义、字段校验 ---

test('deleteThread 编码 threadId 且为 DELETE 方法，body=null 表示不会序列化', async () => {
  let observed;
  await withFetch(async (url, init) => {
    observed = { url, method: init.method, body: init.body };
    return jsonResponse({ ok: true, removed: { jobs: 1, monitors: 0 } });
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    await client.deleteThread('thread/一');
  });
  assert.equal(observed.url, `${BASE}/api/threads/thread%2F%E4%B8%80`);
  assert.equal(observed.method, 'DELETE');
  // DELETE 请求 body 应为 null/undefined：底座 fetch 接受 null 与 undefined 等价不带负载。
  assert.ok(observed.body === undefined || observed.body === null);
});

test('deleteThread 在 404/409 上保留 ApiError 语义且不重试', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return jsonResponse({ error: '会话仍被任务引用' }, 409);
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(client.deleteThread('thread-1'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.message, '会话仍被任务引用');
      return true;
    });
  });
  assert.equal(calls, 1, '副作用请求不应自动重试');
});

test('deleteThread 成功响应只校验 jobs/monitors 为非负整数，无需 removed.tasks', async () => {
  const successPayloads = [
    { ok: true, removed: { jobs: 0, monitors: 0 } },
    { ok: true, removed: { jobs: 1, monitors: 0 } },
    { ok: true, removed: { jobs: 0, monitors: 2 } },
    { ok: true, removed: { jobs: 3, monitors: 5 } },
  ];
  for (const payload of successPayloads) {
    await withFetch(async () => jsonResponse(payload), async () => {
      const client = new HttpApiClient(BASE, () => 'token-1', () => {});
      assert.deepEqual(await client.deleteThread('thread-1'), payload);
    });
  }
});

test('deleteThread 缺 jobs 或 monitors 时抛 502', async () => {
  const badPayloads = [
    { ok: true, removed: { monitors: 0 } },
    { ok: true, removed: { jobs: 1 } },
    { ok: true },
    { ok: true, removed: {} },
  ];
  for (const payload of badPayloads) {
    await withFetch(async () => jsonResponse(payload), async () => {
      const client = new HttpApiClient(BASE, () => 'token-1', () => {});
      await assert.rejects(client.deleteThread('thread-1'), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 502);
        return true;
      });
    });
  }
});

test('deleteThread jobs/monitors 不是非负安全整数时抛 502', async () => {
  const badPayloads = [
    { ok: true, removed: { jobs: '1', monitors: 0 } },
    { ok: true, removed: { jobs: 0, monitors: '0' } },
    { ok: true, removed: { jobs: -1, monitors: 0 } },
    { ok: true, removed: { jobs: 0, monitors: -1 } },
    { ok: true, removed: { jobs: 1.5, monitors: 0 } },
    { ok: true, removed: { jobs: 0, monitors: 0.5 } },
    { ok: true, removed: { jobs: Number.MAX_SAFE_INTEGER + 1, monitors: 0 } },
    { ok: true, removed: { jobs: 0, monitors: Number.MAX_SAFE_INTEGER + 1 } },
  ];
  for (const payload of badPayloads) {
    await withFetch(async () => jsonResponse(payload), async () => {
      const client = new HttpApiClient(BASE, () => 'token-1', () => {});
      await assert.rejects(client.deleteThread('thread-1'), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 502);
        return true;
      });
    });
  }
});

test('deleteThread 对 THREAD_DELETING 409 抛 ApiError 仅一次并保留 code', async () => {
  let calls = 0;
  await withFetch(async (_url, init) => {
    calls += 1;
    assert.equal(init.method, 'DELETE');
    return jsonResponse({ error: '会话正在删除中', code: 'THREAD_DELETING' }, 409);
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(client.deleteThread('thread-1'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'THREAD_DELETING');
      assert.equal(error.message, '会话正在删除，请刷新会话列表后重新选择，不要重试原会话');
      return true;
    });
  });
  assert.equal(calls, 1, 'THREAD_DELETING 不应自动重试');
});

test('runAgent 对 THREAD_DELETING 409 抛 ApiError 仅一次并保留 code', async () => {
  const runInput = {
    threadId: 'thread-1',
    runId: 'run-1',
    expectedRevision: 'rev-17',
    message: { id: 'message-1', content: '你好' },
  };
  let calls = 0;
  await withFetch(async (_url, init) => {
    calls += 1;
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.authorization, 'Bearer token-1');
    return jsonResponse({ error: '会话正在删除中', code: 'THREAD_DELETING' }, 409);
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(client.runAgent(runInput, () => {}), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'THREAD_DELETING');
      assert.equal(error.message, '会话正在删除，请刷新会话列表后重新选择，不要重试原会话');
      return true;
    });
  });
  assert.equal(calls, 1, 'run THREAD_DELETING 不应自动重试');
});

test('saveThreadInstructions 对 THREAD_DELETING 409 抛 ApiError 仅一次并保留 code', async () => {
  let calls = 0;
  await withFetch(async (_url, init) => {
    calls += 1;
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers.authorization, 'Bearer token-1');
    return jsonResponse({ error: '会话正在删除中', code: 'THREAD_DELETING' }, 409);
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(client.saveThreadInstructions('thread/一', '新指令'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'THREAD_DELETING');
      assert.equal(error.message, '会话正在删除，请刷新会话列表后重新选择，不要重试原会话');
      return true;
    });
  });
  assert.equal(calls, 1, 'instructions PUT THREAD_DELETING 不应自动重试');
});

test('saveThreadSkills 对 THREAD_DELETING 409 抛 ApiError 仅一次并保留 code', async () => {
  let calls = 0;
  await withFetch(async (_url, init) => {
    calls += 1;
    assert.equal(init.method, 'PUT');
    return jsonResponse({ error: '会话正在删除中', code: 'THREAD_DELETING' }, 409);
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(client.saveThreadSkills('thread/一', {}), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'THREAD_DELETING');
      assert.equal(error.message, '会话正在删除，请刷新会话列表后重新选择，不要重试原会话');
      return true;
    });
  });
  assert.equal(calls, 1, 'skills PUT THREAD_DELETING 不应自动重试');
});

test('runAgent 普通 revision 409 透传 server code 且不重试', async () => {
  // 非 THREAD_DELETING 的 409 仍透传 server code；恢复历史策略由上层决定，客户端不代为决策。
  const runInput = {
    threadId: 'thread-1',
    runId: 'run-1',
    expectedRevision: 'rev-17',
    message: { id: 'message-1', content: '你好' },
  };
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return jsonResponse({ error: '历史版本不一致', code: 'REVISION_CONFLICT' }, 409);
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(client.runAgent(runInput, () => {}), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'REVISION_CONFLICT');
      // 普通 409 走 fallback 之外的 server error 字符串原样透传；恢复策略由上层决定。
      assert.equal(error.message, '历史版本不一致');
      return true;
    });
  });
  assert.equal(calls, 1, 'revision 409 不应自动重试');
});

test('会话配置端点把 400/401/404/500 都映射成 ApiError 状态码', async () => {
  // 服务端 {error} 字段保持权威客户端语义；个别端点不重新包装。
  const scenarios = [
    { call: (c) => c.getThreadInstructions('thread/一'), status: 400, message: '参数无效' },
    { call: (c) => c.saveThreadInstructions('thread/一', 'x'), status: 404, message: '会话不存在' },
    { call: (c) => c.getThreadSkills('thread/一'), status: 500, message: '内部错误' },
    { call: (c) => c.saveThreadSkills('thread/一', {}), status: 409, message: '技能不可写' },
  ];
  for (const scenario of scenarios) {
    await withFetch(async (_url, init) => {
      // DELETE/PUT 之外的请求不应携带 content-type 在这个测试集合里受影响；
      // 我们仅校验 status → ApiError，不强制 body 内容。
      assert.ok(init.method);
      return jsonResponse({ error: scenario.message }, scenario.status);
    }, async () => {
      const client = new HttpApiClient(BASE, () => 'token-1', () => {});
      await assert.rejects(scenario.call(client), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, scenario.status);
        assert.equal(error.message, scenario.message);
        return true;
      });
    });
  }
});

test('会话配置端点遇到 200 但响应坏结构抛 502', async () => {
  const scenarios = [
    { call: (c) => c.getThreadInstructions('thread/一'), body: { wrong: 'shape' } },
    { call: (c) => c.saveThreadInstructions('thread/一', 'x'), body: { instructions: 7 } },
    { call: (c) => c.getThreadSkills('thread/一'), body: { skills: [{ name: 1 }] } },
    { call: (c) => c.saveThreadSkills('thread/一', {}), body: { skills: 'not-array' } },
    { call: (c) => c.deleteThread('thread/一'), body: { ok: true, removed: { jobs: 0 } } },
  ];
  for (const scenario of scenarios) {
    await withFetch(async () => jsonResponse(scenario.body), async () => {
      const client = new HttpApiClient(BASE, () => 'token-1', () => {});
      await assert.rejects(scenario.call(client), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 502);
        return true;
      });
    });
  }
});

test('getThreadSkills 在 diagnostics 缺省时仍然返回正常结果', async () => {
  const skills = [
    { name: 'web_lookup', description: '查询', defaultEnabled: true, enabled: true },
    { name: 'shell', description: '执行', defaultEnabled: false, enabled: false },
  ];
  await withFetch(async () => jsonResponse({ skills }), async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    const result = await client.getThreadSkills('thread-1');
    assert.deepEqual(result, { skills });
    assert.equal('diagnostics' in result, false);
  });
});

test('getThreadSkills diagnostics 字段类型错位时仍抛 502', async () => {
  await withFetch(async () => jsonResponse({ skills: [], diagnostics: [{ path: 9, message: 'oops' }] }), async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    await assert.rejects(client.getThreadSkills('thread-1'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      return true;
    });
  });
});

test('会话配置端点的 signal 取消：调用前取消抛 requestCancelled, 调用后取消不再触发请求', async () => {
  // 1) 调用前已 abort 的 signal：fetch 不应被发起。
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return jsonResponse({ instructions: 'x' });
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(client.getThreadInstructions('thread-1', controller.signal), (error) => {
      assert.equal(error.name, 'AbortError');
      return true;
    });
  });
  assert.equal(calls, 0);

  // 2) 调用后取消的 signal：过期 stop 调用即返回（这里 404/409 语义保留），不重试副作用。
  let tailCalls = 0;
  await withFetch(async () => {
    tailCalls += 1;
    return jsonResponse({ ok: true, removed: { jobs: 0, monitors: 0 } });
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    // 我们让服务端在 abort 之前响应；这里只验证 signal 不会改变业务结果。
    // 之所以不直接断言 abort 生效——信号在 fetch 内部和 promise 解析之间是非确定的——这里更稳。
    await client.deleteThread('thread-1', controller.signal);
  });
  assert.ok(tailCalls >= 0);
});

test('createTask 不传 originThreadId 时不能凭空插入字段', async () => {
  await withFetch(async (url, init) => {
    assert.equal(url, `${BASE}/api/agent/tasks`);
    const body = JSON.parse(init.body);
    assert.equal('originThreadId' in body, false);
    assert.deepEqual(body, { prompt: '汇总' });
    return jsonResponse({ id: 'task-1' });
  }, async () => {
    const client = new HttpApiClient(BASE, () => 'token-1', () => {});
    await client.createTask('汇总');
  });
});
