import assert from 'node:assert/strict';
import test from 'node:test';
import { fileScope } from '../src/chat/file-scope.ts';

test('逻辑文件路径区分私有与 shared 范围', () => {
  assert.equal(fileScope('drafts/reply.md'), '该会话私有文件');
  assert.equal(fileScope('shared/templates/signature.txt'), '共享文件');
  assert.equal(fileScope('shared-notes.md'), '该会话私有文件');
});

test('未知、绝对、URL 与越界路径不伪装成私有文件', () => {
  for (const value of [undefined, '', '/etc/passwd', '\\server', 'C:\\private.txt', 'https://example.com', '../another/a.md', 'shared/../a.md']) {
    assert.equal(fileScope(value), undefined, String(value));
  }
});
