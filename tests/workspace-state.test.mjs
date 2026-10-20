import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAIN_SPACE, mainSpace, newSpace } from '../src/spaces/space-state.ts';

test('主会话默认值和新会话 ID 均满足接口约束', () => {
  assert.equal(mainSpace().id, MAIN_SPACE);
  for (let i = 0; i < 50; i++) {
    const thread = newSpace();
    assert.match(thread.id, /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
    assert.ok(Number.isFinite(Date.parse(thread.updatedAt)));
  }
});
