/**
 * 真实 HTTP 客户端：expo/fetch（原生流式支持）+ Bearer token + SSE 分帧消费。
 *
 * 协议要点（对齐 openapi 与已验证的 web 端实现）：
 * - 统一错误形状 {error}；401 由构造方注入的 onUnauthorized 处理
 *   （清 token 回登录门）；
 * - run 只发送新用户消息与历史版本，服务端负责历史一致性及冲突检测；
 * - SSE 用 parseSseFrames 按 \n\n 分帧（翻译自 pi-muse web/src/lib/api.ts），
 *   非 JSON 帧忽略，协议错误由 RUN_ERROR 事件表达。
 */

import { fetch as expoFetch } from 'expo/fetch';
import type {
  AgentTask,
  ApprovalNotification,
  ConversationSnapshot,
  DeleteThreadResult,
  Goal,
  GoalStatus,
  Identity,
  MemoryItem,
  Monitor,
  TaskDetails,
  ThreadInfo,
  ThreadInstructions,
  ThreadSkill,
  ThreadSkills,
  WorkspaceSnapshot,
  WorkspaceData,
} from './types';
import {
  type ApiClient,
  type ApprovalDecision,
  type GoalInput,
  type IdentityInput,
  type MonitorAction,
  type Profile,
  type RunInput,
  type TaskAction,
  type TaskControlTarget,
} from './contracts';
import { ApiError, isRequestCancelled, requestCancelled } from './errors';
import { parseSseFrames } from './sse';

export type TransportState = { kind: 'online' | 'offline'; token?: string; error?: string };
export type HttpApiOptions = { onTransportState?: (state: TransportState) => void; timeoutMs?: number; headerTimeoutMs?: number };
type RequestControl = {
  controller: AbortController;
  generation: number;
  timedOut: () => boolean;
  stopTimeout: () => void;
  finish: () => void;
  assertActive: () => void;
};

export class HttpApiClient implements ApiClient {
  private generation = 0;
  private retired = false;
  private paused = false;
  private pending = new Set<AbortController>();
  private activeRuns = new Set<{ threadId: string; runId: string; token?: string }>();

  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | undefined,
    private readonly onUnauthorized: (token?: string) => void,
    private readonly options: HttpApiOptions = {},
  ) {}

  private control(timeoutMs: number, external?: AbortSignal): RequestControl {
    const controller = new AbortController();
    const generation = this.generation;
    let timeout = false;
    const abort = () => controller.abort();
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) controller.abort();
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) { timeout = true; controller.abort(); }
    }, timeoutMs);
    this.pending.add(controller);
    return {
      controller, generation,
      timedOut: () => timeout,
      stopTimeout: () => clearTimeout(timer),
      finish: () => { clearTimeout(timer); external?.removeEventListener('abort', abort); this.pending.delete(controller); },
      assertActive: () => {
        if (timeout) throw new ApiError(408, '请求超时，操作结果可能已生效，请刷新核对后再操作');
        if (controller.signal.aborted || generation !== this.generation) throw requestCancelled();
      },
    };
  }

  private notify(control: RequestControl, state: TransportState) {
    if (!this.retired && control.generation === this.generation) this.options.onTransportState?.(state);
  }

  private failure(error: unknown, control: RequestControl, token?: string): Error {
    if (!control.timedOut() && (control.controller.signal.aborted || isRequestCancelled(error))) return requestCancelled();
    const result = control.timedOut()
      ? new ApiError(408, '请求超时，操作结果可能已生效，请刷新核对后再操作')
      : error instanceof SyntaxError ? new ApiError(502, '服务器响应格式不正确，请确认服务器地址')
        : error instanceof ApiError ? error
          : new ApiError(0, '无法连接服务器，请检查地址、网络或重定向设置后重试');
    if (!(result instanceof ApiError) || result.status === 0 || result.status === 408 || result.status >= 500) {
      this.notify(control, { kind: 'offline', token, error: result.message });
    }
    return result;
  }

  /** 取消只是中断本地消费，远端停止始终以原URL及精确runId尽力通知。 */
  cancelPending() {
    const runs = [...this.activeRuns];
    this.generation++;
    for (const controller of this.pending) controller.abort();
    for (const run of runs) {
      void this.request('/api/conversation/stop', { method: 'POST', body: { threadId: run.threadId, runId: run.runId }, tokenOverride: { value: run.token } }).catch(() => {});
    }
  }

  suspend() {
    this.paused = true;
    this.cancelPending();
  }

  resume() {
    if (!this.retired) this.paused = false;
  }

  retire() {
    this.retired = true;
    this.cancelPending();
  }

  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown; anonymous?: boolean; tokenOverride?: { value?: string }; signal?: AbortSignal },
  ): Promise<T> {
    if ((this.retired || this.paused) && path !== '/api/conversation/stop') throw requestCancelled();
    const token = init?.anonymous ? undefined : init?.tokenOverride ? init.tokenOverride.value : this.getToken();
    const control = this.control(this.options.timeoutMs ?? 15_000, init?.signal);
    try {
      control.assertActive();
      const response = await expoFetch(`${this.baseUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: control.controller.signal,
        redirect: 'error',
      });
      control.assertActive();
      if (response.status === 401) {
        if (!init?.anonymous && !this.retired && control.generation === this.generation) this.onUnauthorized(token);
        throw new ApiError(401, '当前凭证未被服务器接受，请重新认证');
      }
      if (!response.ok) {
        const text = await response.text();
        control.assertActive();
        let message = `请求失败 (${response.status})`;
        try {
          const data = JSON.parse(text) as { error?: unknown };
          if (typeof data.error === 'string') message = data.error;
        } catch { /* 非JSON错误正文不替代HTTP状态。 */ }
        throw new ApiError(response.status, message);
      }
      const data = await response.json() as T;
      control.assertActive();
      if (!init?.anonymous) this.notify(control, { kind: 'online', token });
      return data;
    } catch (error) {
      throw this.failure(error, control, token);
    } finally {
      control.finish();
    }
  }

  async createSession(accessKey?: string): Promise<{ token: string; mode: string }> {
    const session = await this.request<{ token: string; mode: string }>('/api/session', {
      method: 'POST', body: accessKey ? { accessKey } : {}, anonymous: true,
    });
    if (typeof session?.token !== 'string' || !/^[A-Za-z0-9._~+\/-]+=*$/.test(session.token) || typeof session.mode !== 'string') {
      throw new ApiError(502, '服务器没有返回有效会话，请确认地址是否为 Pi Muse 服务');
    }
    return session;
  }

  async listThreads(signal?: AbortSignal): Promise<ThreadInfo[]> {
    const data = await this.request<{ threads: ThreadInfo[] }>('/api/threads', { signal });
    if (!Array.isArray(data?.threads) || data.threads.some((item) => typeof item?.id !== 'string' || typeof item?.updatedAt !== 'string')) {
      throw new ApiError(502, '服务器没有返回有效会话列表，请确认服务器地址');
    }
    return data.threads;
  }

  async getConversation(threadId: string, signal?: AbortSignal): Promise<ConversationSnapshot> {
    return this.request<ConversationSnapshot>(`/api/conversation?threadId=${encodeURIComponent(threadId)}`, { signal });
  }

  // --- 会话配置：响应字段必须存在且类型正确，200 但结构错位报 502（与服务端快照校验一致） ---

  async getThreadInstructions(threadId: string, signal?: AbortSignal): Promise<ThreadInstructions> {
    const path = `/api/threads/${encodeURIComponent(threadId)}/instructions`;
    const data = await this.request<ThreadInstructions>(path, { signal });
    if (typeof data?.instructions !== 'string') {
      throw new ApiError(502, '服务器没有返回有效会话指令，请确认服务器版本与地址');
    }
    return data;
  }

  async saveThreadInstructions(threadId: string, instructions: string, signal?: AbortSignal): Promise<ThreadInstructions> {
    const path = `/api/threads/${encodeURIComponent(threadId)}/instructions`;
    const data = await this.request<ThreadInstructions>(path, { method: 'PUT', body: { instructions }, signal });
    if (typeof data?.instructions !== 'string') {
      throw new ApiError(502, '服务器没有返回有效会话指令，请确认服务器版本与地址');
    }
    return data;
  }

  // diagnostics 可缺省；skills 字段必须为条目数组，每条字段类型严格。
  async getThreadSkills(threadId: string, signal?: AbortSignal): Promise<ThreadSkills> {
    const path = `/api/threads/${encodeURIComponent(threadId)}/skills`;
    const data = await this.request<ThreadSkills>(path, { signal });
    if (!Array.isArray(data?.skills) || data.skills.some((item) => !this.isValidThreadSkill(item))) {
      throw new ApiError(502, '服务器没有返回有效会话技能列表，请确认服务器版本与地址');
    }
    if (data.diagnostics !== undefined && (!Array.isArray(data.diagnostics) || data.diagnostics.some((item) => typeof item?.path !== 'string' || typeof item?.message !== 'string'))) {
      throw new ApiError(502, '服务器没有返回有效会话技能列表，请确认服务器版本与地址');
    }
    return data;
  }

  async saveThreadSkills(
    threadId: string,
    overrides: Record<string, boolean>,
    signal?: AbortSignal,
  ): Promise<ThreadSkills> {
    const path = `/api/threads/${encodeURIComponent(threadId)}/skills`;
    const data = await this.request<ThreadSkills>(path, { method: 'PUT', body: { overrides }, signal });
    if (!Array.isArray(data?.skills) || data.skills.some((item) => !this.isValidThreadSkill(item))) {
      throw new ApiError(502, '服务器没有返回有效会话技能列表，请确认服务器版本与地址');
    }
    if (data.diagnostics !== undefined && (!Array.isArray(data.diagnostics) || data.diagnostics.some((item) => typeof item?.path !== 'string' || typeof item?.message !== 'string'))) {
      throw new ApiError(502, '服务器没有返回有效会话技能列表，请确认服务器版本与地址');
    }
    return data;
  }

  // DELETE 必须无 body；服务端 404/409 语义保留，不做自动重试副作用。
  async deleteThread(threadId: string, signal?: AbortSignal): Promise<DeleteThreadResult> {
    const path = `/api/threads/${encodeURIComponent(threadId)}`;
    const data = await this.request<DeleteThreadResult>(path, { method: 'DELETE', signal });
    if (data?.ok !== true || !data.removed || typeof data.removed.jobs !== 'number' || typeof data.removed.monitors !== 'number' || typeof data.removed.tasks !== 'number') {
      throw new ApiError(502, '服务器没有返回有效会话删除结果，请确认服务器版本与地址');
    }
    return data;
  }

  private isValidThreadSkill(item: unknown): item is ThreadSkill {
    if (!item || typeof item !== 'object') return false;
    const skill = item as ThreadSkill;
    return typeof skill.name === 'string'
      && typeof skill.description === 'string'
      && typeof skill.defaultEnabled === 'boolean'
      && typeof skill.enabled === 'boolean';
  }

  async runAgent(
    input: RunInput,
    onEvent: (event: import('./types').AgUiEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.retired || this.paused) throw requestCancelled();
    const token = this.getToken();
    const control = this.control(this.options.headerTimeoutMs ?? this.options.timeoutMs ?? 15_000, signal);
    const run = { threadId: input.threadId, runId: input.runId, token };
    this.activeRuns.add(run);
    let callbackFailed = false;
    try {
      control.assertActive();
      const response = await expoFetch(`${this.baseUrl}/api/conversation/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(input), signal: control.controller.signal, redirect: 'error',
      });
      control.assertActive();
      if (response.status === 401) {
        if (!this.retired && control.generation === this.generation) this.onUnauthorized(token);
        throw new ApiError(401, '当前凭证未被服务器接受，请重新认证');
      }
      if (!response.ok) {
        if (response.status === 409) throw new ApiError(409, '会话状态已更新或仍在运行，请重新加载后重试');
        const data = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
        control.assertActive();
        throw new ApiError(response.status, typeof data?.error === 'string' ? data.error : `请求失败 (${response.status})`);
      }
      if (!response.body) throw new ApiError(502, '回复连接未返回数据流');
      // 只限制握手等待，已经建立的模型长流不按整轮时长超时。
      control.stopTimeout();
      this.notify(control, { kind: 'online', token });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminal = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          control.assertActive();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseFrames(buffer);
          buffer = rest;
          for (const event of events) {
            if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') terminal = true;
            try { onEvent(event); } catch (error) { callbackFailed = true; throw error; }
          }
        }
        if (!terminal) throw new ApiError(0, '回复连接意外中断，请重新加载会话后重试');
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (error) {
      if (callbackFailed) throw error;
      throw this.failure(error, control, token);
    } finally {
      this.activeRuns.delete(run);
      control.finish();
    }
  }

  async stopRun(threadId: string, runId: string): Promise<boolean> {
    const data = await this.request<{ stopped: boolean }>(
      '/api/conversation/stop',
      { method: 'POST', body: { threadId, runId } },
    );
    return data.stopped;
  }

  async getSnapshot(signal?: AbortSignal): Promise<WorkspaceSnapshot> {
    // 工作区快照不包含审批正文；两端点属于同一轮刷新，任一失败都不提交半份新状态。
    const [workspace, pending] = await Promise.all([
      this.request<WorkspaceData>('/api/agent', { signal }),
      this.request<{ actions: ApprovalNotification[] }>('/api/actions/pending', { signal }),
    ]);
    if (!workspace || !['tasks', 'goals', 'monitors', 'memories'].every((key) => Array.isArray(workspace[key as keyof WorkspaceData])) || typeof workspace.identity?.name !== 'string' || typeof workspace.identity?.tone !== 'string' || typeof workspace.worker?.running !== 'boolean' || !Array.isArray(pending?.actions)) {
      throw new ApiError(502, '服务器工作区响应格式不正确，请确认服务器版本与地址');
    }
    return { ...workspace, notifications: pending.actions };
  }

  async createTask(prompt: string, title?: string, originThreadId?: string): Promise<AgentTask> {
    // title/originThreadId 仅在显式传值时落入 body：传 'local-main' 也算值，服务端据此回填会话来源。
    const body: { prompt: string; title?: string; originThreadId?: string } = { prompt };
    if (title !== undefined) body.title = title;
    if (originThreadId !== undefined) body.originThreadId = originThreadId;
    return this.request<AgentTask>('/api/agent/tasks', {
      method: 'POST',
      body,
    });
  }

  async getTask(id: string): Promise<TaskDetails> {
    return this.request<TaskDetails>(`/api/agent/tasks/${encodeURIComponent(id)}`);
  }

  async controlTask(id: string, action: TaskAction, target: TaskControlTarget): Promise<AgentTask> {
    return this.request<AgentTask>(`/api/agent/tasks/${encodeURIComponent(id)}/control`, {
      method: 'POST',
      body: { action, target },
    });
  }

  async controlMonitor(id: string, action: MonitorAction): Promise<Monitor> {
    return this.request<Monitor>(`/api/agent/monitors/${encodeURIComponent(id)}/control`, {
      method: 'POST',
      body: { action },
    });
  }

  async decideAction(id: string, decision: ApprovalDecision): Promise<ApprovalNotification> {
    return this.request<ApprovalNotification>(`/api/actions/${encodeURIComponent(id)}/decide`, {
      method: 'POST',
      body: { decision },
    });
  }

  async createGoal(input: GoalInput): Promise<Goal> {
    return this.request<Goal>('/api/agent/goals', { method: 'POST', body: input });
  }

  async updateGoal(id: string, input: Partial<Omit<GoalInput, 'milestones'>>): Promise<Goal> {
    return this.request<Goal>(`/api/agent/goals/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: input,
    });
  }

  async setGoalStatus(id: string, status: GoalStatus): Promise<Goal> {
    return this.request<Goal>(`/api/agent/goals/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: { status },
    });
  }

  async toggleMilestone(goalId: string, milestoneId: string): Promise<Goal> {
    return this.request<Goal>(
      `/api/agent/goals/${encodeURIComponent(goalId)}/milestones/${encodeURIComponent(milestoneId)}/toggle`,
      { method: 'POST', body: {} },
    );
  }

  async removeGoal(id: string): Promise<void> {
    await this.request<{ ok: boolean }>(`/api/agent/goals/${encodeURIComponent(id)}/remove`, {
      method: 'POST',
      body: {},
    });
  }

  async saveIdentity(input: IdentityInput): Promise<Identity> {
    return this.request<Identity>('/api/agent/identity', { method: 'POST', body: input });
  }

  async addMemory(text: string, source?: string): Promise<MemoryItem> {
    return this.request<MemoryItem>('/api/agent/memories', {
      method: 'POST',
      body: source ? { text, source } : { text },
    });
  }

  async editMemory(id: string, text: string): Promise<MemoryItem> {
    return this.request<MemoryItem>(`/api/agent/memories/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: { text },
    });
  }

  async forgetMemory(id: string): Promise<void> {
    await this.request<{ ok: boolean }>(`/api/agent/memories/${encodeURIComponent(id)}/forget`, {
      method: 'POST',
      body: {},
    });
  }

  async getProfile(): Promise<Profile> {
    return this.request<Profile>('/api/profile');
  }

  async saveProfile(profile: Profile): Promise<Profile> {
    return this.request<Profile>('/api/profile', { method: 'PUT', body: profile });
  }
}
