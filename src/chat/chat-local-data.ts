import { parseConversationMessages } from '../api/contracts';
import type { ConversationMessage } from '../api/types';
import { normalizeServerAddress } from '../connection/server-address';

export type ChatReadingPosition = { messageId: string | null; offset: number; following: boolean };
/** 只用于展示；故意没有 revision、pending、运行或审批状态。 */
export type ChatLocalData = {
  piSessionId: string | null;
  messages: ConversationMessage[];
  draft: string;
  readingPosition: ChatReadingPosition | null;
};
export interface ChatLocalSessionRepository {
  load(id: string): Promise<ChatLocalData | null>;
  save(id: string, data: ChatLocalData): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface ChatLocalStorage {
  read(): Promise<string | null>;
  /** 实现必须以临时文件 + 原子替换发布完整文档。 */
  write(text: string): Promise<void>;
  clear(): Promise<void>;
}
export const CHAT_LOCAL_MAX_BYTES = 4 * 1024 * 1024;
export const CHAT_LOCAL_MAX_MESSAGES = 200;
const MAX_SESSIONS = 8;
const MAX_TEXT = 64 * 1024;
const clipText = (text: string) => {
  const notice = '\n[本机缓存已截断，联网后查看完整内容]';
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - notice.length) + notice : text;
};
const bytes = (text: string) => new TextEncoder().encode(text).length;
type Entry = { serverUrl: string; sessionId: string; data: ChatLocalData };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every((name) => name in value);
export function isChatReadingPosition(value: unknown): value is ChatReadingPosition {
  return object(value) && keys(value, ['messageId', 'offset', 'following']) &&
    (value.messageId === null || typeof value.messageId === 'string' && value.messageId.length <= 512) &&
    // 偏移是行顶部相对视口的位置：读到长消息中间时为负数，并非非法 scrollY。
    typeof value.offset === 'number' && Number.isFinite(value.offset) && Math.abs(value.offset) <= 100_000_000 && typeof value.following === 'boolean';
}
// parser 去掉的未知字段也视为损坏，而非让本地文件夹带凭据或额外状态。
function sameShape(raw: unknown, parsed: unknown): boolean {
  if (Array.isArray(raw) && Array.isArray(parsed)) return raw.length === parsed.length && raw.every((value, i) => sameShape(value, parsed[i]));
  if (object(raw) && object(parsed)) return keys(raw, Object.keys(parsed)) && Object.keys(raw).every((key) => sameShape(raw[key], parsed[key]));
  return raw === parsed;
}
function parseData(raw: unknown): ChatLocalData {
  if (!object(raw) || !keys(raw, ['piSessionId', 'messages', 'draft', 'readingPosition']) ||
    !(raw.piSessionId === null || typeof raw.piSessionId === 'string' && raw.piSessionId.length <= 512) ||
    typeof raw.draft !== 'string' || raw.draft.length > MAX_TEXT ||
    !(raw.readingPosition === null || isChatReadingPosition(raw.readingPosition)) ||
    !Array.isArray(raw.messages) || raw.messages.length > CHAT_LOCAL_MAX_MESSAGES) throw new Error('聊天本地记录已损坏');
  const messages = parseConversationMessages(raw.messages);
  if (!sameShape(raw.messages, messages) || messages.some((item) =>
    (item.content?.length ?? 0) > MAX_TEXT || (item.role === 'user' && item.attachments?.some((attachment) => attachment.image)))) throw new Error('聊天本地记录超过限制');
  return { piSessionId: raw.piSessionId as string | null, messages, draft: raw.draft, readingPosition: raw.readingPosition as ChatReadingPosition | null };
}
/** 附件仅留小型元数据；工具和正文有界截断，不把 base64 图片写到文档目录。 */
export function boundChatLocalData(data: ChatLocalData): ChatLocalData {
  if (data.draft.length > MAX_TEXT) throw new Error('聊天本地草稿超过限制');
  const messages = data.messages.slice(-CHAT_LOCAL_MAX_MESSAGES).map((message): ConversationMessage => ({
    ...message,
    ...(message.content !== undefined ? { content: clipText(message.content) } : {}),
    ...(message.toolCalls ? { toolCalls: message.toolCalls.slice(0, 32).map((call) => ({ ...call, function: { name: call.function.name.slice(0, 512), arguments: clipText(call.function.arguments) } })) } : {}),
    ...(message.role === 'user' && message.attachments ? { attachments: message.attachments.slice(0, 16).map(({ image: _image, ...metadata }) => metadata) } : {}),
  }));
  const bounded = { piSessionId: data.piSessionId, messages, draft: data.draft, readingPosition: data.readingPosition };
  // 一次线性预算，避免每删一条就序列化整份数 MiB 历史（大工具结果会阻塞 JS 线程）。
  let remaining = CHAT_LOCAL_MAX_BYTES - 4096 - bytes(JSON.stringify({ ...bounded, messages: [] }));
  const recent: ConversationMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const size = bytes(JSON.stringify(messages[index])) + 1;
    if (size > remaining) break;
    remaining -= size; recent.push(messages[index]);
  }
  return parseData({ ...bounded, messages: recent.reverse() });
}
function parseDocument(text: string | null): Entry[] {
  if (text === null) return [];
  if (bytes(text) > CHAT_LOCAL_MAX_BYTES) throw new Error('聊天本地文件超过限制');
  const raw: unknown = JSON.parse(text);
  if (!object(raw) || !keys(raw, ['schema', 'entries']) || raw.schema !== 1 || !Array.isArray(raw.entries) || raw.entries.length > MAX_SESSIONS) throw new Error('聊天本地文件已损坏');
  return raw.entries.map((entry: unknown) => {
    if (!object(entry) || !keys(entry, ['serverUrl', 'sessionId', 'data']) || typeof entry.serverUrl !== 'string' ||
      normalizeServerAddress(entry.serverUrl) !== entry.serverUrl || typeof entry.sessionId !== 'string' || !/^(main|[a-zA-Z0-9-]{1,128})$/.test(entry.sessionId)) throw new Error('聊天本地范围无效');
    return { serverUrl: entry.serverUrl, sessionId: entry.sessionId, data: parseData(entry.data) };
  });
}
/** 全部操作串行：clear 排在旧写后，新代次不会被慢写回滚。文档总量有界，不维护第二份权威历史。 */
export class ChatLocalRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  constructor(private readonly storage: ChatLocalStorage) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  forServer(server: string): ChatLocalSessionRepository {
    const serverUrl = normalizeServerAddress(server);
    const generation = this.generation;
    return {
      load: (id) => this.serial(async () => {
        if (generation !== this.generation) return null;
        const entries = parseDocument(await this.storage.read());
        if (generation !== this.generation) return null;
        return entries.find((entry) => entry.serverUrl === serverUrl && entry.sessionId === id)?.data ?? null;
      }),
      save: (id, data) => {
        const bounded = boundChatLocalData(data);
        return this.serial(async () => {
          if (generation !== this.generation) return;
          let entries: Entry[];
          const text = await this.storage.read();
          try { entries = parseDocument(text); } catch { entries = []; }
          entries = [...entries.filter((entry) => entry.serverUrl !== serverUrl || entry.sessionId !== id), { serverUrl, sessionId: id, data: bounded }].slice(-MAX_SESSIONS);
          const encoded = entries.map((entry) => { const text = JSON.stringify(entry); return { text, size: bytes(text) + 1 }; });
          let total = encoded.reduce((sum, entry) => sum + entry.size, 32);
          while (total > CHAT_LOCAL_MAX_BYTES && encoded.length > 1) total -= encoded.shift()!.size;
          if (total > CHAT_LOCAL_MAX_BYTES) throw new Error('聊天本地草稿超过限制');
          await this.storage.write(`{"schema":1,"entries":[${encoded.map((entry) => entry.text).join(',')}]}`);
        });
      },
      remove: (id) => this.serial(async () => {
        if (generation !== this.generation) return;
        const entries = parseDocument(await this.storage.read()).filter((entry) => entry.serverUrl !== serverUrl || entry.sessionId !== id);
        await this.storage.write(JSON.stringify({ schema: 1, entries }));
      }),
    };
  }
  clear(): Promise<void> { this.generation++; return this.serial(() => this.storage.clear()); }
}
