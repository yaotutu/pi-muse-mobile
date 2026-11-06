/**
 * 底部固定 Agent 偏好设置 Store。
 *
 * 架构与安全边界：
 * 1. 存储边界：纯设备/连接级显示偏好，不修改服务端 Agent 事实属性，不持久化明文凭据。
 * 2. 键名沿用：复用原有置顶存储键（按服务器地址安全编码），无缝继承用户既有置顶顺序（已有 pinned 数组本身有序）。
 * 3. 槽位上限：固定槽上限 DOCK_PIN_LIMIT=3。超出上限调用 togglePin 直接返回失败 (false) 并保留原状态，不静默截断。
 * 4. 读写代次与时序：通过 generation 代次与 writes 队列串行化落盘，防止并发竞态；迟到旧读取与旧写入错误绝不覆盖新状态。
 * 5. 输入校验：严格校验 ID 格式（字母、数字、下划线、连字符），'group'（全部视图）不可作为固定项。
 */

export const DOCK_PIN_LIMIT = 3;

export type DockPreferenceStorage = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
};

export type DockPreferences = {
  readonly pinned: readonly string[];
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error?: string;
};

/** 地址逐字符编码，与原有置顶存储键保持一致以继承用户已有置顶偏好。 */
export const getDockStorageKey = (serverUrl: string): string =>
  'pi-muse-avatar-pins-' + [...serverUrl].map((char) => char.charCodeAt(0).toString(16)).join('-');

export class DockPreferenceStore {
  private state: DockPreferences = { pinned: [], loading: true, saving: false };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly storage: DockPreferenceStorage) {}

  getSnapshot = (): DockPreferences => this.state;
  get snapshot(): DockPreferences {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<DockPreferences>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /**
   * 从存储加载固定列表。
   * 迟到读取保护：如果读取完成时 generation 已被新的用户操作推进，则丢弃旧读结果，不覆盖较新状态。
   * 不静默截断：如果历史存储中存在多于 3 项，原样读出保留，由用户后续操作自然收敛或在底栏只展示前 3 个槽。
   */
  async load(): Promise<void> {
    this.publish({ loading: true, error: undefined });
    const loadGeneration = this.generation;
    try {
      const raw = await this.storage.read();
      if (this.generation !== loadGeneration) return;
      const value: unknown = raw === null ? [] : JSON.parse(raw);
      if (
        !Array.isArray(value) ||
        value.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || id === 'group')
      ) {
        throw new Error('固定偏好格式不正确');
      }
      this.publish({ pinned: [...new Set<string>(value)], loading: false });
    } catch {
      if (this.generation === loadGeneration) {
        this.publish({ loading: false, error: '固定偏好读取失败，请重试' });
      }
    }
  }

  /**
   * 切换固定状态。
   * - 若 id 已固定：取消固定，成功返回 true。
   * - 若 id 未固定：检查上限，若当前已达到 DOCK_PIN_LIMIT 则直接返回 false（拒绝追加，保留原状态，不静默截断）；否则追加到末尾并写盘，成功返回 true。
   * - 'group' 属于全局视图，不可固定，直接返回 false。
   */
  async togglePin(id: string): Promise<boolean> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || id === 'group') {
      return false;
    }
    const isPinned = this.state.pinned.includes(id);
    if (!isPinned && this.state.pinned.length >= DOCK_PIN_LIMIT) {
      // 超过固定槽上限，直接拒绝并保留原状态，不静默截断
      return false;
    }
    const nextPinned = isPinned
      ? this.state.pinned.filter((item) => item !== id)
      : [...this.state.pinned, id];

    return this.persist(nextPinned);
  }

  /**
   * 调整固定 Agent 顺序。
   * 支持传入新的完整有序 ID 数组，或传入 (fromIndex, toIndex) 索引对。
   * 严格校验合法性与上限，失败返回 false 并保留原状态。
   */
  async reorder(orderOrFrom: readonly string[] | number, toIndex?: number): Promise<boolean> {
    let nextPinned: string[];
    if (Array.isArray(orderOrFrom)) {
      if (
        orderOrFrom.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id) || id === 'group') ||
        new Set(orderOrFrom).size !== orderOrFrom.length ||
        orderOrFrom.length > Math.max(DOCK_PIN_LIMIT, this.state.pinned.length)
      ) {
        return false;
      }
      nextPinned = [...orderOrFrom];
    } else if (typeof orderOrFrom === 'number' && typeof toIndex === 'number') {
      if (
        orderOrFrom < 0 ||
        orderOrFrom >= this.state.pinned.length ||
        toIndex < 0 ||
        toIndex >= this.state.pinned.length
      ) {
        return false;
      }
      nextPinned = [...this.state.pinned];
      const [moved] = nextPinned.splice(orderOrFrom, 1);
      nextPinned.splice(toIndex, 0, moved);
    } else {
      return false;
    }

    return this.persist(nextPinned);
  }

  /**
   * 串行持久化并保护代次：
   * 1. 乐观更新内存中的 pinned 状态，立即通知订阅者；
   * 2. 写入存储入队串行执行，避免并发写冲突；
   * 3. 若写盘失败，且在此期间没有更新的代次产生，则回退 pinned 并设置 error；
   * 4. 迟到完成的旧写入决不能覆盖更新代次的写入结果或错误状态。
   */
  private async persist(nextPinned: readonly string[]): Promise<boolean> {
    const previousPinned = this.state.pinned;
    const writeGen = ++this.generation;
    this.publish({ pinned: nextPinned, saving: true, error: undefined });

    const task = (async () => {
      try {
        await this.storage.write(JSON.stringify(nextPinned));
        if (this.generation === writeGen) {
          this.publish({ saving: false });
        }
        return true;
      } catch {
        if (this.generation === writeGen) {
          this.publish({ pinned: previousPinned, saving: false, error: '固定偏好保存失败，请重试' });
        }
        return false;
      }
    })();

    this.writes = this.writes.then(
      () => task.then(() => {}, () => {}),
      () => task.then(() => {}, () => {}),
    );
    return task;
  }

  /** 等待所有入队的写盘任务完成（便于测试及页面收尾同步）。 */
  whenSaved(): Promise<void> {
    return this.writes;
  }
}
