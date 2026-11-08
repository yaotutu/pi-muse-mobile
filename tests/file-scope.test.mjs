import assert from 'node:assert/strict';
import test from 'node:test';
import { fileScope } from '../src/chat/file-scope.ts';

test('逻辑文件路径统一工作区不保留双根', () => {
  assert.equal(fileScope('drafts/reply.md'), '工作区文件');
  assert.equal(fileScope('shared/templates/signature.txt'), '工作区文件');
  assert.equal(fileScope('shared-notes.md'), '工作区文件');
});

test('未知、绝对、URL 与越界路径不伪装成私有文件', () => {
  for (const value of [undefined, '', '/etc/passwd', '\\server', 'C:\\private.txt', 'https://example.com', '../another/a.md', 'shared/../a.md']) {
    assert.equal(fileScope(value), undefined, String(value));
  }
});
