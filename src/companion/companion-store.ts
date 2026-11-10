import { isCompanionPackId, type CompanionClient, type CompanionDiagnostic, type CompanionPackSummary } from '../api/companion-contracts';
import { companionAbort } from './companion-cache';
import type { CompanionCache, CompanionImages, CompanionKey, CompanionPack, CompanionPreferences } from './types';

export type CompanionSnapshot = {
  selectedKey: CompanionKey; activePack: CompanionPack; serverPacks: CompanionPackSummary[];
  diagnostics: CompanionDiagnostic[]; cachedImages: Record<string, CompanionImages>;
  downloadingKey?: CompanionKey; error?: string; notice?: string; refreshing: boolean; connected: boolean;
};
const validKey = (key: string | null): key is CompanionKey => key === 'builtin:penguin' || (!!key?.startsWith('server:') && isCompanionPackId(key.slice(7)));

/** 形象是纯展示偏好；代次只取消本领域读取，绝不操作聊天、草稿或连接客户端。 */
export class CompanionStore {
  private state: CompanionSnapshot;
  private listeners = new Set<() => void>();
  private selectionGeneration = 0;
  private preferenceGeneration = 0;
  private connectionGeneration = 0;
  private selection?: AbortController;
  private listing?: AbortController;
  private client?: CompanionClient;
  private scope?: string;
  private disposed = false;
  private loaded = false;
  private connectionResolved = true;
  private loading?: Promise<void>;
  private writes = Promise.resolve();
  constructor(private readonly builtin: CompanionPack, private readonly preferences: CompanionPreferences, private readonly cache: CompanionCache) {
    this.state = { selectedKey: 'builtin:penguin', activePack: builtin, serverPacks: [], diagnostics: [], cachedImages: {}, refreshing: false, connected: false };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<CompanionSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener();
  }
  private save(key: CompanionKey) {
    // 快速连续选择按顺序保存，较慢的旧写入不得覆盖较新的偏好。
    this.writes = this.writes.then(async () => {
      if (!this.disposed && key === this.state.activePack.key) await this.preferences.write(key);
    }).catch(() => { this.publish({ error: '助手形象偏好保存失败，请重新选择' }); });
  }
  load(): Promise<void> {
    return this.loading ??= (async () => {
      const generation = this.preferenceGeneration;
      try {
        const key = await this.preferences.read();
        if (this.disposed) return;
        if (generation === this.preferenceGeneration && validKey(key)) this.publish({ selectedKey: key });
      } catch { this.publish({ error: '助手形象偏好读取失败，暂用内置形象' }); }
      this.loaded = true;
      if (!this.disposed) await this.reconcile();
    })();
  }
  connect(scope: string | undefined, client: CompanionClient | undefined, connected: boolean, resolved = true) {
    if (scope === this.scope && client === this.client && connected === this.state.connected && resolved === this.connectionResolved) return;
    const changedServer = this.scope !== undefined && scope !== this.scope;
    this.connectionResolved = resolved;
    this.connectionGeneration++; this.selectionGeneration++;
    this.selection?.abort(); this.listing?.abort(); this.scope = scope; this.client = client;
    this.publish({ connected, refreshing: false, downloadingKey: undefined, error: undefined,
      ...(changedServer ? { serverPacks: [], diagnostics: [], cachedImages: {} } : {}) });
    if (changedServer) this.fallback('服务器已更换，已恢复内置助手形象');
    if (this.loaded) void this.reconcile();
  }
  private async reconcile() {
    if (!this.connectionResolved) return;
    const generation = this.connectionGeneration;
    if (this.state.selectedKey.startsWith('server:')) await this.restore();
    if (!this.disposed && generation === this.connectionGeneration && this.state.connected) await this.refresh();
  }
  private fallback(notice: string) {
    this.preferenceGeneration++; this.selectionGeneration++; this.selection?.abort();
    this.publish({ selectedKey: 'builtin:penguin', activePack: this.builtin, downloadingKey: undefined, notice }); this.save('builtin:penguin');
  }
  private async restore() {
    const key = this.state.selectedKey; const scope = this.scope;
    if (!scope) { this.fallback('没有当前服务器的本地形象缓存，已恢复内置助手形象'); return; }
    const controller = new AbortController(); this.selection?.abort(); this.selection = controller;
    const selection = this.selectionGeneration; const connection = this.connectionGeneration;
    try {
      const cached = await this.cache.read(scope, key.slice(7), controller.signal);
      if (!this.current(selection, connection, controller)) return;
      if (cached) this.publish({ activePack: { key, ...cached.summary, images: cached.images }, cachedImages: { ...this.state.cachedImages, [key]: cached.images } });
      else if (!this.state.connected) this.fallback('本地形象缓存不可用，已恢复内置助手形象；连接后可重新选择');
    } catch {
      if (this.current(selection, connection, controller) && !this.state.connected) this.fallback('本地形象缓存不可用，已恢复内置助手形象');
    }
  }
  private current(selection: number, connection: number, controller: AbortController) {
    return !this.disposed && !controller.signal.aborted && selection === this.selectionGeneration && connection === this.connectionGeneration;
  }
  async refresh() {
    if (!this.state.connected || !this.client) return;
    this.listing?.abort(); const controller = new AbortController(); this.listing = controller;
    const generation = this.connectionGeneration; const client = this.client;
    this.publish({ refreshing: true, error: undefined });
    try {
      const result = await client.listCompanions(controller.signal);
      if (this.disposed || controller.signal.aborted || generation !== this.connectionGeneration) return;
      this.publish({ serverPacks: result.companions, diagnostics: result.diagnostics, refreshing: false });
      const key = this.state.selectedKey;
      if (key.startsWith('server:')) {
        const pack = result.companions.find((pack) => `server:${pack.id}` === key);
        if (!pack) this.fallback('所选服务端形象已删除或不完整，已恢复内置助手形象');
        else await this.download(pack);
      }
    } catch {
      if (!this.disposed && !controller.signal.aborted && generation === this.connectionGeneration) {
        this.publish({ refreshing: false, error: '助手形象列表读取失败，请刷新重试；当前可用形象保持不变' });
        if (this.state.selectedKey.startsWith('server:') && this.state.activePack.key !== this.state.selectedKey) this.fallback('没有可用的本地形象缓存，已恢复内置助手形象');
      }
    }
  }
  async select(key: CompanionKey) {
    this.preferenceGeneration++; this.selectionGeneration++; this.selection?.abort();
    this.publish({ error: undefined, notice: undefined, downloadingKey: undefined });
    if (key === 'builtin:penguin') { this.publish({ selectedKey: key, activePack: this.builtin }); this.save(key); return; }
    const pack = this.state.serverPacks.find((pack) => `server:${pack.id}` === key);
    if (!this.state.connected || !pack) { this.publish({ error: '请先连接服务器并刷新形象列表' }); return; }
    this.publish({ selectedKey: key }); await this.download(pack);
  }
  private async download(pack: CompanionPackSummary) {
    const client = this.client; const scope = this.scope; if (!client || !scope || !this.state.connected) return;
    this.selection?.abort(); const controller = new AbortController(); this.selection = controller;
    const selection = ++this.selectionGeneration; const connection = this.connectionGeneration; const key: CompanionKey = `server:${pack.id}`;
    this.publish({ downloadingKey: key });
    try {
      const cached = await this.cache.prepare(scope, pack, async (state) => {
        const bytes = await client.fetchCompanionAsset(pack.id, state, controller.signal);
        // 资源 URL 不含版本，最后回读摘要防止下载途中安装新版导致混合状态图。
        if (state === 'stopped') {
          const latest = await client.getCompanion(pack.id, controller.signal);
          if (latest.version !== pack.version) throw new Error('形象版本已变化，请刷新后重试');
        }
        return bytes;
      }, controller.signal);
      if (!this.current(selection, connection, controller)) throw companionAbort();
      this.publish({ selectedKey: key, activePack: { key, name: pack.name, description: pack.description, images: cached.images },
        cachedImages: { ...this.state.cachedImages, [key]: cached.images }, downloadingKey: undefined, error: undefined }); this.save(key);
    } catch (error) {
      if (this.current(selection, connection, controller)) {
        // 保留失败原因（客户端层错误文案已是面向用户的中文），便于用户判断是网络还是服务端问题。
        const reason = error instanceof Error && error.message ? `：${error.message}` : '';
        this.publish({ selectedKey: this.state.activePack.key, downloadingKey: undefined, error: `助手形象下载失败${reason}；仍使用当前可用形象，请重试` }); this.save(this.state.activePack.key);
      }
    }
  }
  dispose() {
    this.disposed = true; this.connectionGeneration++; this.selectionGeneration++;
    this.selection?.abort(); this.listing?.abort(); this.listeners.clear();
  }
}
