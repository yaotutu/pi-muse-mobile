import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './register-source.mjs';
import test from 'node:test';
import { ApiError } from '../src/api/errors.ts';
import { parseIdentity, parseProfile, parseWorkspaceSnapshot } from '../src/api/profile-contracts.ts';

test('身份响应保留未知 tone，只消费白名单字段并校验 optional 类型', () => {
  assert.deepEqual(
    parseIdentity({
      name: 'Pi',
      tone: 'future-tone',
      avatar: 'sky',
      showChatUpdates: false,
      future: 'ignored',
    }),
    { name: 'Pi', tone: 'future-tone', avatar: 'sky', showChatUpdates: false },
  );
  assert.deepEqual(parseIdentity({ name: '', tone: '' }), { name: '', tone: '' });
  assert.throws(
    () => parseIdentity({ name: 'Pi', tone: 'warm', avatar: 1 }),
    (error) => error instanceof ApiError && error.status === 502,
  );
  assert.throws(
    () => parseIdentity({ name: 'Pi', tone: 'warm', showChatUpdates: 'yes' }),
    (error) => error instanceof ApiError && error.status === 502,
  );
});

test('profile 响应严格要求 SOUL/USER 两段字符串且快照复用身份解析', () => {
  assert.deepEqual(parseProfile({ soul: '', user: '用户资料' }), { soul: '', user: '用户资料' });
  assert.throws(
    () => parseProfile({ soul: 'soul' }),
    (error) => error instanceof ApiError && error.status === 502,
  );
  assert.throws(
    () => parseProfile({ soul: 'soul', user: 2 }),
    (error) => error instanceof ApiError && error.status === 502,
  );
  assert.deepEqual(
    parseWorkspaceSnapshot({ identity: { name: 'Pi', tone: 'future-tone' }, other: 'ignored' }),
    { identity: { name: 'Pi', tone: 'future-tone' } },
  );
});

test('ProfileProvider 挂在连接域并使用外部 store 订阅与 AppState 生命周期', () => {
  const provider = readFileSync('src/profile/ProfileProvider.tsx', 'utf8');
  assert.match(provider, /const api = useApi\(\)/);
  assert.match(provider, /const connection = useServiceConnection\(\)/);
  assert.match(provider, /useSyncExternalStore\(store\.subscribe, store\.getSnapshot, store\.getSnapshot\)/);
  assert.match(provider, /AppState\.addEventListener\('change'/);
  assert.doesNotMatch(provider, /setInterval|setTimeout/);
});

test('ProfileStore 暴露固定 UI 契约且身份读取复用快照端点', () => {
  const source = readFileSync('src/profile/profile-store.ts', 'utf8');
  for (const member of [
    'getSnapshot =',
    'subscribe =',
    'setActive(',
    'open()',
    'close()',
    'dispose()',
    'setIdentity =',
    'setProfile =',
    'refresh =',
    'saveIdentity =',
    'saveProfile =',
    'discardIdentity =',
    'discardProfile =',
    'canWrite()',
  ]) assert.ok(source.includes(member), member);
  assert.match(source, /this\.client\.getSnapshot\(controller\.signal\)/);
  assert.doesNotMatch(source, /\/api\/agent\/identity.*get/i);
});
