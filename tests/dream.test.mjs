import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './register-source.mjs';
import test from 'node:test';
import { ApiError } from '../src/api/errors.ts';
import { parseDreamOverview, parseDreamAgent } from '../src/dream/contracts.ts';
import { DREAM_PROMPT_LIMIT, DREAM_RUN_TIMEOUT_MS, MAIN_DREAM_AGENT } from '../src/dream/types.ts';

const run = (patch = {}) => ({
  at: '2026-10-23T17:07:07.144Z',
  status: 'completed',
  changed: [],
  processed: 2,
  ...patch,
});

const pending = (patch = {}) => ({
  id: 'pending-1',
  text: 'Preferred coding time: BEFORE_SUNRISE',
  suggestedTarget: 'user',
  reason: 'ambiguous',
  createdAt: '2026-10-23T17:07:13.089Z',
  ...patch,
});

const agent = (patch = {}) => ({
  agentId: 'dream-e2e',
  enabled: false,
  inheritGlobalPrompt: true,
  cursor: 'assistant-1',
  lastRun: run(),
  pending: [pending()],
  prompt: 'Agent dream prompt',
  purpose: 'Dedicated acceptance',
  ...patch,
});

test('Dream overview parser only consumes agents and validates every public field', () => {
  const source = {
    globalPrompt: '',
    defaultPrompt: 'Default prompt',
    intervalHours: 2,
    running: false,
    agents: [agent({ agentId: MAIN_DREAM_AGENT, enabled: true })],
    future: 'ignored',
  };
  const parsed = parseDreamOverview(source);
  assert.equal(Object.hasOwn(parsed, 'threads'), false);
  assert.equal(parsed.agents.length, 1);
  assert.equal(parsed.agents[0].agentId, MAIN_DREAM_AGENT);
  assert.equal(parsed.agents[0].enabled, true);
  assert.equal(parsed.agents[0].lastRun.processed, 2);
  assert.equal(parsed.agents[0].pending[0].suggestedTarget, 'user');
});

test('Dream agent parser preserves optionals and rejects foreign identities', () => {
  const parsed = parseDreamAgent(agent());
  assert.equal(parsed.cursor, 'assistant-1');
  assert.equal(parsed.lastRun.status, 'completed');
  assert.deepEqual({ ...parsed, lastRun: undefined }, { ...agent(), lastRun: undefined });
  assert.throws(() => parseDreamAgent(agent(), 'foreign'), (error) => error instanceof ApiError && error.status === 502);
});

test('Dream parser rejects malformed enums, dates, counts and duplicate overview agents', () => {
  const invalidAgents = [
    agent({ enabled: 1 }),
    agent({ inheritGlobalPrompt: 'yes' }),
    agent({ cursor: null }),
    agent({ lastRun: run({ status: 'queued' }) }),
    agent({ lastRun: run({ processed: -1 }) }),
    agent({ lastRun: run({ changed: ['profile'] }) }),
    agent({ lastRun: run({ at: '2026-02-30T00:00:00Z' }) }),
    agent({ pending: [pending({ reason: 'unauthorized' })] }),
    agent({ pending: [pending({ suggestedTarget: 'profile' })] }),
  ];
  for (const item of invalidAgents) {
    assert.throws(() => parseDreamAgent(item), (error) => error instanceof ApiError && error.status === 502);
  }
  const first = agent({ agentId: 'agent-1' });
  const duplicate = agent({ agentId: 'agent-1' });
  assert.throws(() => parseDreamOverview({
    globalPrompt: '',
    defaultPrompt: 'Default',
    intervalHours: 2,
    running: false,
    agents: [first, duplicate],
  }));
});

test('Dream response prompt length is not capped and empty string remains an explicit override clear', () => {
  const prompt = 'D'.repeat(DREAM_PROMPT_LIMIT);
  assert.equal(parseDreamAgent(agent({ prompt })).prompt.length, DREAM_PROMPT_LIMIT);
  assert.equal(parseDreamOverview({
    globalPrompt: prompt,
    defaultPrompt: 'Default',
    intervalHours: 2,
    running: false,
    agents: [],
  }).globalPrompt.length, DREAM_PROMPT_LIMIT);
  // 20000 是写入请求限制；响应 schema 只声明 string，合法长文档不能让整个页面读取失败。
  assert.equal(parseDreamAgent(agent({ prompt: `${prompt}D` })).prompt.length, DREAM_PROMPT_LIMIT + 1);
  assert.equal(parseDreamOverview({
    globalPrompt: `${prompt}D`,
    defaultPrompt: 'Default',
    intervalHours: 2,
    running: false,
    agents: [],
  }).globalPrompt.length, DREAM_PROMPT_LIMIT + 1);
  assert.equal(parseDreamOverview({
    globalPrompt: '',
    defaultPrompt: 'Default',
    intervalHours: 2,
    running: false,
    agents: [],
  }).globalPrompt, '');
});

test('Dream HTTP and provider contracts are fixed for the non-visual UI integration', () => {
  const contracts = readFileSync('src/api/contracts.ts', 'utf8');
  const client = readFileSync('src/api/http-client.ts', 'utf8');
  const provider = readFileSync('src/dream/DreamProvider.tsx', 'utf8');
  const store = readFileSync('src/dream/dream-store.ts', 'utf8');

  assert.match(contracts, /interface ApiClient extends DreamClient,/);
  for (const member of [
    'getDreamOverview',
    'saveGlobalDreamPrompt',
    'getAgentDream',
    'updateAgentDream',
    'runAgentDream',
    'resolveAgentDreamPending',
  ]) {
    assert.ok(client.includes(`async ${member}(`), member);
  }
  assert.equal(DREAM_RUN_TIMEOUT_MS, 300_000);
  assert.match(client, /timeoutMs: DREAM_RUN_TIMEOUT_MS/);
  assert.doesNotMatch(client, /dream\/threads|threadId/);

  assert.match(provider, /const api = useApi\(\)/);
  assert.doesNotMatch(provider, /as unknown as DreamClient/);
  assert.match(provider, /const connection = useServiceConnection\(\)/);
  assert.match(provider, /AppState\.addEventListener\('change'/);
  assert.match(provider, /useSyncExternalStore\(store\.subscribe, store\.getSnapshot, store\.getSnapshot\)/);
  assert.match(provider, /export function useDream\(\)/);

  for (const member of [
    'setActive(',
    'open()',
    'close()',
    'dispose()',
    'selectAgent =',
    'setGlobalPrompt =',
    'setAgentDraft =',
    'saveGlobalPrompt =',
    'saveAgentSettings =',
    'discardGlobal =',
    'discardAgent =',
    'refresh =',
    'runNow =',
    'resolvePending =',
  ]) assert.ok(store.includes(member), member);
  assert.match(store, /globalDraft: ''/);
  assert.match(store, /!this\.state\.globalDirty && !this\.state\.agentDirty/);
  assert.doesNotMatch(store, /threads|threadId|spaceId/);
  assert.doesNotMatch(store, /setInterval|setTimeout/);
});
