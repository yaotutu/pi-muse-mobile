import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAIN_AGENT, mainAgent, newAgent } from '../src/agents/agent-state.ts';

test('主会话默认值和新会话 ID 均满足接口约束', () => {
  assert.equal(mainAgent().id, MAIN_AGENT);
  for (let i = 0; i < 50; i++) {
    const agent = newAgent();
    assert.match(agent.id, /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
    assert.ok(Number.isFinite(Date.parse(agent.updatedAt)));
  }
});
