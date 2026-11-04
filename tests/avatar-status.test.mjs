import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { avatarTargets, adjacentAvatar } from '../src/workspace/avatar-navigation.ts';
import { AvatarPreferenceStore } from '../src/workspace/avatar-preferences.ts';
import { parseAgentPresence, parseRuntimeReady } from '../src/runtime/contracts.ts';

test('头像置顶优先、各组最近活动优先、全部固定，Muse 无特权且不重复', () => {
  const ids = ['local-main', 'news-internal', 'sms-internal', 'custom', 'custom'];
  const recency = { 'local-main': '2026-11-01T01:00:00Z', 'sms-internal': '2026-11-03T01:00:00Z', custom: '2026-11-02T01:00:00Z' };
  assert.deepEqual(avatarTargets(ids, [], recency), ['group', 'sms-internal', 'custom', 'local-main', 'news-internal']);
  const pinned = avatarTargets(ids, ['news-internal', 'local-main'], recency);
  assert.deepEqual(pinned, ['group', 'local-main', 'news-internal', 'sms-internal', 'custom']);
  assert.equal(adjacentAvatar(pinned, 'news-internal', 1), 'sms-internal');
});

test('置顶按当前存储持久化，失败不显示成功、错误读取不覆写原偏好', async () => {
  let saved = null;
  const storage = { read: async () => saved, write: async (value) => { saved = value; } };
  const first = new AvatarPreferenceStore(storage);
  await first.load(); await first.toggle('sms-internal');
  const next = new AvatarPreferenceStore(storage); await next.load();
  assert.deepEqual(next.getSnapshot().pinned, ['sms-internal']);
  await next.toggle('group'); assert.deepEqual(next.getSnapshot().pinned, ['sms-internal']);
  const failed = new AvatarPreferenceStore({ ...storage, write: async () => { throw Error('disk'); } });
  await failed.load(); await failed.toggle('local-main');
  assert.deepEqual(failed.getSnapshot().pinned, ['sms-internal']); assert.ok(failed.getSnapshot().error);
  const damaged = new AvatarPreferenceStore({ ...storage, read: async () => '{bad' });
  await damaged.load(); await damaged.toggle('local-main');
  assert.ok(damaged.getSnapshot().error); assert.deepEqual(JSON.parse(saved), ['sms-internal']);
});

test('头像状态严格校验，不接受无效状态或活动时间；ready 要求新的完整集合', () => {
  const presence = { agentId: 'a', state: 'working', label: '工作中', lastActiveAt: null };
  assert.deepEqual(parseAgentPresence(presence), presence);
  assert.throws(() => parseAgentPresence({ ...presence, state: 'queued' }));
  assert.throws(() => parseAgentPresence({ ...presence, lastActiveAt: 'yesterday' }));
  assert.throws(() => parseRuntimeReady({ instanceId: 'a', serverTime: 'now', agentStatuses: [], pendingApprovals: [], activities: [] }));
});

test('无数字角标、全部不聚合，断线标记未知，触摸期间冻结排列且不重建会话', () => {
  const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  const badge = read('workspace/AgentStatusBadge.tsx');
  assert.doesNotMatch(badge, /count|onPress/); assert.match(badge, /pointerEvents="none"/); assert.match(badge, /reduced/);
  const strip = read('workspace/AgentAvatarStrip.tsx');
  assert.match(strip, /id !== 'group' && <AgentStatusBadge/);
  const root = read('workspace/WorkspaceScreen.tsx');
  assert.match(root, /const targets = frozenTargets \?\? desiredTargets/);
  assert.match(root, /setFrozenTargets\(targets\)/);
  assert.match(root, /runtimeSnapshot.connection !== 'live' \? 'unknown'/);
  assert.doesNotMatch(root, /key={targets/);
});

test('动态审批面板与头像共用检查对象的整体状态，不以私聊空闲覆盖通知审批或后台工作', () => {
  const root = readFileSync(new URL('../src/workspace/WorkspaceScreen.tsx', import.meta.url), 'utf8');
  assert.match(root, /const inspectedStatus = avatarStatus\(focusedAgentId\)/);
  assert.match(root, /const statusLabel = connectionError \? connectionLabel\(snapshot\) : avatarStatusDetail\(focusedAgentId\)/);
  assert.match(root, /inspectedStatus === 'error' \? 'danger'/);
  assert.match(root, /inspectedStatus === 'waiting' \|\| inspectedStatus === 'unknown' \? 'warning'/);
  assert.match(root, /inspectedStatus === 'working' \? 'accent' : 'neutral'/);
  assert.match(root, /testID="workspace-session-status" tone={statusTone}/);
  assert.doesNotMatch(root, /runtime\.label|runtime\.running/);
});
