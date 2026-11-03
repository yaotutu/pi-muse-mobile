import type { ApiClient } from '../api/contracts';
import { isRequestCancelled } from '../api/errors';
import type { InformationItem, InformationPreferences, InformationSettings } from './types';

export const SMS_REFRESH_INTERVAL_MS = 5_000;
type SmsClient = Pick<ApiClient, 'getSmsSettings' | 'getSmsPreferences' | 'listSmsItems' | 'saveSmsSettings' | 'saveSmsPreferences' | 'ingestSmsItems' | 'triggerSmsRun'>;
type SmsSnapshot = {
  settings: InformationSettings | null; preferences: InformationPreferences | null; draftNotes: string;
  items: InformationItem[]; loading: boolean; saving: boolean; ingesting: boolean; triggering: boolean;
  needsReadback: boolean; error?: string; notice?: string;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 连接内唯一短信数据所有者；自动回读只在设置页前台进行，不触发分析或覆盖未保存偏好。 */
export class SmsStore {
  private state: SmsSnapshot = { settings: null, preferences: null, draftNotes: '', items: [], loading: true,
    saving: false, ingesting: false, triggering: false, needsReadback: false };
  private listeners = new Set<() => void>();
  private read?: { controller: AbortController; automatic: boolean };
  private writes = new Map<AbortController, 'saving' | 'ingesting' | 'triggering'>();
  private timer?: ReturnType<typeof setInterval>;
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
    clearInterval(this.timer);
    if (this.visible && this.foreground && !this.disposed) this.timer = setInterval(() => void this.reload(true), this.intervalMs);
    else if (this.read?.automatic) { this.read.controller.abort(); this.read = undefined; }
  }
  reload = async (automatic = false) => {
    if (this.disposed || this.writes.size || (automatic && (this.read || this.state.needsReadback))) return;
    this.read?.controller.abort();
    const read = { controller: new AbortController(), automatic }; this.read = read;
    const { signal } = read.controller;
    try {
      const [settings, preferences, page] = await Promise.all([
        this.api.getSmsSettings(signal), this.api.getSmsPreferences(signal), this.api.listSmsItems({ limit: 10 }, signal),
      ]);
      if (signal.aborted || this.read !== read || this.disposed) return;
      const clean = this.state.draftNotes === (this.state.preferences?.notes ?? '');
      this.publish({ settings, preferences, items: page.items, ...(clean ? { draftNotes: preferences.notes } : {}), error: undefined, needsReadback: false });
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
      if (!controller.signal.aborted) this.publish({ needsReadback: true, error: `${message(error)}。请刷新核对，不会自动重发或重跑。` });
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
    return this.write('ingesting', (signal) => this.api.ingestSmsItems([{ source: 'sms',
      externalId: externalId ?? `sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, content,
      title: title?.trim() || undefined, receivedAt: receivedAt ?? new Date().toISOString(),
    }], signal), (result) => this.publish({
      items: [...result, ...this.state.items.filter((item) => !result.some((next) => next.id === item.id))].slice(0, 10),
      notice: `已上报 ${result.length} 条信息到待处理队列`,
    }), !!externalId);
  };
  triggerRun = async () => {
    await this.write('triggering', (signal) => this.api.triggerSmsRun(signal), () => this.publish({ notice: '本轮信息分析已完成，请查看条目状态' }));
  };
  dispose = () => {
    this.disposed = true; clearInterval(this.timer); this.read?.controller.abort(); this.read = undefined;
    for (const controller of this.writes.keys()) controller.abort();
    this.listeners.clear();
  };
}
