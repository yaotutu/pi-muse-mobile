import { HttpApiClient, type HttpApiOptions, type TransportState } from '../api/http-client';
import { isRequestCancelled, requestCancelled } from '../api/errors';
import type { ConnectionStore } from './connection-store';
import { normalizeServerAddress } from './server-address';
import type { ConnectionRecord, ConnectionSnapshot, ConnectionTest } from './types';

type ClientFactory = (url: string, getToken: () => string | undefined, onUnauthorized: (token?: string) => void, options: HttpApiOptions) => HttpApiClient;
type Dependencies = { store: ConnectionStore; clearWorkspaceData: () => Promise<void>; createClient?: ClientFactory };
type Probe = ConnectionTest & { token: string; key: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 管理器归属单个连接数据域；连接状态变化不能重建业务数据域。 */
export class ConnectionManager {
  private record?: ConnectionRecord;
  private client?: HttpApiClient;
  private credentials?: { token?: string };
  private listeners = new Set<(snapshot: ConnectionSnapshot) => void>();
  private operation = 0;
  private probeVersion = 0;
  private probeClient?: HttpApiClient;
  private lastProbe?: Probe;
  private active = false;
  private disposed = false;
  private critical = false;
  private unknownConfiguration = false;
  private createClient: ClientFactory;
  private state: ConnectionSnapshot = { status: 'loading', hasToken: false, workspaceReady: false, workspaceKey: 0, refreshVersion: 0, busy: false };

  constructor(private readonly dependencies: Dependencies) {
    this.createClient = dependencies.createClient ?? ((...args) => new HttpApiClient(...args));
  }

  getSnapshot = () => this.state;
  getClient = () => this.client;
  isCritical = () => this.critical;
  subscribe = (listener: (snapshot: ConnectionSnapshot) => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<ConnectionSnapshot>) {
    this.state = { ...this.state, ...patch, serverUrl: this.record?.serverUrl, hasToken: !!this.credentials?.token };
    for (const listener of this.listeners) listener(this.state);
  }
  private current(operation: number) { return !this.disposed && this.operation === operation; }
  private available() {
    if (this.disposed) throw requestCancelled();
    if (this.state.busy || this.critical) throw new Error('正在处理连接，请稍候');
  }

  private install(record: ConnectionRecord, replace: boolean) {
    this.record = { ...record };
    if (replace || !this.client) {
      this.client?.retire();
      const credentials = { token: record.token };
      this.credentials = credentials;
      let client: HttpApiClient;
      client = this.createClient(record.serverUrl, () => credentials.token,
        (token) => this.unauthorized(client, credentials, token),
        { onTransportState: (state) => this.transport(client, credentials, state) });
      this.client = client;
      this.state = { ...this.state, workspaceKey: this.state.workspaceKey + 1, workspaceReady: !!record.token && !record.resetPending };
    } else {
      this.credentials!.token = record.token;
      this.state = { ...this.state, workspaceReady: record.resetPending ? false : this.state.workspaceReady || !!record.token };
    }
    if (this.active && record.token && !record.resetPending) this.client.resume();
    else this.client.suspend();
  }

  private transport(client: HttpApiClient, credentials: { token?: string }, state: TransportState) {
    if (this.disposed || !this.active || this.critical || this.client !== client || !state.token || state.token !== credentials.token) return;
    if (state.kind === 'online') this.publish({ status: 'online', error: undefined });
    else this.publish({ status: 'offline', error: state.error ?? '服务器暂时不可用，请重试连接' });
  }

  private unauthorized(client: HttpApiClient, credentials: { token?: string }, sentToken?: string) {
    if (this.disposed || !this.active || this.critical || this.client !== client || !sentToken || sentToken !== credentials.token || !this.record) return;
    const operation = ++this.operation;
    const record: ConnectionRecord = { serverUrl: this.record.serverUrl };
    this.record = record;
    credentials.token = undefined;
    this.publish({ status: 'authentication-required', busy: false, error: '服务器拒绝了当前凭证，请在原地址重新认证' });
    // 先让当前401正常返回，再取消同域其他请求；不能用迟到401清新凭证。
    queueMicrotask(() => {
      if (this.current(operation) && this.client === client) client.suspend();
    });
    void this.dependencies.store.save(record).catch(() => {
      if (this.current(operation)) this.publish({ error: '凭证已失效，但无法更新本地存储，请检查存储权限后重新认证' });
    });
  }

  async start() {
    this.disposed = false;
    this.critical = false;
    const operation = ++this.operation;
    this.publish({ status: 'loading', busy: true, error: undefined });
    try {
      const record = await this.dependencies.store.load();
      if (!this.current(operation)) return;
      this.unknownConfiguration = false;
      if (!record) {
        this.client?.retire();
        this.record = undefined;
        this.client = undefined;
        this.credentials = undefined;
        this.publish({ status: 'unconfigured', busy: false, workspaceReady: false });
        return;
      }
      this.install(record, true);
      if (record.resetPending) {
        this.critical = true;
        try { await this.completeReset(operation); }
        finally { if (this.operation === operation) this.critical = false; }
      } else this.publish({ status: record.token ? 'connecting' : 'authentication-required', busy: false });
      if (this.current(operation) && this.active && this.record?.token) await this.retry();
    } catch (error) {
      if (!this.current(operation) || isRequestCancelled(error)) return;
      if (this.state.status === 'reset-error') return;
      this.unknownConfiguration = !this.record;
      this.publish({ status: 'storage-error', busy: false, error: message(error) });
    }
  }

  setActive(active: boolean) {
    if (this.active === active || this.disposed) return;
    this.active = active;
    if (!active) {
      if (!this.critical) { this.operation++; this.publish({ busy: false }); }
      this.cancelTest();
      this.client?.suspend();
    } else {
      if (this.record?.token && !this.record.resetPending) this.client?.resume();
      if (this.record?.token && !this.record.resetPending && !this.state.busy) void this.retry();
    }
  }

  cancelTest = () => {
    this.probeVersion++;
    this.lastProbe = undefined;
    this.probeClient?.retire();
    this.probeClient = undefined;
  };

  private async probe(serverUrl: string, key: string): Promise<ConnectionTest> {
    this.cancelTest();
    const id = this.probeVersion;
    let token = serverUrl === this.record?.serverUrl && !key ? this.credentials?.token : undefined;
    const client = this.createClient(serverUrl, () => token, () => {}, { timeoutMs: 10_000 });
    this.probeClient = client;
    try {
      if (!token) token = (await client.createSession(key || undefined)).token;
      if (this.disposed || id !== this.probeVersion || this.probeClient !== client) throw requestCancelled();
      await client.listSpaces();
      if (this.disposed || id !== this.probeVersion || this.probeClient !== client) throw requestCancelled();
      this.lastProbe = { id, serverUrl, token, key };
      return { id, serverUrl };
    } finally {
      client.retire();
      if (this.probeClient === client) this.probeClient = undefined;
    }
  }

  testConnection = async (input: string, key: string) => {
    this.available();
    const serverUrl = normalizeServerAddress(input);
    // 新的有效探测代表用户已修正输入；只清旧操作错误，不改变当前连接状态。
    this.publish({ error: undefined });
    return this.probe(serverUrl, key);
  };

  private verified(input: string, key: string, test?: ConnectionTest): Probe | undefined {
    if (!test) return undefined;
    if (!this.lastProbe || this.lastProbe.id !== test.id || test.serverUrl !== input || this.lastProbe.serverUrl !== input || this.lastProbe.key !== key) throw new Error('连接草稿已更改，请重新测试');
    return this.lastProbe;
  }

  retry = async () => {
    if (this.disposed || !this.active || this.state.busy || this.critical || !this.record || this.record.resetPending) return;
    if (!this.credentials?.token) return;
    const client = this.client!;
    const operation = ++this.operation;
    this.publish({ status: 'connecting', busy: true, error: undefined });
    try {
      await client.listSpaces();
      if (this.current(operation)) this.publish({ status: 'online', error: undefined, refreshVersion: this.state.refreshVersion + 1 });
    } catch (error) {
      if (this.current(operation) && !isRequestCancelled(error)) this.publish({ status: 'offline', error: message(error) });
    } finally {
      if (this.current(operation)) this.publish({ busy: false });
    }
  };

  saveConnection = async (input: string, key: string, options?: { test?: ConnectionTest; confirmChange?: boolean }) => {
    this.available();
    const serverUrl = normalizeServerAddress(input);
    const same = serverUrl === this.record?.serverUrl;
    const changesServer = this.unknownConfiguration || (this.record !== undefined && !same);
    if (changesServer && !options?.confirmChange) throw new Error('更改服务器会清理当前业务数据，请先确认');

    const before = this.state;
    const operation = ++this.operation;
    this.publish({ status: 'connecting', busy: true, error: undefined });
    let committed = false;
    try {
      // 直接保存也必须先认证；已传 proof 则严格绑定当前地址、Key 与探测序号。
      const proof = options?.test ? this.verified(serverUrl, key, options.test)! : await this.probe(serverUrl, key);
      if (!this.current(operation)) throw requestCancelled();
      const verified = this.verified(serverUrl, key, proof)!;

      this.critical = true;
      const reset = this.unknownConfiguration || !!this.record?.resetPending || (!!this.record && !same);
      const record: ConnectionRecord = { serverUrl, token: verified.token, ...(reset ? { resetPending: true } : {}) };
      // 先写清理日志再删业务数据；写入失败不能破坏仍有效的旧配置。
      await this.dependencies.store.save(record);
      if (!this.current(operation)) throw requestCancelled();
      committed = true;
      this.install(record, !same);
      this.unknownConfiguration = false;
      // 成功提交后立即释放 proof，避免旧证据被后续输入复用。
      this.cancelTest();
      if (reset) await this.completeReset(operation);
      else this.publish({ status: 'online', error: undefined, refreshVersion: this.state.refreshVersion + 1 });
    } catch (error) {
      if (this.current(operation) && (!this.critical || !committed)) {
        // 探测失败只恢复旧状态；401/网络错误不能被包装成存储损坏。
        const failureMessage = this.critical && !isRequestCancelled(error)
          ? '无法保存连接配置，请检查设备存储权限后重试'
          : message(error);
        this.publish({ ...before, status: before.status, busy: false, error: isRequestCancelled(error) ? before.error : failureMessage });
      }
      if (!committed) {
        if (isRequestCancelled(error)) throw error;
        if (!this.critical) throw error;
        throw new Error('无法保存连接配置，请检查设备存储权限后重试');
      }
    } finally {
      if (this.operation === operation) this.critical = false;
      if (this.current(operation)) this.publish({ busy: false });
    }
  };

  private async completeReset(operation: number) {
    this.publish({ status: 'resetting', busy: true });
    try {
      await this.dependencies.clearWorkspaceData();
      if (!this.current(operation)) throw requestCancelled();
      const record: ConnectionRecord = { serverUrl: this.record!.serverUrl, ...(this.record!.token ? { token: this.record!.token } : {}) };
      await this.dependencies.store.save(record);
      if (!this.current(operation)) throw requestCancelled();
      this.install(record, false);
      this.publish({ status: record.token ? 'connecting' : 'authentication-required', busy: false });
    } catch (error) {
      if (this.current(operation)) this.publish({ status: 'reset-error', busy: false, error: '本地数据清理未完成，请重试清理；旧缓存不会用于新服务器' });
      throw error;
    }
  }

  retryReset = async () => {
    if (this.disposed || this.state.busy || !this.record?.resetPending) return;
    const operation = ++this.operation;
    this.critical = true;
    try { await this.completeReset(operation); } catch { /* 清理失败已保留日志并显示，不能放行新数据域。 */ }
    finally { if (this.operation === operation) this.critical = false; }
    if (this.current(operation) && this.active && this.record?.token && !this.record.resetPending) void this.retry();
  };

  dispose() {
    this.disposed = true;
    this.active = false;
    this.operation++;
    this.cancelTest();
    this.client?.retire();
    this.listeners.clear();
  }
}
