/** 主题身份与明暗模式分离：经典蓝白和晨光白都是浅色，不可用 light 代替主题 ID。 */
export type ThemeAppearance = 'light' | 'dark';

/** 新增语义色须补齐所有主题；业务页面不得读取某一套主题的固定颜色。 */
export type ThemeColors = Readonly<{
  canvas: string;
  surface: string;
  newsCard: string;
  control: string;
  floatingSurface: string;
  floatingLine: string;
  panelVeil: string;
  selected: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  blue: string;
  blueSoft: string;
  accentText: string;
  onAccent: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  avatar: string;
  overlay: string;
  scrim: string;
}>;

export type ThemeDefinition = Readonly<{
  id: string;
  name: string;
  description: string;
  appearance: ThemeAppearance;
  colors: ThemeColors;
}>;
