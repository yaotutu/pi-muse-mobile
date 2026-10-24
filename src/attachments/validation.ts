import type { MessageAttachmentInput } from '../api/types';
import type { AttachmentDraft } from './types';

export const MAX_MESSAGE_ATTACHMENTS = 4;
export const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_BYTES = 100_000;
export const MAX_MESSAGE_CONTENT_CHARS = 32_000;

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'image/svg+xml',
  'application/json', 'application/xml', 'text/xml', 'application/yaml', 'text/yaml',
  'application/javascript', 'text/javascript', 'text/typescript', 'application/sql', 'text/css',
]);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'xml', 'yaml', 'yml', 'js', 'mjs', 'cjs',
  'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cpp',
  'hpp', 'cs', 'php', 'sql', 'sh', 'bash', 'zsh', 'css', 'scss', 'less', 'html', 'htm', 'svg',
]);
const BASE64_VALUES = (() => {
  const values = new Int16Array(128).fill(-1);
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((char, index) => {
    values[char.charCodeAt(0)] = index;
  });
  return values;
})();

export type AttachmentValidationResult =
  | { ok: true; attachments: AttachmentDraft[] }
  | { ok: false; error: string };

export type OutgoingMessageValidationResult =
  | { ok: true; text: string; attachments: AttachmentDraft[] }
  | { ok: false; error: string };

type AttachmentBytesInput = {
  id: string;
  name: string;
  mimeType: string;
  data: Uint8Array;
};

function decodeBase64(value: string): Uint8Array | undefined {
  if (!isCanonicalBase64(value)) return undefined;
  const length = value.length;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < length; i += 4) {
    const c0 = value.charCodeAt(i);
    const c1 = value.charCodeAt(i + 1);
    const c2 = value.charCodeAt(i + 2);
    const c3 = value.charCodeAt(i + 3);
    if (c0 >= 128 || c1 >= 128 || c2 >= 128 || c3 >= 128) return undefined;
    const n0 = BASE64_VALUES[c0]!;
    const n1 = BASE64_VALUES[c1]!;
    const c2IsPadding = c2 === 61;
    const c3IsPadding = c3 === 61;
    const n2 = c2IsPadding ? 0 : BASE64_VALUES[c2]!;
    const n3 = c3IsPadding ? 0 : BASE64_VALUES[c3]!;
    if (n0 < 0 || n1 < 0 || (!c2IsPadding && n2 < 0) || (!c3IsPadding && n3 < 0)) return undefined;
    const triplet = (n0 << 18) | (n1 << 12) | (n2 << 6) | n3;
    bytes[at++] = (triplet >> 16) & 0xff;
    if (!c2IsPadding) bytes[at++] = (triplet >> 8) & 0xff;
    if (!c3IsPadding) bytes[at++] = triplet & 0xff;
  }
  return at === bytes.length ? bytes : undefined;
}

/** 大字符串不能交给单个正则，避免移动端正则引擎栈溢出。 */
export function isCanonicalBase64(value: string): boolean {
  const length = value.length;
  if (!length || length % 4 !== 0) return false;
  const valueOf = (index: number) => BASE64_VALUES[value.charCodeAt(index)] ?? -1;
  // 最后一组未用 bit 必须为零；否则同一字节会存在多个非 canonical 编码。
  if (value.charCodeAt(length - 1) === 61) {
    if (value.charCodeAt(length - 2) === 61) {
      if ((valueOf(length - 3) & 0x0f) !== 0) return false;
    } else if ((valueOf(length - 2) & 0x03) !== 0) {
      return false;
    }
  }
  for (let i = 0; i < length; i++) {
    const code = value.charCodeAt(i);
    if (code === 61) {
      if (i !== length - 1 && i !== length - 2) return false;
      if (i === length - 2 && value.charCodeAt(i + 1) !== 61) return false;
      continue;
    }
    if (code >= 128 || BASE64_VALUES[code]! < 0) return false;
  }
  return true;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  // 分块拼接避免 8MiB 附件在 Hermes/JavaScriptCore 上形成超长临时字符串。
  // 块大小必须是 3 的倍数，避免把连续 Base64 组拆成带独立 padding 的两段。
  for (let start = 0; start < bytes.length; start += 30_000) {
    let chunk = '';
    const end = Math.min(start + 30_000, bytes.length);
    for (let i = start; i < end; i += 3) {
      const b0 = bytes[i]!;
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      chunk += alphabet[b0 >> 2]!;
      chunk += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
      chunk += b1 === undefined ? '=' : alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
      chunk += b2 === undefined ? '=' : alphabet[b2 & 0x3f]!;
    }
    result += chunk;
  }
  return result;
}

export function imageMimeOf(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6) {
    const gif = String.fromCharCode(...bytes.slice(0, 6));
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  }
  return undefined;
}

function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++]!;
    if (b0 < 0x80) continue;
    // C0/C1 只能生成 overlong 编码；严格 UTF-8 的两字节序列必须从 C2 开始。
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      const b1 = bytes[i++];
      if ((b1! & 0xc0) !== 0x80) return false;
      continue;
    }
    if (b0 >= 0xe0 && b0 <= 0xef) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      if ((b1! & 0xc0) !== 0x80 || (b2! & 0xc0) !== 0x80) return false;
      if ((b0 === 0xe0 && b1! < 0xa0) || (b0 === 0xed && b1! >= 0xa0)) return false;
      continue;
    }
    if (b0 >= 0xf0 && b0 <= 0xf4) {
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      if ((b1! & 0xc0) !== 0x80 || (b2! & 0xc0) !== 0x80 || (b3! & 0xc0) !== 0x80) return false;
      if ((b0 === 0xf0 && b1! < 0x90) || (b0 === 0xf4 && b1! > 0x8f)) return false;
      continue;
    }
    return false;
  }
  return true;
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
};

const IMAGE_MIME_ALIASES = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['image/x-png', 'image/png'],
]);
const MIME_BY_EXTENSION = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'], ['webp', 'image/webp'], ['txt', 'text/plain'],
  ['md', 'text/markdown'], ['markdown', 'text/markdown'], ['csv', 'text/csv'],
  ['html', 'text/html'], ['htm', 'text/html'], ['svg', 'image/svg+xml'],
  ['json', 'application/json'], ['xml', 'application/xml'], ['yaml', 'application/yaml'],
  ['yml', 'application/yaml'], ['js', 'application/javascript'], ['mjs', 'application/javascript'],
  ['cjs', 'application/javascript'], ['ts', 'text/typescript'], ['tsx', 'text/typescript'],
  ['sql', 'application/sql'], ['css', 'text/css'],
]);

/**
 * Android 常把 .ts 报成 video/mp2t、.py 报成 text/x-python。
 * 只对已知文本扩展名的非图片未知 MIME 降级为 octet-stream，再由扩展名与真实 UTF-8 字节把关。
 */
export function pickedMimeType(name: string, declared: string | undefined, actualImageMime?: string): string {
  const extension = extensionOf(name);
  const normalized = declared?.trim().toLowerCase();
  if (normalized) {
    const mime = IMAGE_MIME_ALIASES.get(normalized) ?? normalized;
    const known = IMAGE_MIME_TYPES.has(mime) || TEXT_MIME_TYPES.has(mime) || mime === 'application/octet-stream';
    if (known) return mime;
    if (!mime.startsWith('image/') && TEXT_EXTENSIONS.has(extension)) return 'application/octet-stream';
    return mime;
  }
  return MIME_BY_EXTENSION.get(extension) ?? actualImageMime ?? 'application/octet-stream';
}

/** 原始字节入口：系统选择器读入 bytes 后只做一次校验和一次 Base64 编码。 */
export function createAttachmentDraftsFromBytes(inputs: readonly AttachmentBytesInput[]): AttachmentValidationResult {
  if (inputs.length > MAX_MESSAGE_ATTACHMENTS) {
    return { ok: false, error: `最多只能发送 ${MAX_MESSAGE_ATTACHMENTS} 个附件` };
  }
  const seen = new Set<string>();
  const drafts: AttachmentDraft[] = [];
  let totalBytes = 0;
  let totalTextBytes = 0;

  for (const input of inputs) {
    if (!input || typeof input !== 'object') return { ok: false, error: '附件结构不正确' };
    const { id, name, mimeType } = input;
    if (typeof id !== 'string' || id.length < 1 || id.length > 100 || !/^[A-Za-z0-9._-]+$/.test(id)) {
      return { ok: false, error: '附件 ID 只能使用字母、数字、点、下划线或连字符' };
    }
    if (seen.has(id)) return { ok: false, error: '附件 ID 不能重复' };
    seen.add(id);
    if (typeof name !== 'string' || name.length < 1 || name.length > 200 ||
      name.includes('/') || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name)) {
      return { ok: false, error: '附件名不能为空、超过 200 字符，或包含路径分隔符与控制字符' };
    }
    if (typeof mimeType !== 'string' || (!IMAGE_MIME_TYPES.has(mimeType) && !TEXT_MIME_TYPES.has(mimeType) && mimeType !== 'application/octet-stream')) {
      return { ok: false, error: '仅支持 PNG/JPEG/GIF/WebP 图片或受支持的 UTF-8 文本附件' };
    }
    if (!(input.data instanceof Uint8Array)) {
      return { ok: false, error: `附件 ${name} 的原始字节无效` };
    }
    const bytes = input.data;
    const dataBase64 = bytesToBase64(bytes);
    if (bytes.length === 0) return { ok: false, error: `附件 ${name} 是空文件` };
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { ok: false, error: `附件总大小不能超过 ${MAX_TOTAL_ATTACHMENT_BYTES} 字节` };
    }

    const actualImageMime = imageMimeOf(bytes);
    if (IMAGE_MIME_TYPES.has(mimeType) || actualImageMime) {
      if (actualImageMime !== mimeType) {
        return { ok: false, error: `附件 ${name} 的图片 MIME 与实际字节不匹配` };
      }
      if (bytes.length > MAX_IMAGE_ATTACHMENT_BYTES) {
        return { ok: false, error: `图片 ${name} 不能超过 ${MAX_IMAGE_ATTACHMENT_BYTES} 字节` };
      }
      drafts.push({
        id, name, kind: 'image', mimeType, size: bytes.length, dataBase64,
        image: { mimeType, dataBase64 },
      });
      continue;
    }

    const knownTextMime = TEXT_MIME_TYPES.has(mimeType);
    const extensionFallback = mimeType === 'application/octet-stream' && TEXT_EXTENSIONS.has(extensionOf(name));
    if (!knownTextMime && !extensionFallback) {
      return { ok: false, error: `附件 ${name} 不是受支持的图片或 UTF-8 文本格式` };
    }
    if (bytes.includes(0)) return { ok: false, error: `文本附件 ${name} 不能包含 NUL 字节` };
    if (!isValidUtf8(bytes)) return { ok: false, error: `文本附件 ${name} 不是有效 UTF-8` };
    totalTextBytes += bytes.length;
    if (totalTextBytes > MAX_TEXT_ATTACHMENT_BYTES) {
      return { ok: false, error: `文本附件合计不能超过 ${MAX_TEXT_ATTACHMENT_BYTES} 字节` };
    }
    drafts.push({ id, name, kind: 'text', mimeType, size: bytes.length, dataBase64 });
  }
  return { ok: true, attachments: drafts };
}

/** Base64 入口：HttpApiClient 在真实 HTTP 前解码一次并复用同一套字节级校验。 */
export function createAttachmentDrafts(inputs: readonly MessageAttachmentInput[]): AttachmentValidationResult {
  if (inputs.length > MAX_MESSAGE_ATTACHMENTS) {
    return { ok: false, error: `最多只能发送 ${MAX_MESSAGE_ATTACHMENTS} 个附件` };
  }
  const decoded: AttachmentBytesInput[] = [];
  for (const input of inputs) {
    if (!input || typeof input !== 'object' || typeof input.dataBase64 !== 'string') {
      return { ok: false, error: '附件结构或 Base64 内容不正确' };
    }
    const data = decodeBase64(input.dataBase64);
    if (!data) return { ok: false, error: `附件 ${input.name} 的 Base64 内容无效` };
    decoded.push({ id: input.id, name: input.name, mimeType: input.mimeType, data });
  }
  return createAttachmentDraftsFromBytes(decoded);
}

/** Store/Hook 内部草稿已经持有完整字节编码；这里只做廉价数量、ID、总大小与文本合计检查。 */
export function validateAttachmentDrafts(attachments: readonly AttachmentDraft[]): AttachmentValidationResult {
  if (attachments.length > MAX_MESSAGE_ATTACHMENTS) {
    return { ok: false, error: `最多只能发送 ${MAX_MESSAGE_ATTACHMENTS} 个附件` };
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  let totalTextBytes = 0;
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object' || seen.has(attachment.id)) {
      return { ok: false, error: '附件结构不正确或 ID 重复' };
    }
    seen.add(attachment.id);
    if (typeof attachment.size !== 'number' || !Number.isSafeInteger(attachment.size) || attachment.size <= 0) {
      return { ok: false, error: `附件 ${attachment.name} 的大小无效` };
    }
    totalBytes += attachment.size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { ok: false, error: `附件总大小不能超过 ${MAX_TOTAL_ATTACHMENT_BYTES} 字节` };
    }
    if (attachment.kind === 'text') {
      totalTextBytes += attachment.size;
      if (totalTextBytes > MAX_TEXT_ATTACHMENT_BYTES) {
        return { ok: false, error: `文本附件合计不能超过 ${MAX_TEXT_ATTACHMENT_BYTES} 字节` };
      }
    }
  }
  return { ok: true, attachments: [...attachments] };
}

export function validateOutgoingMessage(text: string, attachments: readonly MessageAttachmentInput[] = []): OutgoingMessageValidationResult {
  if (text.length > MAX_MESSAGE_CONTENT_CHARS) {
    return { ok: false, error: `消息文字不能超过 ${MAX_MESSAGE_CONTENT_CHARS.toLocaleString()} 字符` };
  }
  const result = createAttachmentDrafts(attachments);
  if (!result.ok) return result;
  if (!text.trim() && result.attachments.length === 0) {
    return { ok: false, error: '请输入文字或选择至少一个附件' };
  }
  return { ok: true, text, attachments: result.attachments };
}

/** 发送路径使用已验证的 AttachmentDraft，避免在 Store 与 HttpApiClient 之间重复解码。 */
export function validateOutgoingDraftMessage(
  text: string,
  attachments: readonly AttachmentDraft[],
): OutgoingMessageValidationResult {
  if (text.length > MAX_MESSAGE_CONTENT_CHARS) {
    return { ok: false, error: `消息文字不能超过 ${MAX_MESSAGE_CONTENT_CHARS.toLocaleString()} 字符` };
  }
  const result = validateAttachmentDrafts(attachments);
  if (!result.ok) return result;
  if (!text.trim() && result.attachments.length === 0) {
    return { ok: false, error: '请输入文字或选择至少一个附件' };
  }
  return { ok: true, text, attachments: result.attachments };
}

/** HttpApiClient 的唯一上传投影：严格剔除本地 kind、size 与预览等非协议字段。 */
export function attachmentUploadOf(attachment: AttachmentDraft): MessageAttachmentInput {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    dataBase64: attachment.dataBase64,
  };
}
