import type { ApiClient } from '../api/contracts';
import { ApiError } from '../api/errors';
import type { ConversationMessage, ConversationSnapshot, DeleteSessionResult, ResetSessionResult, SessionDeleteOptions } from '../api/types';
import { isChatReadingPosition, type ChatLocalData, type ChatLocalSessionRepository, type ChatReadingPosition } from '../chat/chat-local-data';
import { validateAttachmentDrafts } from '../attachments/validation';
import type { AttachmentDraft, AttachmentDraftUpdateResult } from '../attachments/types';
import { MAIN_SESSION_ID } from './types';
export type { ChatReadingPosition } from '../chat/chat-local-data';

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

export type SessionState = {
  localLoaded: boolean;
  localError?: string;
  readingPosition: ChatReadingPosition | null;
  /** 展示缓存，不能建立 revision / 已落盘 ID 或审批资格。 */
  cachedMessages: ConversationMessage[] | null;
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
};
/** 每个连接工作区独占内存；仅通过显式注入边界保存有界展示缓存和纯文本草稿。 */
export class ChatSessionStore {
  private sessions = new Map<string, SessionState>();
  private listeners = new Set<() => void>();
  private version = 0;
  private lifecycleVersion = 0;
  private enabled = true;
  private disposed = false;
  private localBindings = new Map<string, string | null>();
  private localReads = new Map<string, Promise<void>>();
  private localWrites = new Map<string, ReturnType<typeof setTimeout>>();
  private draftEdits = new Map<string, number>();
  private readingEdits = new Map<string, number>();
  private confirmed = new Set<string>();
  private bound = new Set<string>();
  private localRestoreAllowed = true;

  constructor(private readonly api: ApiClient, private readonly local?: ChatLocalSessionRepository) {}
  private localFailure(entry: SessionState) {
    if (this.disposed) return;
    entry.localError = '本机聊天缓存未能保存或读取；服务端消息不受影响';
    this.changed();
  }
  private persistLocal(id: string, immediate = false) {
    if (!this.local || this.disposed || !this.localRestoreAllowed) return;
    const entry = this.get(id);
    const epoch = entry.epoch;
    clearTimeout(this.localWrites.get(id));
    const save = async () => {
      this.localWrites.delete(id);
      await this.localReads.get(id);
      if (this.disposed || !this.localRestoreAllowed || this.sessions.get(id) !== entry || entry.epoch !== epoch || entry.deleted || entry.resetting || entry.resetUncertain) return;
      const data: ChatLocalData = { piSessionId: entry.piSessionId ?? this.localBindings.get(id) ?? null,
        messages: entry.cachedMessages ?? [], draft: entry.draft, readingPosition: entry.readingPosition };
      try { await this.local!.save(id, data); }
      catch { this.localFailure(entry); }
    };
    if (immediate) void save();
    else this.localWrites.set(id, setTimeout(() => void save(), 250));
  }
  private hydrateLocal(id: string, entry: SessionState) {
    if (!this.local || !this.localRestoreAllowed) { entry.localLoaded = true; return; }
    const epoch = entry.epoch;
    const draftEdit = this.draftEdits.get(id) ?? 0;
    const readingEdit = this.readingEdits.get(id) ?? 0;
    const read = (async () => {
      try {
        const data = await this.local!.load(id);
        if (this.disposed || !this.localRestoreAllowed || this.sessions.get(id) !== entry || entry.epoch !== epoch) return;
        // 已成功网络绑定优先；迟到旧缓存不能覆盖新历史、草稿或阅读位置。
        if (data && (!this.bound.has(id) || entry.piSessionId === data.piSessionId)) {
          this.localBindings.set(id, data.piSessionId);
          if (!this.confirmed.has(id)) entry.cachedMessages = data.messages;
          if ((this.draftEdits.get(id) ?? 0) === draftEdit) entry.draft = data.draft;
          if ((this.readingEdits.get(id) ?? 0) === readingEdit) entry.readingPosition = data.readingPosition;
        }
      } catch { this.localFailure(entry); }
      finally {
        if (!this.disposed && this.sessions.get(id) === entry) { entry.localLoaded = true; this.changed(); }
      }
    })();
    this.localReads.set(id, read);
  }
  setReadingPosition(id: string, epoch: number, position: ChatReadingPosition): void {
    const entry = this.get(id);
    if (!this.isCurrent(id, epoch) || !isChatReadingPosition(position)) return;
    entry.readingPosition = { ...position };
    this.readingEdits.set(id, (this.readingEdits.get(id) ?? 0) + 1);
    this.persistLocal(id);
    this.changed();
  }
  /** 仅当前 HTTP 权威快照可进入展示缓存；缓存恢复本身不调用此入口。 */
  cacheConfirmedHistory(id: string, epoch: number, history: ConversationSnapshot) {
    if (!this.isCurrent(id, epoch) || history.sessionId !== id) return;
    const entry = this.get(id);
    this.confirmed.add(id);
    entry.cachedMessages = history.messages;
    this.localBindings.set(id, history.piSessionId);
    this.persistLocal(id);
  }
  private clearLocal(id: string, entry: SessionState) {
    clearTimeout(this.localWrites.get(id)); this.localWrites.delete(id);
    this.localBindings.delete(id); this.confirmed.delete(id);
    entry.cachedMessages = null; entry.readingPosition = null;
    this.readingEdits.set(id, (this.readingEdits.get(id) ?? 0) + 1);
    this.draftEdits.set(id, (this.draftEdits.get(id) ?? 0) + 1);
    return this.local?.remove(id).catch(() => this.localFailure(entry)) ?? Promise.resolve();
  }
  flushLocal() { for (const id of this.localWrites.keys()) this.persistLocal(id, true); }
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
  /** 401 只禁止新恢复受保护缓存，不重建同服 Store 或丢失 A01 未确认正文。 */
  setLocalRestoreAllowed(allowed: boolean) { this.localRestoreAllowed = allowed; }
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
      entry = { localLoaded: !this.local, readingPosition: null, cachedMessages: null, epoch: 0, piSessionId: null, deleted: false, deleting: false, resetting: false, resetUncertain: false, resetReviewed: false, deleteUncertain: false, draft: '', draftAttachments: [], pendingSubmission: null };
      this.sessions.set(id, entry);
      this.hydrateLocal(id, entry);
    }
    return entry;
  }
  isCurrent(id: string, epoch: number) {
    const entry = this.get(id);
    return entry.epoch === epoch && this.canWrite(id);
  }
  canWrite(id: string) { const entry = this.get(id); return !this.disposed && !entry.deleted && !entry.deleting && !entry.resetting && !entry.resetUncertain && !entry.deleteUncertain; }
  setDraft(id: string, value: string) { if (this.canWrite(id)) { this.get(id).draft = value; this.draftEdits.set(id, (this.draftEdits.get(id) ?? 0) + 1); this.persistLocal(id); this.changed(); } }
  /** 附件草稿允许在连接短暂 enabled=false 时写入；仍拒绝 dispose、删除、重置与旧 epoch。 */
  private canHoldDraftAttachments(id: string, epoch: number) {
    const entry = this.get(id);
    return !this.disposed && entry.epoch === epoch && !entry.deleted && !entry.deleting && !entry.deleteUncertain &&
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
    this.draftEdits.set(id, (this.draftEdits.get(id) ?? 0) + 1);
    this.persistLocal(id);
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
  /** 列表观察到另一设备重置时，只失效聊天，不能销毁会话规则与未保存的设置草稿。 */
  bindSession(id: string, piSessionId: string | null) {
    const entry = this.get(id);
    if (entry.deleted || entry.resetting) return;
    const previous = this.bound.has(id) ? entry.piSessionId : this.localBindings.has(id) ? this.localBindings.get(id) : undefined;
    this.bound.add(id);
    if (previous === piSessionId) {
      if (entry.piSessionId !== piSessionId) { entry.piSessionId = piSessionId; this.changed(); }
      return;
    }
    // 空会话首次创建 PI 绑定不是重置，不能清掉首轮发送期间新输入的草稿或未确认条目。
    if (previous != null || entry.resetUncertain) {
      entry.epoch++;
      entry.draft = '';
      entry.draftAttachments = [];
      entry.pendingSubmission = null;
      this.clearLocal(id, entry);
    }
    entry.piSessionId = piSessionId;
    entry.resetUncertain = false;
    this.changed();
  }

  async resetSession(id: string): Promise<ResetSessionResult | undefined> {
    const entry = this.get(id);
    if (!this.available(id)) return undefined;
    // 先切本地代次再请求：旧 SSE、历史回读和迟到 finally 都不能写入新上下文。
    // 请求被拒绝或结果未明时必须保留正文、附件与暂存，只在成功或权威绑定变化后清理。
    entry.resetting = true; entry.resetReviewed = false;
    entry.epoch++;
    if (entry.pendingSubmission) {
      entry.pendingSubmission = { ...entry.pendingSubmission, epoch: entry.epoch,
        status: entry.pendingSubmission.status === 'sending' ? 'unconfirmed' : entry.pendingSubmission.status };
    }
    this.lifecycleVersion++;
    this.changed();
    try {
      const result = await this.api.resetSession(id);
      if (this.get(id) !== entry) return undefined;
      // reset 响应不泄漏底层绑定；下一次完整历史读取建立新绑定。
      entry.piSessionId = null;
      entry.draft = '';
      entry.draftAttachments = [];
      entry.pendingSubmission = null;
      await this.clearLocal(id, entry);
      this.bound.delete(id);
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

  async deleteSession(id: string, options: SessionDeleteOptions): Promise<DeleteSessionResult | undefined> {
    if (id === MAIN_SESSION_ID) throw new ApiError(409, '默认会话不可删除');
    const entry = this.get(id);
    if (!this.available(id)) return undefined;
    entry.deleting = true;
    // 请求进行时先锁写入但保留运行代次；失败后当前轮仍可恢复，成功清理才永久失效。
    this.changed();
    try {
      let result: DeleteSessionResult;
      try { result = await this.api.deleteSession(id, options); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        result = { ok: true, removed: { sessions: 0, jobs: 0, monitors: 0 }, moved: { jobs: 0, monitors: 0 } };
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
    this.clearLocal(id, entry);
    this.bound.delete(id);
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
    for (const timer of this.localWrites.values()) clearTimeout(timer);
    this.localWrites.clear();
    this.listeners.clear();
  }
}
