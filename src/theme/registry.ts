import { classicTheme } from './presets/classic';
import { darkTheme } from './presets/dark';
import { lightTheme } from './presets/light';
import type { ThemeDefinition } from './types';

/** 注册一套完整配色即可自动出现在选择器中，主题 ID 类型也由此推导。 */
export const themeRegistry = {
  classic: classicTheme,
  light: lightTheme,
  dark: darkTheme,
} as const satisfies Record<string, ThemeDefinition>;

export type ThemeId = keyof typeof themeRegistry;
export const availableThemes = Object.freeze(Object.values(themeRegistry));
export const DEFAULT_THEME_ID: ThemeId = 'classic';
export const DARK_THEME_ID: ThemeId = 'dark';

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && Object.hasOwn(themeRegistry, value);
}
