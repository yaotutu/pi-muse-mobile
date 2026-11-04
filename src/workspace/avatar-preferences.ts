export type AvatarPreferenceStorage = { read: () => Promise<string | null>; write: (value: string) => Promise<void> };
export type AvatarPreferences = { pinned: readonly string[]; loading: boolean; saving: boolean; error?: string };

/** 置顶是本设备、当前服务器的显示偏好，不修改 Agent 能力或另一台设备的排列。 */
export class AvatarPreferenceStore {
  private state: AvatarPreferences = { pinned: [], loading: true, saving: false };
  private listeners = new Set<() => void>();
  constructor(private storage: AvatarPreferenceStorage) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<AvatarPreferences>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  async load() {
    this.publish({ loading: true, error: undefined });
    try {
      const raw = await this.storage.read();
      const value: unknown = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || id === 'group')) throw new Error('置顶偏好格式不正确');
      this.publish({ pinned: [...new Set<string>(value)], loading: false });
    } catch { this.publish({ loading: false, error: '置顶偏好读取失败，请重试' }); }
  }
  async toggle(id: string) {
    if (this.state.loading || this.state.saving || this.state.error || id === 'group') return;
    const pinned = this.state.pinned.includes(id) ? this.state.pinned.filter((item) => item !== id) : [...this.state.pinned, id];
    this.publish({ saving: true });
    try { await this.storage.write(JSON.stringify(pinned)); this.publish({ pinned, saving: false }); }
    catch { this.publish({ saving: false, error: '置顶偏好保存失败，请重试' }); }
  }
}
