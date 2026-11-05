import type { AgentCapability, GroupClient, GroupSettings } from './contracts';

export type RoutingDraft = GroupSettings | AgentCapability;
type Editor<T> = { saved?: T; draft?: T; loading: boolean; saving: boolean; needsReadback: boolean; error?: string; notice?: string };
const empty = { loading: false, saving: false, needsReadback: false };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const message = (error: unknown) => error instanceof Error ? error.message : '设置请求失败';

/** 仅管理组设置和公开能力的连接内草稿；离页不丢输入，未明保存必须显式回读，不自动重发。 */
export class RoutingSettingsStore {
  private editors = new Map<string, Editor<RoutingDraft>>();
  private reads = new Map<string, AbortController>();
  private writes = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private api: GroupClient) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  group = () => this.get('group') as Editor<GroupSettings>;
  capability = (agentId: string) => this.get(`agent:${agentId}`) as Editor<AgentCapability>;
  private get(key: string) {
    if (!this.editors.has(key)) this.editors.set(key, { ...empty });
    return this.editors.get(key)!;
  }
  private publish(key: string, patch: Partial<Editor<RoutingDraft>>) {
    if (this.disposed) return;
    this.editors.set(key, { ...this.get(key), ...patch });
    for (const listener of this.listeners) listener();
  }
  editGroup = (draft: GroupSettings) => this.publish('group', { draft, notice: undefined });
  editCapability = (draft: AgentCapability) => this.publish(`agent:${draft.agentId}`, { draft, notice: undefined });
  reloadGroup = (automatic = false) => this.reload('group', automatic);
  reloadCapability = (id: string, automatic = false) => this.reload(`agent:${id}`, automatic);
  private async reload(key: string, automatic: boolean) {
    if (this.disposed || this.writes.has(key) || (automatic && this.get(key).needsReadback)) return;
    this.reads.get(key)?.abort();
    const controller = new AbortController(); this.reads.set(key, controller);
    this.publish(key, { loading: true });
    try {
      const saved = key === 'group' ? await this.api.getGroupSettings(controller.signal) : await this.api.getAgentCapability(key.slice(6), controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      const state = this.get(key);
      const clean = !state.draft || same(state.draft, state.saved) || same(state.draft, saved);
      this.publish(key, { saved, ...(clean ? { draft: saved } : {}), needsReadback: false, error: undefined, notice: undefined });
    } catch (error) { if (!controller.signal.aborted) this.publish(key, { error: `${message(error)}。原草稿已保留。` }); }
    finally { if (this.reads.get(key) === controller) { this.reads.delete(key); this.publish(key, { loading: false }); } }
  }
  saveGroup = () => this.save('group');
  saveCapability = (id: string) => this.save(`agent:${id}`);
  private async save(key: string) {
    const state = this.get(key);
    if (this.disposed || !state.saved || !state.draft || this.writes.has(key) || state.needsReadback) return;
    this.reads.get(key)?.abort(); this.reads.delete(key);
    const draft = state.draft;
    const controller = new AbortController(); this.writes.set(key, controller);
    this.publish(key, { saving: true, loading: false, error: undefined, notice: undefined });
    try {
      const saved = 'agentId' in draft ? await this.api.saveAgentCapability(draft.agentId, draft.capability, controller.signal) : await this.api.saveGroupSettings(draft, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      const clean = same(this.get(key).draft, draft);
      this.publish(key, { saved, ...(clean ? { draft: saved } : {}), notice: clean ? '已保存，下次发送生效' : '提交已保存，后续修改尚未保存' });
    } catch (error) { if (!controller.signal.aborted) this.publish(key, { needsReadback: true, error: `${message(error)}。请先刷新核对，不会自动重发。` }); }
    finally { if (this.writes.get(key) === controller) { this.writes.delete(key); this.publish(key, { saving: false }); } }
  }
  dispose = () => {
    this.disposed = true;
    for (const controller of [...this.reads.values(), ...this.writes.values()]) controller.abort();
    this.listeners.clear();
  };
}
