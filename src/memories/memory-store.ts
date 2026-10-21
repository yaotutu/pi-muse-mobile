import { ApiError, isRequestCancelled } from '../api/errors';
import type { MemoryItem } from '../api/types';
import type { MemoryClient } from './types';

export const MEMORY_TEXT_LIMIT = 2000;
export const MEMORY_QUERY_LIMIT = 200;
export type MemorySnapshot = {
  query: string;
  memories: readonly MemoryItem[];
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  error?: string;
  notice?: string;
  editor?: { id?: string; text: string };
  deleteTarget?: MemoryItem;
  writing: boolean;
  uncertain: boolean;
  reviewed: boolean;
};
const initial = (): MemorySnapshot => ({ query: '', memories: [], loaded: false, loading: false, stale: true, writing: false, uncertain: false, reviewed: false });

/**
 * 当前服务连接内的全局长期记忆。只保留可见列表与编辑草稿，不持久化服务端正文。
 * 记忆没有 SSE/revision/幂等键：按需读，写入必须串行，提交未明不自动重放或猜成功。
 */
export class MemoryStore {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private visible = false;
  private disposed = false;
  private readGeneration = 0;
  private writeGeneration = 0;
  private readController?: AbortController;
  private writeController?: AbortController;
  constructor(private readonly client: MemoryClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<MemorySnapshot>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private cancelRead() { this.readGeneration++; this.readController?.abort(); this.readController = undefined; }
  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      this.cancelRead(); this.writeGeneration++; this.writeController?.abort(); this.writeController = undefined;
      this.publish({ loading: false, stale: true, deleteTarget: undefined, writing: false,
        ...(this.state.writing ? { uncertain: true, reviewed: false, error: '提交结果未明。请读取全部记忆并核对，不会自动重试。' } : {}) });
    } else if (this.visible) void this.refresh();
  }
  open() { if (this.disposed) return; this.visible = true; void this.refresh(); }
  close() {
    this.visible = false; this.cancelRead();
    // 离开页面不重发也不主动撤销已授权写入；完成结果留在连接内，前后台/切服才取消消费。
    this.publish({ loading: false, stale: true, deleteTarget: undefined });
  }
  canWrite() { return this.active && this.visible && this.state.loaded && !this.state.loading && !this.state.stale && !this.state.writing && !this.state.uncertain; }
  search = (query: string) => {
    if (this.state.writing) return;
    const value = query.trim();
    if (value.length > MEMORY_QUERY_LIMIT) { this.publish({ error: `关键词不能超过 ${MEMORY_QUERY_LIMIT} 字符` }); return; }
    this.cancelRead();
    this.publish({ query: value, memories: [], loaded: false, stale: true, deleteTarget: undefined, error: undefined });
    void this.refresh();
  };
  refresh = async () => {
    if (!this.active || !this.visible || this.state.writing || this.disposed) return;
    this.cancelRead(); const generation = this.readGeneration; const controller = new AbortController(); this.readController = controller;
    const query = this.state.query;
    this.publish({ loading: true, deleteTarget: undefined, error: undefined });
    try {
      const page = await this.client.listMemories(query ? { q: query, limit: 10 } : {}, controller.signal);
      if (generation !== this.readGeneration || controller.signal.aborted || this.disposed) return;
      this.publish({ memories: page.memories, loaded: true, stale: false, reviewed: this.state.uncertain && !query });
    } catch (error) {
      if (generation !== this.readGeneration || controller.signal.aborted || isRequestCancelled(error)) return;
      this.publish({ stale: true, error: error instanceof Error ? error.message : '记忆读取失败，请重试' });
    } finally {
      if (generation === this.readGeneration) { this.readController = undefined; this.publish({ loading: false }); }
    }
  };
  newMemory = () => { if (this.canWrite()) this.publish({ editor: { text: '' }, deleteTarget: undefined, error: undefined, notice: undefined }); };
  edit = (id: string) => {
    if (!this.canWrite()) return;
    const memory = this.state.memories.find((item) => item.id === id);
    if (memory) this.publish({ editor: { id, text: memory.text }, deleteTarget: undefined, error: undefined, notice: undefined });
  };
  setText = (text: string) => { if (this.state.editor && !this.state.writing && !this.state.uncertain) this.publish({ editor: { ...this.state.editor, text } }); };
  cancelEdit = () => { if (!this.state.writing && !this.state.uncertain) this.publish({ editor: undefined, error: undefined }); };
  requestDelete = (id: string) => {
    if (this.canWrite()) this.publish({ deleteTarget: this.state.memories.find((item) => item.id === id), error: undefined, notice: undefined });
  };
  cancelDelete = () => { if (!this.state.writing) this.publish({ deleteTarget: undefined }); };
  save = async () => {
    const editor = this.state.editor;
    if (!editor || !this.canWrite()) return false;
    if (!editor.text.trim() || editor.text.length > MEMORY_TEXT_LIMIT) { this.publish({ error: `记忆内容须为 1–${MEMORY_TEXT_LIMIT} 字符，不能只有空白` }); return false; }
    return this.write(async (signal) => {
      if (editor.id) await this.client.editMemory(editor.id, editor.text, signal);
      // 来源由调用端明确声明，不依赖服务端面向其他消费端的默认标签。
      else await this.client.addMemory(editor.text, 'Mobile UI', signal);
    }, editor.id ? '记忆已更新' : '记忆已新增');
  };
  confirmDelete = async () => {
    const target = this.state.deleteTarget;
    if (!target || !this.canWrite()) return false;
    return this.write((signal) => this.client.forgetMemory(target.id, signal), '记忆已删除');
  };
  private async write(action: (signal: AbortSignal) => Promise<unknown>, notice: string) {
    this.cancelRead(); const generation = ++this.writeGeneration; const controller = new AbortController(); this.writeController = controller;
    this.publish({ writing: true, error: undefined, notice: undefined });
    let success = false;
    try {
      await action(controller.signal);
      if (generation !== this.writeGeneration || controller.signal.aborted || this.disposed) return false;
      success = true;
      this.publish({ editor: undefined, deleteTarget: undefined, stale: true, notice });
    } catch (error) {
      if (generation !== this.writeGeneration || this.disposed) return false;
      const uncertain = isRequestCancelled(error) || !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
      this.publish({ uncertain, reviewed: false, deleteTarget: undefined, stale: true,
        error: uncertain ? '提交结果未明。请读取全部记忆并核对，不会自动重试。' : error instanceof Error ? error.message : '记忆操作失败' });
    } finally {
      if (generation === this.writeGeneration) {
        this.writeController = undefined; this.publish({ writing: false });
        if (success) void this.refresh();
      }
    }
    return success;
  }
  /** 无幂等键无法凭相同正文确认新增成功；必须先完整回读，再由用户明确解除锁定。 */
  acknowledgeReviewed = () => {
    if (this.active && this.state.uncertain && this.state.reviewed && !this.state.loading && !this.state.stale) {
      this.publish({ uncertain: false, reviewed: false, error: undefined, notice: '已解除提交锁定。再次保存会发起新的操作，请确认没有重复。' });
    }
  };
  dispose() { this.setActive(false); this.disposed = true; this.visible = false; this.state = initial(); this.listeners.clear(); }
}
