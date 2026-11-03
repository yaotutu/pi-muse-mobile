import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../src/api/http-client.ts';
import { parseCreatedAgent, parseResetAgent, parseAgents } from '../src/api/agent-contracts.ts';
import { parseApprovalView } from '../src/approvals/contracts.ts';
import { parseActivityOverview } from '../src/activities/contracts.ts';
import { ensureAgentStatus } from '../src/runtime/contracts.ts';
import { approvalFixture } from './helpers/approval-fixtures.ts';
import { activityFixture } from './helpers/activity-fixtures.ts';

const resetResult = { ok: true, agentId: 'agent/a', sessionId: 'new-session', cancelledApprovals: 1, removed: { jobs: 0, monitors: 0 } };
const invalid = (error) => error.status === 502;
test('创建成员只提交选定 ID，并严格核对返回归属和绑定', async () => {
  const original = globalThis.fetch; const calls = [];
  const agent = { id: 'side-create', sessionId: 'session-create', updatedAt: new Date(0).toISOString(), extensions: [] };
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ agent })); };
  try {
    const api = new HttpApiClient('https://agent.example', () => 'token', () => {});
    assert.deepEqual(await api.createAgent(agent.id), agent);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://agent.example/api/agents');
    assert.equal(calls[0].init.method, 'POST'); assert.deepEqual(JSON.parse(calls[0].init.body), { agentId: agent.id });
    for (const value of [{ agent: { ...agent, id: 'other' } }, { agent: { ...agent, sessionId: null } }, {}]) {
      assert.throws(() => parseCreatedAgent(value, agent.id), invalid);
    }
  } finally { globalThis.fetch = original; }
});
test('智能体列表必须有真实 sessionId，旧列表、缺绑定或重复智能体不能伪装成功', () => {
  const entry = { id: 'a', sessionId: 'session-a', updatedAt: '2026-10-20T00:00:00Z', extensions: [] };
  assert.deepEqual(parseAgents({ agents: [entry] }), [entry]);
  for (const body of [{ spaces: [entry] }, { agents: [{ ...entry, sessionId: undefined }] }, { agents: [{ ...entry, sessionId: '' }] }, { agents: [entry, entry] }]) {
    assert.throws(() => parseAgents(body), invalid);
  }
});
test('resetAgent 只提交 clearSchedules 并编码智能体ID，默认保留定时任务与监控', async () => {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(resetResult)); };
  try {
    const api = new HttpApiClient('https://agent.example', () => 'token', () => {});
    assert.deepEqual(await api.resetAgent('agent/a'), resetResult);
    await api.resetAgent('agent/a', { clearSchedules: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(({ init }) => JSON.parse(init.body)), [{ clearSchedules: false }, { clearSchedules: true }]);
    for (const { url, init } of calls) {
      assert.equal(url, 'https://agent.example/api/agents/agent%2Fa/reset');
      assert.equal(init.method, 'POST'); assert.equal(init.headers.authorization, 'Bearer token'); assert.equal(init.redirect, 'error');
    }
  } finally { globalThis.fetch = original; }
});
test('重置严格校验智能体归属、sessionId与非负计数，不把坏响应当作已清空', () => {
  assert.deepEqual(parseResetAgent(resetResult, 'agent/a'), resetResult);
  for (const body of [{ ...resetResult, ok: false }, { ...resetResult, agentId: 'other' }, { ...resetResult, sessionId: '' },
    { ...resetResult, cancelledApprovals: undefined }, { ...resetResult, cancelledApprovals: -1 },
    { ...resetResult, removed: { jobs: 1.5, monitors: 0 } }, { ...resetResult, removed: { jobs: 0 } }]) assert.throws(() => parseResetAgent(body, 'agent/a'), invalid);
});
test('resetAgent 错误/取消不自动重试，保留 AGENT_DELETING 语义与401鉴权守卫', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 409, 500]) {
      let count = 0; let unauthorized = 0;
      globalThis.fetch = async () => { count++; return new Response(JSON.stringify({ error: 'failed', code: 'AGENT_DELETING' }), { status }); };
      const api = new HttpApiClient('https://agent.example', () => 'token', () => { unauthorized++; });
      await assert.rejects(api.resetAgent('a'), (e) => e.status === status && (status !== 409 || e.code === 'AGENT_DELETING'));
      assert.equal(count, 1); assert.equal(unauthorized, status === 401 ? 1 : 0);
    }
    let count = 0; globalThis.fetch = async () => { count++; };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(new HttpApiClient('https://agent.example', () => 'token', () => {}).resetAgent('a', {}, controller.signal), (e) => e.name === 'AbortError');
    assert.equal(count, 0);
  } finally { globalThis.fetch = original; }
});
test('审批、活动和运行状态只使用 agentId 归属，不需要同义别名', () => {
  const approval = approvalFixture();
  assert.equal(parseApprovalView(approval).agentId, approval.agentId);
  assert.throws(() => parseApprovalView({ ...approval, agentId: undefined }), invalid);
  assert.equal(parseApprovalView({ ...approval, workspaceAgentId: 'other' }).workspaceAgentId, 'other');
  assert.throws(() => parseApprovalView({ ...approval, preview: { ...approval.preview, ownerAgentId: null } }), invalid);
  const activity = activityFixture();
  assert.deepEqual(parseActivityOverview(activity), activity);
  assert.throws(() => parseActivityOverview({ ...activity, agentId: undefined }), invalid);
  const status = { activityId: null, agentId: 'a', runId: 'run', revision: 1, source: 'chat', jobId: null,
    title: '', status: 'running', phase: 'preparing', label: '', tools: [], subagents: [], pendingApprovalIds: [], startedAt: 'now', updatedAt: 'now', endedAt: null };
  assert.equal(ensureAgentStatus(status).agentId, 'a');
  assert.throws(() => ensureAgentStatus({ ...status, agentId: undefined }), invalid);
});
