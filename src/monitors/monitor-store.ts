import type { ApiClient, MonitorAction } from '../api/contracts';
import { ApiError, isRequestCancelled } from '../api/errors';
import type { Monitor, MonitorCondition, MonitorStatus, MonitorsQuery } from '../api/types';

export type MonitorClient = Pick<
  ApiClient,
  'listMonitors' | 'getMonitor' | 'controlMonitor' | 'deleteMonitor'
>;

export type MonitorSnapshot = {
  query: MonitorsQuery;
  monitors: readonly Monitor[];
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  deleteTarget?: { id: string; title: string };
  writing: boolean;
  uncertain: boolean;
  reviewed: boolean;
  error?: string;
  notice?: string;
};

const initial = (): MonitorSnapshot => ({
  query: { sort: 'createdAt', order: 'desc' },
  monitors: [],
  loaded: false,
  loading: false,
  stale: true,
  writing: false,
  uncertain: false,
  reviewed: false,
});

export function monitorStatusLabel(status: MonitorStatus): string {
  switch (status) {
    case 'active':
      return '监控中';
    case 'paused':
      return '已暂停';
    case 'stopped':
      return '已停止';
  }
}

export function monitorStatusTone(status: MonitorStatus): 'accent' | 'warning' | 'neutral' {
  switch (status) {
    case 'active':
      return 'accent';
    case 'paused':
      return 'warning';
    case 'stopped':
      return 'neutral';
  }
}

export function monitorConditionLabel(condition: MonitorCondition, value?: string): string {
  if (condition === 'contains') {
    return value ? `关键词：“${value}”` : '包含关键词';
  }
  return '内容变化';
}

export function availableMonitorActions(monitor: Monitor): MonitorAction[] {
  switch (monitor.status) {
    case 'active':
      return ['pause', 'stop'];
    case 'paused':
      return ['resume', 'stop'];
    case 'stopped':
      return [];
  }
}

export function monitorActionLabel(action: MonitorAction): string {
  switch (action) {
    case 'pause':
      return '暂停';
    case 'resume':
      return '恢复';
    case 'stop':
      return '停止';
  }
}

/**
 * 网页监控（/api/monitors）独立连接内状态机。
 * 没有专门的 Monitors SSE；仅在页面打开/回到前台/成功写入后/用户手动刷新时主动回读。
 * 离开页面时取消在途只读请求。
 * 写入若发生中断或超时判定为结果未明并锁定操作，必须刷新回读并由人工确认解锁。
 */
export class MonitorStore {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private visible = false;
  private disposed = false;
  private readGeneration = 0;
  private writeGeneration = 0;
  private readController?: AbortController;
  private writeController?: AbortController;

  constructor(private readonly client: MonitorClient) {}

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<MonitorSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private cancelRead() {
    this.readGeneration++;
    this.readController?.abort();
    this.readController = undefined;
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    const hadWrite = this.state.writing;
    this.active = active;
    if (!active) {
      this.cancelRead();
      this.writeGeneration++;
      this.writeController?.abort();
      this.writeController = undefined;
      this.publish({
        loading: false,
        stale: true,
        deleteTarget: undefined,
        writing: false,
        ...(hadWrite
          ? {
              uncertain: true,
              reviewed: false,
              error: '提交结果未明，请刷新网页监控列表核对；不会自动重试。',
            }
          : {}),
      });
    } else if (this.visible) {
      void this.refresh();
    }
  }

  open() {
    if (this.disposed) return;
    this.visible = true;
    void this.refresh();
  }

  close() {
    this.visible = false;
    this.cancelRead();
    this.publish({ loading: false, stale: true, deleteTarget: undefined });
  }

  canWrite() {
    return (
      this.active &&
      this.visible &&
      this.state.loaded &&
      !this.state.loading &&
      !this.state.stale &&
      !this.state.writing &&
      !this.state.uncertain
    );
  }

  setQuery = (query: MonitorsQuery) => {
    if (this.state.writing || this.state.uncertain) return;
    this.cancelRead();
    this.publish({
      query,
      monitors: [],
      loaded: false,
      stale: true,
      deleteTarget: undefined,
      error: undefined,
      notice: undefined,
    });
    void this.refresh();
  };

  invalidate = () => {
    this.publish({ stale: true, deleteTarget: undefined, reviewed: false });
    if (this.visible && !this.state.writing) void this.refresh();
  };

  refresh = async () => {
    if (!this.active || !this.visible || this.state.writing || this.disposed) return;
    this.cancelRead();
    const generation = this.readGeneration;
    const controller = new AbortController();
    this.readController = controller;
    this.publish({ loading: true, deleteTarget: undefined, error: undefined });
    try {
      const monitors = await this.client.listMonitors(this.state.query, controller.signal);
      if (generation !== this.readGeneration || controller.signal.aborted || this.disposed) return;
      this.publish({
        monitors,
        loaded: true,
        stale: false,
        reviewed: this.state.uncertain,
      });
    } catch (error) {
      if (generation !== this.readGeneration || controller.signal.aborted || isRequestCancelled(error)) return;
      this.publish({
        stale: true,
        error: error instanceof Error ? error.message : '网页监控读取失败，请重试',
      });
    } finally {
      if (generation === this.readGeneration) {
        this.readController = undefined;
        this.publish({ loading: false });
      }
    }
  };

  control = async (id: string, action: MonitorAction) => {
    if (!this.canWrite()) return false;
    const monitor = this.state.monitors.find((m) => m.id === id);
    if (!monitor) return false;
    if (!availableMonitorActions(monitor).includes(action)) return false;
    return this.write(
      (signal) => this.client.controlMonitor(id, action, signal),
      `监控已${monitorActionLabel(action)}`,
    );
  };

  requestDelete = (id: string) => {
    if (!this.canWrite()) return;
    const monitor = this.state.monitors.find((m) => m.id === id);
    if (monitor) {
      this.publish({
        deleteTarget: { id: monitor.id, title: monitor.title },
        error: undefined,
        notice: undefined,
      });
    }
  };

  cancelDelete = () => {
    if (!this.state.writing) {
      this.publish({ deleteTarget: undefined });
    }
  };

  confirmDelete = async () => {
    const target = this.state.deleteTarget;
    if (!target || !this.canWrite()) return false;
    return this.write(
      (signal) => this.client.deleteMonitor(target.id, signal),
      '网页监控已删除',
    );
  };

  private async write(action: (signal: AbortSignal) => Promise<unknown>, notice: string) {
    this.cancelRead();
    const generation = ++this.writeGeneration;
    const controller = new AbortController();
    this.writeController = controller;
    this.publish({ writing: true, error: undefined, notice: undefined });
    let success = false;
    try {
      await action(controller.signal);
      if (generation !== this.writeGeneration || controller.signal.aborted || this.disposed) return false;
      success = true;
      this.publish({ deleteTarget: undefined, stale: true, notice });
    } catch (error) {
      if (generation !== this.writeGeneration || this.disposed) return false;
      const uncertain =
        isRequestCancelled(error) ||
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status === 408 ||
        error.status >= 500;
      this.publish({
        uncertain,
        reviewed: false,
        deleteTarget: undefined,
        stale: true,
        error: uncertain
          ? '提交结果未明，请刷新网页监控列表核对；不会自动重试。'
          : error instanceof Error ? error.message : '网页监控操作失败',
      });
    } finally {
      if (generation === this.writeGeneration) {
        this.writeController = undefined;
        this.publish({ writing: false });
        if (success) void this.refresh();
      }
    }
    return success;
  }

  acknowledgeReviewed = () => {
    if (
      this.active &&
      this.visible &&
      this.state.uncertain &&
      this.state.reviewed &&
      !this.state.loading &&
      !this.state.stale
    ) {
      this.publish({
        uncertain: false,
        reviewed: false,
        error: undefined,
        notice: '已解除操作锁定。请确认未重复操作。',
      });
    }
  };

  dispose() {
    this.setActive(false);
    this.disposed = true;
    this.visible = false;
    this.state = initial();
    this.listeners.clear();
  }
}
