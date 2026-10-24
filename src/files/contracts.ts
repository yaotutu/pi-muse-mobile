import { ApiError } from '../api/errors';
import type {
  WorkspaceDeleteResult,
  WorkspaceFileDetail,
  WorkspaceFileMetadata,
  WorkspaceFileSelector,
  WorkspaceFileScope,
  WorkspaceFileTarget,
  WorkspaceListEntry,
  WorkspaceListResult,
  WorkspaceTextDetail,
} from './types';

export const WORKSPACE_SPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const WORKSPACE_WRITE_SEGMENT = /^[A-Za-z0-9._-]+$/;
export const MAX_WORKSPACE_TEXT_BYTES = 100_000;
export const MAX_WORKSPACE_DOWNLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_WORKSPACE_DIRECTORY_ENTRIES = 1_000;
export const MAX_WORKSPACE_PATH_LENGTH = 2_048;

const invalid = (): never => {
  throw new ApiError(502, '服务器工作区文件响应格式不正确，请刷新核对服务器版本');
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();

const text = (value: unknown, nonempty = false): string =>
  typeof value === 'string' && (!nonempty || value.length > 0) ? value : invalid();

const nullableText = (value: unknown): string | null => value === null ? null : text(value, true);

const integer = (value: unknown, minimum = 0): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : invalid();

function date(value: unknown): string {
  const result = text(value, true);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(result) || !Number.isFinite(Date.parse(result))) return invalid();
  if (new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)) return invalid();
  return result;
}

export const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

export const isValidUnicodeText = (value: string): boolean => {
  if (value.includes('\0')) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
    if (code > 0xdbff || next < 0xdc00 || next > 0xdfff) return false;
    index++;
  }
  return true;
};

export const isValidWorkspaceText = (value: string): boolean =>
  isValidUnicodeText(value) && utf8ByteLength(value) <= MAX_WORKSPACE_TEXT_BYTES;

export function validateWorkspaceSpaceId(value: string): string {
  if (!WORKSPACE_SPACE_ID_PATTERN.test(value)) {
    throw new ApiError(400, '工作区空间 ID 不合法');
  }
  return value;
}

export function validateWorkspaceSelector(selector: WorkspaceFileSelector): WorkspaceFileSelector {
  if (selector.scope !== 'space' && selector.scope !== 'shared') throw new ApiError(400, '工作区范围不合法');
  if (selector.scope === 'space') {
    if (typeof selector.spaceId !== 'string') throw new ApiError(400, 'scope=space 时必须提供 spaceId');
    validateWorkspaceSpaceId(selector.spaceId);
    return { scope: 'space', spaceId: selector.spaceId };
  }
  if (selector.spaceId !== null) throw new ApiError(400, 'scope=shared 时不能提供 spaceId');
  return { scope: 'shared', spaceId: null };
}

/**
 * 只读路径允许历史模型工具留下的非 ASCII 名称；列表根目录用 `.` 表示。
 * 任意路径都拒绝空段、`.`/`..`、反斜杠、绝对路径与 NUL。
 */
export function validateWorkspaceReadPath(rawPath: string, options: { fileRequired?: boolean } = {}): string {
  if (
    typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.length > MAX_WORKSPACE_PATH_LENGTH ||
    rawPath.includes('\0') || rawPath.includes('\\') || rawPath.startsWith('/')
  ) throw new ApiError(400, '工作区路径不合法');
  if (rawPath === '.') {
    if (options.fileRequired) throw new ApiError(400, '必须提供文件路径');
    return rawPath;
  }
  const parts = rawPath.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) throw new ApiError(400, '工作区路径不合法');
  return parts.join('/');
}

export function validateWorkspaceWritePath(rawPath: string): string {
  const path = validateWorkspaceReadPath(rawPath);
  if (path === '.' || !path.split('/').every((part) => WORKSPACE_WRITE_SEGMENT.test(part) && part !== '.' && part !== '..')) {
    throw new ApiError(400, '写入路径每段只能使用 ASCII 字母、数字、点、连字符或下划线');
  }
  return path;
}

export function workspaceFileTarget(scope: WorkspaceFileScope, spaceId: string | null, path: string, mode: 'read' | 'write' | 'file'): WorkspaceFileTarget {
  const selector = validateWorkspaceSelector({ scope, spaceId });
  const validated = mode === 'write'
    ? validateWorkspaceWritePath(path)
    : validateWorkspaceReadPath(path, { fileRequired: mode === 'file' });
  return { ...selector, path: validated };
}

export function workspaceFileQuery(target: WorkspaceFileTarget): string {
  const params = new URLSearchParams({ scope: target.scope, path: target.path });
  if (target.scope === 'space') params.set('spaceId', target.spaceId!);
  return params.toString();
}

function selectorOf(value: unknown, expected?: WorkspaceFileSelector): WorkspaceFileSelector {
  const item = object(value);
  if (item.scope !== 'space' && item.scope !== 'shared') return invalid();
  const spaceId = nullableText(item.spaceId);
  let selector: WorkspaceFileSelector;
  try {
    selector = validateWorkspaceSelector({ scope: item.scope, spaceId });
  } catch {
    return invalid();
  }
  if (expected && (selector.scope !== expected.scope || selector.spaceId !== expected.spaceId)) return invalid();
  return selector;
}

function entry(value: unknown, directoryPath: string): WorkspaceListEntry {
  const item = object(value);
  const name = text(item.name, true);
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') return invalid();
  const path = text(item.path, true);
  const expectedPath = directoryPath === '.' ? name : `${directoryPath}/${name}`;
  if (path !== expectedPath) return invalid();
  if (item.kind !== 'file' && item.kind !== 'directory') return invalid();
  const size = integer(item.size);
  if (item.kind === 'directory' && size !== 0) return invalid();
  return { name, path, kind: item.kind, size, updatedAt: date(item.updatedAt) };
}

export function parseWorkspaceList(value: unknown, expectedTarget?: WorkspaceFileTarget): WorkspaceListResult {
  const item = object(value);
  const selector = selectorOf(item, expectedTarget);
  let path: string;
  try {
    path = validateWorkspaceReadPath(text(item.path, true));
  } catch {
    return invalid();
  }
  if (expectedTarget && path !== expectedTarget.path) return invalid();
  if (!Array.isArray(item.entries) || item.entries.length > MAX_WORKSPACE_DIRECTORY_ENTRIES) return invalid();
  const entries = item.entries.map((raw) => entry(raw, path));
  for (let index = 1; index < entries.length; index++) {
    const left = entries[index - 1];
    const right = entries[index];
    if (left.kind !== 'directory' && right.kind === 'directory') return invalid();
    if (left.kind === right.kind && !(left.name <= right.name)) return invalid();
  }
  if (new Set(entries.map((current) => current.path)).size !== entries.length) return invalid();
  return { ...selector, path, entries };
}

const base64ByteLength = (value: string): number => {
  if (value.length === 0 || value.length % 4 !== 0) return value.length === 0 ? 0 : invalid();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return value.length / 4 * 3 - padding;
};
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})*$/;

function metadata(value: Record<string, unknown>, expectedTarget?: WorkspaceFileTarget): WorkspaceFileMetadata {
  let path: string;
  try {
    path = validateWorkspaceReadPath(text(value.path, true), { fileRequired: true });
  } catch {
    return invalid();
  }
  if (expectedTarget && path !== expectedTarget.path) return invalid();
  const name = text(value.name, true);
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..' || path.split('/').at(-1) !== name) return invalid();
  const kind = value.kind;
  if (kind !== 'text' && kind !== 'image' && kind !== 'binary') return invalid();
  const size = integer(value.size);
  if (size > MAX_WORKSPACE_DOWNLOAD_BYTES) return invalid();
  const mimeType = text(value.mimeType, true);
  if (mimeType.includes('\0')) return invalid();
  return { name, path, kind, size, updatedAt: date(value.updatedAt), mimeType };
}

export function parseWorkspaceFileDetail(value: unknown, expectedTarget?: WorkspaceFileTarget): WorkspaceFileDetail & WorkspaceFileSelector {
  const item = object(value);
  const selector = selectorOf(item, expectedTarget);
  const base = metadata(item, expectedTarget);
  if (base.kind === 'text') {
    if (item.dataBase64 !== undefined || typeof item.content !== 'string') return invalid();
    if (!isValidUnicodeText(item.content)) return invalid();
    if (utf8ByteLength(item.content) !== base.size) return invalid();
    return { ...selector, ...base, kind: 'text', content: item.content };
  }
  if (item.content !== undefined || typeof item.dataBase64 !== 'string') return invalid();
  const dataBase64 = item.dataBase64;
  if (!BASE64_PATTERN.test(dataBase64) || base64ByteLength(dataBase64) !== base.size) return invalid();
  return { ...selector, ...base, kind: base.kind, dataBase64 };
}

export function parseWorkspaceTextDetail(value: unknown, expectedTarget?: WorkspaceFileTarget): WorkspaceTextDetail & WorkspaceFileSelector {
  const detail = parseWorkspaceFileDetail(value, expectedTarget);
  if (detail.kind !== 'text') return invalid();
  return detail;
}

export function parseWorkspaceDelete(value: unknown, expectedTarget?: WorkspaceFileTarget): WorkspaceDeleteResult {
  const item = object(value);
  const selector = selectorOf(item, expectedTarget);
  let path: string;
  try {
    path = validateWorkspaceWritePath(text(item.path, true));
  } catch {
    return invalid();
  }
  if (expectedTarget && path !== expectedTarget.path) return invalid();
  if (item.ok !== true) return invalid();
  return { ...selector, path, ok: true };
}

export function assertWorkspaceTextForWrite(content: string): string {
  if (!isValidUnicodeText(content)) {
    throw new ApiError(400, '文本内容必须是无 NUL 的有效 Unicode');
  }
  if (utf8ByteLength(content) > MAX_WORKSPACE_TEXT_BYTES) {
    throw new ApiError(413, `文本内容不能超过 ${MAX_WORKSPACE_TEXT_BYTES} 个 UTF-8 字节，且必须是无 NUL 的有效 Unicode`);
  }
  return content;
}
