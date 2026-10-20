import type { ApiClient } from '../api/contracts';
import { ApiError, isRequestCancelled } from '../api/errors';
import type { DeleteSpaceResult, ResetSpaceResult, SpaceSkills } from '../api/types';
import { MAIN_SPACE } from './space-state';

export const INSTRUCTIONS_LIMIT = 20_000;

type Field<T> = {
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  saved: T;
  draft: T;
  error?: string;
};
export type SpaceState = {
  epoch: number;
  /** 仅作聊天上下文失效边界；HTTP 始终以空间 ID 寻址。 */
  sessionId: string | null;
  deleted: boolean;
  deleting: boolean;
  resetting: boolean;
  resetUncertain: boolean;
  draft: string;
  instructions: Field<string>;
  skills: Field<Record<string, boolean>> & { catalog: SpaceSkills['skills']; diagnostics: NonNullable<SpaceSkills['diagnostics']>; notice?: string };
};
type ReadKind = 'instructions' | 'skills';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const field = <T,>(value: T): Field<T> => ({ loaded: false, loading: false, saving: false, saved: value, draft: value });
const effective = (data: SpaceSkills) => Object.fromEntries(data.skills.map((skill) => [skill.name, skill.enabled]));
export const equalSwitches = (a: Record<string, boolean>, b: Record<string, boolean>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((name) => a[name] === b[name]);

/** 每个连接工作区独占内存；不持久化正文、凭据或服务端路径。 */
export class SpaceStore {
  private sessions = new Map<string, SpaceState>();
  private reads = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private version = 0;
  private lifecycleVersion = 0;
  private enabled = true;

  constructor(private readonly api: ApiClient) {}
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  private available(id: string) { return this.enabled && this.canWrite(id); }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;
  getLifecycleVersion = () => this.lifecycleVersion;
  private changed() { this.version++; for (const listener of this.listeners) listener(); }
  get(id: string): SpaceState {
    let entry = this.sessions.get(id);
    if (!entry) {
      entry = { epoch: 0, sessionId: null, deleted: false, deleting: false, resetting: false, resetUncertain: false, draft: '', instructions: field(''), skills: { ...field<Record<string, boolean>>({}), catalog: [], diagnostics: [] } };
      this.sessions.set(id, entry);
    }
    return entry;
  }
  isCurrent(id: string, epoch: number) {
    const entry = this.get(id);
    return entry.epoch === epoch && this.canWrite(id);
  }
  canWrite(id: string) { const entry = this.get(id); return !entry.deleted && !entry.deleting && !entry.resetting && !entry.resetUncertain; }
  hasSettingsWrite(id: string) { const entry = this.get(id); return entry.instructions.saving || entry.skills.saving; }
  hasDirtySettings(id: string) { const entry = this.get(id); return entry.instructions.draft !== entry.instructions.saved || !equalSwitches(entry.skills.draft, entry.skills.saved); }
  setDraft(id: string, value: string) { if (this.canWrite(id)) { this.get(id).draft = value; this.changed(); } }
  setInstructions(id: string, value: string) { if (this.canWrite(id) && !this.get(id).instructions.saving) { this.get(id).instructions.draft = value; this.changed(); } }
  setSkill(id: string, name: string, enabled: boolean) {
    const entry = this.get(id);
    if (this.canWrite(id) && !entry.skills.saving && entry.skills.catalog.some((skill) => skill.name === name)) {
      entry.skills.draft = { ...entry.skills.draft, [name]: enabled };
      this.changed();
    }
  }
  discardSettings(id: string) {
    if (!this.canWrite(id) || this.hasSettingsWrite(id)) return;
    const entry = this.get(id);
    entry.instructions.draft = entry.instructions.saved;
    entry.skills.draft = { ...entry.skills.saved };
    entry.skills.notice = undefined;
    this.changed();
  }

  /** 列表观察到另一设备重置时，只失效聊天，不能销毁空间规则与未保存的设置草稿。 */
  bindSession(id: string, sessionId: string) {
    const entry = this.get(id);
    if (entry.deleted || entry.resetting || entry.sessionId === sessionId) return;
    if (entry.sessionId !== null || entry.resetUncertain) {
      entry.epoch++;
      entry.draft = '';
      this.cancelReads(id);
    }
    entry.sessionId = sessionId;
    entry.resetUncertain = false;
    this.changed();
  }

  async resetSpace(id: string, clearSchedules = false): Promise<ResetSpaceResult | undefined> {
    const entry = this.get(id);
    if (!this.available(id) || this.hasSettingsWrite(id)) return undefined;
    // 先切本地代次再请求：旧 SSE、历史回读和迟到 finally 都不能写入新上下文。
    // 与删除不同，空间设置（包括未保存草稿）和私有工作区必须保留。
    entry.resetting = true;
    entry.epoch++;
    this.lifecycleVersion++;
    this.cancelReads(id);
    this.changed();
    try {
      const result = await this.api.resetSpace(id, { clearSchedules });
      if (this.get(id) !== entry) return undefined;
      entry.sessionId = result.sessionId;
      entry.draft = '';
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
    return this.read(id, 'instructions', (signal) => this.api.getSpaceInstructions(id, signal), (data) => {
      const target = this.get(id).instructions;
      const dirty = target.draft !== target.saved;
      target.saved = data.instructions;
      if (!dirty) target.draft = data.instructions;
      target.loaded = true;
    });
  }
  private applySkills(id: string, data: SpaceSkills, preserveDraft: boolean) {
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
    return this.read(id, 'skills', (signal) => this.api.getSpaceSkills(id, signal), (data) => {
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
      const data = await this.api.saveSpaceInstructions(id, draft);
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
      const data = await this.api.saveSpaceSkills(id, overrides);
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

  async deleteSpace(id: string): Promise<DeleteSpaceResult | undefined> {
    if (id === MAIN_SPACE) throw new ApiError(409, '主空间不可删除');
    const entry = this.get(id);
    if (!this.available(id) || this.hasSettingsWrite(id)) return undefined;
    entry.deleting = true;
    // 请求进行时先锁写入但保留运行代次；失败后当前轮仍可恢复，成功清理才永久失效。
    this.cancelReads(id);
    this.changed();
    try {
      let result: DeleteSpaceResult;
      try { result = await this.api.deleteSpace(id); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        result = { ok: true, removed: { jobs: 0, monitors: 0 } };
      }
      this.clear(id);
      return result;
    } finally { entry.deleting = false; this.changed(); }
  }
  clear(id: string) {
    const entry = this.get(id);
    this.cancelReads(id);
    this.sessions.delete(id);
    const blank = this.get(id);
    blank.epoch = entry.epoch + 1;
    blank.deleted = true;
    this.lifecycleVersion++;
    this.changed();
  }
  revive(id: string) { const entry = this.get(id); if (entry.deleted) { entry.deleted = false; this.changed(); } }
  dispose() { this.enabled = false; for (const controller of this.reads.values()) controller.abort(); this.reads.clear(); this.listeners.clear(); }
}
