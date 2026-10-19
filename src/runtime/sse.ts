/**
 * 工作区实时状态推送流（GET /api/events）的 SSE 分帧解析。
 *
 * 与聊天 AG-UI 解析（src/api/sse.ts）的关键差异：
 * - 标准 SSE：以 `event:` 字段为事件名，`data:` 字段为 JSON 负载；空行分帧；
 * - 多行 data 按规范用 `\n` 拼接为单个 JSON 文档（标准 SSE）；
 * - 服务端心跳是 `: keep-alive\n\n` 注释，必须丢弃；
 * - 帧大小硬上限由服务端约束（ready 12MiB、其他 8MiB），超限时必须丢弃并向传输层报可识别错误，
 *   避免大字段悄悄占用内存或让客户端认为正常 EOF。
 *
 * 解析器是 UTF-8 字符流接口；UTF-8 → 字符串由传输层用 TextDecoder 完成，避免在解析器内嵌编码器。
 */

import type { RuntimeEvent } from './types';

export type RuntimeSseLimits = { readyBytes: number; otherBytes: number };

export type ParsedRuntimeFrame = { event: string; data: string };

/** 帧级解析失败；kind 给出失败类别，传输层可据此决定断流或忽略。 */
export class RuntimeSseParseError extends Error {
  constructor(readonly kind: 'oversize' | 'invalid_json', message: string) {
    super(message);
    this.name = 'RuntimeSseParseError';
  }
}

const encodedBytes = (value: string) => new TextEncoder().encode(value).byteLength;

const DEFAULTS: RuntimeSseLimits = {
  readyBytes: 12 * 1024 * 1024,
  otherBytes: 8 * 1024 * 1024,
};

/**
 * 增量 SSE 解析器：push 任意字符串片段，返回该片段内已闭合的完整帧；end 收尾丢弃半截尾帧。
 *
 * 跨 push 边界由 buffer 承载；不预先替换换行符，CRLF/LF/CR 都能在 frame 行内任意位置出现。
 */
export class RuntimeSseParser {
  private buffer = '';
  private frameSize = 0;

  constructor(private readonly limits: RuntimeSseLimits = DEFAULTS) {}

  push(chunk: string): ParsedRuntimeFrame[] {
    if (chunk.length === 0) return [];
    this.buffer += chunk;
    this.frameSize += chunk.length;
    const frames: ParsedRuntimeFrame[] = [];
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(this.buffer);
      if (!boundary) break;
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      this.frameSize = this.buffer.length;
      const limit = this.limitFor(frame);
      const bytes = encodedBytes(frame);
      if (bytes > limit) {
        throw new RuntimeSseParseError(
          'oversize',
          `事件帧超过大小上限（${bytes} > ${limit}），按服务端约定丢弃`,
        );
      }
      const parsed = parseFrame(frame);
      if (parsed) frames.push(parsed);
    }
    const pendingLimit = this.limitFor(this.buffer);
    if (this.frameSize > pendingLimit / 3 && encodedBytes(this.buffer) > pendingLimit) {
      throw new RuntimeSseParseError(
        'oversize',
        `未闭合事件帧超过大小上限（${pendingLimit} 字节），需要重新同步`,
      );
    }
    return frames;
  }

  end(): ParsedRuntimeFrame[] {
    this.buffer = '';
    this.frameSize = 0;
    return [];
  }

  /** ready 帧上限放宽；其他帧按 otherBytes。 */
  private limitFor(frame: string): number {
    const eventMatch = /^event:\s*(.*)$/m.exec(frame);
    const event = eventMatch ? eventMatch[1].trim() : '';
    return event === 'ready' ? this.limits.readyBytes : this.limits.otherBytes;
  }
}

function parseFrame(frame: string): ParsedRuntimeFrame | null {
  let event = '';
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const trimmed = value.startsWith(' ') ? value.slice(1) : value;
    if (field === 'event') event = trimmed;
    else if (field === 'data') dataLines.push(trimmed);
  }
  if (!event && dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/**
 * 把 ParsedRuntimeFrame 翻译为 RuntimeEvent；不识别的事件返回 null，传输层静默跳过。
 *
 * 无法解码的运行状态不能静默丢弃，否则连接看似在线却永久漏掉一次状态变化。
 */
export function decodeRuntimeFrame(frame: ParsedRuntimeFrame): RuntimeEvent | null {
  if (frame.event !== 'ready' && frame.event !== 'agent_status_updated') return null;
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    throw new RuntimeSseParseError('invalid_json', '运行状态事件不是有效 JSON，需要重新同步');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RuntimeSseParseError('invalid_json', '运行状态事件不是对象，需要重新同步');
  if (frame.event === 'ready') return { event: 'ready', data: payload as Extract<RuntimeEvent, { event: 'ready' }>['data'] };
  return { event: 'agent_status_updated', data: payload as Extract<RuntimeEvent, { event: 'agent_status_updated' }>['data'] };
}
