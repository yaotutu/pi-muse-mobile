import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { companionState, describeCompanionState, isTransientOutcome, COMPANION_STATES } from '../src/workspace/companion-state.ts';

const base = { synchronized: true, running: false, phase: null, pendingApprovals: 0 };

test('八状态齐全且描述可用，默认回落 idle', () => {
  assert.deepEqual(COMPANION_STATES, ['idle', 'thinking', 'responding', 'working', 'waiting-approval', 'success', 'error', 'stopped']);
  assert.equal(companionState(base), 'idle');
  for (const state of COMPANION_STATES) assert.ok(describeCompanionState(state).length > 0);
});

test('运行阶段映射：思考、回复、工作、等待审批', () => {
  for (const phase of ['preparing', 'waiting_model', 'finalizing', null]) {
    assert.equal(companionState({ ...base, running: true, phase }), 'thinking', String(phase));
  }
  assert.equal(companionState({ ...base, running: true, phase: 'responding' }), 'responding');
  assert.equal(companionState({ ...base, running: true, phase: 'executing_tool' }), 'working');
  assert.equal(companionState({ ...base, running: true, phase: 'waiting_subagents' }), 'working');
  assert.equal(companionState({ ...base, running: true, phase: 'waiting_approval' }), 'waiting-approval');
});

test('优先级：审批 > 工作 > 回复 > 思考；未同步不猜测运行状态', () => {
  assert.equal(companionState({ synchronized: false, running: true, phase: 'executing_tool', pendingApprovals: 3 }), 'idle');
  assert.equal(companionState({ ...base, running: true, phase: 'executing_tool', pendingApprovals: 1 }), 'waiting-approval');
  assert.equal(companionState({ ...base, running: true, phase: 'executing_tool', pendingApprovals: 0 }), 'working');
});

test('暂存失败/未确认保持 error；发送中借思考姿态', () => {
  assert.equal(companionState({ ...base, pendingStatus: 'failed' }), 'error');
  assert.equal(companionState({ ...base, pendingStatus: 'unconfirmed' }), 'error');
  assert.equal(companionState({ ...base, pendingStatus: 'failed', lastOutcome: 'succeeded' }), 'error');
  assert.equal(companionState({ ...base, pendingStatus: 'sending' }), 'thinking');
});

test('新近终态驱动成功/失败/停止；成功与停止是瞬时姿态', () => {
  assert.equal(companionState({ ...base, lastOutcome: 'succeeded' }), 'success');
  assert.equal(companionState({ ...base, lastOutcome: 'failed' }), 'error');
  assert.equal(companionState({ ...base, lastOutcome: 'cancelled' }), 'stopped');
  assert.equal(isTransientOutcome('success'), true);
  assert.equal(isTransientOutcome('stopped'), true);
  assert.equal(isTransientOutcome('error'), false);
  assert.equal(isTransientOutcome('idle'), false);
});

test('WorkspaceScreen 用运行事实驱动形象并短暂保留终态', () => {
  const screen = readFileSync(new URL('../src/workspace/WorkspaceScreen.tsx', import.meta.url), 'utf8');
  assert.match(screen, /const companion = companionState\(\{/);
  assert.match(screen, /phase: activeRun\?\.phase \?\? null/);
  assert.match(screen, /pendingStatus: currentState\.pendingSubmission\?\.status/);
  assert.match(screen, /lastOutcome: !mainRuntime\.running && recentOutcome \? recentOutcome : undefined/);
  assert.match(screen, /clearTimer = setTimeout\(\(\) => setRecentOutcome\(undefined\), COMPANION_OUTCOME_MS\)/);
  assert.match(screen, /<MuseCompanion state=\{companion\} size=\{72\} offline=\{!mainRuntime\.synchronized\}/);
});
