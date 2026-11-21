import type { ApiClient } from '../api/contracts';
import { ApiError, isRequestCancelled } from '../api/errors';
import type { SessionSkills } from '../api/types';

export const INSTRUCTIONS_LIMIT = 20_000;

type Field<T> = {
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  writeUncertain: boolean;
  saved: T;
  draft: T;
  error?: string;
};
/** 单个技能正文的按需读取状态；键为技能名称，与 GET /skills/:name 一致。 */
export type SkillDetailState = { loading: boolean; content?: string; error?: string };
type SettingsState = {
  instructions: Field<string>;
  skills: Field<Record<string, boolean>> & {
    catalog: SessionSkills['skills'];
    diagnostics: NonNullable<SessionSkills['diagnostics']>;
    details: Record<string, SkillDetailState>;
    notice?: string;
  };
};
type ReadKind = 'instructions' | 'skills';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const field = <T,>(value: T): Field<T> => ({ loaded: false, loading: false, saving: false, writeUncertain: false, saved: value, draft: value });
const isUncertainWrite = (error: unknown) =>
  !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
const effective = (data: SessionSkills) => Object.fromEntries(data.skills.map((skill) => [skill.id, skill.enabled]));
export const equalSwitches = (a: Record<string, boolean>, b: Record<string, boolean>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((name) => a[name] === b[name]);

/** 助手设置由当前连接拥有，独立于各聊天会话的代次和缓存。 */
export class AssistantSettingsStore {
  readonly state: SettingsState = {
    instructions: field(''),
    skills: { ...field<Record<string, boolean>>({}), catalog: [], diagnostics: [], details: {} },
  };
  private reads = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private version = 0;
  private enabled = true;
  private disposed = false;
  constructor(private readonly api: ApiClient) {}
  getVersion = () => this.version;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private changed() {
    if (this.disposed) return;
    this.version++;
    for (const listener of this.listeners) listener();
  }
  setEnabled(enabled: boolean) { this.enabled = enabled; }
  canWrite() { return this.enabled && !this.disposed; }
  hasSettingsWrite() { return this.state.instructions.saving || this.state.skills.saving; }
  dispose() {
    this.disposed = true;
    this.cancelReads();
    this.listeners.clear();
  }

  setInstructions(value: string) { if (this.canWrite() && !this.state.instructions.saving && !this.state.instructions.writeUncertain) { this.state.instructions.draft = value; this.changed(); } }
  setSkill(id: string, enabled: boolean) {
    const entry = this.state;
    if (this.canWrite() && !entry.skills.saving && !entry.skills.writeUncertain) {
      const target = entry.skills.catalog.find((skill) => skill.id === id);
      if (target) {
        const key = target.id;
        entry.skills.draft = { ...entry.skills.draft, [key]: enabled };
        this.changed();
      }
    }
  }
  discardSettings(kind: ReadKind) {
    if (!this.canWrite() || this.hasSettingsWrite() || this.state[kind].writeUncertain) return;
    const entry = this.state;
    if (kind === 'instructions') entry.instructions.draft = entry.instructions.saved;
    else { entry.skills.draft = { ...entry.skills.saved }; entry.skills.notice = undefined; }
    this.changed();
  }

  cancelReads() {
    if (!this.reads.size) return;
    for (const controller of this.reads.values()) controller.abort();
    this.reads.clear();
    this.state.instructions.loading = false;
    this.state.skills.loading = false;
    for (const detail of Object.values(this.state.skills.details)) detail.loading = false;
    this.changed();
  }
  async loadSettings() { await Promise.all([this.loadInstructions(), this.loadSkills()]); }

  private async read<T>(kind: ReadKind, fetch: (signal: AbortSignal) => Promise<T>, apply: (data: T) => void, reconcileUncertain: boolean) {
    const entry = this.state;
    if (!this.canWrite() || entry[kind].saving || (entry[kind].writeUncertain && !reconcileUncertain)) return;

    const key = kind;
    this.reads.get(key)?.abort();
    const controller = new AbortController();
    this.reads.set(key, controller);
    entry[kind].loading = true;
    entry[kind].error = undefined;
    this.changed();
    try {
      const data = await fetch(controller.signal);
      if (!controller.signal.aborted && !this.disposed && this.reads.get(key) === controller) {
        apply(data);
        entry[kind].writeUncertain = false;
      }
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed && this.reads.get(key) === controller && !isRequestCancelled(error)) entry[kind].error = message(error);
    } finally {
      if (this.reads.get(key) === controller) {
        this.reads.delete(key);
        entry[kind].loading = false;
        this.changed();
      }
    }
  }
  loadInstructions(reconcileUncertain = false) {
    return this.read('instructions', (signal) => this.api.getAssistantInstructions(signal), (data) => {
      const target = this.state.instructions;
      const dirty = target.draft !== target.saved;
      target.saved = data.instructions;
      if (!dirty) target.draft = data.instructions;
      target.loaded = true;
    }, reconcileUncertain);
  }
  private applySkills(data: SessionSkills, preserveDraft: boolean) {
    const target = this.state.skills;
    const draft = target.draft;
    const saved = effective(data);
    const removed = Object.keys(draft).filter((key) => !(key in saved));
    const previousIds = new Map(target.catalog.map((skill) => [skill.name, skill.id]));
    const nextIds = new Map(data.skills.map((skill) => [skill.name, skill.id]));
    // 正文也绑定来源：刷新后同名来源变更，丢弃旧正文并取消其在途请求。
    target.details = Object.fromEntries(Object.entries(target.details).filter(([name]) => {
      if (previousIds.get(name) === nextIds.get(name) && nextIds.has(name)) return true;
      const key = `skill-detail:${name}`;
      this.reads.get(key)?.abort();
      this.reads.delete(key);
      return false;
    }));
    target.catalog = data.skills;
    target.diagnostics = data.diagnostics ?? [];
    target.saved = saved;
    target.draft = preserveDraft ? Object.fromEntries(data.skills.map((skill) => {
      const key = skill.id;
      // id 变化即视为新的来源，不能把旧名称草稿套到新来源上。
      return [key, draft[key] ?? skill.enabled];
    })) : { ...saved };
    target.notice = removed.length && preserveDraft ? `技能目录已变化，已移除不可提交的技能：${removed.join('、')}；其余草稿已保留。` : undefined;
    target.loaded = true;
  }
  loadSkills(reconcileUncertain = false) {
    return this.read('skills', (signal) => this.api.getAssistantSkills(signal), (data) => {
      const target = this.state.skills;
      this.applySkills(data, !equalSwitches(target.draft, target.saved));
    }, reconcileUncertain);
  }

  /**
   * 按名称按需加载技能正文（GET /api/assistant/skills/:name）。
   * 404 返回"技能正文不可用"，其它错误显示具体消息。
   */
  async loadSkillDetail(name: string): Promise<void> {
    const entry = this.state;
    if (!this.canWrite()) return;

    const selected = entry.skills.catalog.find((skill) => skill.name === name);
    const selectedId = selected ? selected.id : undefined;
    const key = `skill-detail:${name}`;
    this.reads.get(key)?.abort();
    const controller = new AbortController();
    this.reads.set(key, controller);
    const prev = entry.skills.details[name];
    entry.skills.details = {
      ...entry.skills.details,
      [name]: { loading: true, content: prev?.content, error: undefined },
    };
    this.changed();
    try {
      const detail = await this.api.getAssistantSkill(name, controller.signal);
      if (detail.name !== name || (selectedId !== undefined && detail.id !== selectedId)) {
        throw new ApiError(409, '技能来源已变化，请刷新技能列表后查看说明');
      }
      if (!controller.signal.aborted && !this.disposed && this.reads.get(key) === controller) {
        entry.skills.details = {
          ...entry.skills.details,
          [name]: { loading: false, content: detail.content, error: undefined },
        };
      }
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed && this.reads.get(key) === controller && !isRequestCancelled(error)) {
        const errText = error instanceof ApiError && error.status === 404 ? '技能正文不可用' : message(error);
        entry.skills.details = {
          ...entry.skills.details,
          [name]: { loading: false, content: undefined, error: errText },
        };
      }
    } finally {
      if (this.reads.get(key) === controller) {
        this.reads.delete(key);
        // 如果上面未被 catch/success 处理（如被取消），恢复 loading 状态
        const current = entry.skills.details[name];
        if (current?.loading) {
          entry.skills.details = { ...entry.skills.details, [name]: { ...current, loading: false } };
        }
        this.changed();
      }
    }
  }

  async saveInstructions(): Promise<boolean> {
    const entry = this.state;
    const target = entry.instructions;
    if (!this.canWrite() || !target.loaded || target.saving || target.writeUncertain) return false;
    if (target.draft.length > INSTRUCTIONS_LIMIT) { target.error = `助手指令最多 ${INSTRUCTIONS_LIMIT.toLocaleString()} 字符`; this.changed(); return false; }
    this.reads.get('instructions')?.abort();

    const draft = target.draft;
    target.saving = true;
    target.error = undefined;
    this.changed();
    try {
      const data = await this.api.saveAssistantInstructions(draft);
      if (this.disposed) return false;
      target.saved = data.instructions;
      if (target.draft === draft) target.draft = data.instructions;
      return true;
    } catch (error) {
      if (!this.disposed) {
        target.writeUncertain = isUncertainWrite(error);
        target.error = message(error);
      }
      return false;
    } finally { target.saving = false; this.changed(); }
  }
  async saveSkills(defaults = false): Promise<boolean> {
    const entry = this.state;
    const target = entry.skills;
    if (!this.canWrite() || !target.loaded || target.saving || target.writeUncertain) return false;
    this.reads.get('skills')?.abort();

    // PUT 是替换；普通保存按技能来源身份 id（source/name）提交整个当前目录，重置才发空覆盖表。
    const overrides = defaults ? {} : Object.fromEntries(target.catalog.map((skill) => {
      const key = skill.id;
      return [key, target.draft[key]];
    }));
    target.saving = true;
    target.error = undefined;
    this.changed();
    let refreshCatalog = false;
    try {
      const data = await this.api.saveAssistantSkills(overrides);
      if (this.disposed) return false;
      this.applySkills(data, false);
      return true;
    } catch (error) {
      if (!this.disposed) {
        target.writeUncertain = isUncertainWrite(error);
        target.error = message(error);
        refreshCatalog = error instanceof ApiError && error.status === 400;
      }
      return false;
    } finally {
      target.saving = false;
      this.changed();
      if (refreshCatalog && this.enabled) {
        const error = target.error;
        await this.loadSkills();
        if (!this.disposed) { target.error = error; this.changed(); }
      }
    }
  }

}
