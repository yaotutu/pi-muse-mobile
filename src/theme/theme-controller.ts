import { DARK_THEME_ID, DEFAULT_THEME_ID, isThemeId, themeRegistry, type ThemeId } from './registry';

export type ThemePreferenceStore = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
};

export type ThemeSelection = Readonly<{ themeId: ThemeId; lastLightThemeId: ThemeId }>;
export type ThemeState = Readonly<{
  selection: ThemeSelection;
  loading: boolean;
  saving: boolean;
  error?: string;
}>;

const initialSelection: ThemeSelection = { themeId: DEFAULT_THEME_ID, lastLightThemeId: DEFAULT_THEME_ID };

/** 本机偏好是不可信输入；未知版本、已移除主题或损坏 JSON 均安全回到经典蓝白。 */
export function parseThemePreference(raw: string | null): ThemeSelection {
  if (!raw) return initialSelection;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
      !('themeId' in value) || !isThemeId(value.themeId)) return initialSelection;
    const themeId = value.themeId;
    const lastLightThemeId = themeRegistry[themeId].appearance === 'light' ? themeId :
      'lastLightThemeId' in value && isThemeId(value.lastLightThemeId) && themeRegistry[value.lastLightThemeId].appearance === 'light'
        ? value.lastLightThemeId : DEFAULT_THEME_ID;
    return { themeId, lastLightThemeId };
  } catch { return initialSelection; }
}

/**
 * 仅管理主题偏好，不依赖连接、凭据或业务 store。切换立即生效，落盘串行执行。
 * 恢复读取与连续点击都带代次边界，迟到读取/写入失败不能覆盖用户最新选择。
 */
export class ThemeController {
  private current: ThemeState = { selection: initialSelection, loading: true, saving: false };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private loading?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly storage: ThemePreferenceStore) {}

  get state(): ThemeState { return this.current; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  load(): Promise<void> {
    if (this.loading) return this.loading;
    if (this.generation > 0) return Promise.resolve();
    const generation = this.generation;
    this.loading = (async () => {
      try {
        const raw = await this.storage.read();
        if (this.generation === generation) this.update({ selection: parseThemePreference(raw), loading: false });
      } catch {
        if (this.generation === generation) this.update({ loading: false, error: '主题偏好读取失败，本次仍可切换；重新选择后会再尝试保存。' });
      }
    })();
    return this.loading;
  }

  selectTheme(themeId: ThemeId): void {
    if (!isThemeId(themeId)) return;
    if (themeId === this.current.selection.themeId && !this.current.loading && !this.current.error) return;
    const generation = ++this.generation;
    const selection: ThemeSelection = {
      themeId,
      lastLightThemeId: themeRegistry[themeId].appearance === 'light' ? themeId : this.current.selection.lastLightThemeId,
    };
    this.update({ selection, loading: false, saving: true, error: undefined });
    this.writes = this.writes.then(async () => {
      try {
        // 只保存白名单字段；禁止将服务地址、Token 或正文混入主题偏好。
        await this.storage.write(JSON.stringify({ version: 1, ...selection }));
        if (this.generation === generation) this.update({ saving: false });
      } catch {
        if (this.generation === generation) this.update({ saving: false, error: '主题已切换，但未能保存到本机；请重新选择以重试。' });
      }
    });
  }

  /** 亮暗快捷键返回上次选择的浅色主题，不把经典蓝白强行替换成晨光白。 */
  toggleAppearance(): void {
    this.selectTheme(themeRegistry[this.current.selection.themeId].appearance === 'dark'
      ? this.current.selection.lastLightThemeId : DARK_THEME_ID);
  }

  whenSaved(): Promise<void> { return this.writes; }

  private update(patch: Partial<ThemeState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener();
  }
}
