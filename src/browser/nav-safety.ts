/** WebView 的页面边界。服务端 noVNC 在同源 desktop 路径内完成重定向和资源加载。 */
function desktopRoot(baseUrl: string): { origin: string; path: string } | null {
  try {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.href.includes('@')) return null;
    return { origin: base.origin, path: `${base.pathname.replace(/\/+$/, '')}/browser/desktop/` };
  } catch {
    return null;
  }
}

function desktopUrl(baseUrl: string, candidate: string): URL | null {
  const root = desktopRoot(baseUrl);
  if (!root) return null;
  try {
    const url = new URL(candidate);
    // 不让 originWhitelist 把外链交给系统；所有导航都由同一回调决定。
    if (url.origin !== root.origin || url.href.includes('@') || !url.pathname.startsWith(root.path)) return null;
    if (candidate.includes('\\') || /%2f|%5c/i.test(url.pathname)) return null;
    // noVNC 接受 host/port 覆盖参数；移动容器只连接当前服务端网关。
    for (const params of [url.searchParams, new URLSearchParams(url.hash.slice(1))]) {
      if (params.has('host') || params.has('port')) return null;
      const path = params.get('path');
      if (path !== null && path !== 'browser/desktop/websockify') return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** Android 首次 source 加载不会触发 onShouldStartLoadWithRequest，挂载前必须单独校验。 */
export function isBrowserLaunchUrl(baseUrl: string, launchUrl: string): boolean {
  const url = desktopUrl(baseUrl, launchUrl);
  const root = desktopRoot(baseUrl);
  if (!url || !root || url.pathname !== `${root.path}launch` || url.hash) return false;
  const keys = [...url.searchParams.keys()];
  return keys.length === 1 && keys[0] === 'ticket' && /^[A-Za-z0-9._~-]+$/.test(url.searchParams.get('ticket') ?? '');
}

export function isBrowserNavigationAllowed(baseUrl: string, launchUrl: string, candidate: string, hasTargetFrame = true): boolean {
  if (!hasTargetFrame || !isBrowserLaunchUrl(baseUrl, launchUrl)) return false;
  const url = desktopUrl(baseUrl, candidate);
  const root = desktopRoot(baseUrl);
  if (!url || !root) return false;
  // launch 只允许本次 store 颁发的完整地址，防止跳到其他票据或无票据入口。
  if (url.pathname === `${root.path}launch`) return candidate === launchUrl;
  return true;
}
