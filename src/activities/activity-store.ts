import { ApiError, isRequestCancelled } from '../api/errors';
import type { RuntimeEvent } from '../runtime/types';
import type { RuntimeConnection } from '../runtime/runtime-store';
import type { ActivityClient, ActivityDetail, ActivityFilter, ActivityOverview } from './types';
import { isActiveActivity } from './types';

export type ActivitySnapshot = {
  filter: ActivityFilter;
  activities: readonly ActivityOverview[];
  /** 单一通知流的完整当前集合；与分页历史分开，终态不能在重连时复活。 */
  activeActivities: readonly ActivityOverview[];
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  error?: string;
  selectedId?: string;
  detail?: ActivityDetail;
  detailLoading: boolean;
  detailStale: boolean;
  detailError?: string;
  missing: boolean;
};
const sameFilter = (a: ActivityFilter, b: ActivityFilter) => a.spaceId === b.spaceId && a.status === b.status;
const empty = (): ActivitySnapshot => ({ filter: {}, activities: [], activeActivities: [], loaded: false, loading: false, stale: true, hasMore: false, nextCursor: null, detailLoading: false, detailStale: true, missing: false });

/**
 * 连接内存中的单个可见历史视图。只保留当前列表和一份详情，不做全量运行历史缓存。
 * 状态推送直接替换概览；步骤和过程进展仍按需读，活动没有可用于排序的 revision。
 * 打开、前台恢复、聊天结束和手动刷新均重新读取；不新增 SSE 或周期轮询。
 */
export class ActivityStore {
  private state = empty();
  private listeners = new Set<() => void>();
  private active = false;
  private visible = false;
  private listController?: AbortController;
  private detailController?: AbortController;
  private listGeneration = 0;
  private detailGeneration = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private listDirty = false;
  private detailDirty = false;
  private projectionGeneration = 0;
  constructor(private readonly client: ActivityClient, private readonly debounceMs = 250) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ActivitySnapshot>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private cancel() {
    clearTimeout(this.timer); this.timer = undefined;
    this.listGeneration++; this.detailGeneration++;
    this.listController?.abort(); this.detailController?.abort();
    this.listController = undefined; this.detailController = undefined;
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (!active) { this.cancel(); this.publish({ loading: false, detailLoading: false, stale: true, detailStale: true }); }
    else if (this.visible) this.refresh();
  }
  open(filter: ActivityFilter = {}) {
    this.visible = true;
    const unchanged = sameFilter(this.state.filter, filter);
    this.setFilter(filter);
    if (unchanged) this.refresh();
  }
  close() {
    this.visible = false; this.cancel(); this.listDirty = false; this.detailDirty = false;
    // 关闭即释放详情正文；不持久化或跨连接保留服务端安全投影。
    this.publish({ selectedId: undefined, detail: undefined, detailError: undefined, missing: false, loading: false, detailLoading: false, stale: true, detailStale: true });
  }
  setFilter(filter: ActivityFilter) {
    if (sameFilter(this.state.filter, filter)) return;
    this.cancel(); this.listDirty = false; this.detailDirty = false;
    this.state = { ...empty(), activeActivities: this.state.activeActivities, filter: { ...filter } };
    this.publish({});
    if (this.active && this.visible) void this.loadList();
  }
  select(id?: string) {
    this.detailGeneration++; this.detailController?.abort(); this.detailController = undefined; this.detailDirty = false;
    this.publish({ selectedId: id, detail: undefined, detailLoading: false, detailStale: true, detailError: undefined, missing: false });
    if (id && this.active && this.visible) void this.loadDetail();
  }
  refresh = () => {
    if (!this.active || !this.visible) return;
    this.listDirty = false; this.detailDirty = false;
    void this.loadList();
    if (this.state.selectedId) void this.loadDetail();
  };
  refreshDetail = () => { if (this.active && this.visible && this.state.selectedId) { this.detailDirty = false; void this.loadDetail(); } };
  loadMore = () => {
    if (!this.active || !this.visible || this.state.loading || this.state.stale || !this.state.hasMore || !this.state.nextCursor) return;
    void this.loadList(true);
  };
  /** 聊天结束也从这里失效，不把 RUN_FINISHED 翻译成活动 completed。 */
  invalidate = (spaceId?: string) => {
    const relevantList = !spaceId || !this.state.filter.spaceId || this.state.filter.spaceId === spaceId;
    const relevantDetail = !!this.state.selectedId && (!spaceId || !this.state.detail || this.state.detail.activity.spaceId === spaceId);
    if (!relevantList && !relevantDetail) return;
    this.listDirty ||= relevantList; this.detailDirty ||= relevantDetail;
    this.publish({ ...(relevantList ? { stale: true } : {}), ...(relevantDetail ? { detailStale: true } : {}) });
    this.schedule();
  };
  receive = (event: RuntimeEvent) => {
    if (!this.active) return;
    if (event.event === 'ready') {
      this.projectionGeneration++;
      this.publish({ activeActivities: [...event.data.activities] });
      this.invalidate();
    } else if (event.event === 'activity_updated') {
      this.projectionGeneration++;
      const { instanceId: _instanceId, ...activity } = event.data;
      const current = this.state.activeActivities.filter((item) => item.id !== activity.id);
      if (isActiveActivity(activity)) current.push(activity);
      const matches = (!this.state.filter.spaceId || this.state.filter.spaceId === activity.spaceId)
        && (!this.state.filter.status || this.state.filter.status === activity.status);
      // 概览即时替换，不按时间或运行 revision 伪造活动版本。未知项/分页成员及步骤由查询核对。
      this.publish({ activeActivities: current,
        activities: this.state.activities.flatMap((item) => item.id !== activity.id ? [item] : matches ? [activity] : []),
        ...(this.state.detail?.activity.id === activity.id ? { detail: { ...this.state.detail, activity } } : {}),
      });
      this.invalidate(activity.spaceId);
    } else if (event.event !== 'conversation_updated') {
      // 运行与审批变化仍可能带来活动事实；conversation_updated 只失效聊天历史。
      this.invalidate(event.data.spaceId ?? undefined);
    }
  };
  setConnection = (connection: RuntimeConnection) => {
    if (connection !== 'live') this.publish({ stale: true, detailStale: true });
  };
  private schedule() {
    if (!this.active || !this.visible || this.timer) return;
    // 单次合并通知风暴；在途读完成后再补读一次，避免重叠响应回退投影。
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.listDirty && !this.state.loading) { this.listDirty = false; void this.loadList(); }
      if (this.detailDirty && !this.state.detailLoading && this.state.selectedId) { this.detailDirty = false; void this.loadDetail(); }
    }, this.debounceMs);
  }
  private async loadList(append = false) {
    const generation = ++this.listGeneration;
    const projectionGeneration = this.projectionGeneration;
    this.listController?.abort(); const controller = new AbortController(); this.listController = controller;
    const filter = { ...this.state.filter }; const cursor = append ? this.state.nextCursor : null;
    this.publish({ loading: true, error: undefined });
    try {
      const page = await this.client.listActivities({ ...filter, limit: 20, ...(cursor ? { cursor } : {}) }, controller.signal);
      if (generation !== this.listGeneration || controller.signal.aborted) return;
      // 无活动 revision 时，只以接收代次隔离在途旧 HTTP；旧响应不能短暂抹掉已显示的新推送。
      if (projectionGeneration !== this.projectionGeneration) { this.listDirty = true; return; }
      if (page.activities.some((item) => filter.spaceId && item.spaceId !== filter.spaceId || filter.status && item.status !== filter.status)) throw new ApiError(502, '活动列表与请求范围不符，请刷新核对');
      if (page.hasMore && page.nextCursor === cursor) throw new ApiError(502, '活动分页游标没有前进，请刷新列表');
      // 分页不冻结；追加页可包含已读项，按 ID 去重并保留服务端顺序。
      const merged = new Map((append ? this.state.activities : []).map((item) => [item.id, item]));
      for (const item of page.activities) merged.set(item.id, item);
      this.publish({ activities: [...merged.values()], loaded: true, stale: this.listDirty, hasMore: page.hasMore, nextCursor: page.nextCursor });
    } catch (error) {
      if (generation !== this.listGeneration || controller.signal.aborted || isRequestCancelled(error)) return;
      if (projectionGeneration !== this.projectionGeneration) { this.listDirty = true; return; }
      this.publish({ error: error instanceof Error ? error.message : '活动读取失败，请重试', stale: true });
    } finally {
      if (generation === this.listGeneration) { this.listController = undefined; this.publish({ loading: false }); if (this.listDirty) this.schedule(); }
    }
  }
  private async loadDetail() {
    const id = this.state.selectedId; if (!id) return;
    const generation = ++this.detailGeneration;
    const projectionGeneration = this.projectionGeneration;
    this.detailController?.abort(); const controller = new AbortController(); this.detailController = controller;
    this.publish({ detailLoading: true, detailError: undefined, missing: false });
    try {
      const detail = await this.client.getActivity(id, controller.signal);
      if (generation !== this.detailGeneration || controller.signal.aborted) return;
      if (projectionGeneration !== this.projectionGeneration) { this.detailDirty = true; return; }
      if (detail.activity.id !== id) throw new ApiError(502, '活动详情与请求不符，请刷新核对');
      this.publish({ detail, detailStale: this.detailDirty });
    } catch (error) {
      if (generation !== this.detailGeneration || controller.signal.aborted || isRequestCancelled(error)) return;
      // 迟到的 404 也不能清掉新推送；与成功响应一样，必须先核对接收代次。
      if (projectionGeneration !== this.projectionGeneration) { this.detailDirty = true; return; }
      const missing = error instanceof ApiError && error.status === 404;
      this.publish({ ...(missing ? { detail: undefined } : {}), missing, detailStale: true, detailError: missing ? '活动不存在或来源会话已删除' : error instanceof Error ? error.message : '活动详情读取失败，请重试' });
    } finally {
      if (generation === this.detailGeneration) { this.detailController = undefined; this.publish({ detailLoading: false }); if (this.detailDirty) this.schedule(); }
    }
  }
  forgetSpace(spaceId: string) {
    if (this.state.detail?.activity.spaceId === spaceId || this.state.filter.spaceId === spaceId) this.select();
    this.publish({ activities: this.state.activities.filter((item) => item.spaceId !== spaceId), activeActivities: this.state.activeActivities.filter((item) => item.spaceId !== spaceId) });
    this.invalidate(spaceId);
  }
  dispose() { this.active = false; this.close(); this.state = empty(); this.listeners.clear(); }
}
