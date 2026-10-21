import type { ApiClient } from '../api/contracts';
import { ApiError, isRequestCancelled } from '../api/errors';
import type { JobAction, JobDetail, JobItem, JobsQuery } from '../api/types';
import type { RuntimeEvent } from '../runtime/types';
import { availableJobActions, jobActionLabel, jobEditor, jobUpdates, type JobEditor } from './presentation';

type JobClient = Pick<ApiClient, 'listJobs' | 'getJob' | 'updateJob' | 'controlJob' | 'deleteJob' | 'getServerTimeZone'>;
export type JobSnapshot = {
  query: JobsQuery; jobs: readonly JobItem[]; loaded: boolean; loading: boolean; stale: boolean;
  selectedId?: string; detail?: JobDetail; missing: boolean; editor?: JobEditor;
  confirmation?: { id: string; action: JobAction | 'delete' };
  writing: boolean; uncertain: boolean; reviewed: boolean;
  timeZone?: string; timeZoneError?: string; error?: string; notice?: string;
};
const initial = (): JobSnapshot => ({ query: { sort: 'nextRunAt', order: 'asc' }, jobs: [], loaded: false, loading: false, stale: true, missing: false, writing: false, uncertain: false, reviewed: false });

/**
 * Jobs 独立端点的连接内状态。没有 revision、幂等写入键或专属 SSE，不做盲轮询。
 * 唯一通知流只作失效提示；按打开、回前台、用户刷新及成功写入回读权威列表/详情。
 * 写入中断不等于远端撤销，未明时保留草稿并锁定重提，直到回读及用户明确核对。
 */
export class JobStore {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private visible = false;
  private disposed = false;
  private readGeneration = 0;
  private writeGeneration = 0;
  private readController?: AbortController;
  private writeController?: AbortController;
  constructor(private readonly client: JobClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<JobSnapshot>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private cancelRead() { this.readGeneration++; this.readController?.abort(); this.readController = undefined; }
  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      this.cancelRead(); this.writeGeneration++; this.writeController?.abort(); this.writeController = undefined;
      this.publish({ loading: false, stale: true, confirmation: undefined, writing: false,
        ...(this.state.writing ? { uncertain: true, reviewed: false, error: '提交结果未明，请刷新任务并核对；不会自动重试。' } : {}) });
    } else if (this.visible) void this.refresh();
  }
  open() { if (this.disposed) return; this.visible = true; void this.refresh(); }
  close() { this.visible = false; this.cancelRead(); this.publish({ loading: false, stale: true, confirmation: undefined }); }
  canWrite() { return this.active && this.visible && this.state.loaded && !!this.state.detail && !this.state.missing && !this.state.loading && !this.state.stale && !this.state.writing && !this.state.uncertain; }
  setQuery = (query: JobsQuery) => {
    if (this.state.writing || this.state.uncertain || this.state.editor) return;
    this.cancelRead(); this.publish({ query, jobs: [], loaded: false, stale: true, selectedId: undefined, detail: undefined, missing: false, confirmation: undefined, notice: undefined });
    void this.refresh();
  };
  select = (id?: string) => {
    if (this.state.writing || this.state.uncertain || this.state.editor) return;
    this.cancelRead(); this.publish({ selectedId: id, detail: undefined, missing: false, stale: true, loading: false, confirmation: undefined, error: undefined, notice: undefined });
    void this.refresh();
  };
  invalidate = () => {
    this.publish({ stale: true, confirmation: undefined, reviewed: false });
    if (this.visible && !this.state.writing) void this.refresh();
  };
  receive = (event: RuntimeEvent) => {
    if (event.event === 'agent_status_updated' && event.data.source === 'job') this.invalidate();
  };
  refresh = async () => {
    if (!this.active || !this.visible || this.state.writing || this.disposed) return;
    this.cancelRead(); const generation = this.readGeneration; const controller = new AbortController(); this.readController = controller;
    const { selectedId, query } = this.state;
    this.publish({ loading: true, stale: true, confirmation: undefined, reviewed: false, error: undefined });
    try {
      // 时区失败不伪装为空列表，也不阻断只读详情；只有每日时刻变更需要权威时区。
      const timezone = this.client.getServerTimeZone(controller.signal).then((timeZone) => ({ timeZone, timeZoneError: undefined }), () => ({ timeZone: undefined, timeZoneError: '服务端时区暂不可读，请刷新后再修改每日时刻' }));
      const [jobs, result, zone] = await Promise.all([
        this.client.listJobs(query, controller.signal),
        selectedId ? this.client.getJob(selectedId, controller.signal).then((detail) => ({ detail, missing: false }), (error) => {
          if (error instanceof ApiError && error.status === 404) return { detail: undefined, missing: true };
          throw error;
        }) : Promise.resolve({ detail: undefined, missing: false }), timezone,
      ]);
      if (generation !== this.readGeneration || controller.signal.aborted || this.disposed) return;
      this.publish({ jobs, ...result, ...zone, loaded: true, stale: false, reviewed: this.state.uncertain,
        ...(result.missing ? { error: '此任务已不存在；不会重建或重发旧操作。' } : {}) });
    } catch (error) {
      if (generation !== this.readGeneration || controller.signal.aborted || isRequestCancelled(error)) return;
      this.publish({ stale: true, error: error instanceof Error ? error.message : '任务读取失败，请重试' });
    } finally {
      if (generation === this.readGeneration) { this.readController = undefined; this.publish({ loading: false }); }
    }
  };
  edit = () => {
    const job = this.state.detail?.job;
    if (this.canWrite() && job && job.status !== 'running' && job.status !== 'queued') this.publish({ editor: jobEditor(job), confirmation: undefined, notice: undefined, error: undefined });
  };
  setEditor = (patch: Partial<Pick<JobEditor, 'prompt' | 'daily' | 'date' | 'time'>>) => {
    if (this.state.editor && !this.state.writing && !this.state.uncertain) this.publish({ editor: { ...this.state.editor, ...patch } });
  };
  cancelEdit = () => { if (!this.state.writing && !this.state.uncertain) this.publish({ editor: undefined, error: undefined }); };
  save = async () => {
    const editor = this.state.editor; const job = this.state.detail?.job;
    if (!editor || !job || !this.canWrite() || job.status === 'running' || job.status === 'queued') return false;
    try {
      const updates = jobUpdates(editor);
      if (updates.daily && !this.state.timeZone) throw new Error('请先刷新读取服务端时区，再修改每日时刻');
      // 外部变更后不能用旧草稿静默覆盖；无 revision，明确提示用户重新打开编辑核对。
      if (JSON.stringify(job) !== JSON.stringify(editor.original)) throw new Error('任务已在其他地方更新。请保留所需内容，取消编辑后重新核对再编辑。');
      return await this.write((signal) => this.client.updateJob(editor.id, updates, signal), '任务已更新');
    } catch (error) { this.publish({ error: error instanceof Error ? error.message : '任务内容无效' }); return false; }
  };
  requestAction = (action: JobAction | 'delete') => {
    const job = this.state.detail?.job;
    if (!this.canWrite() || !job || this.state.editor || job.status === 'running' || job.status === 'queued') return;
    if (action === 'delete' || availableJobActions(job).includes(action)) this.publish({ confirmation: { id: job.id, action }, error: undefined, notice: undefined });
  };
  cancelAction = () => { if (!this.state.writing) this.publish({ confirmation: undefined }); };
  confirmAction = async () => {
    const target = this.state.confirmation; const job = this.state.detail?.job;
    if (!target || !job || !this.canWrite() || target.id !== job.id || this.state.editor || job.status === 'running' || job.status === 'queued') return false;
    if (target.action !== 'delete' && !availableJobActions(job).includes(target.action)) return false;
    return this.write((signal) => target.action === 'delete' ? this.client.deleteJob(target.id, signal) : this.client.controlJob(target.id, target.action, signal), `${jobActionLabel(target.action)}已提交`, target.action === 'delete');
  };
  private async write(action: (signal: AbortSignal) => Promise<unknown>, notice: string, removed = false) {
    this.cancelRead(); const generation = ++this.writeGeneration; const controller = new AbortController(); this.writeController = controller;
    this.publish({ writing: true, error: undefined, notice: undefined });
    let success = false;
    try {
      await action(controller.signal);
      if (generation !== this.writeGeneration || controller.signal.aborted || this.disposed) return false;
      success = true;
      this.publish({ editor: undefined, confirmation: undefined, stale: true, notice,
        ...(removed ? { selectedId: undefined, detail: undefined, missing: false } : {}) });
    } catch (error) {
      if (generation !== this.writeGeneration || this.disposed) return false;
      const uncertain = isRequestCancelled(error) || !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
      this.publish({ uncertain, reviewed: false, confirmation: undefined, stale: true,
        error: uncertain ? '提交结果未明，请刷新任务并核对；不会自动重试。' : error instanceof Error ? error.message : '任务操作失败' });
    } finally {
      if (generation === this.writeGeneration) { this.writeController = undefined; this.publish({ writing: false }); if (success) void this.refresh(); }
    }
    return success;
  }
  acknowledgeReviewed = () => {
    if (this.active && this.visible && this.state.uncertain && this.state.reviewed && !this.state.loading && !this.state.stale) this.publish({ uncertain: false, reviewed: false, error: undefined, notice: '已解除锁定；不会自动重发。请核对最新内容后重新编辑。' });
  };
  dispose() { this.setActive(false); this.disposed = true; this.visible = false; this.state = initial(); this.listeners.clear(); }
}
