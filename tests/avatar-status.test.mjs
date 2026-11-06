import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseAgentPresence, parseRuntimeReady } from '../src/runtime/contracts.ts';

test('头像状态严格校验，不接受无效状态或活动时间；ready 要求新的完整集合', () => {
  const presence = { agentId: 'a', state: 'working', label: '工作中', lastActiveAt: null };
  assert.deepEqual(parseAgentPresence(presence), presence);
  assert.throws(() => parseAgentPresence({ ...presence, state: 'queued' }));
  assert.throws(() => parseAgentPresence({ ...presence, lastActiveAt: 'yesterday' }));
  assert.throws(() => parseRuntimeReady({ instanceId: 'a', serverTime: 'now', agentStatuses: [], pendingApprovals: [], activities: [] }));
});

test('私聊与检查面板复用唯一智能体状态，一级用途导航不渲染 Agent 角标', () => {
  const read = (path) => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
  const tabs = read('workspace/PrimaryTabBar.tsx');
  assert.doesNotMatch(tabs, /AgentStatusBadge|lastActiveAt|\.sort\(/);
  const root = read('workspace/WorkspaceScreen.tsx');
  assert.match(root, /<PrimaryTabBar/);
  assert.match(root, /runtimeSnapshot\.connection !== 'live' \? 'unknown'/);
  assert.match(root, /caption=\{avatarStatusDetail\(agents\.currentAgent\)\}/);
});

test('动态审批面板使用实际检查对象的整体状态，不以私聊空闲覆盖通知审批或后台工作', () => {
  const root = readFileSync(new URL('../src/workspace/WorkspaceScreen.tsx', import.meta.url), 'utf8');
  assert.match(root, /const inspectedStatus = avatarStatus\(inspectedSessionAgentId\)/);
  assert.match(root, /const statusLabel = connectionError \? connectionLabel\(snapshot\) : avatarStatusDetail\(inspectedSessionAgentId\)/);
  assert.match(root, /inspectedStatus === 'error' \? 'danger'/);
  assert.match(root, /inspectedStatus === 'waiting' \|\| inspectedStatus === 'unknown' \? 'warning'/);
  assert.match(root, /inspectedStatus === 'working' \? 'accent' : 'neutral'/);
  assert.match(root, /testID="workspace-session-status" tone={statusTone}/);
  assert.doesNotMatch(root, /runtime\.label|runtime\.running/);
});
