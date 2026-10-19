import assert from 'node:assert/strict';
import test from 'node:test';
import './register-source.mjs';
import { RuntimeStore, threadRuntime } from '../src/runtime/runtime-store.ts';
import { ApiError } from '../src/api/errors.ts';

const status = (overrides = {}) => ({ activityId: null, threadId: 'a', runId: 'run-a', revision: 1, source: 'chat', jobId: null, title: '当前执行', status: 'running', phase: 'waiting_model', label: '等待模型响应', tools: [], subagents: [], pendingApprovalIds: [], startedAt: '2026-10-19T10:00:00.000Z', updatedAt: '2026-10-19T10:00:00.000Z', endedAt: null, ...overrides });
const ready = (runs = [], instanceId = 'instance-a') => ({ event: 'ready', data: { instanceId, serverTime: '2026-10-19T10:00:00.000Z', agentStatuses: runs } });
const update = (run, instanceId = 'instance-a') => ({ event: 'agent_status_updated', data: { ...run, instanceId } });
const tick = () => new Promise(setImmediate);
function fixture() {
  const connections = [];
  const queries = [];
  const client = {
    subscribeRuntime(onEvent, signal) {
      return new Promise((resolve, reject) => {
        connections.push({ onEvent, signal, resolve, reject });
      });
    },
    async getAgentStatus(threadId, runId) { queries.push([threadId, runId]); throw new ApiError(404, 'Not found'); },
  };
  const store = new RuntimeStore(client, { retryDelay: () => 1 });
  return { store, client, connections, queries };
}

test('通知流仅一条且按会话隔离，低版本和重复帧不倒退', () => {
  const { store, connections } = fixture();
  store.setActive(true); store.setActive(true);
  assert.equal(connections.length, 1);
  connections[0].onEvent(ready([status(), status({ threadId: 'b', runId: 'run-b', label: 'B 状态' })]));
  connections[0].onEvent(update(status({ revision: 3, label: '正在搜索' })));
  connections[0].onEvent(update(status({ revision: 2, label: '过时' })));
  connections[0].onEvent(update(status({ revision: 3, label: '重复' })));
  assert.equal(threadRuntime(store.getSnapshot(), 'a').label, '正在搜索');
  assert.equal(threadRuntime(store.getSnapshot(), 'b').label, 'B 状态');
  assert.equal(threadRuntime(store.getSnapshot(), 'missing').label, '就绪');
  store.dispose();
});

test('通知断流保留最后观测但不能伪装就绪，退避后ready整体替换并补查消失运行', async () => {
  const { store, connections, queries, client } = fixture();
  client.getAgentStatus = async (...args) => { queries.push(args.slice(0, 2)); return { instanceId: 'instance-a', status: status({ revision: 8, status: 'cancelled', phase: null, endedAt: '2026-10-19T10:01:00.000Z', label: '执行已停止' }) }; };
  store.setActive(true);
  connections[0].onEvent(ready([status()]));
  connections[0].resolve();
  await tick();
  assert.match(threadRuntime(store.getSnapshot(), 'a').label, /状态待同步/);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(connections.length, 2);
  connections[1].onEvent(ready([]));
  assert.deepEqual(store.getSnapshot().runs, []);
  await tick();
  assert.deepEqual(queries, [['a', 'run-a']]);
  assert.equal(threadRuntime(store.getSnapshot(), 'a').label, '执行已停止');
  store.dispose();
});

test('暂停和旧连接迟到事件不污染重连状态，服务实例变化清空旧运行版本', () => {
  const { store, connections } = fixture();
  store.setActive(true);
  connections[0].onEvent(ready([status({ revision: 50 })]));
  store.setActive(false);
  assert.equal(connections[0].signal.aborted, true);
  connections[0].onEvent(update(status({ revision: 51, label: '迟到状态' })));
  store.setActive(true);
  connections[1].onEvent(ready([status({ revision: 1, label: '新实例状态' })], 'instance-b'));
  assert.equal(threadRuntime(store.getSnapshot(), 'a').label, '新实例状态');
  connections[0].onEvent(update(status({ revision: 52, label: '旧实例' })));
  assert.equal(threadRuntime(store.getSnapshot(), 'a').label, '新实例状态');
  store.dispose();
});

test('401不无限重连，手动重试与销毁清理连接', async () => {
  const { store, connections } = fixture();
  store.setActive(true);
  connections[0].reject(new ApiError(401, '重新认证'));
  await tick(); await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(connections.length, 1);
  assert.equal(store.getSnapshot().connection, 'authentication-required');
  store.retry();
  assert.equal(connections.length, 2);
  store.dispose();
  assert.equal(connections[1].signal.aborted, true);
});

test('ready中消失的运行补查失败时明确待同步，404后才恢复就绪', async () => {
  const { store, client, connections } = fixture();
  client.getAgentStatus = async () => { throw new ApiError(503, '暂时不可用'); };
  store.setActive(true);
  connections[0].onEvent(ready([status()]));
  store.retry();
  connections[1].onEvent(ready([]));
  assert.equal(threadRuntime(store.getSnapshot(), 'a').label, '执行结果待同步');
  await tick();
  assert.equal(threadRuntime(store.getSnapshot(), 'a').synchronized, false);
  client.getAgentStatus = async () => { throw new ApiError(404, '已清理'); };
  store.retry();
  connections[2].onEvent(ready([]));
  await tick();
  assert.equal(threadRuntime(store.getSnapshot(), 'a').label, '就绪');
  store.dispose();
});

test('HTTP终态补查不可覆盖已收到的较新版本，404不猜成功', async () => {
  const { store, client, connections } = fixture();
  let resolveQuery;
  client.getAgentStatus = () => new Promise((resolve) => { resolveQuery = resolve; });
  store.setActive(true);
  connections[0].onEvent(ready([status()]));
  store.retry();
  connections[1].onEvent(ready([]));
  connections[1].onEvent(update(status({ revision: 10, label: '新运行状态' })));
  resolveQuery({ instanceId: 'instance-a', status: status({ revision: 5, label: '旧查询' }) });
  await tick();
  assert.equal(threadRuntime(store.getSnapshot(), 'a').label, '新运行状态');
  store.forgetThread('a');
  assert.deepEqual(store.getSnapshot().runs, []);
  store.dispose();
});
