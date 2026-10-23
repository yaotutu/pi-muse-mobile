import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './register-source.mjs';
import test from 'node:test';
import { ApiError } from '../src/api/errors.ts';
import { parseDreamOverview, parseDreamSpace } from '../src/dream/contracts.ts';
import { DREAM_PROMPT_LIMIT, DREAM_RUN_TIMEOUT_MS, MAIN_DREAM_SPACE } from '../src/dream/types.ts';

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

const space = (patch = {}) => ({
  spaceId: 'dream-e2e',
  enabled: false,
  inheritGlobalPrompt: true,
  cursor: 'assistant-1',
  lastRun: run(),
  pending: [pending()],
  prompt: 'Space dream prompt',
  purpose: 'Dedicated acceptance',
  ...patch,
});

test('Dream overview parser only consumes spaces and validates every public field', () => {
  const source = {
    globalPrompt: '',
    defaultPrompt: 'Default prompt',
    intervalHours: 2,
    running: false,
    spaces: [space({ spaceId: MAIN_DREAM_SPACE, enabled: true })],
    // 服务端仍返回兼容别名；移动端明确不消费，也不把别名混入 UI 状态。
    threads: [{ ...space(), spaceId: 'foreign' }],
    future: 'ignored',
  };
  const parsed = parseDreamOverview(source);
  assert.equal(Object.hasOwn(parsed, 'threads'), false);
  assert.equal(parsed.spaces.length, 1);
  assert.equal(parsed.spaces[0].spaceId, MAIN_DREAM_SPACE);
  assert.equal(parsed.spaces[0].enabled, true);
  assert.equal(parsed.spaces[0].lastRun.processed, 2);
  assert.equal(parsed.spaces[0].pending[0].suggestedTarget, 'user');
});

test('Dream space parser preserves optionals and rejects foreign identities', () => {
  const parsed = parseDreamSpace(space());
  assert.equal(parsed.cursor, 'assistant-1');
  assert.equal(parsed.lastRun.status, 'completed');
  assert.deepEqual({ ...parsed, lastRun: undefined }, { ...space(), lastRun: undefined });
  assert.throws(() => parseDreamSpace(space(), 'foreign'), (error) => error instanceof ApiError && error.status === 502);
});

test('Dream parser rejects malformed enums, dates, counts and duplicate overview spaces', () => {
  const invalidSpaces = [
    space({ enabled: 1 }),
    space({ inheritGlobalPrompt: 'yes' }),
    space({ cursor: null }),
    space({ lastRun: run({ status: 'queued' }) }),
    space({ lastRun: run({ processed: -1 }) }),
    space({ lastRun: run({ changed: ['profile'] }) }),
    space({ lastRun: run({ at: '2026-02-30T00:00:00Z' }) }),
    space({ pending: [pending({ reason: 'unauthorized' })] }),
    space({ pending: [pending({ suggestedTarget: 'profile' })] }),
  ];
  for (const item of invalidSpaces) {
    assert.throws(() => parseDreamSpace(item), (error) => error instanceof ApiError && error.status === 502);
  }
  const first = space({ spaceId: 'space-1' });
  const duplicate = space({ spaceId: 'space-1' });
  assert.throws(() => parseDreamOverview({
    globalPrompt: '',
    defaultPrompt: 'Default',
    intervalHours: 2,
    running: false,
    spaces: [first, duplicate],
  }));
});

test('Dream response prompt length is not capped and empty string remains an explicit override clear', () => {
  const prompt = 'D'.repeat(DREAM_PROMPT_LIMIT);
  assert.equal(parseDreamSpace(space({ prompt })).prompt.length, DREAM_PROMPT_LIMIT);
  assert.equal(parseDreamOverview({
    globalPrompt: prompt,
    defaultPrompt: 'Default',
    intervalHours: 2,
    running: false,
    spaces: [],
  }).globalPrompt.length, DREAM_PROMPT_LIMIT);
  // 20000 是写入请求限制；响应 schema 只声明 string，合法长文档不能让整个页面读取失败。
  assert.equal(parseDreamSpace(space({ prompt: `${prompt}D` })).prompt.length, DREAM_PROMPT_LIMIT + 1);
  assert.equal(parseDreamOverview({
    globalPrompt: `${prompt}D`,
    defaultPrompt: 'Default',
    intervalHours: 2,
    running: false,
    spaces: [],
  }).globalPrompt.length, DREAM_PROMPT_LIMIT + 1);
  assert.equal(parseDreamOverview({
    globalPrompt: '',
    defaultPrompt: 'Default',
    intervalHours: 2,
    running: false,
    spaces: [],
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
    'getSpaceDream',
    'updateSpaceDream',
    'runSpaceDream',
    'resolveSpaceDreamPending',
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
    'selectSpace =',
    'setGlobalPrompt =',
    'setSpaceDraft =',
    'saveGlobalPrompt =',
    'saveSpaceSettings =',
    'discardGlobal =',
    'discardSpace =',
    'refresh =',
    'runNow =',
    'resolvePending =',
  ]) assert.ok(store.includes(member), member);
  assert.match(store, /globalDraft: ''/);
  assert.match(store, /!this\.state\.globalDirty && !this\.state\.spaceDirty/);
  assert.doesNotMatch(store, /threads/);
  assert.doesNotMatch(store, /setInterval|setTimeout/);
});
