/**
 * 手机端小修与实际后端专项回归脚本。
 * 显式 opt-in：E2E_ALLOW_LIVE=1 且必须提供 E2E_API_BASE_URL。
 * 
 * 验收流程：
 * 1. 真实鉴权（E2E_ACCESS_KEY 或已有连接认证），核对 /docs、/openapi.json 与 /api/health 部署一致性。
 * 2. 真实大模型调用至少一次：在专属空间下通过 runAgent 进行真实对话，验证流式返回及落盘。
 * 3. 监控控制契约回归：创建专属空间与网页监控，通过 HttpApiClient.controlMonitor 走现行 /api/monitors/:id/control 路径，
 *    进行 pause -> resume -> pause 并回读确认持久化状态。
 * 4. 幂等清理：finally 块走 API 删除本轮创建的测试空间（级联清理关联监控与文件），绝不遗留测试数据，脱敏记录日志。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpApiClient } from '../src/api/http-client.ts';
import { SpaceStore } from '../src/spaces/space-store.ts';
import { StreamAggregator, projectHistory } from '../src/chat/chat-state.ts';
import { ApiError } from '../src/api/errors.ts';

assert.equal(
  process.env.E2E_ALLOW_LIVE,
  '1',
  'Set E2E_ALLOW_LIVE=1 to authorize real model calls and live regression verification',
);
assert.ok(process.env.E2E_API_BASE_URL, 'Explicitly set E2E_API_BASE_URL to the target backend');

const base = process.env.E2E_API_BASE_URL.replace(/\/$/, '');
const output = mkdtempSync(join(tmpdir(), 'pimuse-mobile-regression.'));
const stamp = Date.now().toString(36);
const spaceId = `reg-space-${stamp}`;
const monitorTitle = `Regression Monitor ${stamp}`;
const chatMarker = `REGRESSION_OK_${stamp}`;

const checks = [];
let token;
let cleanupRequired = false;
let failure;
let baselineSpaces = [];
let createdMonitor;

const api = new HttpApiClient(
  base,
  () => token,
  () => {
    throw new Error('Real authentication failed');
  },
);
const spaces = new SpaceStore(api);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pass = (name, data = {}) => {
  checks.push({ name, ...data });
  console.log('PASS', name);
};

async function until(test, label, timeout = 120_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}

async function verifyDeployment() {
  const [html, spec, health] = await Promise.all(
    ['/docs', '/openapi.json', '/api/health'].map(async (path) => {
      const response = await fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      assert.equal(response.status, 200, `${path} must return 200`);
      return path === '/docs' ? response.text() : response.json();
    }),
  );

  assert.ok(html.includes('/openapi.json'), 'Docs HTML must reference openapi.json');
  assert.equal(health.ok, true, 'Health check must be ok');
  assert.deepEqual(spec['x-service-version'], health.serviceVersion, 'Service version match');

  // 验证 OpenAPI 契约包含现行 /api/monitors/:id/control 且已移除 /api/agent/monitors
  assert.ok(
    spec.paths['/api/monitors/{id}/control']?.post,
    'OpenAPI must declare POST /api/monitors/{id}/control',
  );
  assert.equal(
    spec.paths['/api/agent/monitors/{id}/control'],
    undefined,
    'OpenAPI must not declare deprecated /api/agent/monitors/{id}/control',
  );

  return health.serviceVersion;
}

try {
  // 1. 验证部署元数据与路由一致性
  const serviceVersion = await verifyDeployment();
  pass('docs/OpenAPI/health deployment verification', { serviceVersion });

  // 2. 真实鉴权交换会话
  const auth = await api.createSession(process.env.E2E_ACCESS_KEY);
  assert.equal(auth.mode, 'live', 'Authentication mode must be live');
  assert.ok(auth.token, 'Session token must be provided');
  token = auth.token;
  pass('authenticated real session');

  baselineSpaces = (await api.listSpaces()).map((s) => s.id);
  assert.ok(!baselineSpaces.includes(spaceId), 'Dedicated test space must not exist initially');

  // 从首次创建资源起标记清理
  cleanupRequired = true;

  // 3. 创建专属空间及指令配置
  await api.saveSpaceInstructions(
    spaceId,
    'Dedicated regression test space. Reply directly to questions. Do not invoke external tools or background schedules.',
  );
  await spaces.loadSettings(spaceId);
  pass('created isolated test space with instructions');

  // 4. 真实外部大模型调用：通过 runAgent 流式聊天验证真实响应
  const initialHistory = await api.getConversation(spaceId);
  const runId = `reg-run-${stamp}`;
  let streamFinished = false;
  let streamError;
  const events = [];
  const aggregator = new StreamAggregator(projectHistory(initialHistory.messages));

  await api.runAgent(
    {
      spaceId,
      runId,
      expectedRevision: initialHistory.revision,
      message: {
        id: `msg-${stamp}`,
        content: `Reply with exactly "${chatMarker}". Do not use tools.`,
      },
    },
    (event) => {
      events.push(event.type);
      aggregator.push(event);
      if (event.type === 'RUN_ERROR') {
        streamError = event.code ?? event.message ?? 'RUN_ERROR';
      }
      if (event.type === 'RUN_FINISHED') {
        streamFinished = true;
      }
    },
    AbortSignal.timeout(120_000),
  );

  await until(() => streamFinished || streamError, 'chat stream completion', 30_000);
  assert.equal(streamError, undefined, `Real model call failed with error: ${streamError}`);
  assert.ok(events.includes('RUN_FINISHED'), 'Real model stream must finish with RUN_FINISHED');

  // 回读权威历史确认已落盘
  const freshHistory = await api.getConversation(spaceId);
  const assistantReply = freshHistory.messages.find((m) => m.role === 'assistant');
  assert.ok(assistantReply, 'Authoritative history must contain assistant reply');
  assert.ok(
    assistantReply.content?.includes(chatMarker),
    'Assistant reply must contain requested marker from live model',
  );
  pass('real external model invoked and stream persisted to authoritative history');

  // 5. 网页监控管理与 controlMonitor 回归
  // 创建监控（使用 https://example.com 且 intervalMinutes=1440，避免外部频繁抓取，无写入副作用）
  createdMonitor = await api.request('/api/monitors', {
    method: 'POST',
    body: {
      url: 'https://example.com',
      condition: 'change',
      title: monitorTitle,
      intervalMinutes: 1440,
      originSpaceId: spaceId,
    },
  });
  assert.ok(createdMonitor?.id, 'Monitor ID must be generated');
  assert.equal(createdMonitor.originSpaceId, spaceId, 'Monitor must belong to test space');
  assert.equal(createdMonitor.status, 'active', 'Initial status must be active');
  pass('created test monitor under test space');

  // 使用 HttpApiClient.controlMonitor 暂停监控（走现行 /api/monitors/:id/control）
  const pausedMonitor = await api.controlMonitor(createdMonitor.id, 'pause');
  assert.equal(pausedMonitor.id, createdMonitor.id, 'Controlled monitor ID must match');
  assert.equal(pausedMonitor.status, 'paused', 'Status after pause must be paused');

  // 独立回读详情验证持久化状态
  const readAfterPause = await api.request(`/api/monitors/${encodeURIComponent(createdMonitor.id)}`);
  assert.equal(readAfterPause.status, 'paused', 'Persisted status must be paused');
  pass('controlMonitor pause verified via live endpoint and round-trip read');

  // 使用 HttpApiClient.controlMonitor 恢复监控
  const resumedMonitor = await api.controlMonitor(createdMonitor.id, 'resume');
  assert.equal(resumedMonitor.status, 'active', 'Status after resume must be active');
  const readAfterResume = await api.request(`/api/monitors/${encodeURIComponent(createdMonitor.id)}`);
  assert.equal(readAfterResume.status, 'active', 'Persisted status must be active');
  pass('controlMonitor resume verified via live endpoint and round-trip read');

  // 再次暂停并回读确认
  const pausedAgain = await api.controlMonitor(createdMonitor.id, 'pause');
  assert.equal(pausedAgain.id, createdMonitor.id, 'Controlled monitor ID must match');
  assert.equal(pausedAgain.status, 'paused', 'Status after second pause must be paused');
  const readAfterSecondPause = await api.request(`/api/monitors/${encodeURIComponent(createdMonitor.id)}`);
  assert.equal(readAfterSecondPause.status, 'paused', 'Persisted status after second pause must be paused');
  pass('controlMonitor second pause verified via live endpoint and round-trip read');

  // 验证部署版本在测试过程中保持一致
  const endVersion = await verifyDeployment();
  assert.deepEqual(endVersion, serviceVersion, 'Deployment version must not drift during execution');

} catch (err) {
  failure = err;
  console.error('FAIL', err instanceof Error ? err.message : String(err));
} finally {
  spaces.dispose();
  try {
    if (cleanupRequired) {
      // 级联删除专属测试空间（将级联清理该空间关联的监控和对话）
      await api.deleteSpace(spaceId);
      const remainingSpaces = (await api.listSpaces()).map((s) => s.id);
      assert.ok(!remainingSpaces.includes(spaceId), 'Test space must be removed');
      assert.ok(
        baselineSpaces.every((id) => remainingSpaces.includes(id)),
        'Pre-existing baseline spaces must remain intact',
      );

      // 核对关联监控已被级联清理且单项查询 404
      const monitorsResp = await api.request('/api/monitors');
      assert.ok(Array.isArray(monitorsResp?.monitors), 'Monitors response must have monitors array');
      const spaceMonitors = monitorsResp.monitors.filter(
        (m) => m.originSpaceId === spaceId || (createdMonitor && m.id === createdMonitor.id),
      );
      assert.equal(spaceMonitors.length, 0, 'Associated monitors must be cleaned up');
      if (createdMonitor?.id) {
        try {
          await api.request(`/api/monitors/${encodeURIComponent(createdMonitor.id)}`);
          assert.fail('Monitor should return 404 after cascade space deletion');
        } catch (e) {
          assert.ok(e instanceof ApiError && e.status === 404, 'Deleted monitor must return HTTP 404');
        }
      }
      pass('cleaned up test space and associated monitors');
    }
  } catch (cleanErr) {
    failure ??= cleanErr;
    console.error('FAIL cleanup:', cleanErr instanceof Error ? cleanErr.message : String(cleanErr));
  }

  // 脱敏保存结果证据（严禁写入 token 或明文凭据）
  token = undefined;
  const summary = {
    passed: !failure,
    base,
    spaceId,
    checks,
    error: failure?.message,
  };
  writeFileSync(join(output, 'regression-results.json'), JSON.stringify(summary, null, 2));
  console.log('Evidence recorded to:', output);
}

if (failure) {
  process.exitCode = 1;
}
