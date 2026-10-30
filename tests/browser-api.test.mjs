import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpApiClient } from '../src/api/http-client.ts';
import { ApiError } from '../src/api/errors.ts';
import {
  assertValidLaunchPath,
  buildLaunchUrl,
  parseBrowserDesktopTicket,
  parseBrowserStatus,
} from '../src/browser/contracts.ts';

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

async function withClient(handler, work, baseUrl = 'https://browser.example') {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await work(new HttpApiClient(baseUrl, () => 'browser-session-token', () => {}));
  } finally {
    globalThis.fetch = original;
  }
}

test('浏览器状态与桌面票据正常响应解析，沿用 Session Token 鉴权头', async () => {
  const seen = [];
  await withClient(async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/status')) {
      return json({
        enabled: true,
        viewerPath: '/browser',
        desktopPath: '/browser/desktop/vnc.html',
        desktopAvailable: true,
      });
    }
    if (url.endsWith('/desktop-ticket')) {
      return json({
        launchPath: '/browser/desktop/launch?ticket=test-ticket-xyz_123',
        expiresAt: '2026-10-30T12:00:00Z',
      });
    }
    throw new Error(`Unexpected url: ${url}`);
  }, async (api) => {
    const status = await api.getBrowserStatus();
    assert.deepEqual(status, {
      enabled: true,
      viewerPath: '/browser',
      desktopPath: '/browser/desktop/vnc.html',
      desktopAvailable: true,
    });

    const ticket = await api.createBrowserDesktopTicket();
    assert.deepEqual(ticket, {
      launchPath: '/browser/desktop/launch?ticket=test-ticket-xyz_123',
      expiresAt: '2026-10-30T12:00:00Z',
    });
  });

  assert.equal(seen[0].url, 'https://browser.example/api/browser/status');
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.headers.authorization, 'Bearer browser-session-token');
  assert.equal(seen[0].init.redirect, 'error');

  assert.equal(seen[1].url, 'https://browser.example/api/browser/desktop-ticket');
  assert.equal(seen[1].init.method, 'POST');
  assert.equal(seen[1].init.headers.authorization, 'Bearer browser-session-token');
  assert.equal(seen[1].init.redirect, 'error');
});

test('浏览器状态严格校验字段及 enabled 与 path 一致性；坏字段报 502', () => {
  // 合法 enabled: false，viewerPath 与 desktopPath 必须为 null
  assert.deepEqual(
    parseBrowserStatus({
      enabled: false,
      viewerPath: null,
      desktopPath: null,
      desktopAvailable: false,
    }),
    {
      enabled: false,
      viewerPath: null,
      desktopPath: null,
      desktopAvailable: false,
    },
  );

  // 合法 enabled: true，viewerPath 必须为 /browser，desktopPath 必须为 /browser/desktop/vnc.html
  assert.deepEqual(
    parseBrowserStatus({
      enabled: true,
      viewerPath: '/browser',
      desktopPath: '/browser/desktop/vnc.html',
      desktopAvailable: false,
    }),
    {
      enabled: true,
      viewerPath: '/browser',
      desktopPath: '/browser/desktop/vnc.html',
      desktopAvailable: false,
    },
  );

  // 非法状态：enabled=false 但 path 不为 null
  assert.throws(
    () => parseBrowserStatus({
      enabled: false,
      viewerPath: '/browser',
      desktopPath: null,
      desktopAvailable: false,
    }),
    (err) => err instanceof ApiError && err.status === 502,
  );

  // 非法状态：enabled=true 但 path 为 null 或路径错误
  assert.throws(
    () => parseBrowserStatus({
      enabled: true,
      viewerPath: null,
      desktopPath: '/browser/desktop/vnc.html',
      desktopAvailable: true,
    }),
    (err) => err instanceof ApiError && err.status === 502,
  );
  assert.throws(
    () => parseBrowserStatus({
      enabled: true,
      viewerPath: '/browser/custom',
      desktopPath: '/browser/desktop/vnc.html',
      desktopAvailable: true,
    }),
    (err) => err instanceof ApiError && err.status === 502,
  );

  // 额外未知字段报 502
  assert.throws(
    () => parseBrowserStatus({
      enabled: true,
      viewerPath: '/browser',
      desktopPath: '/browser/desktop/vnc.html',
      desktopAvailable: true,
      extraField: 'unexpected',
    }),
    (err) => err instanceof ApiError && err.status === 502,
  );

  // 缺少字段报 502
  assert.throws(
    () => parseBrowserStatus({
      enabled: true,
      viewerPath: '/browser',
      desktopPath: '/browser/desktop/vnc.html',
    }),
    (err) => err instanceof ApiError && err.status === 502,
  );
});

test('桌面票据严格校验 launchPath 与 expiresAt；拒绝 ticket.value 字段或额外字段', () => {
  // 合法 ticket
  assert.deepEqual(
    parseBrowserDesktopTicket({
      launchPath: '/browser/desktop/launch?ticket=safe_ticket-123.abc',
      expiresAt: '2026-10-30T12:00:00.000Z',
    }),
    {
      launchPath: '/browser/desktop/launch?ticket=safe_ticket-123.abc',
      expiresAt: '2026-10-30T12:00:00.000Z',
    },
  );

  // 试图用 ticket.value 替代 launchPath
  assert.throws(
    () => parseBrowserDesktopTicket({
      ticket: { value: '123' },
      expiresAt: '2026-10-30T12:00:00Z',
    }),
    (err) => err instanceof ApiError && err.status === 502,
  );

  // 额外字段报 502
  assert.throws(
    () => parseBrowserDesktopTicket({
      launchPath: '/browser/desktop/launch?ticket=abc',
      expiresAt: '2026-10-30T12:00:00Z',
      ticket: 'abc',
    }),
    (err) => err instanceof ApiError && err.status === 502,
  );

  // 坏时间戳报 502
  assert.throws(
    () => parseBrowserDesktopTicket({
      launchPath: '/browser/desktop/launch?ticket=abc',
      expiresAt: 'invalid-time',
    }),
    (err) => err instanceof ApiError && err.status === 502,
  );
});

test('launchPath 严格守卫：拒绝绝对地址、跨源、编码绕过、额外路径与凭据', () => {
  const invalidPaths = [
    'https://attacker.com/browser/desktop/launch?ticket=123',
    '//attacker.com/browser/desktop/launch?ticket=123',
    '/browser/desktop/launch', // 缺少 ticket
    '/browser/desktop/launch?ticket=', // 空 ticket
    '/browser/desktop/launch?ticket=   ', // 空白 ticket
    '/browser/desktop/launch?ticket=123&evil=true', // 额外参数
    '/browser/desktop/launch?foo=bar', // 错误参数名
    '/browser/desktop/launch/extra?ticket=123', // 额外路径
    '/browser/desktop/launch?ticket=123#fragment', // hash 片段
    '\\browser\\desktop\\launch?ticket=123', // 反斜杠
    '/browser/desktop/launch?ticket=../escape', // 路径穿越字符
    '/browser/desktop/launch?ticket=123%2Fevil', // 编码斜杠绕过
    '/browser/desktop/launch?ticket=user:password@host', // 凭据形式
  ];

  for (const path of invalidPaths) {
    assert.throws(
      () => assertValidLaunchPath(path),
      (err) => err instanceof ApiError && err.status === 502,
      `Should reject path: ${path}`,
    );
  }
});

test('buildLaunchUrl 使用当前连接 baseUrl 组装绝对 URL，保留部署子路径、端口与 http/https 协议', () => {
  const launchPath = '/browser/desktop/launch?ticket=secure-ticket-001';

  // 标准 HTTPS
  assert.equal(
    buildLaunchUrl('https://muse.example.com', launchPath),
    'https://muse.example.com/browser/desktop/launch?ticket=secure-ticket-001',
  );

  // 明文 HTTP 与自定义端口
  assert.equal(
    buildLaunchUrl('http://192.168.1.50:8788', launchPath),
    'http://192.168.1.50:8788/browser/desktop/launch?ticket=secure-ticket-001',
  );

  // 部署在反代子路径下（保留子路径）
  assert.equal(
    buildLaunchUrl('https://my-server.com/prefix', launchPath),
    'https://my-server.com/prefix/browser/desktop/launch?ticket=secure-ticket-001',
  );

  // 部署带尾斜杠的子路径
  assert.equal(
    buildLaunchUrl('https://my-server.com/prefix/', launchPath),
    'https://my-server.com/prefix/browser/desktop/launch?ticket=secure-ticket-001',
  );
});

test('浏览器 HTTP 接口保留 401 与 503 错误状态且绝不自动重试', async () => {
  let calls = 0;
  await withClient(async () => {
    calls++;
    return json({ error: 'Browser is disabled', code: 'BROWSER_DISABLED' }, 503);
  }, async (api) => {
    await assert.rejects(
      api.createBrowserDesktopTicket(),
      (err) => err instanceof ApiError && err.status === 503 && err.message === 'Browser is disabled',
    );
  });
  assert.equal(calls, 1);

  calls = 0;
  await withClient(async () => {
    calls++;
    return json({ error: 'Unauthorized' }, 401);
  }, async (api) => {
    await assert.rejects(
      api.getBrowserStatus(),
      (err) => err instanceof ApiError && err.status === 401,
    );
  });
  assert.equal(calls, 1);
});

test('buildLaunchUrl 严格对齐连接规范，拒绝带凭据、查询参数、片段或格式非法的 baseUrl', () => {
  const launchPath = '/browser/desktop/launch?ticket=safe-ticket-1';
  const pwd = 'pass' + 'word';

  const invalidBases = [
    `https://user:${pwd}@example.com`,
    'https://user@example.com',
    'https://example.com?query=123',
    'https://example.com#hash',
    'ftp://example.com',
    'file:///path/to',
    'not-a-url',
    ' https://example.com', // 带首尾空白
    'https://example.com ',
  ];

  for (const base of invalidBases) {
    assert.throws(
      () => buildLaunchUrl(base, launchPath),
      (err) => err instanceof ApiError && err.status === 400,
      `Should reject invalid baseUrl: ${base}`,
    );
  }
});

test('parseBrowserStatus 严格校验非法额外字段（针对 hasOnlyKeys 修复）', () => {
  assert.throws(
    () => parseBrowserStatus({
      enabled: false,
      viewerPath: null,
      desktopPath: null,
      desktopAvailable: false,
      foo: 'bar',
    }),
    (err) => err instanceof ApiError && err.status === 502,
  );
});
