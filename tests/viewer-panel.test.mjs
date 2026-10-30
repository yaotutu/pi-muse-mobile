import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isBrowserLaunchUrl, isBrowserNavigationAllowed } from '../src/browser/nav-safety.ts';
import { createBrowserStore } from '../src/browser/browser-store.ts';

const base = 'http://127.0.0.1:12330';
const launch = `${base}/browser/desktop/launch?ticket=once_1`;
const allowed = (url, frame = true) => isBrowserNavigationAllowed(base, launch, url, frame);

test('首次 source 严格校验同源一次性 launch，支持 HTTP 与部署前缀', () => {
  assert.equal(isBrowserLaunchUrl(base, launch), true);
  assert.equal(isBrowserLaunchUrl('https://muse.example/app', 'https://muse.example/app/browser/desktop/launch?ticket=abc-1'), true);
  for (const url of [
    'https://127.0.0.1:12330/browser/desktop/launch?ticket=once_1',
    `${base}/browser/desktop/launch`, `${base}/browser/desktop/launch?ticket=`,
    `${base}/browser/desktop/launch?ticket=once_1&next=1`,
    `${base}/browser/desktop/launch?ticket=once_1#host=evil.example`,
    `${base}/browser/desktop/launch?ticket=once_1/extra`,
    `${base}/browser/desktop/launch?ticket=once_1@evil.example`,
  ]) assert.equal(isBrowserLaunchUrl(base, url), false, url);
});

test('只允许同源 desktop 页面，拒绝跨域、scheme、弹窗及 noVNC 远端覆盖', () => {
  assert.equal(allowed(launch), true);
  const gatewayPath = encodeURIComponent('browser/desktop/websockify');
  assert.equal(allowed(`${base}/browser/desktop/vnc.html?autoconnect=1&resize=scale&path=${gatewayPath}`), true);
  assert.equal(allowed(`${base}/browser/desktop/pimuse-mobile.html?path=${gatewayPath}`), true);
  for (const url of [
    'https://evil.example/browser/desktop/vnc.html',
    'intent://evil.example/#Intent;scheme=https;end',
    'javascript:alert(1)', 'file:///etc/passwd',
    `${base}/browser`, `${base}/api/browser/status`,
    `${base}/browser/desktop/launch?ticket=other`,
    `${base}/browser/desktop/vnc.html?host=evil.example`,
    `${base}/browser/desktop/vnc.html#port=9999`,
    `${base}/browser/desktop/vnc.html?path=evil%2Fwebsockify`,
    `${base}/browser/desktop/%2f%2fevil.example`,
  ]) assert.equal(allowed(url), false, url);
  assert.equal(allowed(`${base}/browser/desktop/vnc.html`, false), false);
});

test('关闭再打开取得新票据；UI 不向 WebView 传鉴权头或重载旧票据', async () => {
  let tickets = 0;
  const store = createBrowserStore({
    async getBrowserStatus() { return { enabled: true, viewerPath: '/browser', desktopPath: '/browser/desktop/vnc.html', desktopAvailable: true }; },
    async createBrowserDesktopTicket() { tickets += 1; return { launchPath: `/browser/desktop/launch?ticket=once_${tickets}`, expiresAt: new Date().toISOString() }; },
  }, base);
  await store.open();
  assert.equal(store.getSnapshot().launchUrl, launch);
  store.close();
  assert.equal(store.getSnapshot().launchUrl, null);
  await store.open();
  assert.equal(store.getSnapshot().launchUrl, `${base}/browser/desktop/launch?ticket=once_2`);
  assert.equal(tickets, 2);
  store.dispose();

  const panel = readFileSync(new URL('../src/browser/BrowserPanel.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../src/workspace/WorkspaceScreen.tsx', import.meta.url), 'utf8');
  assert.match(panel, /source=\{\{ uri: launchUrl \}\}/);
  assert.match(panel, /incognito/);
  assert.match(panel, /originWhitelist=\{\['\*'\]\}/);
  assert.match(panel, /onOpenWindow=\{\(\) =>/);
  assert.doesNotMatch(panel, /Linking|\.reload\(|Authorization|Bearer|onMessage=/);
  assert.match(workspace, /chatVisible=\{page === 'chat'\}/);
  assert.match(workspace, /\{browserOpen && <BrowserPanel/);
  assert.match(workspace, /!browserOpen && !\(page === 'chat' && keyboardVisible\)/);
  assert.match(workspace, /browser\.close\(\);\s*setBrowserOpen\(false\)/);
  assert.match(workspace, /browser\.dispose\(\)/);
});

test('BrowserPanel 在订阅时补读稳定快照，防止请求在 render 与 effect 之间完成后卡住', () => {
  const panel = readFileSync(new URL('../src/browser/BrowserPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /const snapshot = useSyncExternalStore\(store\.subscribe, store\.getSnapshot, store\.getSnapshot\)/);
  assert.doesNotMatch(panel, /useEffect\(|setSnapshot\(/);
});
