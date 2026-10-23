import { ApiError, isRequestCancelled } from '../api/errors';
import {
  DREAM_PROMPT_LIMIT,
  MAIN_DREAM_SPACE,
  type DreamClient,
  type DreamOverview,
  type DreamPending,
  type DreamPendingDecision,
  type DreamRunStatus,
  type DreamSpace,
  type DreamSpaceDraft,
  type DreamTarget,
} from './types';

export type DreamWriteKind = false | 'global' | 'space' | 'run' | 'pending';

export type DreamSnapshot = {
  overview?: DreamOverview;
  selectedSpaceId: string;
  selectedSpace?: DreamSpace;
  loaded: boolean;
  loading: boolean;
  stale: boolean;
  writing: DreamWriteKind;
  globalDraft: string;
  globalDirty: boolean;
  spaceDraft: DreamSpaceDraft;
  spaceDirty: boolean;
  error?: string;
  notice?: string;
};

const emptySpaceDraft = (): DreamSpaceDraft => ({
  enabled: false,
  inheritGlobalPrompt: true,
  prompt: '',
});

const initial = (): DreamSnapshot => ({
  selectedSpaceId: MAIN_DREAM_SPACE,
  loaded: false,
  loading: false,
  stale: true,
  writing: false,
  globalDraft: '',
  globalDirty: false,
  spaceDraft: emptySpaceDraft(),
  spaceDirty: false,
});

const message = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const uncertainWrite = (error: unknown): boolean =>
  isRequestCancelled(error) || !(error instanceof ApiError) ||
  error.status === 0 || error.status === 408 || error.status >= 500;

const spaceDraftFrom = (space: DreamSpace): DreamSpaceDraft => ({
  enabled: space.enabled,
  inheritGlobalPrompt: space.inheritGlobalPrompt,
  prompt: space.prompt,
});

const dirtySpace = (draft: DreamSpaceDraft, space: DreamSpace): boolean =>
  draft.enabled !== space.enabled ||
  draft.inheritGlobalPrompt !== space.inheritGlobalPrompt ||
  draft.prompt !== space.prompt;

const promptLimitError = (scope: '全局' | '空间') =>
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
 * Dream 连接内状态。刷新只读一次全局概览，再按当前选择投影空间；
 * 读取失败保留旧值，不伪造空列表，也不重复请求当前空间。
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
    const selected = overview.spaces.find((space) => space.spaceId === this.state.selectedSpaceId);
    const spaceDraft = this.state.spaceDirty && selected ? this.state.spaceDraft
      : selected ? spaceDraftFrom(selected)
        : emptySpaceDraft();
    return {
      overview,
      selectedSpace: selected,
      globalDraft,
      globalDirty: globalDraft !== overview.globalPrompt,
      spaceDraft,
      spaceDirty: selected ? dirtySpace(spaceDraft, selected) : false,
    };
  }

  private spacePatch(
    space: DreamSpace,
    spaceDraft = this.state.spaceDirty ? this.state.spaceDraft : spaceDraftFrom(space),
  ): Partial<DreamSnapshot> {
    return {
      selectedSpace: space,
      spaceDraft,
      spaceDirty: dirtySpace(spaceDraft, space),
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
    const selected = this.state.selectedSpace;
    return this.canWrite() && !!selected &&
      !this.state.globalDirty && !this.state.spaceDirty &&
      this.state.overview?.running !== true &&
      selected.lastRun?.status !== 'running';
  }

  selectSpace = (spaceId: string): boolean => {
    if (this.disposed || this.state.writing !== false) return false;
    if (spaceId === this.state.selectedSpaceId) return true;
    const space = this.state.overview?.spaces.find((item) => item.spaceId === spaceId);
    if (!space) {
      this.publish({ error: '请从当前 Dream 概览中选择已有空间；未知空间不会创建。' });
      return false;
    }
    // 空间草稿只跟随当前选择；切换即丢弃旧空间草稿，由 UI 在调用前自行确认。
    this.publish({
      selectedSpaceId: spaceId,
      selectedSpace: space,
      spaceDraft: spaceDraftFrom(space),
      spaceDirty: false,
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

  setSpaceDraft = (patch: Partial<DreamSpaceDraft>) => {
    if (this.state.writing !== false) return;
    const draft = { ...this.state.spaceDraft, ...patch };
    if (draft.prompt.length > DREAM_PROMPT_LIMIT) {
      this.publish({ error: promptLimitError('空间') });
      return;
    }
    this.publish({
      spaceDraft: draft,
      spaceDirty: !!this.state.selectedSpace && dirtySpace(draft, this.state.selectedSpace),
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

  discardSpace = () => {
    if (!this.canWrite() || !this.state.selectedSpace) return;
    this.publish({
      spaceDraft: spaceDraftFrom(this.state.selectedSpace),
      spaceDirty: false,
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
        ...(patch.selectedSpace ? {} : { error: '所选空间不在最新 Dream 概览中，请重新选择。' }),
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
      ...(overview.spaces.some((space) => space.spaceId === this.state.selectedSpaceId) ? {}
        : { error: '所选空间不在最新 Dream 概览中，请重新选择。' }),
      notice: '全局 Dream 提示词已保存',
    }), '全局 Dream 提示词保存结果未明，请刷新核对；确认后可再次明确保存。');
  };

  saveSpaceSettings = async () => {
    if (!this.canWrite() || !this.state.selectedSpace || !this.state.spaceDirty) return false;
    const spaceId = this.state.selectedSpaceId;
    const submitted = this.state.spaceDraft;
    if (submitted.prompt.length > DREAM_PROMPT_LIMIT) {
      this.publish({ error: promptLimitError('空间') });
      return false;
    }
    return this.write('space', (signal) => this.client.updateSpaceDream(spaceId, submitted, signal), (space) => ({
      ...this.spacePatch(space, spaceDraftFrom(space)),
      notice: '空间 Dream 设置已保存',
    }), '空间 Dream 设置保存结果未明，请刷新核对；确认后可再次明确保存。');
  };

  runNow = async () => {
    if (!this.canRun() || !this.state.selectedSpace) return false;
    const spaceId = this.state.selectedSpaceId;
    return this.write('run', (signal) => this.client.runSpaceDream(spaceId, signal), (space) => {
      const feedback = runFeedback(space.lastRun?.status ?? 'running', space.lastRun?.processed ?? 0, space.lastRun?.error);
      return {
        ...this.spacePatch(space),
        ...feedback,
      };
    }, 'Dream 请求已中断，远端整理可能仍在执行；请刷新核对，未确认前不会重发。');
  };

  resolvePending = async (id: string, action: 'apply' | 'dismiss', target?: DreamTarget): Promise<boolean> => {
    if (!this.canWrite() || !this.state.selectedSpace) return false;
    const item: DreamPending | undefined = this.state.selectedSpace.pending.find((pending) => pending.id === id);
    if (!item) {
      this.publish({ error: '待决建议不存在；请刷新后只处理服务端仍返回的条目。' });
      return false;
    }
    const spaceId = this.state.selectedSpaceId;
    const decision: DreamPendingDecision = action === 'apply' ? { action, target } : { action };
    return this.write('pending', (signal) => this.client.resolveSpaceDreamPending(spaceId, id, decision, signal), (space) => {
      // 待决项操作与保存配置无关；未保存的空间草稿必须原样保留。
      return {
        ...this.spacePatch(space),
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
