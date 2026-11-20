import type { ApiClient } from '../api/contracts';
import { ApiError, isRequestCancelled } from '../api/errors';
import type {
  InformationItem,
  InformationPreferences,
  InformationRunOptions,
  InformationSettings,
  InformationStatus,
  SmsImportProgress,
} from './types';

export const SMS_REFRESH_INTERVAL_MS = 5_000;
const FAST_SMS_REFRESH_INTERVAL_MS = 1_500;
const INGEST_CHUNK_SIZE = 200;
const MAX_ITEM_CONTENT_LENGTH = 20_000;
const MAX_ITEM_TITLE_LENGTH = 500;
const MIN_VALID_TIMESTAMP_MS = Date.UTC(1990, 0, 1);

type SmsClient = Pick<
  ApiClient,
  'getSmsSettings' | 'getSmsPreferences' | 'listSmsItems' | 'getSmsStatus' | 'saveSmsSettings' | 'saveSmsPreferences' | 'ingestSmsItems' | 'triggerSmsRun'
>;
type SmsSnapshot = {
  settings: InformationSettings | null;
  preferences: InformationPreferences | null;
  status: InformationStatus | null;
  draftNotes: string;
  items: InformationItem[];
  loading: boolean;
  saving: boolean;
  ingesting: boolean;
  triggering: boolean;
  needsReadback: boolean;
  importProgress?: SmsImportProgress;
  error?: string;
  notice?: string;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const normalizeReceivedAt = (raw: string | undefined, fallbackIso: string): string => {
  if (!raw) return fallbackIso;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_VALID_TIMESTAMP_MS) return fallbackIso;
  return new Date(parsed).toISOString();
};

/** 连接内唯一短信数据所有者；自动回读只在设置页前台进行，不触发分析或覆盖未保存偏好。 */
export class SmsStore {
  private state: SmsSnapshot = {
    settings: null,
    preferences: null,
    status: null,
    draftNotes: '',
    items: [],
    loading: true,
    saving: false,
    ingesting: false,
    triggering: false,
    needsReadback: false,
  };
  private listeners = new Set<() => void>();
  private read?: { controller: AbortController; automatic: boolean };
  private writes = new Map<AbortController, 'saving' | 'ingesting' | 'triggering'>();
  private timer?: ReturnType<typeof setInterval>;
  private activeIntervalMs?: number;
  private visible = false;
  private foreground = false;
  private disposed = false;
  constructor(private api: SmsClient, private intervalMs = SMS_REFRESH_INTERVAL_MS) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<SmsSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setImportProgress = (importProgress?: SmsImportProgress) => this.publish({ importProgress });
  setDraftNotes = (draftNotes: string) => this.publish({ draftNotes });
  setVisible = (visible: boolean) => {
    this.visible = visible; this.schedule();
    if (visible && this.foreground) void this.reload(true);
  };
  setForeground = (foreground: boolean) => {
    this.foreground = foreground; this.schedule();
    // 回到前台也核对开关，防止离开设置页后继续沿用另一设备已关闭的监听配置。
    if (foreground) void this.reload(true);
  };
  private schedule() {
    if (this.visible && this.foreground && !this.disposed) {
      const nextInterval = this.state.status?.running
        ? Math.min(this.intervalMs, FAST_SMS_REFRESH_INTERVAL_MS)
        : this.intervalMs;
      if (!this.timer || this.activeIntervalMs !== nextInterval) {
        clearInterval(this.timer);
        this.activeIntervalMs = nextInterval;
        this.timer = setInterval(() => void this.reload(true), nextInterval);
      }
    } else {
      clearInterval(this.timer);
      this.timer = undefined;
      this.activeIntervalMs = undefined;
      if (this.read?.automatic) { this.read.controller.abort(); this.read = undefined; }
    }
  }
  reload = async (automatic = false) => {
    if (this.disposed || this.writes.size || (automatic && (this.read || this.state.needsReadback))) return;
    this.read?.controller.abort();
    const read = { controller: new AbortController(), automatic }; this.read = read;
    const { signal } = read.controller;
    try {
      const [settings, preferences, page, status] = await Promise.all([
        this.api.getSmsSettings(signal),
        this.api.getSmsPreferences(signal),
        this.api.listSmsItems({ limit: 10 }, signal),
        this.api.getSmsStatus(signal),
      ]);
      if (signal.aborted || this.read !== read || this.disposed) return;
      const clean = this.state.draftNotes === (this.state.preferences?.notes ?? '');
      const finishedBackgroundRun = Boolean(this.state.status?.running && !status.running);
      this.publish({
        settings,
        preferences,
        items: page.items,
        status,
        ...(clean ? { draftNotes: preferences.notes } : {}),
        ...(!status.running && this.state.importProgress?.phase === 'analyzing' ? { importProgress: undefined } : {}),
        ...(finishedBackgroundRun
          ? {
              notice: `历史短信全量分析完成：已处理 ${status.counts.processed} 条${status.counts.failed ? `，失败 ${status.counts.failed} 条` : ''}，已生成精炼简报`,
            }
          : {}),
        error: undefined,
        needsReadback: false,
      });
      this.schedule();
    } catch (error) {
      if (!signal.aborted && this.read === read && !isRequestCancelled(error)) this.publish({ error: `短信状态同步失败：${message(error)}，保留上次记录，可刷新核对。` });
    } finally {
      if (this.read === read) { this.read = undefined; this.publish({ loading: false }); }
    }
  };
  private async write<T>(kind: 'saving' | 'ingesting' | 'triggering', action: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void, native = false) {
    if (this.disposed || (!native && (this.writes.size || this.state.needsReadback))) return;
    // 先废弃旧 GET，避免写成功后迟到的旧开关/偏好又覆盖已确认状态。原生接入保留并发上报能力。
    this.read?.controller.abort(); this.read = undefined;
    const controller = new AbortController(); this.writes.set(controller, kind);
    this.publish({ [kind]: true, ...(!this.state.needsReadback ? { error: undefined } : {}) });
    try {
      const value = await action(controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      apply(value); return value;
    } catch (error) {
      if (!controller.signal.aborted) {
        this.publish({ needsReadback: true, importProgress: undefined, error: `${message(error)}。请刷新核对，不会自动重发或重跑。` });
      }
    } finally {
      this.writes.delete(controller);
      this.publish({ [kind]: [...this.writes.values()].includes(kind) });
      if (!this.writes.size) {
        if (!this.state.needsReadback) await this.reload(true);
      }
    }
  }
  toggleEnabled = async (enabled: boolean) => {
    const settings = this.state.settings; if (!settings) return;
    await this.write('saving', (signal) => this.api.saveSmsSettings({ ...settings, enabled }, signal),
      (updated) => this.publish({ settings: updated, notice: enabled ? '已开启独立短信处理' : '已关闭短信处理' }));
  };
  saveNotes = async () => {
    const notes = this.state.draftNotes;
    await this.write('saving', (signal) => this.api.saveSmsPreferences({ notes }, signal), (preferences) => this.publish({
      preferences, ...(this.state.draftNotes === notes ? { draftNotes: preferences.notes } : {}), notice: '已保存短信功能偏好',
    }));
  };
  ingestSms = async (content: string, title?: string, externalId?: string, receivedAt?: string) => {
    if (!content.trim()) return;
    const nowIso = new Date().toISOString();
    return this.write('ingesting', (signal) => this.api.ingestSmsItems([{
      source: 'sms',
      externalId: (externalId ?? `sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 256),
      content: content.slice(0, MAX_ITEM_CONTENT_LENGTH),
      title: title?.trim() ? title.trim().slice(0, MAX_ITEM_TITLE_LENGTH) : undefined,
      receivedAt: normalizeReceivedAt(receivedAt, nowIso),
    }], signal), (result) => this.publish({
      items: [...result, ...this.state.items.filter((item) => !result.some((next) => next.id === item.id))].slice(0, 10),
      notice: `已上报 ${result.length} 条信息到待处理队列`,
    }), !!externalId);
  };
  ingestBatch = async (
    items: { content: string; title?: string; externalId?: string; receivedAt?: string }[],
    options?: InformationRunOptions,
  ) => {
    const valid = items.filter((item) => item.content.trim());
    if (!valid.length) return;
    const nowIso = new Date().toISOString();
    const seenKeys = new Set<string>();
    const prepared = valid.map((item, index) => {
      let externalId = (item.externalId?.trim() || `sms-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 256);
      if (seenKeys.has(externalId)) {
        externalId = `${externalId.slice(0, 240)}-${index}`;
      }
      seenKeys.add(externalId);
      const rawTitle = item.title?.trim();
      return {
        source: 'sms',
        externalId,
        content: item.content.slice(0, MAX_ITEM_CONTENT_LENGTH),
        title: rawTitle ? rawTitle.slice(0, MAX_ITEM_TITLE_LENGTH) : undefined,
        receivedAt: normalizeReceivedAt(item.receivedAt, nowIso),
      };
    });
    const runOptions: InformationRunOptions = {
      background: options?.background ?? true,
      forceInitial: options?.forceInitial ?? true,
    };
    let alreadyAnalyzed = false;
    return this.write('ingesting', async (signal) => {
      const uploaded: InformationItem[] = [];
      for (let offset = 0; offset < prepared.length; offset += INGEST_CHUNK_SIZE) {
        const chunk = prepared.slice(offset, offset + INGEST_CHUNK_SIZE);
        this.publish({ importProgress: { phase: 'uploading', current: offset, total: prepared.length } });
        const result = await this.api.ingestSmsItems(chunk, signal, { bulkImport: true });
        uploaded.push(...result);
        this.publish({
          importProgress: {
            phase: 'uploading',
            current: Math.min(offset + chunk.length, prepared.length),
            total: prepared.length,
          },
        });
      }
      this.publish({ importProgress: { phase: 'analyzing', current: 0, total: prepared.length } });
      try {
        await this.api.triggerSmsRun(signal, runOptions);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          alreadyAnalyzed = uploaded.every((item) => item.status !== 'pending');
        } else {
          throw error;
        }
      }
      return uploaded;
    }, (result) => this.publish({
      items: [...result, ...this.state.items.filter((item) => !result.some((next) => next.id === item.id))].slice(0, 10),
      ...(alreadyAnalyzed ? { importProgress: undefined } : {}),
      notice: alreadyAnalyzed
        ? `本机 ${result.length} 条历史短信已全部导入并分析过，无需重复分析`
        : `已上报 ${result.length} 条历史短信，${runOptions.background ? '后台已开始全量分析' : '已完成初始全面分析'}`,
    }), true);
  };
  triggerRun = async (options?: InformationRunOptions) => {
    await this.write('triggering', (signal) => this.api.triggerSmsRun(signal, options), () => this.publish({
      notice: options?.background ? '后台分析已启动，正在排空队列…' : '本轮信息分析已完成，请查看条目状态',
    }));
  };
  dispose = () => {
    this.disposed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.activeIntervalMs = undefined;
    this.read?.controller.abort();
    this.read = undefined;
    for (const controller of this.writes.keys()) controller.abort();
    this.listeners.clear();
  };
}
