import { ApiError, isRequestCancelled } from '../api/errors';
import type { RuntimeConnection } from '../runtime/runtime-store';
import type { RuntimeEvent } from '../runtime/types';
import { ApprovalConflictError } from './contracts';
import { approvalCanDecide } from './presentation';
import type { ApprovalClient, ApprovalDecision, ApprovalFilter, ApprovalRecord, ApprovalView } from './types';

export type ApprovalHistory = {
  filter: ApprovalFilter; ids: readonly string[]; loaded: boolean; loading: boolean;
  hasMore: boolean; nextCursor: string | null; dirty: boolean; error?: string;
};
export type ApprovalSnapshot = {
  synchronized: boolean;
  syncVersion: number;
  records: Readonly<Record<string, ApprovalRecord>>;
  pendingIds: readonly string[];
  loadingIds: readonly string[];
  submittingIds: readonly string[];
  uncertainIds: readonly string[];
  errors: Readonly<Record<string, string | undefined>>;
  history: ApprovalHistory;
  refreshing: boolean;
  error?: string;
};
const initialHistory = (): ApprovalHistory => ({ filter: {}, ids: [], loaded: false, loading: false, hasMore: false, nextCursor: null, dirty: false });
const filterKey = (filter: ApprovalFilter) => JSON.stringify([filter.spaceId, filter.status, filter.activityId]);
const without = (items: readonly string[], id: string) => items.filter((item) => item !== id);
export const hasApprovalPreview = (record: ApprovalRecord | undefined): record is ApprovalView => !!record && 'preview' in record;

/**
 * 审批领域只消费共享通知流，不建立 SSE、不轮询、不持久化正文。
 * pending 集合由 ready 完整替换；HTTP 与事件都按持久的 (id, revision) 合并。
 * 提交失败不重发决定：结果可能已生效，先读回权威详情再允许用户重新决定。
 */
export class ApprovalStore {
  private state: ApprovalSnapshot = { synchronized: false, syncVersion: 0, records: {}, pendingIds: [], loadingIds: [], submittingIds: [], uncertainIds: [], errors: {}, history: initialHistory(), refreshing: false };
  private listeners = new Set<() => void>();
  private requests = new Set<AbortController>();
  private active = false;
  private generation = 0;
  private eventVersion = 0;
  private historyVersion = 0;
  private historyController?: AbortController;
  private selectedId?: string;

  constructor(private readonly client: ApprovalClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ApprovalSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private current(generation: number, controller: AbortController) {
    return this.active && generation === this.generation && !controller.signal.aborted;
  }
  private startRequest() {
    const controller = new AbortController(); this.requests.add(controller); return controller;
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active; this.generation++;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    this.publish({ synchronized: false, loadingIds: [], submittingIds: [], refreshing: false,
      uncertainIds: [...new Set([...this.state.uncertainIds, ...this.state.submittingIds])],
      history: { ...this.state.history, loading: false, dirty: this.state.history.loaded },
    });
  }
  setConnection = (connection: RuntimeConnection) => {
    if (connection !== 'live') this.publish({ synchronized: false });
  };

  receive = (event: RuntimeEvent) => {
    if (!this.active || event.event === 'agent_status_updated') return;
    this.eventVersion++;
    if (event.event === 'ready') {
      const oldPending = this.state.pendingIds;
      for (const approval of event.data.pendingApprovals) this.merge(approval);
      const pendingIds = event.data.pendingApprovals.map((approval) => approval.id).filter((id) => this.state.records[id].status === 'pending');
      this.publish({ synchronized: true, syncVersion: this.state.syncVersion + 1, pendingIds, error: undefined, history: { ...this.state.history, dirty: this.state.history.loaded } });
      // 断线期间消失的审批不能猜成取消/成功；补读当前详情，且不把迟到 pending 加回集合。
      for (const id of oldPending) if (!pendingIds.includes(id)) void this.loadDetail(id);
      if (this.selectedId) void this.loadDetail(this.selectedId);
    } else {
      const wasUnknown = !this.state.records[event.data.id];
      const applied = this.merge(event.data);
      if (applied && event.event === 'approval_pending' && this.state.records[event.data.id].status === 'pending') {
        this.publish({ pendingIds: [...new Set([...this.state.pendingIds, event.data.id])] });
      }
      if (event.event === 'approval_updated') {
        this.publish({ history: { ...this.state.history, dirty: true } });
        if (wasUnknown) void this.loadDetail(event.data.id);
      }
    }
    this.trimPreviews();
  };

  private merge(incoming: ApprovalRecord): boolean {
    const previous = this.state.records[incoming.id];
    const newer = !previous || incoming.revision > previous.revision;
    // 终态轻量事件可能先于较旧的完整 HTTP 响应到达：只补不可变内容，不回退状态。
    const enrich = previous && ((!hasApprovalPreview(previous) && hasApprovalPreview(incoming)) || (!('title' in previous) && 'title' in incoming));
    if (!newer && !enrich) return false;
    const record = newer ? { ...previous, ...incoming } : { ...incoming, ...previous };
    if (hasApprovalPreview(previous)) (record as ApprovalView).preview = previous.preview;
    const terminal = record.status !== 'pending';
    this.publish({ records: { ...this.state.records, [record.id]: record },
      ...(terminal ? { pendingIds: without(this.state.pendingIds, record.id), uncertainIds: without(this.state.uncertainIds, record.id) } : {}),
    });
    return true;
  }

  /** 终态大预览只保留最近八份；当前选中和全部 pending 不裁剪，轻量版本信息继续保留。 */
  private trimPreviews() {
    const candidates = Object.values(this.state.records).filter((item) => hasApprovalPreview(item) && item.status !== 'pending' && item.id !== this.selectedId);
    if (candidates.length <= 8) return;
    const records = { ...this.state.records };
    for (const item of candidates.slice(0, -8)) {
      if (!hasApprovalPreview(item)) continue;
      const { preview: _preview, ...summary } = item;
      records[item.id] = summary;
    }
    this.publish({ records });
  }
  select = (id?: string) => {
    this.selectedId = id;
    if (id) void this.loadDetail(id);
    this.trimPreviews();
  };

  loadDetail = async (id: string) => {
    if (!this.active || this.state.loadingIds.includes(id)) return;
    const generation = this.generation; const controller = this.startRequest();
    this.publish({ loadingIds: [...this.state.loadingIds, id], errors: { ...this.state.errors, [id]: undefined } });
    try {
      const approval = await this.client.getApproval(id, controller.signal);
      if (!this.current(generation, controller)) return;
      this.merge(approval);
      this.publish({ uncertainIds: without(this.state.uncertainIds, id) });
    } catch (error) {
      if (!this.current(generation, controller) || isRequestCancelled(error)) return;
      this.publish({ errors: { ...this.state.errors, [id]: error instanceof ApiError && error.status === 404 ? '审批不存在或已不可读取，不能继续决定' : '详情未同步，请重试核对后再操作' },
        uncertainIds: [...new Set([...this.state.uncertainIds, id])],
        ...(error instanceof ApiError && error.status === 404 ? { pendingIds: without(this.state.pendingIds, id) } : {}),
      });
    } finally {
      this.requests.delete(controller);
      if (this.current(generation, controller)) this.publish({ loadingIds: without(this.state.loadingIds, id) });
      this.trimPreviews();
    }
  };

  canDecide = (id: string, now = Date.now()) => {
    const record = this.state.records[id];
    return this.active && hasApprovalPreview(record) && this.state.pendingIds.includes(id)
      && !this.state.loadingIds.includes(id) && !this.state.submittingIds.includes(id) && !this.state.uncertainIds.includes(id)
      && approvalCanDecide(record, this.state.synchronized, now);
  };
  decide = async (id: string, decision: ApprovalDecision): Promise<boolean> => {
    if (!this.canDecide(id)) return false;
    const generation = this.generation; const controller = this.startRequest();
    this.publish({ submittingIds: [...this.state.submittingIds, id], errors: { ...this.state.errors, [id]: undefined } });
    try {
      const approval = await this.client.decideApproval(id, decision, controller.signal);
      if (!this.current(generation, controller)) return false;
      this.merge(approval);
      this.publish({ history: { ...this.state.history, dirty: true } });
      return true;
    } catch (error) {
      if (!this.current(generation, controller) || isRequestCancelled(error)) return false;
      if (error instanceof ApprovalConflictError) this.merge(error.approval);
      const known = error instanceof ApprovalConflictError || error instanceof ApiError && error.status === 404;
      this.publish({ errors: { ...this.state.errors, [id]: known ? '审批已变化或不存在，请核对当前结果；没有重发决定' : '提交结果未确认，请刷新详情核对；没有自动重试' },
        ...(!known || error instanceof ApiError && error.status === 404 ? { uncertainIds: [...new Set([...this.state.uncertainIds, id])] } : {}),
        ...(error instanceof ApiError && error.status === 404 ? { pendingIds: without(this.state.pendingIds, id) } : {}),
      });
      return false;
    } finally {
      this.requests.delete(controller);
      if (this.current(generation, controller)) this.publish({ submittingIds: without(this.state.submittingIds, id) });
      this.trimPreviews();
    }
  };

  refreshPending = async () => {
    if (!this.active || this.state.refreshing) return;
    const generation = this.generation; const version = this.eventVersion; const controller = this.startRequest();
    this.publish({ refreshing: true, error: undefined });
    try {
      const approvals = await this.client.getPendingApprovals(controller.signal);
      if (!this.current(generation, controller)) return;
      for (const approval of approvals) this.merge(approval);
      // REST 仅作补读；请求途中有新事件时，不用旧集合删除新到达的 pending。
      if (version === this.eventVersion) {
        const pendingIds = approvals.map((item) => item.id).filter((id) => this.state.records[id].status === 'pending');
        const missing = this.state.pendingIds.filter((id) => !pendingIds.includes(id));
        this.publish({ pendingIds });
        for (const id of missing) void this.loadDetail(id);
      }
    } catch (error) {
      if (this.current(generation, controller) && !isRequestCancelled(error)) this.publish({ error: '待审批补读失败；已保留最后观测，请重新同步' });
    } finally {
      this.requests.delete(controller);
      if (this.current(generation, controller)) this.publish({ refreshing: false });
    }
  };

  loadHistory = async (filter: ApprovalFilter, append = false) => {
    if (!this.active) return;
    const same = filterKey(filter) === filterKey(this.state.history.filter);
    if (append && (!same || !this.state.history.hasMore || this.state.history.loading)) return;
    this.historyController?.abort();
    const controller = this.startRequest(); this.historyController = controller;
    const generation = this.generation; const version = ++this.historyVersion; const eventVersion = this.eventVersion;
    const old = same ? this.state.history : initialHistory();
    this.publish({ history: { ...old, filter: { ...filter }, loading: true, error: undefined } });
    try {
      const page = await this.client.listApprovals({ ...filter, limit: 20, ...(append && old.nextCursor ? { cursor: old.nextCursor } : {}) }, controller.signal);
      if (!this.current(generation, controller) || version !== this.historyVersion) return;
      for (const item of page.approvals) this.merge(item);
      const ids = [...new Set([...(append ? old.ids : []), ...page.approvals.map((item) => item.id)])];
      this.publish({ history: { filter: { ...filter }, ids, loaded: true, loading: false, hasMore: page.hasMore, nextCursor: page.nextCursor, dirty: eventVersion !== this.eventVersion } });
    } catch (error) {
      if (this.current(generation, controller) && version === this.historyVersion && !isRequestCancelled(error)) {
        this.publish({ history: { ...this.state.history, loading: false, error: '审批历史读取失败，请重试；没有用空列表替代失败结果' } });
      }
    } finally { this.requests.delete(controller); }
  };
  dispose() { this.setActive(false); this.listeners.clear(); }
}
