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
  ConversationSnapshot,
  DeleteGoalResult,
  DeleteJobResult,
  DeleteSpaceResult,
  Goal,
  GoalStatus,
  GoalsQuery,
  Identity,
  JobAction,
  JobDetail,
  JobItem,
  JobsQuery,
  MemoryItem,
  Monitor,
  SpaceInfo,
  SpaceInstructions,
  SpaceSkill,
  SpaceSkills,
  UpdateGoalInput,
  UpdateJobInput,
  WorkspaceSnapshot,
} from './types';
import {
  type ApiClient,
  type ApprovalDecision,
  type GoalInput,
  type IdentityInput,
  type MonitorAction,
  type Profile,
  type RunInput,
} from './contracts';
import { ApiError, isRequestCancelled, requestCancelled, responseError } from './errors';
import { parseSseFrames } from './sse';
import { parseResetSpace, parseSpaces } from './space-contracts';
import type {
  AgentStatusResponse,
  RuntimeEvent,
} from '../runtime/types';
import {
  parseAgentStatusResponse,
  parseAgentStatusUpdate,
  parseRuntimeReady,
} from '../runtime/contracts';
import { RuntimeSseParser, RuntimeSseParseError, decodeRuntimeFrame } from '../runtime/sse';
import type { ApprovalPage, ApprovalQuery, ApprovalView } from '../approvals/types';
import { ApprovalConflictError, parseApprovalPage, parseApprovalResolution, parseApprovalView, parsePendingApprovals } from '../approvals/contracts';
import type { ActivityQuery } from '../activities/types';
import { parseActivityDetail, parseActivityOverview, parseActivityPage } from '../activities/contracts';
import type { MemoryQuery } from '../memories/types';
import { parseMemoryItem, parseMemoryPage, parseMemoryRemoval } from '../memories/contracts';
import { parseJob, parseJobDetail, parseJobRemoval, parseJobs, parseServerTimeZone } from './job-contracts';

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
  private activeRuns = new Set<{ spaceId: string; runId: string; token?: string }>();

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
      void this.request('/api/conversation/stop', { method: 'POST', body: { spaceId: run.spaceId, runId: run.runId }, tokenOverride: { value: run.token } }).catch(() => {});
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

  async getServerTimeZone(signal?: AbortSignal): Promise<string> {
    return parseServerTimeZone(await this.request('/api/health', { anonymous: true, signal }));
  }

  async listSpaces(signal?: AbortSignal): Promise<SpaceInfo[]> {
    return parseSpaces(await this.request('/api/spaces', { signal }));
  }

  async resetSpace(spaceId: string, options: { clearSchedules?: boolean } = {}, signal?: AbortSignal) {
    return parseResetSpace(await this.request(`/api/spaces/${encodeURIComponent(spaceId)}/reset`, {
      method: 'POST', body: { clearSchedules: options.clearSchedules ?? false }, signal,
    }), spaceId);
  }

  /** 只读活动接口；游标绑定筛选，原样编码传输，绝不解析/拼造游标。 */
  async listActivities(query: ActivityQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    if (query.spaceId !== undefined) params.set('spaceId', query.spaceId);
    if (query.status !== undefined) params.set('status', query.status);
    const suffix = params.toString();
    return parseActivityPage(await this.request(`/api/activities${suffix ? `?${suffix}` : ''}`, { signal }));
  }

  async getActivity(id: string, signal?: AbortSignal) {
    return parseActivityDetail(await this.request(`/api/activities/${encodeURIComponent(id)}`, { signal }), id);
  }

  async getConversation(spaceId: string, signal?: AbortSignal): Promise<ConversationSnapshot> {
    return this.request<ConversationSnapshot>(`/api/conversation?spaceId=${encodeURIComponent(spaceId)}`, { signal });
  }

  // --- 空间配置：响应字段必须存在且类型正确，200 但结构错位报 502（与服务端快照校验一致） ---

  async getSpaceInstructions(spaceId: string, signal?: AbortSignal): Promise<SpaceInstructions> {
    const path = `/api/spaces/${encodeURIComponent(spaceId)}/instructions`;
    const data = await this.request<SpaceInstructions>(path, { signal });
    if (typeof data?.instructions !== 'string') {
      throw new ApiError(502, '服务器没有返回有效空间指令，请确认服务器版本与地址');
    }
    return data;
  }

  async saveSpaceInstructions(spaceId: string, instructions: string, signal?: AbortSignal): Promise<SpaceInstructions> {
    const path = `/api/spaces/${encodeURIComponent(spaceId)}/instructions`;
    const data = await this.request<SpaceInstructions>(path, { method: 'PUT', body: { instructions }, signal });
    if (typeof data?.instructions !== 'string') {
      throw new ApiError(502, '服务器没有返回有效空间指令，请确认服务器版本与地址');
    }
    return data;
  }

  // diagnostics 可缺省；skills 字段必须为条目数组，每条字段类型严格。
  async getSpaceSkills(spaceId: string, signal?: AbortSignal): Promise<SpaceSkills> {
    const path = `/api/spaces/${encodeURIComponent(spaceId)}/skills`;
    const data = await this.request<SpaceSkills>(path, { signal });
    if (!Array.isArray(data?.skills) || data.skills.some((item) => !this.isValidSpaceSkill(item))) {
      throw new ApiError(502, '服务器没有返回有效空间技能列表，请确认服务器版本与地址');
    }
    if (data.diagnostics !== undefined && (!Array.isArray(data.diagnostics) || data.diagnostics.some((item) => typeof item?.path !== 'string' || typeof item?.message !== 'string'))) {
      throw new ApiError(502, '服务器没有返回有效空间技能列表，请确认服务器版本与地址');
    }
    return data;
  }

  async saveSpaceSkills(
    spaceId: string,
    overrides: Record<string, boolean>,
    signal?: AbortSignal,
  ): Promise<SpaceSkills> {
    const path = `/api/spaces/${encodeURIComponent(spaceId)}/skills`;
    const data = await this.request<SpaceSkills>(path, { method: 'PUT', body: { overrides }, signal });
    if (!Array.isArray(data?.skills) || data.skills.some((item) => !this.isValidSpaceSkill(item))) {
      throw new ApiError(502, '服务器没有返回有效空间技能列表，请确认服务器版本与地址');
    }
    if (data.diagnostics !== undefined && (!Array.isArray(data.diagnostics) || data.diagnostics.some((item) => typeof item?.path !== 'string' || typeof item?.message !== 'string'))) {
      throw new ApiError(502, '服务器没有返回有效空间技能列表，请确认服务器版本与地址');
    }
    return data;
  }

  // DELETE 必须无 body；服务端 404/409 语义保留，不做自动重试副作用。
  async deleteSpace(spaceId: string, signal?: AbortSignal): Promise<DeleteSpaceResult> {
    const path = `/api/spaces/${encodeURIComponent(spaceId)}`;
    const data = await this.request<DeleteSpaceResult>(path, { method: 'DELETE', signal });
    const removed = data?.removed;
    if (
      data?.ok !== true ||
      !removed ||
      !Number.isSafeInteger(removed.jobs) || removed.jobs < 0 ||
      !Number.isSafeInteger(removed.monitors) || removed.monitors < 0
    ) {
      throw new ApiError(502, '服务器没有返回有效空间删除结果，请确认服务器版本与地址');
    }
    return data;
  }

  private isValidSpaceSkill(item: unknown): item is SpaceSkill {
    if (!item || typeof item !== 'object') return false;
    const skill = item as SpaceSkill;
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
    const run = { spaceId: input.spaceId, runId: input.runId, token };
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
        // 删除中的空间与普通版本冲突必须保留区别，不能引导重试旧 ID。
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

  async stopRun(spaceId: string, runId: string): Promise<boolean> {
    const data = await this.request<{ stopped: boolean }>(
      '/api/conversation/stop',
      { method: 'POST', body: { spaceId, runId } },
    );
    return data.stopped;
  }

  async getSnapshot(signal?: AbortSignal): Promise<WorkspaceSnapshot> {
    // 审批由 GET /api/events 与 /api/approvals/* 独立同步，不再请求已下线的 /api/actions/pending。
    // 定时任务已迁移至独立 /api/jobs 接口，/api/agent 响应体中不再包含 tasks 字段。
    // monitors、memories 与 goals 亦已迁移至独立接口，快照权威提供 identity。
    const workspace = await this.request<WorkspaceSnapshot>('/api/agent', { signal });
    if (
      !workspace ||
      typeof workspace.identity?.name !== 'string' ||
      typeof workspace.identity?.tone !== 'string'
    ) {
      throw new ApiError(502, '服务器工作区响应格式不正确，请确认服务器版本与地址');
    }
    return workspace;
  }

  // --- 定时任务（/api/jobs） ---

  async listJobs(query?: JobsQuery, signal?: AbortSignal): Promise<JobItem[]> {
    const params = new URLSearchParams();
    if (query?.spaceId) params.set('spaceId', query.spaceId);
    if (query?.sort) params.set('sort', query.sort);
    if (query?.order) params.set('order', query.order);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return parseJobs(await this.request(`/api/jobs${suffix}`, { signal }));
  }

  async getJob(id: string, signal?: AbortSignal): Promise<JobDetail> {
    return parseJobDetail(await this.request(`/api/jobs/${encodeURIComponent(id)}`, { signal }), id);
  }

  async controlJob(id: string, action: JobAction, signal?: AbortSignal): Promise<JobItem> {
    return parseJob(await this.request(`/api/jobs/${encodeURIComponent(id)}/control`, {
      method: 'POST',
      body: { action },
      signal,
    }), id);
  }

  async updateJob(id: string, updates: UpdateJobInput, signal?: AbortSignal): Promise<JobItem> {
    return parseJob(await this.request(`/api/jobs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: updates,
      signal,
    }), id);
  }

  async deleteJob(id: string, signal?: AbortSignal): Promise<DeleteJobResult> {
    return parseJobRemoval(await this.request(`/api/jobs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    }), id);
  }

  async controlMonitor(id: string, action: MonitorAction): Promise<Monitor> {
    return this.request<Monitor>(`/api/monitors/${encodeURIComponent(id)}/control`, {
      method: 'POST',
      body: { action },
    });
  }

  async listApprovals(query: ApprovalQuery = {}, signal?: AbortSignal): Promise<ApprovalPage> {
    const params = new URLSearchParams();
    for (const key of ['limit', 'cursor', 'status', 'spaceId', 'activityId'] as const) {
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

  // --- 长期目标（/api/goals） ---

  async listGoals(query?: GoalsQuery, signal?: AbortSignal): Promise<Goal[]> {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status);
    if (query?.category) params.set('category', query.category);
    if (query?.sort) params.set('sort', query.sort);
    if (query?.order) params.set('order', query.order);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await this.request<{ goals: Goal[] }>(`/api/goals${suffix}`, { signal });
    if (!data || !Array.isArray(data.goals)) {
      throw new ApiError(502, '长期目标列表响应格式不正确');
    }
    return data.goals;
  }

  async getGoal(id: string, signal?: AbortSignal): Promise<Goal> {
    const goal = await this.request<Goal>(`/api/goals/${encodeURIComponent(id)}`, { signal });
    if (!goal || typeof goal.id !== 'string') {
      throw new ApiError(502, '目标详情响应格式不正确');
    }
    return goal;
  }

  async createGoal(input: GoalInput, signal?: AbortSignal): Promise<Goal> {
    return this.request<Goal>('/api/goals', { method: 'POST', body: input, signal });
  }

  async updateGoal(id: string, input: UpdateGoalInput, signal?: AbortSignal): Promise<Goal> {
    return this.request<Goal>(`/api/goals/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      signal,
    });
  }

  async setGoalStatus(id: string, status: GoalStatus, signal?: AbortSignal): Promise<Goal> {
    return this.updateGoal(id, { status }, signal);
  }

  async toggleMilestone(goalId: string, milestoneId: string, signal?: AbortSignal): Promise<Goal> {
    return this.request<Goal>(
      `/api/goals/${encodeURIComponent(goalId)}/milestones/${encodeURIComponent(milestoneId)}/toggle`,
      { method: 'POST', body: {}, signal },
    );
  }

  async removeGoal(id: string, signal?: AbortSignal): Promise<DeleteGoalResult> {
    return this.request<DeleteGoalResult>(`/api/goals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    });
  }

  async saveIdentity(input: IdentityInput): Promise<Identity> {
    return this.request<Identity>('/api/agent/identity', { method: 'POST', body: input });
  }

  /** 搜索参数只原样编码声明字段；省略 q 读取完整列表，不借用 /api/agent。 */
  async listMemories(query: MemoryQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (query.q !== undefined) params.set('q', query.q);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.sort !== undefined) params.set('sort', query.sort);
    if (query.order !== undefined) params.set('order', query.order);
    const suffix = params.toString();
    return parseMemoryPage(await this.request(`/api/memories${suffix ? `?${suffix}` : ''}`, { signal }));
  }

  async getMemory(id: string, signal?: AbortSignal): Promise<MemoryItem> {
    return parseMemoryItem(await this.request(`/api/memories/${encodeURIComponent(id)}`, { signal }), id);
  }

  async addMemory(text: string, source?: string, signal?: AbortSignal): Promise<MemoryItem> {
    return parseMemoryItem(await this.request('/api/memories', {
      method: 'POST',
      body: source !== undefined ? { text, source } : { text },
      signal,
    }));
  }

  async editMemory(id: string, text: string, signal?: AbortSignal): Promise<MemoryItem> {
    return parseMemoryItem(await this.request(`/api/memories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { text },
      signal,
    }), id);
  }

  async forgetMemory(id: string, signal?: AbortSignal): Promise<void> {
    parseMemoryRemoval(await this.request(`/api/memories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    }), id);
  }

  async getProfile(): Promise<Profile> {
    return this.request<Profile>('/api/profile');
  }

  async saveProfile(profile: Profile): Promise<Profile> {
    return this.request<Profile>('/api/profile', { method: 'PUT', body: profile });
  }

  // --- 运行状态（GET /api/agent/status + GET /api/events） ---

  async getAgentStatus(spaceId: string, runId: string, signal?: AbortSignal): Promise<AgentStatusResponse> {
    // 单点查询：spaceId 与 runId 都必填，服务端 400 透传，404 表示运行不存在或已被清理。
    const path = `/api/agent/status?spaceId=${encodeURIComponent(spaceId)}&runId=${encodeURIComponent(runId)}`;
    const raw = await this.request<unknown>(path, { signal });
    const response = parseAgentStatusResponse(raw);
    if (response.status.spaceId !== spaceId || response.status.runId !== runId) throw new ApiError(502, '服务器返回的运行状态归属不正确');
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
          } else if (decoded.event === 'approval_updated') event = { event: 'approval_updated', data: { ...parseApprovalResolution(decoded.data), instanceId: readyInstanceId } };
          else event = { event: 'activity_updated', data: { ...parseActivityOverview(decoded.data), instanceId: readyInstanceId } };
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
