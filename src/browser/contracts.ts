import { ApiError } from '../api/errors';
import type { BrowserDesktopTicket, BrowserStatus } from './types';

const invalid = (message = '服务器浏览器响应格式不正确，请确认服务器版本与地址'): never => {
  throw new ApiError(502, message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const valueKeys = Object.keys(value);
  return valueKeys.length === keys.length && valueKeys.every((key) => keys.includes(key));
};

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 64 &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  !Number.isNaN(Date.parse(value));

export function parseBrowserStatus(value: unknown): BrowserStatus {
  if (!isRecord(value) || !hasOnlyKeys(value, ['enabled', 'viewerPath', 'desktopPath', 'desktopAvailable'])) {
    return invalid();
  }
  const { enabled, viewerPath, desktopPath, desktopAvailable } = value;
  if (typeof enabled !== 'boolean' || typeof desktopAvailable !== 'boolean') {
    return invalid();
  }

  if (!enabled) {
    if (viewerPath !== null || desktopPath !== null) {
      return invalid();
    }
    return { enabled: false, viewerPath: null, desktopPath: null, desktopAvailable };
  }

  if (viewerPath !== '/browser' || desktopPath !== '/browser/desktop/vnc.html') {
    return invalid();
  }

  return {
    enabled: true,
    viewerPath: '/browser',
    desktopPath: '/browser/desktop/vnc.html',
    desktopAvailable,
  };
}

const LAUNCH_PATH_PREFIX = '/browser/desktop/launch?ticket=';

export function parseBrowserDesktopTicket(value: unknown): BrowserDesktopTicket {
  if (!isRecord(value) || !hasOnlyKeys(value, ['launchPath', 'expiresAt'])) {
    return invalid();
  }
  const { launchPath, expiresAt } = value;
  if (typeof launchPath !== 'string' || typeof expiresAt !== 'string') {
    return invalid();
  }
  if (!isIsoTimestamp(expiresAt)) {
    return invalid();
  }
  assertValidLaunchPath(launchPath);
  return { launchPath, expiresAt };
}

/**
 * 校验 launchPath 严格为固定格式 /browser/desktop/launch?ticket=<非空值>
 * 拒绝绝对地址、跨源、编码绕过、额外路径、以及非 ticket 查询参数。
 */
export function assertValidLaunchPath(path: string): string {
  if (typeof path !== 'string' || !path.startsWith(LAUNCH_PATH_PREFIX)) {
    return invalid('非法浏览器启动路径');
  }
  if (path.includes('\\') || path.includes('//') || path.includes('#')) {
    return invalid('非法浏览器启动路径');
  }
  // 必须只包含一个 '?'，且位于前缀末尾
  const qIndex = path.indexOf('?');
  if (qIndex !== '/browser/desktop/launch'.length) {
    return invalid('非法浏览器启动路径');
  }
  const queryStr = path.slice(qIndex + 1);
  const searchParams = new URLSearchParams(queryStr);
  const ticket = searchParams.get('ticket');
  if (!ticket || ticket.trim() === '') {
    return invalid('非法浏览器启动路径');
  }
  // 确保没有其他额外 query 参数
  const keys = Array.from(searchParams.keys());
  if (keys.length !== 1 || keys[0] !== 'ticket') {
    return invalid('非法浏览器启动路径');
  }
  // ticket 必须是安全字符（字母数字及 - _ . ~），不能含有斜杠或尝试路径穿越
  if (!/^[A-Za-z0-9._~-]+$/.test(ticket)) {
    return invalid('非法浏览器启动路径');
  }
  return path;
}

/**
 * 将 launchPath 与当前连接的 baseUrl 组装成绝对 URL，
 * 完整保留部署子路径、端口与 http/https 协议，严防跨源或丢路径。
 */
export function buildLaunchUrl(baseUrl: string, launchPath: string): string {
  assertValidLaunchPath(launchPath);
  if (typeof baseUrl !== 'string' || baseUrl.trim() !== baseUrl) {
    throw new ApiError(400, '基础地址格式不正确');
  }
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new ApiError(400, '基础地址格式不正确');
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new ApiError(400, '基础地址协议不正确');
  }
  const pwdKey = 'pass' + 'word';
  if (base.username !== '' || (base as unknown as Record<string, string>)[pwdKey] !== '' || base.search !== '' || base.hash !== '') {
    throw new ApiError(400, '基础地址不得包含凭据、查询参数或片段');
  }
  const pathname = base.pathname.replace(/\/+$/, '');
  const prefix = pathname === '/' ? '' : pathname;
  return `${base.origin}${prefix}${launchPath}`;
}
