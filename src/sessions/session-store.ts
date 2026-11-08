import type { ApiClient } from '../api/contracts';
import { ApiError } from '../api/errors';
import { orderSessions, type SessionRecord } from './types';
import type { ChatSessionStore } from './chat-session-store';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 连接级目录事实；不持有聊天正文、SSE、附件或设置草稿。 */
export class SessionStore {
  private disposed = false;
  private enabled = true;
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;
  private changed() { this.version++; for (const listener of this.listeners) listener(); }
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  records: SessionRecord[] = [];
  loading = false;
  loaded = false;
  directoryError?: string;
  directoryWriting = false;
  directoryUncertain = false;
  private directoryGeneration = 0;
  private directoryRead?: AbortController;
  private tombstones = new Set<string>();
  constructor(private readonly api: ApiClient, private readonly chats: ChatSessionStore) {}

  /** 普通刷新只同步目录；写入未明只能由用户明确回读核对后解锁。 */
  reload = async (options: { reconcileUncertain?: boolean } = {}): Promise<boolean> => {
    if (!this.enabled || this.disposed || this.directoryWriting) return false;
    const generation = ++this.directoryGeneration;
    this.directoryRead?.abort();
    const controller = new AbortController(); this.directoryRead = controller;
    this.loading = true; this.changed();
    try {
      const records = await this.api.listSessions(controller.signal);
      if (this.disposed || controller.signal.aborted || generation !== this.directoryGeneration) return false;
      for (const previous of this.records) if (!records.some((item) => item.id === previous.id)) this.chats.clear(previous.id);
      this.records = orderSessions(records.filter((item) => !this.tombstones.has(item.id)));
      this.loaded = true; this.directoryError = undefined;
      if (options.reconcileUncertain) this.directoryUncertain = false;
      return true;
    } catch (error) {
      if (!controller.signal.aborted && generation === this.directoryGeneration && !this.disposed) this.directoryError = message(error);
      return false;
    } finally { if (generation === this.directoryGeneration && !this.disposed) { this.loading = false; this.changed(); } }
  };
  private async directoryWrite(action: () => Promise<SessionRecord>): Promise<SessionRecord | undefined> {
    if (this.disposed || !this.enabled || this.directoryWriting || this.directoryUncertain) return;
    ++this.directoryGeneration; this.directoryRead?.abort(); this.loading = false;
    this.directoryWriting = true; this.directoryError = undefined; this.changed();
    try {
      const record = await action();
      if (this.disposed || this.tombstones.has(record.id)) return;
      this.records = orderSessions([record, ...this.records.filter((item) => item.id !== record.id)]);
      return record;
    } catch (error) {
      if (!this.disposed) {
        this.directoryUncertain = !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
        this.directoryError = message(error);
      }
    } finally { if (!this.disposed) { this.directoryWriting = false; this.changed(); } }
  }
  create = (title?: string) => this.directoryWrite(() => this.api.createSession(title));
  rename = (id: string, title: string) => this.records.some((item) => item.id === id)
    ? this.directoryWrite(() => this.api.renameSession(id, title)) : Promise.resolve(undefined);

  update(record: SessionRecord) {
    if (this.disposed || this.tombstones.has(record.id)) return;
    ++this.directoryGeneration; this.directoryRead?.abort(); this.loading = false;
    this.records = orderSessions([record, ...this.records.filter((item) => item.id !== record.id)]); this.changed();
  }
  forget(id: string) {
    ++this.directoryGeneration; this.directoryRead?.abort(); this.loading = false;
    this.tombstones.add(id); this.records = this.records.filter((item) => item.id !== id); this.changed();
  }
  dispose() { this.disposed = true; this.directoryRead?.abort(); this.listeners.clear(); }
}
