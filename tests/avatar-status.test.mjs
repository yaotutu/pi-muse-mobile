import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DockPreferenceStore } from '../src/workspace/dock-preferences.ts';
import { parseAgentPresence, parseRuntimeReady } from '../src/runtime/contracts.ts';

test('底栏固定按当前存储持久化，全部禁止固定，失败不显示成功、错误读取不覆写原偏好', async () => {
  let saved = null;
  const storage = { read: async () => saved, write: async (value) => { saved = value; } };
  const first = new DockPreferenceStore(storage);
  await first.load(); await first.togglePin('sms-internal');
  const next = new DockPreferenceStore(storage); await next.load();
  assert.deepEqual(next.getSnapshot().pinned, ['sms-internal']);
  assert.equal(await next.togglePin('group'), false);
  assert.deepEqual(next.getSnapshot().pinned, ['sms-internal']);
  const failed = new DockPreferenceStore({ ...storage, write: async () => { throw Error('disk'); } });
  await failed.load(); await failed.togglePin('local-main');
  assert.deepEqual(failed.getSnapshot().pinned, ['sms-internal']); assert.ok(failed.getSnapshot().error);
  const damaged = new DockPreferenceStore({ ...storage, read: async () => '{bad' });
  await damaged.load();
  assert.ok(damaged.getSnapshot().error); assert.deepEqual(JSON.parse(saved), ['sms-internal']);
});

test('头像状态严格校验，不接受无效状态或活动时间；ready 要求新的完整集合', () => {
  const presence = { agentId: 'a', state: 'working', label: '工作中', lastActiveAt: null };
  assert.deepEqual(parseAgentPresence(presence), presence);
  assert.throws(() => parseAgentPresence({ ...presence, state: 'queued' }));
  assert.throws(() => parseAgentPresence({ ...presence, lastActiveAt: 'yesterday' }));
  assert.throws(() => parseRuntimeReady({ instanceId: 'a', serverTime: 'now', agentStatuses: [], pendingApprovals: [], activities: [] }));
});

test('无数字角标、全部不聚合，断线标记未知，底栏呈现状态角标且不重建会话', () => {
  const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  const badge = read('workspace/AgentStatusBadge.tsx');
  assert.doesNotMatch(badge, /count|onPress/); assert.match(badge, /pointerEvents="none"/); assert.match(badge, /reduced/);
  const dock = read('workspace/AgentDock.tsx');
  assert.match(dock, /<AgentStatusBadge state=\{agentStatus\} \/>/);
  const root = read('workspace/WorkspaceScreen.tsx');
  assert.match(root, /<AgentDock/);
  assert.match(root, /runtimeSnapshot\.connection !== 'live' \? 'unknown'/);
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
