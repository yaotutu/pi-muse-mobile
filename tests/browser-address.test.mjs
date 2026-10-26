import './register-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBrowserAddress } from '../src/connection/browser-address.ts';

for (const [input, expected] of [
  [' https://BROWSER.example:443/vnc.html?autoconnect=1&resize=scale ', 'https://browser.example/vnc.html?autoconnect=1&resize=scale'],
  ['http://[::1]:6080/vnc.html?path=websockify', 'http://[::1]:6080/vnc.html?path=websockify'],
  ['https://example.com/vnc.html?token=secret', 'https://example.com/vnc.html?token=secret'],
  ['https://example.com/目录?view=full', 'https://example.com/%E7%9B%AE%E5%BD%95?view=full'],
]) test(`noVNC 地址规范化：${input}`, () => assert.equal(normalizeBrowserAddress(input), expected));

for (const input of [
  '', 'example.com/vnc.html', 'ftp://example.com/vnc.html', 'javascript:alert(1)',
  'https://user@example.com/vnc.html', 'https://@example.com/vnc.html',
  'https://user:secret@example.com/vnc.html', 'https://example.com/vnc.html#',
  'https://example.com/vnc.html#page',
  'https://example.com/vnc\n.html', 'https://example.com\\vnc.html',
]) test(`拒绝不安全的 noVNC 地址：${input}`, () => assert.throws(() => normalizeBrowserAddress(input)));
