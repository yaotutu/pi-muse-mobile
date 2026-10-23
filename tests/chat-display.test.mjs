import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeTool } from '../src/chat/tool-display.ts';
import { safeMessageUrl } from '../src/chat/message-links.ts';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('safeMessageUrl only normalizes credential-free absolute HTTP links', () => {
  assert.equal(safeMessageUrl('  https://Example.com/a?x=1  '), 'https://example.com/a?x=1');
  assert.equal(safeMessageUrl('http://example.com'), 'http://example.com/');
  for (const value of [
    'javascript:alert(1)',
    'data:text/plain,hello',
    'file:///tmp/secret',
    'intent://example.com/#Intent;scheme=https;end',
    'https://user:password@example.com',
    'http://user@example.com',
    'example.com/path',
  ]) {
    assert.equal(safeMessageUrl(value), undefined, value);
  }
});

test('search sources retain legal null titles by falling back to the safe URL', () => {
  const result = JSON.stringify({
    results: [
      { url: 'https://example.com/null-title', title: null },
      { url: 'https://example.com/titled', title: '标题' },
      { url: 'javascript:alert(1)', title: null },
      { url: 'https://user:pass@example.com/credentials', title: null },
      { url: 'https://example.com/missing-title' },
    ],
  });
  assert.deepEqual(describeTool('search_web', '{}', result).sources, [
    { title: 'https://example.com/null-title', url: 'https://example.com/null-title' },
    { title: '标题', url: 'https://example.com/titled' },
  ]);
});

test('search source projection keeps at most ten legal links', () => {
  const result = JSON.stringify({
    results: Array.from({ length: 12 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: null,
    })),
  });
  assert.equal(describeTool('search_web', '{}', result).sources.length, 10);
});

test('missing tool result is pending rather than running or saved', () => {
  const display = describeTool('currentTime', '{}');
  assert.equal(display.status, 'pending');
  assert.equal(display.kind, 'time');
  assert.equal(display.title, '当前时间');
  assert.equal('saved' in display, false);
  assert.equal('running' in display, false);
});

test('hidden generic completion stays finished without inventing saved state', () => {
  const display = describeTool('instructions', '{}', '工具执行已结束（详情已隐藏）');
  assert.equal(display.status, 'finished');
  assert.equal(display.summary, '工具执行已结束（详情已隐藏）');
  assert.equal('saved' in display, false);
});

test('structured and projected server errors are failed', () => {
  assert.deepEqual(describeTool('search_web', '{}', '{"error":"Search failed."}'), {
    kind: 'search',
    title: '网页搜索',
    status: 'failed',
    summary: 'Search failed.',
  });
  assert.equal(describeTool('read', '{}', '工具执行失败').status, 'failed');
});

test('message markdown uses native nodes, safe links, literal HTML, and copyable code', () => {
  const source = read('../src/workspace/MessageContent.tsx');
  assert.match(source, /marked\.lexer\(/);
  assert.match(source, /safeMessageUrl\(/);
  assert.match(source, /case 'link':/);
  assert.match(source, /case 'image': return <Text key=\{key\}>\{inline\(part\.tokens, value\)\}<\/Text>/);
  assert.match(source, /case 'html': return <Text key=\{key\}>\{value\}<\/Text>/);
  assert.match(source, /Clipboard\.setStringAsync\(code\)/);
  assert.match(source, /accessibilityLabel="复制代码"/);
  assert.match(source, /<Text selectable style=\{styles\.codeText\}>\{code\}<\/Text>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|<WebView\b|from ['"]react-native-webview['"]|<Image\b|FastImage|marked\.parse\(/);
});
