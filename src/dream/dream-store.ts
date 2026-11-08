import { ApiError, isRequestCancelled } from '../api/errors';
import { DREAM_PROMPT_LIMIT, type DreamClient, type DreamOverview, type DreamTarget } from './types';
export type DreamSnapshot = {
  overview?: DreamOverview; loaded: boolean; loading: boolean; stale: boolean; writing: boolean;
  prompt: string; enabled: boolean; dirty: boolean; uncertain: boolean; reviewed: boolean; error?: string;
};
const initial = (): DreamSnapshot => ({ loaded: false, loading: false, stale: true, writing: false, prompt: '', enabled: false, dirty: false, uncertain: false, reviewed: false });

/** 全局整理状态只属于连接；未明写入回读后需人工解锁，后台与 dispose 废弃迟到响应。 */
export class DreamStore {
  private state = initial(); private active = false; private visible = false; private disposed = false;
  private readGeneration = 0; private writeGeneration = 0; private read?: AbortController; private writeController?: AbortController;
  private listeners = new Set<() => void>();
  constructor(private readonly client: DreamClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<DreamSnapshot>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private cancelRead() { this.readGeneration++; this.read?.abort(); this.read = undefined; }
  setActive(active: boolean) {
    if (this.disposed || this.active === active) return; this.active = active;
    if (!active) {
      this.cancelRead(); this.writeGeneration++; this.writeController?.abort(); this.writeController = undefined;
      this.publish({ loading: false, writing: false, stale: true, ...(this.state.writing ? { uncertain: true, reviewed: false, error: '请求已中断，远端可能仍在执行；请回读核对。' } : {}) });
    } else if (this.visible) void this.refresh();
  }
  open() { if (!this.disposed) { this.visible = true; void this.refresh(); } }
  close() { this.visible = false; this.cancelRead(); this.publish({ loading: false, stale: true }); }
  canWrite() { return this.active && this.visible && this.state.loaded && !this.state.stale && !this.state.loading && !this.state.writing && !this.state.uncertain; }
  canRun() { return this.canWrite() && !this.state.dirty && !this.state.overview?.running; }
  setDraft = (patch: { prompt?: string; enabled?: boolean }) => {
    if (this.state.writing || (patch.prompt !== undefined && patch.prompt.length > DREAM_PROMPT_LIMIT)) return;
    const prompt = patch.prompt ?? this.state.prompt; const enabled = patch.enabled ?? this.state.enabled;
    this.publish({ prompt, enabled, dirty: prompt !== this.state.overview?.globalPrompt || enabled !== this.state.overview?.enabled });
  };
  discard = () => { if (this.state.overview && !this.state.writing) this.publish({ prompt: this.state.overview.globalPrompt, enabled: this.state.overview.enabled, dirty: false }); };
  refresh = async () => {
    if (!this.active || !this.visible || this.state.writing || this.disposed) return;
    this.cancelRead(); const generation = this.readGeneration; const controller = new AbortController(); this.read = controller; this.publish({ loading: true });
    try {
      const overview = await this.client.getDreamOverview(controller.signal);
      if (this.disposed || controller.signal.aborted || generation !== this.readGeneration) return;
      this.publish({ overview, loaded: true, stale: false, error: undefined, reviewed: this.state.uncertain,
        ...(!this.state.dirty ? { prompt: overview.globalPrompt, enabled: overview.enabled } : {}) });
    } catch (error) { if (generation === this.readGeneration && !controller.signal.aborted && !isRequestCancelled(error)) this.publish({ stale: true, error: error instanceof Error ? error.message : 'Dream 读取失败' }); }
    finally { if (generation === this.readGeneration) { this.read = undefined; this.publish({ loading: false }); } }
  };
  save = () => this.canWrite() ? this.write((signal) => this.client.saveDreamSettings({ enabled: this.state.enabled, prompt: this.state.prompt }, signal), true) : Promise.resolve(false);
  runNow = () => this.canRun() ? this.write((signal) => this.client.runDream(signal)) : Promise.resolve(false);
  resolvePending = (id: string, action: 'apply' | 'dismiss', target?: DreamTarget) => {
    if (!this.canWrite() || !this.state.overview?.pending.some((item) => item.id === id)) return Promise.resolve(false);
    // 来源会话的存在与授权由后端核验；不建立会话、不改归属、不自动重发。
    return this.write((signal) => this.client.resolveDreamPending(id, action === 'apply' ? { action, target } : { action }, signal));
  };
  private async write(action: (signal: AbortSignal) => Promise<DreamOverview>, saved = false) {
    this.cancelRead(); const generation = ++this.writeGeneration; const controller = new AbortController(); this.writeController = controller;
    this.publish({ writing: true, error: undefined });
    try {
      const overview = await action(controller.signal);
      if (this.disposed || generation !== this.writeGeneration || controller.signal.aborted) return false;
      this.publish({ overview, stale: false, ...(saved ? { prompt: overview.globalPrompt, enabled: overview.enabled, dirty: false } : {}),
        ...(overview.lastRun?.status === 'failed' || overview.lastRun?.status === 'partial' ? { error: overview.lastRun.error ?? '本次整理未完全成功，请核对结果。' } : {}) }); return true;
    } catch (error) {
      if (generation !== this.writeGeneration || this.disposed) return false;
      const uncertain = !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
      this.publish({ stale: true, uncertain, reviewed: false, error: uncertain ? '操作结果未明，请先回读核对，不会自动重发。' : error.message }); return false;
    } finally { if (generation === this.writeGeneration) { this.writeController = undefined; this.publish({ writing: false }); } }
  }
  acknowledgeReviewed = () => { if (this.state.uncertain && this.state.reviewed && !this.state.stale && !this.state.loading) this.publish({ uncertain: false, reviewed: false }); };
  dispose() { this.setActive(false); this.disposed = true; this.state = initial(); this.listeners.clear(); }
}
