export type AgentMainView = 'reading' | 'chat';
export type ViewPreferenceStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};
type ViewSnapshot = { ready: boolean; saving: boolean; views: Record<string, AgentMainView>; error?: string };

export function defaultAgentView(agentId: string): AgentMainView {
  return agentId === 'news-internal' ? 'reading' : 'chat';
}
export function agentHomePage(agentId: string, view: AgentMainView): 'news' | 'chat' {
  return agentId === 'news-internal' && view === 'reading' ? 'news' : 'chat';
}

/** 偏好只属于当前设备与服务地址，不含 token；键编码为 SecureStore 允许的 ASCII 字符。 */
export function agentViewPreferenceKey(serverUrl: string): string {
  const scope = serverUrl.replace(/\/+$/, '');
  return `pi-muse-agent-views-${scope.split('').map((char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
}

/** 先持久化再发布选择；加载失败不伪装默认值，保存失败不冒充已保存。 */
export class AgentViewPreferences {
  private state: ViewSnapshot = { ready: false, saving: false, views: {} };
  private listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private readonly key: string;
  constructor(serverUrl: string, private readonly storage: ViewPreferenceStorage) {
    this.key = agentViewPreferenceKey(serverUrl);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  view = (agentId: string): AgentMainView => this.state.views[agentId] ?? defaultAgentView(agentId);
  private publish(patch: Partial<ViewSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  load = (): Promise<void> => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.publish({ error: undefined });
      try {
        const raw = await this.storage.getItem(this.key);
        let views: Record<string, AgentMainView> = {};
        if (raw !== null) {
          const data: unknown = JSON.parse(raw);
          if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 ||
              !('views' in data) || !data.views || typeof data.views !== 'object' || Array.isArray(data.views)) throw new Error('invalid');
          for (const [id, view] of Object.entries(data.views)) {
            if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || (view !== 'chat' && view !== 'reading') ||
                (view === 'reading' && id !== 'news-internal')) throw new Error('invalid');
          }
          views = { ...data.views } as Record<string, AgentMainView>;
        }
        this.publish({ ready: true, views, error: undefined });
      } catch {
        this.publish({ error: '主视图偏好读取失败，请重试；不会覆盖已保存的选择。' });
      } finally { this.loading = undefined; }
    })();
    return this.loading;
  };
  save = async (agentId: string, view: AgentMainView): Promise<boolean> => {
    if (!this.state.ready || this.state.saving || agentId !== 'news-internal' || !['reading', 'chat'].includes(view)) return false;
    if (this.view(agentId) === view) return true;
    this.publish({ saving: true, error: undefined });
    try {
      const views = { ...this.state.views, [agentId]: view };
      await this.storage.setItem(this.key, JSON.stringify({ version: 1, views }));
      this.publish({ views, saving: false, error: undefined });
      return true;
    } catch {
      this.publish({ saving: false, error: '主视图保存失败，仍使用原选择，请重试。' });
      return false;
    }
  };
}
