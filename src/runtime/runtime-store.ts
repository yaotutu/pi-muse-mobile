import { ApiError, isRequestCancelled } from '../api/errors';
import type { AgentStatus, AgentStatusResponse, RuntimeEvent } from './types';

export type RuntimeClient = {
  subscribeRuntime: (onEvent: (event: RuntimeEvent) => void, signal?: AbortSignal) => Promise<void>;
  getAgentStatus: (threadId: string, runId: string, signal?: AbortSignal) => Promise<AgentStatusResponse>;
};
export type RuntimeConnection = 'paused' | 'connecting' | 'live' | 'reconnecting' | 'authentication-required';
export type RuntimeSnapshot = {
  connection: RuntimeConnection;
  instanceId?: string;
  runs: readonly AgentStatus[];
  unknownThreadIds?: readonly string[];
  error?: string;
};
export type RuntimeStoreOptions = {
  retryDelay?: (attempt: number) => number;
  /** 领域观察者共享本通知连接，不为审批再建立第二条 SSE。 */
  onEvent?: (event: RuntimeEvent) => void;
  onConnection?: (connection: RuntimeConnection) => void;
};
const keyFor = (threadId: string, runId: string) => JSON.stringify([threadId, runId]);
const MAX_REMEMBERED_RUNS = 128;

/** 单个服务器数据域持有一条通知连接；重连只同步状态，绝不重发聊天或停止运行。 */
export class RuntimeStore {
  private state: RuntimeSnapshot = { connection: 'paused', runs: [] };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private attempt = 0;
  private unresolved = new Map<string, { threadId: string; runId: string }>();
  private blockedThreads = new Set<string>();
  private active = false;

  constructor(private readonly client: RuntimeClient, private readonly options: RuntimeStoreOptions = {}) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<RuntimeSnapshot>) {
    this.state = { ...this.state, ...patch };
    if (patch.connection) this.options.onConnection?.(patch.connection);
    for (const listener of this.listeners) listener();
  }
  private current(generation: number, signal: AbortSignal) {
    return this.active && this.generation === generation && !signal.aborted;
  }
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = undefined;
    this.attempt = 0;
    if (active) void this.connect();
    else this.publish({ connection: 'paused' });
  }
  retry = () => {
    if (!this.active) return;
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.attempt = 0;
    void this.connect();
  };

  private async connect() {
    if (!this.active) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ connection: this.state.instanceId ? 'reconnecting' : 'connecting', error: undefined });
    try {
      await this.client.subscribeRuntime((event) => {
        if (!this.current(generation, controller.signal)) return;
        if (event.event === 'ready') {
          this.attempt = 0;
          const previous = [...this.unresolved.values(), ...this.state.runs.filter((run) => run.status === 'running')];
          const missing = previous.filter((run) => !event.data.agentStatuses.some((next) => keyFor(next.threadId, next.runId) === keyFor(run.threadId, run.runId)));
          this.blockedThreads.clear();
          this.unresolved = new Map(missing.map((run) => [keyFor(run.threadId, run.runId), { threadId: run.threadId, runId: run.runId }]));
          this.publish({ instanceId: event.data.instanceId, connection: 'live', runs: [...event.data.agentStatuses], unknownThreadIds: [...new Set(missing.map((run) => run.threadId))], error: undefined });
          // ready 不含历史；消失的运行只能补查终态，不能因缺席就猜成功。
          for (const run of missing) void this.reconcile(run.threadId, run.runId, generation, controller.signal);
        } else {
          if (event.data.instanceId !== this.state.instanceId) throw new ApiError(502, '运行状态实例已变化，请重新同步');
          if (event.event === 'agent_status_updated') this.merge(event.data);
        }
        this.options.onEvent?.(event);
      }, controller.signal);
      if (this.current(generation, controller.signal)) throw new ApiError(0, '状态连接已断开，正在重新同步');
    } catch (error) {
      if (!this.current(generation, controller.signal) || isRequestCancelled(error)) return;
      controller.abort();
      const message = error instanceof Error ? error.message : '状态连接暂时不可用';
      if (error instanceof ApiError && error.status === 401) {
        this.publish({ connection: 'authentication-required', error: message });
        return;
      }
      this.publish({ connection: 'reconnecting', error: message });
      const delay = this.options.retryDelay?.(this.attempt) ?? Math.min(1000 * 2 ** Math.min(this.attempt, 5), 30_000);
      this.attempt++;
      this.timer = setTimeout(() => { if (this.active && this.generation === generation) void this.connect(); }, delay);
    }
  }
  private merge(run: AgentStatus) {
    if (this.blockedThreads.has(run.threadId)) return;
    const identity = keyFor(run.threadId, run.runId);
    const previous = this.state.runs.find((item) => keyFor(item.threadId, item.runId) === identity);
    if (previous && previous.revision >= run.revision) return;
    const runs = this.state.runs.filter((item) => keyFor(item.threadId, item.runId) !== identity);
    runs.push(run);
    // 内存只保留有界的最近观测结果；所有进行中项必须保留，历史仍由服务端负责。
    while (runs.length > MAX_REMEMBERED_RUNS) {
      const index = runs.findIndex((item) => item.status !== 'running');
      if (index < 0) break;
      runs.splice(index, 1);
    }
    this.unresolved.delete(identity);
    this.publish({ runs, unknownThreadIds: [...new Set([...this.unresolved.values()].map((item) => item.threadId))] });
  }
  private async reconcile(threadId: string, runId: string, generation: number, signal: AbortSignal) {
    try {
      const response = await this.client.getAgentStatus(threadId, runId, signal);
      if (!this.current(generation, signal) || response.instanceId !== this.state.instanceId) return;
      if (response.status.threadId !== threadId || response.status.runId !== runId) throw new ApiError(502, '运行查询返回了其他会话或运行');
      if (this.state.runs.some((run) => run.threadId === threadId && run.runId !== runId)) {
        this.unresolved.delete(keyFor(threadId, runId));
        this.publish({ unknownThreadIds: [...new Set([...this.unresolved.values()].map((item) => item.threadId))] });
        return;
      }
      this.merge(response.status);
    } catch (error) {
      if (!this.current(generation, signal)) return;
      if (isRequestCancelled(error)) return;
      if (error instanceof ApiError && error.status === 404) {
        this.unresolved.delete(keyFor(threadId, runId));
        this.publish({ unknownThreadIds: [...new Set([...this.unresolved.values()].map((item) => item.threadId))] });
      } else this.publish({ error: '部分执行结果暂未同步，请重试同步' });
    }
  }
  forgetThread(threadId: string) {
    this.blockedThreads.add(threadId);
    for (const [key, run] of this.unresolved) if (run.threadId === threadId) this.unresolved.delete(key);
    this.publish({ runs: this.state.runs.filter((run) => run.threadId !== threadId), unknownThreadIds: this.state.unknownThreadIds?.filter((id) => id !== threadId) });
    this.retry();
  }
  dispose() {
    this.setActive(false);
    this.listeners.clear();
  }
}

export function threadRuntime(snapshot: RuntimeSnapshot, threadId: string) {
  const runs = snapshot.runs.filter((run) => run.threadId === threadId);
  const active = runs.filter((run) => run.status === 'running');
  const last = runs.at(-1);
  const unresolved = snapshot.unknownThreadIds?.includes(threadId) ?? false;
  const synchronized = snapshot.connection === 'live' && !unresolved;
  const label = unresolved && snapshot.connection === 'live' ? '执行结果待同步' : !synchronized
    ? snapshot.connection === 'authentication-required' ? '需要重新认证'
      : snapshot.connection === 'connecting' ? '正在同步运行状态' : '连接已断开，状态待同步'
    : active.length > 1 ? `${active.length} 项执行中` : active[0]?.label ?? last?.label ?? '就绪';
  const selected = active.length ? active : last ? [last] : [];
  return { runs: selected, running: active.length > 0, synchronized, label };
}
