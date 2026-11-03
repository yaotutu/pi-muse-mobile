import type { NewsClient, NewsPreferences } from '../news/types';
import { isRequestCancelled } from '../api/errors';

type PreferencesClient = Pick<NewsClient, 'getNewsPreferences' | 'saveNewsPreferences'>;
type Snapshot = {
  preferences?: NewsPreferences;
  draftNotes: string;
  loading: boolean;
  saving: boolean;
  needsReadback: boolean;
  error?: string;
  notice?: string;
};
const message = (error: unknown) => error instanceof Error ? error.message : '新闻偏好请求失败';

/** 连接内保留明确偏好草稿和未明写入；离页不丢输入，换连接时销毁，不写设备存储。 */
export class NewsPreferencesStore {
  private state: Snapshot = { draftNotes: '', loading: false, saving: false, needsReadback: false };
  private listeners = new Set<() => void>();
  private read?: AbortController;
  private write?: AbortController;
  private active = false;
  private visible = false;
  private disposed = false;

  constructor(private client: PreferencesClient) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<Snapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private cancelRead() {
    this.read?.abort();
    this.read = undefined;
    this.publish({ loading: false });
  }
  setActive = (active: boolean) => {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.cancelRead();
    else if (this.visible) void this.reload(true);
  };
  open = () => {
    this.visible = true;
    if (this.active) void this.reload(true);
  };
  close = () => {
    this.visible = false;
    this.cancelRead();
  };
  setDraftNotes = (draftNotes: string) => this.publish({ draftNotes, notice: undefined });

  reload = async (automatic = false) => {
    // 离页重开和前台回读不能绕过结果未明锁；只有用户显式核对才解锁。
    if (this.disposed || this.write || (automatic && this.state.needsReadback)) return;
    this.cancelRead();
    const controller = new AbortController();
    this.read = controller;
    this.publish({ loading: true });
    try {
      const preferences = await this.client.getNewsPreferences(controller.signal);
      if (controller.signal.aborted || this.read !== controller || this.disposed) return;
      const clean = this.state.draftNotes === (this.state.preferences?.notes ?? '');
      this.publish({ preferences, ...(clean ? { draftNotes: preferences.notes } : {}),
        needsReadback: false, error: undefined });
    } catch (error) {
      if (!controller.signal.aborted && !isRequestCancelled(error)) {
        this.publish({ error: `${message(error)}。已保留草稿，请刷新核对。` });
      }
    } finally {
      if (this.read === controller) { this.read = undefined; this.publish({ loading: false }); }
    }
  };

  save = async () => {
    if (this.disposed || !this.state.preferences || this.write || this.state.needsReadback) return;
    // 保存先废弃旧 GET，防止迟到响应把已确认的偏好回滚。
    this.cancelRead();
    const notes = this.state.draftNotes;
    const controller = new AbortController();
    this.write = controller;
    this.publish({ saving: true, notice: undefined, error: undefined });
    try {
      const preferences = await this.client.saveNewsPreferences({ notes }, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      const unchanged = this.state.draftNotes === notes;
      this.publish({ preferences, ...(unchanged ? { draftNotes: preferences.notes } : {}),
        notice: unchanged ? '已保存新闻偏好，从下一轮筛选生效' : '提交的偏好已保存，后续修改尚未保存' });
    } catch (error) {
      if (!controller.signal.aborted) this.publish({ needsReadback: true,
        error: `${message(error)}。请先刷新核对，不会自动重发。` });
    } finally {
      if (this.write === controller) { this.write = undefined; this.publish({ saving: false }); }
    }
  };
  dispose = () => {
    this.disposed = true;
    this.cancelRead();
    this.write?.abort();
    this.listeners.clear();
  };
}
