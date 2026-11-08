import type { ApiClient } from '../api/contracts';
import { ApiError, isRequestCancelled } from '../api/errors';
import type { DeleteSessionResult, ResetSessionResult, SessionSkills } from '../api/types';
import { validateAttachmentDrafts } from '../attachments/validation';
import type { AttachmentDraft, AttachmentDraftUpdateResult } from '../attachments/types';
import { MAIN_SESSION_ID } from './types';

export const INSTRUCTIONS_LIMIT = 20_000;

/** A01: 客户端未确认提交条目（内存持有，随会话与 epoch 隔离，连接销毁即释放，不持久化正文）。 */
export type PendingSubmission = {
  messageId: string;
  runId: string;
  text: string;
  epoch: number;
  status: 'sending' | 'failed' | 'unconfirmed';
  error?: string;
  /** 流内已收到且流已终止的终态 RUN_ERROR 证据（内存）：卸载/切回后首次完整历史对账仍可判未发送。 */
  terminalError?: string;
  /** 权威历史确认前的完整原始附件；重试/恢复必须原样复用，不能只保留元数据。 */
  attachments?: AttachmentDraft[];
};

type Field<T> = {
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  saved: T;
  draft: T;
  error?: string;
};
export type SessionState = {
  epoch: number;
  /** 仅作聊天上下文失效边界；HTTP 始终以会话 ID 寻址。 */
  piSessionId: string | null;
  deleted: boolean;
  deleting: boolean;
  resetting: boolean;
  resetUncertain: boolean;
  resetReviewed: boolean;
  deleteUncertain: boolean;
  draft: string;
  /** 本会话输入框当前附件；离线与系统选择器短暂失焦时保留。 */
  draftAttachments: AttachmentDraft[];
  /** A01: 单会话单epoch独占一条未确认提交，收到权威历史包含原user ID前始终保留 */
  pendingSubmission: PendingSubmission | null;
  instructions: Field<string>;
  skills: Field<Record<string, boolean>> & { catalog: SessionSkills['skills']; diagnostics: NonNullable<SessionSkills['diagnostics']>; notice?: string };
};
type ReadKind = 'instructions' | 'skills';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const field = <T,>(value: T): Field<T> => ({ loaded: false, loading: false, saving: false, saved: value, draft: value });
const effective = (data: SessionSkills) => Object.fromEntries(data.skills.map((skill) => [skill.name, skill.enabled]));
export const equalSwitches = (a: Record<string, boolean>, b: Record<string, boolean>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((name) => a[name] === b[name]);

/** 每个连接工作区独占内存；不持久化正文、凭据或服务端路径。 */
export class ChatSessionStore {
  private sessions = new Map<string, SessionState>();
  private reads = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private version = 0;
  private lifecycleVersion = 0;
  private enabled = true;
  private disposed = false;

  constructor(private readonly api: ApiClient) {}
  /** 重置未明只回读历史绑定，不重发 reset；读取失败继续锁住旧上下文。 */
  async verifyReset(id: string) {
    if (!this.get(id).resetUncertain || this.disposed) return;
    const history = await this.api.getConversation(id);
    if (!this.disposed) { this.bindSession(id, history.piSessionId); if (this.get(id).resetUncertain) { this.get(id).resetReviewed = true; this.changed(); } }
  }
  acknowledgeReset(id: string) {
    const entry = this.get(id);
    if (!this.disposed && entry.resetUncertain && entry.resetReviewed) { entry.resetUncertain = false; entry.resetReviewed = false; this.changed(); }
  }
  acknowledgeDeletion(id: string) { if (!this.disposed) { this.get(id).deleteUncertain = false; this.changed(); } }
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  private available(id: string) { return this.enabled && !this.disposed && this.canWrite(id); }
  /** dispose 后的工作区整体失效：阻止已销毁 Hook 发起新发送或回写正文。 */
  isDisposed() { return this.disposed; }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;
  getLifecycleVersion = () => this.lifecycleVersion;
  private changed() { this.version++; for (const listener of this.listeners) listener(); }
  get(id: string): SessionState {
    let entry = this.sessions.get(id);
    if (!entry) {
      entry = { epoch: 0, piSessionId: null, deleted: false, deleting: false, resetting: false, resetUncertain: false, resetReviewed: false, deleteUncertain: false, draft: '', draftAttachments: [], pendingSubmission: null, instructions: field(''), skills: { ...field<Record<string, boolean>>({}), catalog: [], diagnostics: [] } };
      this.sessions.set(id, entry);
    }
    return entry;
  }
  isCurrent(id: string, epoch: number) {
    const entry = this.get(id);
    return entry.epoch === epoch && this.canWrite(id);
  }
  canWrite(id: string) { const entry = this.get(id); return !this.disposed && !entry.deleted && !entry.deleting && !entry.resetting && !entry.resetUncertain && !entry.deleteUncertain; }
  hasSettingsWrite(id: string) { const entry = this.get(id); return entry.instructions.saving || entry.skills.saving; }
  hasDirtySettings(id: string) { const entry = this.get(id); return entry.instructions.draft !== entry.instructions.saved || !equalSwitches(entry.skills.draft, entry.skills.saved); }
  setDraft(id: string, value: string) { if (this.canWrite(id)) { this.get(id).draft = value; this.changed(); } }
  /** 附件草稿允许在连接短暂 enabled=false 时写入；仍拒绝 dispose、删除、重置与旧 epoch。 */
  private canHoldDraftAttachments(id: string, epoch: number) {
    const entry = this.get(id);
    return !this.disposed && entry.epoch === epoch && !entry.deleted && !entry.deleting &&
      !entry.resetting && !entry.resetUncertain;
  }
  setDraftAttachments(id: string, epoch: number, attachments: AttachmentDraft[]): AttachmentDraftUpdateResult {
    if (!this.canHoldDraftAttachments(id, epoch)) return { ok: false, error: '会话已重置或不可写，附件草稿已失效' };
    const validated = validateAttachmentDrafts(attachments);
    if (!validated.ok) return validated;
    this.get(id).draftAttachments = validated.attachments;
    this.changed();
    return { ok: true };
  }
  appendDraftAttachments(id: string, epoch: number, attachments: AttachmentDraft[]): AttachmentDraftUpdateResult {
    if (!this.canHoldDraftAttachments(id, epoch)) return { ok: false, error: '会话已重置或不可写，附件草稿已失效' };
    const incoming = validateAttachmentDrafts(attachments);
    if (!incoming.ok) return incoming;
    const combined = [...this.get(id).draftAttachments, ...incoming.attachments];
    const validated = validateAttachmentDrafts(combined);
    if (!validated.ok) return validated;
    this.get(id).draftAttachments = validated.attachments;
    this.changed();
    return { ok: true };
  }
  removeDraftAttachment(id: string, epoch: number, attachmentId: string): boolean {
    if (!this.canHoldDraftAttachments(id, epoch)) return false;
    const entry = this.get(id);
    if (!entry.draftAttachments.some((attachment) => attachment.id === attachmentId)) return false;
    entry.draftAttachments = entry.draftAttachments.filter((attachment) => attachment.id !== attachmentId);
    this.changed();
    return true;
  }
  clearDraftAttachments(id: string, epoch: number): boolean {
    if (!this.canHoldDraftAttachments(id, epoch)) return false;
    const entry = this.get(id);
    if (entry.draftAttachments.length === 0) return false;
    entry.draftAttachments = [];
    this.changed();
    return true;
  }
  setPendingSubmission(id: string, epoch: number, submission: PendingSubmission) {
    const entry = this.get(id);
    if (!this.disposed && entry.epoch === epoch && this.canWrite(id)) {
      entry.pendingSubmission = submission;
      this.changed();
    }
  }
  /** 绑定 messageId + epoch 的状态更新：迟到响应不能改写下一轮（或 dispose 后）的暂存条目。 */
  updatePendingSubmissionStatus(
    id: string,
    epoch: number,
    messageId: string,
    update: { status: PendingSubmission['status']; error?: string; terminalError?: string },
  ) {
    const entry = this.get(id);
    if (!this.disposed && entry.epoch === epoch && entry.pendingSubmission?.messageId === messageId) {
      entry.pendingSubmission = {
        ...entry.pendingSubmission,
        status: update.status,
        error: update.error ?? entry.pendingSubmission.error,
        terminalError: update.terminalError ?? entry.pendingSubmission.terminalError,
      };
      this.changed();
    }
  }
  /** 释放暂存；传 messageId 时仅当与当前条目一致才清除，避免迟到确认清掉新一轮提交。 */
  clearPendingSubmission(id: string, epoch?: number, messageId?: string) {
    const entry = this.get(id);
    if (epoch === undefined || entry.epoch === epoch) {
      if (entry.pendingSubmission && (messageId === undefined || entry.pendingSubmission.messageId === messageId)) {
        entry.pendingSubmission = null;
        this.changed();
      }
    }
  }
  /** 仅恢复终态 failed 的未发送正文与原始附件；草稿已有任何输入或附件都不覆盖。 */
  restorePendingSubmissionToDraft(id: string): boolean {
    const entry = this.get(id);
    if (this.disposed || !this.canWrite(id)) return false;
    if (entry.draft.length > 0 || entry.draftAttachments.length > 0) return false;
    const pending = entry.pendingSubmission;
    if (!pending || pending.status !== 'failed') return false;
    entry.draft = pending.text;
    entry.draftAttachments = [...(pending.attachments ?? [])];
    entry.pendingSubmission = null;
    this.changed();
    return true;
  }
  /** 显式手动重试才允许复用原 message/run ID；同时清空旧失败证据，避免下一轮误判。 */
  retryPendingSubmission(id: string, epoch: number, messageId: string): boolean {
    const entry = this.get(id);
    const pending = entry.pendingSubmission;
    if (this.disposed || entry.epoch !== epoch || pending?.messageId !== messageId || pending.status !== 'failed') return false;
    entry.pendingSubmission = { ...pending, status: 'sending', error: undefined, terminalError: undefined };
    this.changed();
    return true;
  }
  /** 用户显式丢弃失败提交：只释放暂存正文，不覆盖仍归输入框所有的当前草稿。 */
  discardFailedSubmission(id: string, epoch: number, messageId: string): boolean {
    const entry = this.get(id);
    const pending = entry.pendingSubmission;
    if (this.disposed || !this.canWrite(id) || entry.epoch !== epoch ||
      pending?.messageId !== messageId || pending.epoch !== epoch || pending.status !== 'failed') return false;
    entry.pendingSubmission = null;
    this.changed();
    return true;
  }
  setInstructions(id: string, value: string) { if (this.canWrite(id) && !this.get(id).instructions.saving) { this.get(id).instructions.draft = value; this.changed(); } }
  setSkill(id: string, name: string, enabled: boolean) {
    const entry = this.get(id);
    if (this.canWrite(id) && !entry.skills.saving && entry.skills.catalog.some((skill) => skill.name === name)) {
      entry.skills.draft = { ...entry.skills.draft, [name]: enabled };
      this.changed();
    }
  }
  discardSettings(id: string, kind: ReadKind) {
    if (!this.canWrite(id) || this.hasSettingsWrite(id)) return;
    const entry = this.get(id);
    if (kind === 'instructions') entry.instructions.draft = entry.instructions.saved;
    else { entry.skills.draft = { ...entry.skills.saved }; entry.skills.notice = undefined; }
    this.changed();
  }

  /** 列表观察到另一设备重置时，只失效聊天，不能销毁会话规则与未保存的设置草稿。 */
  bindSession(id: string, piSessionId: string | null) {
    const entry = this.get(id);
    if (entry.deleted || entry.resetting || entry.piSessionId === piSessionId) return;
    if (entry.piSessionId !== null || entry.resetUncertain) {
      entry.epoch++;
      entry.draft = '';
      entry.draftAttachments = [];
      entry.pendingSubmission = null;
      this.cancelReads(id);
    }
    entry.piSessionId = piSessionId;
    entry.resetUncertain = false;
    this.changed();
  }

  async resetSession(id: string, clearSchedules = false): Promise<ResetSessionResult | undefined> {
    const entry = this.get(id);
    if (!this.available(id) || this.hasSettingsWrite(id)) return undefined;
    // 先切本地代次再请求：旧 SSE、历史回读和迟到 finally 都不能写入新上下文。
    // 请求被拒绝或结果未明时必须保留正文、附件与暂存，只在成功或权威绑定变化后清理。
    entry.resetting = true; entry.resetReviewed = false;
    entry.epoch++;
    if (entry.pendingSubmission) {
      entry.pendingSubmission = { ...entry.pendingSubmission, epoch: entry.epoch,
        status: entry.pendingSubmission.status === 'sending' ? 'unconfirmed' : entry.pendingSubmission.status };
    }
    this.lifecycleVersion++;
    this.cancelReads(id);
    this.changed();
    try {
      const result = await this.api.resetSession(id, { clearSchedules });
      if (this.get(id) !== entry) return undefined;
      // reset 响应不泄漏底层绑定；下一次完整历史读取建立新绑定。
      entry.piSessionId = null;
      entry.draft = '';
      entry.draftAttachments = [];
      entry.pendingSubmission = null;
      entry.resetUncertain = false;
      return result;
    } catch (error) {
      // 网络中断不代表远端未重置，禁止自动重发这种破坏性操作；由列表新绑定核对。
      entry.resetUncertain = !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
      throw error;
    } finally {
      entry.resetting = false;
      this.changed();
    }
  }

  cancelReads(id: string) {
    for (const kind of ['instructions', 'skills'] as const) {
      const key = `${id}:${kind}`;
      this.reads.get(key)?.abort();
      this.reads.delete(key);
      this.get(id)[kind].loading = false;
    }
    this.changed();
  }
  async loadSettings(id: string) { await Promise.all([this.loadInstructions(id), this.loadSkills(id)]); }

  private async read<T>(id: string, kind: ReadKind, fetch: (signal: AbortSignal) => Promise<T>, apply: (data: T) => void) {
    const entry = this.get(id);
    if (!this.available(id) || entry[kind].saving) return;
    const epoch = entry.epoch;
    const key = `${id}:${kind}`;
    this.reads.get(key)?.abort();
    const controller = new AbortController();
    this.reads.set(key, controller);
    entry[kind].loading = true;
    entry[kind].error = undefined;
    this.changed();
    try {
      const data = await fetch(controller.signal);
      if (!controller.signal.aborted && this.isCurrent(id, epoch) && this.reads.get(key) === controller) apply(data);
    } catch (error) {
      if (!controller.signal.aborted && this.isCurrent(id, epoch) && this.reads.get(key) === controller && !isRequestCancelled(error)) entry[kind].error = message(error);
    } finally {
      if (this.reads.get(key) === controller) {
        this.reads.delete(key);
        entry[kind].loading = false;
        this.changed();
      }
    }
  }
  loadInstructions(id: string) {
    return this.read(id, 'instructions', (signal) => this.api.getSessionInstructions(id, signal), (data) => {
      const target = this.get(id).instructions;
      const dirty = target.draft !== target.saved;
      target.saved = data.instructions;
      if (!dirty) target.draft = data.instructions;
      target.loaded = true;
    });
  }
  private applySkills(id: string, data: SessionSkills, preserveDraft: boolean) {
    const target = this.get(id).skills;
    const draft = target.draft;
    const saved = effective(data);
    const removed = Object.keys(draft).filter((name) => !(name in saved));
    target.catalog = data.skills;
    target.diagnostics = data.diagnostics ?? [];
    target.saved = saved;
    target.draft = preserveDraft ? Object.fromEntries(data.skills.map((skill) => [skill.name, draft[skill.name] ?? skill.enabled])) : { ...saved };
    target.notice = removed.length && preserveDraft ? `技能目录已变化，已移除不可提交的技能：${removed.join('、')}；其余草稿已保留。` : undefined;
    target.loaded = true;
  }
  loadSkills(id: string) {
    return this.read(id, 'skills', (signal) => this.api.getSessionSkills(id, signal), (data) => {
      const target = this.get(id).skills;
      this.applySkills(id, data, !equalSwitches(target.draft, target.saved));
    });
  }

  async saveInstructions(id: string): Promise<boolean> {
    const entry = this.get(id);
    const target = entry.instructions;
    if (!this.available(id) || !target.loaded || target.saving) return false;
    if (target.draft.length > INSTRUCTIONS_LIMIT) { target.error = `专属规则最多 ${INSTRUCTIONS_LIMIT.toLocaleString()} 字符`; this.changed(); return false; }
    this.reads.get(`${id}:instructions`)?.abort();
    const epoch = entry.epoch;
    const draft = target.draft;
    target.saving = true;
    target.error = undefined;
    this.changed();
    try {
      const data = await this.api.saveSessionInstructions(id, draft);
      if (!this.isCurrent(id, epoch)) return false;
      target.saved = data.instructions;
      if (target.draft === draft) target.draft = data.instructions;
      return true;
    } catch (error) {
      if (this.isCurrent(id, epoch) && !isRequestCancelled(error)) target.error = message(error);
      return false;
    } finally { target.saving = false; this.changed(); }
  }
  async saveSkills(id: string, defaults = false): Promise<boolean> {
    const entry = this.get(id);
    const target = entry.skills;
    if (!this.available(id) || !target.loaded || target.saving) return false;
    this.reads.get(`${id}:skills`)?.abort();
    const epoch = entry.epoch;
    // PUT 是替换；普通保存提交整个当前目录，重置才发空覆盖表。
    const overrides = defaults ? {} : Object.fromEntries(target.catalog.map((skill) => [skill.name, target.draft[skill.name]]));
    target.saving = true;
    target.error = undefined;
    this.changed();
    let refreshCatalog = false;
    try {
      const data = await this.api.saveSessionSkills(id, overrides);
      if (!this.isCurrent(id, epoch)) return false;
      this.applySkills(id, data, false);
      return true;
    } catch (error) {
      if (this.isCurrent(id, epoch) && !isRequestCancelled(error)) {
        target.error = message(error);
        refreshCatalog = error instanceof ApiError && error.status === 400;
      }
      return false;
    } finally {
      target.saving = false;
      this.changed();
      if (refreshCatalog && this.enabled) {
        const error = target.error;
        await this.loadSkills(id);
        if (this.isCurrent(id, epoch)) { target.error = error; this.changed(); }
      }
    }
  }

  async deleteSession(id: string): Promise<DeleteSessionResult | undefined> {
    if (id === MAIN_SESSION_ID) throw new ApiError(409, '默认会话不可删除');
    const entry = this.get(id);
    if (!this.available(id) || this.hasSettingsWrite(id)) return undefined;
    entry.deleting = true;
    // 请求进行时先锁写入但保留运行代次；失败后当前轮仍可恢复，成功清理才永久失效。
    this.cancelReads(id);
    this.changed();
    try {
      let result: DeleteSessionResult;
      try { result = await this.api.deleteSession(id); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        result = { ok: true, removed: { sessions: 0 } };
      }
      if (this.disposed) return;
      this.clear(id);
      return result;
    } catch (error) {
      if (!this.disposed) entry.deleteUncertain = !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
      throw error;
    } finally { entry.deleting = false; this.changed(); }
  }
  clear(id: string) {
    const entry = this.get(id);
    this.cancelReads(id);
    this.sessions.delete(id);
    const blank = this.get(id);
    blank.epoch = entry.epoch + 1;
    blank.pendingSubmission = null;
    blank.draftAttachments = [];
    blank.deleted = true;
    this.lifecycleVersion++;
    this.changed();
  }
  /**
   * 连接工作区整体销毁：释放全部内存态（含未确认提交正文与草稿），并拒绝任何迟到回写。
   * 与 setEnabled(false)（离线与草稿保留）不同，dispose 后 store 不可复用。
   */
  dispose() {
    this.disposed = true;
    this.enabled = false;
    for (const entry of this.sessions.values()) {
      entry.pendingSubmission = null;
      entry.draft = '';
      entry.draftAttachments = [];
    }
    for (const controller of this.reads.values()) controller.abort();
    this.reads.clear();
    this.listeners.clear();
  }
}
