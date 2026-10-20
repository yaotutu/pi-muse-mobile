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
import { ApiError, isRequestCancelled, requestCancelled, responseError } from './errors';
import { parseSseFrames } from './sse';
import type {
  AgentStatus,
  AgentStatusResponse,
  RuntimeEvent,
  RunPhase,
  SubagentPhase,
} from '../runtime/types';
import { RuntimeSseParser, RuntimeSseParseError, decodeRuntimeFrame } from '../runtime/sse';
import type { ApprovalPage, ApprovalQuery, ApprovalView } from '../approvals/types';
import { ApprovalConflictError, parseApprovalPage, parseApprovalResolution, parseApprovalView, parsePendingApprovals } from '../approvals/contracts';
import type { ActivityQuery } from '../activities/types';
import { parseActivityDetail, parseActivityPage } from '../activities/contracts';

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
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { /* 非JSON错误正文不替代HTTP状态。 */ }
        throw responseError(response.status, payload);
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

  /** 只读活动接口；游标绑定筛选，原样编码传输，绝不解析/拼造游标。 */
  async listActivities(query: ActivityQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    if (query.threadId !== undefined) params.set('threadId', query.threadId);
    if (query.status !== undefined) params.set('status', query.status);
    const suffix = params.toString();
    return parseActivityPage(await this.request(`/api/activities${suffix ? `?${suffix}` : ''}`, { signal }));
  }

  async getActivity(id: string, signal?: AbortSignal) {
    return parseActivityDetail(await this.request(`/api/activities/${encodeURIComponent(id)}`, { signal }), id);
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
    const removed = data?.removed;
    if (
      data?.ok !== true ||
      !removed ||
      !Number.isSafeInteger(removed.jobs) || removed.jobs < 0 ||
      !Number.isSafeInteger(removed.monitors) || removed.monitors < 0
    ) {
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
        // 删除中的会话与普通版本冲突必须保留区别，不能引导重试旧 ID。
        const payload = await response.json().catch(() => undefined);
        control.assertActive();
        const fallback = response.status === 409 ? '会话状态已更新或仍在运行，请重新加载后重试' : undefined;
        throw responseError(response.status, payload, fallback);
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

  async listApprovals(query: ApprovalQuery = {}, signal?: AbortSignal): Promise<ApprovalPage> {
    const params = new URLSearchParams();
    for (const key of ['limit', 'cursor', 'status', 'threadId', 'activityId'] as const) {
      const value = query[key];
      if (value !== undefined) params.set(key, String(value));
    }
    const suffix = params.toString();
    return parseApprovalPage(await this.request<unknown>(`/api/approvals${suffix ? `?${suffix}` : ''}`, { signal }));
  }

  async getPendingApprovals(signal?: AbortSignal): Promise<ApprovalView[]> {
    return parsePendingApprovals(await this.request<unknown>('/api/approvals/pending', { signal }));
  }

  async getApproval(id: string, signal?: AbortSignal): Promise<ApprovalView> {
    const approval = parseApprovalView(await this.request<unknown>(`/api/approvals/${encodeURIComponent(id)}`, { signal }));
    if (approval.id !== id) throw new ApiError(502, '服务器返回了其他审批的详情');
    return approval;
  }

  async decideApproval(id: string, decision: ApprovalDecision, signal?: AbortSignal): Promise<ApprovalView> {
    try {
      const approval = parseApprovalView(await this.request<unknown>(`/api/approvals/${encodeURIComponent(id)}/decision`, {
        method: 'POST', body: { decision }, signal,
      }));
      if (approval.id !== id) throw new ApiError(502, '服务器返回了其他审批的决定结果');
      if (approval.status !== (decision === 'approve' ? 'approved' : 'denied')) throw new ApiError(502, '审批决定响应与本次操作不一致，请重新核对');
      return approval;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const payload = error.payload as { approval?: unknown } | undefined;
        const approval = parseApprovalView(payload?.approval);
        if (approval.id !== id) throw new ApiError(502, '审批冲突响应的归属不正确');
        throw new ApprovalConflictError(approval);
      }
      throw error;
    }
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

  // --- 运行状态（GET /api/agent/status + GET /api/events） ---

  async getAgentStatus(threadId: string, runId: string, signal?: AbortSignal): Promise<AgentStatusResponse> {
    // 单点查询：threadId 与 runId 都必填，服务端 400 透传，404 表示运行不存在或已被清理。
    const path = `/api/agent/status?threadId=${encodeURIComponent(threadId)}&runId=${encodeURIComponent(runId)}`;
    const raw = await this.request<unknown>(path, { signal });
    const response = parseAgentStatusResponse(raw);
    if (response.status.threadId !== threadId || response.status.runId !== runId) throw new ApiError(502, '服务器返回的运行状态归属不正确');
    return response;
  }

  /**
   * 工作区实时状态推送流。
   *
   * 协议要点：
   * - 握手用 headerTimeoutMs；握手成功（HTTP 200）后无限时长，不再按整轮时长超时；
   * - 401 触发 onUnauthorized + ApiError；503/429 直接抛 ApiError，由 store 退避；
   * - 流自然结束（EOF）视为需要重连，调用方按服务端约定退避后重新订阅；
   * - signal 触发即取消本地读取，绝不调用 stopRun 或影响 activeRuns；
   * - 首帧必须是 ready 且恰一次；instanceId 与 ready 不一致视为非法帧。
   * - 用户回调异常按原样向上抛，绝不包成网络错误。
   */
  async subscribeRuntime(
    onEvent: (event: RuntimeEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.retired || this.paused) throw requestCancelled();
    const token = this.getToken();
    const control = this.control(this.options.headerTimeoutMs ?? this.options.timeoutMs ?? 15_000, signal);
    let callbackFailed = false;
    try {
      control.assertActive();
      const response = await expoFetch(`${this.baseUrl}/api/events`, {
        method: 'GET',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          accept: 'text/event-stream',
        },
        signal: control.controller.signal,
        redirect: 'error',
      });
      control.assertActive();
      if (response.status === 401) {
        if (!this.retired && control.generation === this.generation) this.onUnauthorized(token);
        throw new ApiError(401, '当前凭证未被服务器接受，请重新认证');
      }
      if (response.status === 503 || response.status === 429) {
        const payload = await response.json().catch(() => undefined);
        throw responseError(response.status, payload);
      }
      if (!response.ok) {
        const text = await response.text();
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { /* 非 JSON 错误正文不替代 HTTP 状态。 */ }
        throw responseError(response.status, payload);
      }
      if (!response.body) throw new ApiError(502, '订阅连接未返回数据流');
      control.stopTimeout();
      this.notify(control, { kind: 'online', token });
      await this.consumeRuntimeStream(response.body.getReader(), onEvent, () => { callbackFailed = true; }, control);
    } catch (error) {
      // 回调异常按原样抛，不被 failure() 包成网络错误；外部 signal 取消视为本地正常结束；
      // 其它错误照常包装给 store 退避。
      if (callbackFailed) throw error;
      if (signal?.aborted) return;
      throw this.failure(error, control, token);
    } finally {
      control.finish();
    }
  }

  private async consumeRuntimeStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onEvent: (event: RuntimeEvent) => void,
    markCallbackFailed: () => void,
    control: RequestControl,
  ): Promise<void> {
    const parser = new RuntimeSseParser();
    const decoder = new TextDecoder();
    let buffer = '';
    let readyReceived = false;
    let readyInstanceId: string | undefined;
    // 外部或内部 abort 必须能立即打断阻塞中的 reader.read()；不能等下一个 assertActive。
    const onAbort = () => { reader.cancel().catch(() => {}); };
    control.controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
      for (;;) {
        control.assertActive();
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = parser.push(buffer);
        buffer = '';
        for (const frame of frames) {
          const decoded = decodeRuntimeFrame(frame);
          if (!decoded) continue;
          if (decoded.event === 'ready') {
            // ready 必须恰一次；重复到达按服务端约定视为非法帧。
            if (readyReceived) throw new ApiError(502, '运行状态推送出现重复 ready 首帧');
            const parsed = parseRuntimeReady(decoded.data);
            readyReceived = true;
            readyInstanceId = parsed.instanceId;
            try { onEvent({ event: 'ready', data: parsed }); } catch (error) { markCallbackFailed(); throw error; }
            continue;
          }
          if (!readyReceived || !readyInstanceId) {
            // 首帧必须是 ready；没有 ready 就先收到状态帧，视为非法帧。
            throw new ApiError(502, '运行状态推送缺少 ready 首帧');
          }
          if (decoded.data.instanceId !== readyInstanceId) throw new ApiError(502, '推送事件与 ready 的 instanceId 不一致');
          let event: RuntimeEvent;
          if (decoded.event === 'agent_status_updated') event = { event: decoded.event, data: parseAgentStatusUpdate(decoded.data, readyInstanceId) };
          else if (decoded.event === 'approval_pending') {
            const approval = parseApprovalView(decoded.data);
            if (approval.status !== 'pending') throw new ApiError(502, '待审批事件不是 pending 状态');
            event = { event: decoded.event, data: { ...approval, instanceId: readyInstanceId } };
          } else event = { event: 'approval_updated', data: { ...parseApprovalResolution(decoded.data), instanceId: readyInstanceId } };
          try { onEvent(event); } catch (error) { markCallbackFailed(); throw error; }
        }
      }
      parser.end();
    } catch (error) {
      // 帧级解析错误按 502 报告，避免被外层 failure() 包成网络断开。
      if (error instanceof RuntimeSseParseError) {
        throw new ApiError(502, error.message);
      }
      throw error;
    } finally {
      control.controller.signal.removeEventListener('abort', onAbort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

// ---------------------------------------------------------------------------
// 运行状态结构校验：字段类型或枚举错位一律抛 502；坏协议不静默漏状态，也不替上层臆造字段。
// ---------------------------------------------------------------------------

const RUN_STATUSES = new Set(['running', 'succeeded', 'failed', 'cancelled']);
const RUN_PHASES = new Set([
  'preparing',
  'waiting_model',
  'responding',
  'executing_tool',
  'waiting_subagents',
  'waiting_approval',
  'finalizing',
]);
const SUBAGENT_PHASES = new Set([
  'preparing',
  'waiting_model',
  'responding',
  'executing_tool',
  'waiting_approval',
  'finalizing',
]);
const TOOL_STATUSES = new Set(['running', 'waiting_approval']);
const SUBAGENT_STATUSES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const RUN_SOURCES = new Set(['chat', 'job']);

function ensureString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ApiError(502, `运行状态字段 ${field} 不是字符串`);
  return value;
}

function ensureText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ApiError(502, `运行状态字段 ${field} 不是文本`);
  return value;
}

function ensureOptionalString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) throw new ApiError(502, `运行状态字段 ${field} 不是字符串或 null`);
  return value;
}

function ensureRevision(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new ApiError(502, `运行状态字段 ${field} 不是正安全整数`);
  return value as number;
}

function ensureEnum<T extends string>(value: unknown, allowed: Set<string>, field: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) throw new ApiError(502, `运行状态字段 ${field} 不是允许的枚举值`);
  return value as T;
}

function ensurePhase<T extends RunPhase | SubagentPhase>(value: unknown, allowed: Set<string>, field: string): T {
  if (value === null) return null as T;
  if (typeof value !== 'string' || !allowed.has(value)) throw new ApiError(502, `运行状态字段 ${field} 不是允许的阶段值或 null`);
  return value as T;
}

function ensureStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new ApiError(502, `运行状态字段 ${field} 不是字符串数组`);
  for (const entry of value) if (typeof entry !== 'string' || entry.length === 0) throw new ApiError(502, `运行状态字段 ${field} 包含非字符串元素`);
  return value as string[];
}

function ensureToolState(value: unknown): AgentStatus['tools'][number] {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态 tools 项不是对象');
  const entry = value as Record<string, unknown>;
  return {
    toolCallId: ensureString(entry.toolCallId, 'tools[].toolCallId'),
    name: entry.name === null ? null : ensureString(entry.name, 'tools[].name'),
    label: ensureText(entry.label, 'tools[].label'),
    status: ensureEnum<AgentStatus['tools'][number]['status']>(entry.status, TOOL_STATUSES, 'tools[].status'),
    subagentId: entry.subagentId === null ? null : ensureString(entry.subagentId, 'tools[].subagentId'),
  };
}

function ensureSubagentState(value: unknown): AgentStatus['subagents'][number] {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态 subagents 项不是对象');
  const entry = value as Record<string, unknown>;
  return {
    id: ensureString(entry.id, 'subagents[].id'),
    role: ensureString(entry.role, 'subagents[].role'),
    status: ensureEnum<AgentStatus['subagents'][number]['status']>(entry.status, SUBAGENT_STATUSES, 'subagents[].status'),
    phase: ensurePhase<SubagentPhase>(entry.phase, SUBAGENT_PHASES, 'subagents[].phase'),
    label: ensureText(entry.label, 'subagents[].label'),
    startedAt: ensureOptionalString(entry.startedAt, 'subagents[].startedAt'),
    updatedAt: ensureString(entry.updatedAt, 'subagents[].updatedAt'),
    endedAt: ensureOptionalString(entry.endedAt, 'subagents[].endedAt'),
  };
}

function ensureAgentStatus(value: unknown): AgentStatus {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态 status 不是对象');
  const entry = value as Record<string, unknown>;
  if (!Array.isArray(entry.tools) || entry.tools.length > 64) throw new ApiError(502, '运行状态 tools 不是长度 ≤64 的数组');
  if (!Array.isArray(entry.subagents) || entry.subagents.length > 64) throw new ApiError(502, '运行状态 subagents 不是长度 ≤64 的数组');
  return {
    activityId: entry.activityId === null ? null : ensureString(entry.activityId, 'status.activityId'),
    threadId: ensureString(entry.threadId, 'status.threadId'),
    runId: ensureString(entry.runId, 'status.runId'),
    revision: ensureRevision(entry.revision, 'status.revision'),
    source: ensureEnum<AgentStatus['source']>(entry.source, RUN_SOURCES, 'status.source'),
    jobId: entry.jobId === null ? null : ensureString(entry.jobId, 'status.jobId'),
    title: ensureText(entry.title, 'status.title'),
    status: ensureEnum<AgentStatus['status']>(entry.status, RUN_STATUSES, 'status.status'),
    phase: ensurePhase<RunPhase>(entry.phase, RUN_PHASES, 'status.phase'),
    label: ensureText(entry.label, 'status.label'),
    tools: entry.tools.map(ensureToolState),
    subagents: entry.subagents.map(ensureSubagentState),
    pendingApprovalIds: ensureStringArray(entry.pendingApprovalIds, 'status.pendingApprovalIds'),
    startedAt: ensureString(entry.startedAt, 'status.startedAt'),
    updatedAt: ensureString(entry.updatedAt, 'status.updatedAt'),
    endedAt: ensureOptionalString(entry.endedAt, 'status.endedAt'),
  };
}

function parseAgentStatusResponse(value: unknown): AgentStatusResponse {
  if (!value || typeof value !== 'object') throw new ApiError(502, '运行状态响应不是对象');
  const entry = value as Record<string, unknown>;
  const instanceId = ensureString(entry.instanceId, 'instanceId');
  return { instanceId, status: ensureAgentStatus(entry.status) };
}

function parseRuntimeReady(value: unknown): Extract<RuntimeEvent, { event: 'ready' }>['data'] {
  if (!value || typeof value !== 'object') throw new ApiError(502, 'ready 事件 data 不是对象');
  const entry = value as Record<string, unknown>;
  const instanceId = ensureString(entry.instanceId, 'ready.data.instanceId');
  const serverTime = ensureString(entry.serverTime, 'ready.data.serverTime');
  if (!Array.isArray(entry.agentStatuses)) throw new ApiError(502, 'ready.data.agentStatuses 不是数组');
  return {
    instanceId,
    serverTime,
    agentStatuses: entry.agentStatuses.map(ensureAgentStatus),
    pendingApprovals: parsePendingApprovals({ approvals: entry.pendingApprovals }),
  };
}

function parseAgentStatusUpdate(value: unknown, expectedInstanceId: string): AgentStatus & { instanceId: string } {
  if (!value || typeof value !== 'object') throw new ApiError(502, 'agent_status_updated data 不是对象');
  const entry = value as Record<string, unknown>;
  const instanceId = ensureString(entry.instanceId, 'agent_status_updated.data.instanceId');
  if (instanceId !== expectedInstanceId) {
    throw new ApiError(502, 'agent_status_updated 与 ready 的 instanceId 不一致，按服务端约定视为非法帧');
  }
  const status = ensureAgentStatus(entry);
  return { ...status, instanceId };
}
