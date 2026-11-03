import { ApiError, isRequestCancelled } from '../api/errors';
import {
  DREAM_PROMPT_LIMIT,
  MAIN_DREAM_AGENT,
  type DreamClient,
  type DreamOverview,
  type DreamPending,
  type DreamPendingDecision,
  type DreamRunStatus,
  type DreamAgent,
  type DreamAgentDraft,
  type DreamTarget,
} from './types';

export type DreamWriteKind = false | 'global' | 'agent' | 'run' | 'pending';

export type DreamSnapshot = {
  overview?: DreamOverview;
  selectedAgentId: string;
  selectedAgent?: DreamAgent;
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  writing: DreamWriteKind;
  globalDraft: string;
  globalDirty: boolean;
  agentDraft: DreamAgentDraft;
  agentDirty: boolean;
  error?: string;
  notice?: string;
};

const emptyAgentDraft = (): DreamAgentDraft => ({
  enabled: false,
  inheritGlobalPrompt: true,
  prompt: '',
});

const initial = (): DreamSnapshot => ({
  selectedAgentId: MAIN_DREAM_AGENT,
  loaded: false,
  loading: false,
  stale: true,
  writing: false,
  globalDraft: '',
  globalDirty: false,
  agentDraft: emptyAgentDraft(),
  agentDirty: false,
});

const message = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const uncertainWrite = (error: unknown): boolean =>
  isRequestCancelled(error) || !(error instanceof ApiError) ||
  error.status === 0 || error.status === 408 || error.status >= 500;

const agentDraftFrom = (agent: DreamAgent): DreamAgentDraft => ({
  enabled: agent.enabled,
  inheritGlobalPrompt: agent.inheritGlobalPrompt,
  prompt: agent.prompt,
});

const dirtyAgent = (draft: DreamAgentDraft, agent: DreamAgent): boolean =>
  draft.enabled !== agent.enabled ||
  draft.inheritGlobalPrompt !== agent.inheritGlobalPrompt ||
  draft.prompt !== agent.prompt;

const promptLimitError = (scope: '全局' | '智能体') =>
  `${scope} Dream 提示词不能超过 ${DREAM_PROMPT_LIMIT} 字符`;

function runFeedback(status: DreamRunStatus, processed: number, error?: string): { notice?: string; error?: string } {
  if (status === 'completed') {
    return { notice: `Dream 整理完成，本轮处理 ${processed} 条新消息。` };
  }
  const detail = error ? `服务端说明：${error}` : '';
  if (status === 'partial') {
    return { error: `Dream 整理部分完成，部分目标可能已写入，游标未推进。${detail}` };
  }
  if (status === 'failed') {
    return { error: `Dream 整理失败，本轮没有产生写入。${detail}` };
  }
  return { error: 'Dream 整理仍在执行，请刷新核对结果。' };
}

/**
 * Dream 连接内状态。刷新只读一次全局概览，再按当前选择投影智能体；
 * 读取失败保留旧值，不伪造空列表，也不重复请求当前智能体。
 */
export class DreamStore {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private visible = false;
  private disposed = false;
  private readGeneration = 0;
  private readController?: AbortController;
  private writeGeneration = 0;
  private writeController?: AbortController;

  constructor(private readonly client: DreamClient) {}

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<DreamSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private overviewPatch(
    overview: DreamOverview,
    globalDraft = this.state.globalDirty ? this.state.globalDraft : overview.globalPrompt,
  ): Partial<DreamSnapshot> {
    const selected = overview.agents.find((agent) => agent.agentId === this.state.selectedAgentId);
    const agentDraft = this.state.agentDirty && selected ? this.state.agentDraft
      : selected ? agentDraftFrom(selected)
        : emptyAgentDraft();
    return {
      overview,
      selectedAgent: selected,
      globalDraft,
      globalDirty: globalDraft !== overview.globalPrompt,
      agentDraft,
      agentDirty: selected ? dirtyAgent(agentDraft, selected) : false,
    };
  }

  private agentPatch(
    agent: DreamAgent,
    agentDraft = this.state.agentDirty ? this.state.agentDraft : agentDraftFrom(agent),
  ): Partial<DreamSnapshot> {
    return {
      selectedAgent: agent,
      agentDraft,
      agentDirty: dirtyAgent(agentDraft, agent),
    };
  }

  private cancelRead() {
    this.readGeneration++;
    this.readController?.abort();
    this.readController = undefined;
  }

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    const hadWrite = this.state.writing !== false;
    this.active = active;
    if (!active) {
      this.cancelRead();
      this.writeGeneration++;
      this.writeController?.abort();
      this.writeController = undefined;
      this.publish({
        loading: false,
        stale: true,
        writing: false,
        ...(hadWrite
          ? { error: '本地已停止等待 Dream 操作，远端可能仍在执行；回前台后先刷新核对，未确认前不会重发。' }
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
    this.publish({ loading: false, stale: true });
  }

  canWrite() {
    return this.active && this.visible && this.state.loaded &&
      !this.state.loading && !this.state.stale && this.state.writing === false;
  }

  /** 草稿不阻止处理 pending，但必须保存或取消后才能 run，避免误以为未保存提示词已生效。 */
  canRun() {
    const selected = this.state.selectedAgent;
    return this.canWrite() && !!selected &&
      !this.state.globalDirty && !this.state.agentDirty &&
      this.state.overview?.running !== true &&
      selected.lastRun?.status !== 'running';
  }

  selectAgent = (agentId: string): boolean => {
    if (this.disposed || this.state.writing !== false) return false;
    if (agentId === this.state.selectedAgentId) return true;
    const agent = this.state.overview?.agents.find((item) => item.agentId === agentId);
    if (!agent) {
      this.publish({ error: '请从当前 Dream 概览中选择已有智能体；未知智能体不会创建。' });
      return false;
    }
    // 智能体草稿只跟随当前选择；切换即丢弃旧智能体草稿，由 UI 在调用前自行确认。
    this.publish({
      selectedAgentId: agentId,
      selectedAgent: agent,
      agentDraft: agentDraftFrom(agent),
      agentDirty: false,
      error: undefined,
      notice: undefined,
    });
    return true;
  };

  setGlobalPrompt = (value: string) => {
    if (this.state.writing !== false) return;
    if (value.length > DREAM_PROMPT_LIMIT) {
      this.publish({ error: promptLimitError('全局') });
      return;
    }
    this.publish({
      globalDraft: value,
      globalDirty: !!this.state.overview && value !== this.state.overview.globalPrompt,
      error: undefined,
      notice: undefined,
    });
  };

  setAgentDraft = (patch: Partial<DreamAgentDraft>) => {
    if (this.state.writing !== false) return;
    const draft = { ...this.state.agentDraft, ...patch };
    if (draft.prompt.length > DREAM_PROMPT_LIMIT) {
      this.publish({ error: promptLimitError('智能体') });
      return;
    }
    this.publish({
      agentDraft: draft,
      agentDirty: !!this.state.selectedAgent && dirtyAgent(draft, this.state.selectedAgent),
      error: undefined,
      notice: undefined,
    });
  };

  discardGlobal = () => {
    if (!this.canWrite() || !this.state.overview) return;
    this.publish({
      globalDraft: this.state.overview.globalPrompt,
      globalDirty: false,
      error: undefined,
      notice: undefined,
    });
  };

  discardAgent = () => {
    if (!this.canWrite() || !this.state.selectedAgent) return;
    this.publish({
      agentDraft: agentDraftFrom(this.state.selectedAgent),
      agentDirty: false,
      error: undefined,
      notice: undefined,
    });
  };

  refresh = async (options: { preserveFeedback?: boolean } = {}) => {
    if (!this.active || !this.visible || this.state.writing !== false || this.disposed) return;
    this.cancelRead();
    const generation = this.readGeneration;
    const controller = new AbortController();
    this.readController = controller;
    this.publish({
      loading: true,
      stale: true,
      ...(options.preserveFeedback ? {} : { error: undefined, notice: undefined }),
    });
    try {
      const overview = await this.client.getDreamOverview(controller.signal);
      if (generation !== this.readGeneration || controller.signal.aborted || this.disposed) return;
      const patch = this.overviewPatch(overview);
      this.publish({
        ...patch,
        loaded: true,
        stale: false,
        loading: false,
        ...(patch.selectedAgent ? {} : { error: '所选智能体不在最新 Dream 概览中，请重新选择。' }),
      });
    } catch (error) {
      if (generation !== this.readGeneration || controller.signal.aborted || this.disposed || isRequestCancelled(error)) return;
      this.publish({
        stale: true,
        error: message(error, 'Dream 概览读取失败，请刷新重试'),
        loading: false,
      });
    } finally {
      if (generation === this.readGeneration) this.readController = undefined;
    }
  };

  saveGlobalPrompt = async () => {
    if (!this.canWrite() || !this.state.overview || !this.state.globalDirty) return false;
    if (this.state.globalDraft.length > DREAM_PROMPT_LIMIT) {
      this.publish({ error: promptLimitError('全局') });
      return false;
    }
    const submitted = this.state.globalDraft;
    return this.write('global', (signal) => this.client.saveGlobalDreamPrompt(submitted, signal), (overview) => ({
      ...this.overviewPatch(overview, overview.globalPrompt),
      ...(overview.agents.some((agent) => agent.agentId === this.state.selectedAgentId) ? {}
        : { error: '所选智能体不在最新 Dream 概览中，请重新选择。' }),
      notice: '全局 Dream 提示词已保存',
    }), '全局 Dream 提示词保存结果未明，请刷新核对；确认后可再次明确保存。');
  };

  saveAgentSettings = async () => {
    if (!this.canWrite() || !this.state.selectedAgent || !this.state.agentDirty) return false;
    const agentId = this.state.selectedAgentId;
    const submitted = this.state.agentDraft;
    if (submitted.prompt.length > DREAM_PROMPT_LIMIT) {
      this.publish({ error: promptLimitError('智能体') });
      return false;
    }
    return this.write('agent', (signal) => this.client.updateAgentDream(agentId, submitted, signal), (agent) => ({
      ...this.agentPatch(agent, agentDraftFrom(agent)),
      notice: '智能体 Dream 设置已保存',
    }), '智能体 Dream 设置保存结果未明，请刷新核对；确认后可再次明确保存。');
  };

  runNow = async () => {
    if (!this.canRun() || !this.state.selectedAgent) return false;
    const agentId = this.state.selectedAgentId;
    return this.write('run', (signal) => this.client.runAgentDream(agentId, signal), (agent) => {
      const feedback = runFeedback(agent.lastRun?.status ?? 'running', agent.lastRun?.processed ?? 0, agent.lastRun?.error);
      return {
        ...this.agentPatch(agent),
        ...feedback,
      };
    }, 'Dream 请求已中断，远端整理可能仍在执行；请刷新核对，未确认前不会重发。');
  };

  resolvePending = async (id: string, action: 'apply' | 'dismiss', target?: DreamTarget): Promise<boolean> => {
    if (!this.canWrite() || !this.state.selectedAgent) return false;
    const item: DreamPending | undefined = this.state.selectedAgent.pending.find((pending) => pending.id === id);
    if (!item) {
      this.publish({ error: '待决建议不存在；请刷新后只处理服务端仍返回的条目。' });
      return false;
    }
    const agentId = this.state.selectedAgentId;
    const decision: DreamPendingDecision = action === 'apply' ? { action, target } : { action };
    return this.write('pending', (signal) => this.client.resolveAgentDreamPending(agentId, id, decision, signal), (agent) => {
      // 待决项操作与保存配置无关；未保存的智能体草稿必须原样保留。
      return {
        ...this.agentPatch(agent),
        notice: action === 'apply' ? '待决建议已按选定目标写入' : '待决建议已忽略',
      };
    }, '待决建议处理结果未明，请刷新核对；确认后可再次明确操作。');
  };

  private async write<T>(
    kind: Exclude<DreamWriteKind, false>,
    action: (signal: AbortSignal) => Promise<T>,
    apply: (result: T) => Partial<DreamSnapshot>,
    uncertainMessage: string,
  ): Promise<boolean> {
    this.cancelRead();
    const generation = ++this.writeGeneration;
    const controller = new AbortController();
    this.writeController = controller;
    this.publish({ writing: kind, loading: false, error: undefined, notice: undefined });
    let completed = false;
    let feedbackError = false;
    try {
      const result = await action(controller.signal);
      if (generation !== this.writeGeneration || controller.signal.aborted || this.disposed) return false;
      completed = true;
      const patch = apply(result);
      feedbackError = patch.error !== undefined;
      this.publish({ ...patch, stale: true });
    } catch (error) {
      if (generation !== this.writeGeneration || this.disposed) return false;
      const uncertain = uncertainWrite(error);
      const stateChanged = error instanceof ApiError && [401, 404, 409].includes(error.status);
      this.publish({
        stale: uncertain || stateChanged || this.state.stale,
        error: uncertain ? uncertainMessage : message(error, 'Dream 操作失败'),
      });
    } finally {
      if (generation === this.writeGeneration) {
        this.writeController = undefined;
        this.publish({ writing: false });
        if (completed) void this.refresh({ preserveFeedback: true });
      }
    }
    return completed && !feedbackError;
  }

  dispose() {
    this.setActive(false);
    this.disposed = true;
    this.visible = false;
    this.state = initial();
    this.listeners.clear();
  }
}
