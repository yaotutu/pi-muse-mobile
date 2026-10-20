/**
 * 设计 token —— 全项目视觉常量的唯一事实来源。
 *
 * 值逐项取自 OpenMuse 客户端（~/Desktop/code/openmuse/apps/mobile/src/ui.tsx），
 * 由 pi-muse-mobile 重新声明，不 import 对方代码。后续纯 Web 客户端（pi-muse-web）
 * 应把本文件同源翻译成 Tailwind @theme，改值只改这里，禁止在组件里散写色值/圆角。
 */

/** 颜色。命名按用途而非色相，方便整体换肤时对照替换。 */
export const colors = {
  /** 页面画布底色 */
  canvas: '#FCFCFC',
  /** 卡片底色 */
  card: '#FFFFFF',
  /** 主文字 */
  ink: '#11191C',
  /** 次级文字 */
  muted: '#697176',
  /** 描边 / 分割线 */
  line: '#EEEEF0',

  /** 用户气泡底 / 主按钮底（浅蓝） */
  bubbleUser: '#C8E7FF',
  /** 助手气泡底 / 工具卡底（灰） */
  bubbleAssistant: '#EEEEF0',
  /** 链接 / 图标 / 强调色 */
  accent: '#1473C8',

  /** 浅蓝底：iconBox、通知卡 */
  sky: '#EDF7FD',
  /** 成功底（浅绿） */
  successBg: '#E3F3E8',
  /** 成功文字 / 完成态（深绿） */
  success: '#47896C',
  /** 审核卡底（浅紫） */
  lavender: '#F0EEFA',
  /** 等待状态底（浅橙） */
  waiting: '#FDF0DF',

  /** 错误文字 */
  danger: '#AA4A45',
  /** 错误底 */
  dangerBg: '#FBEFED',

  /** 次级按钮底 */
  subtle: '#F1F2F3',
  /** 底部 tab 选中块底 */
  tabActive: '#F0F1F2',

  /** 代码块底（行内与块级统一） */
  codeBg: '#E2E4E7',

  /** 头像/iconBox 变体底色（应用页身份选择等） */
  avatarSky: '#ECF5FA',
  avatarSand: '#FAF0DF',
  avatarLilac: '#F1ECF9',

  /** 弹层遮罩：Sheet/Modal 背后的半透明暗色（值同 OpenMuse modalShade） */
  shade: 'rgba(35,48,44,0.25)',
  /** Sheet 抓手条：底部抽屉形态顶部的灰色小条 */
  grabber: '#D8DBDE',
  /** 底部 tab bar 胶囊描边（比 line 更浅，配合白底软阴影） */
  tabBarLine: '#F8F8F8',
  /** tab bar 软阴影投影色 */
  tabBarShadow: '#132631',
  /** 输入框默认描边（composer pill） */
  inputBorder: '#EEF0F2',
  /** 输入框聚焦描边（浅蓝） */
  inputFocusBorder: '#C7E4F9',
  /** 输入区软阴影投影色 */
  composerShadow: '#18384B',
  /** 进度条填充色（目标/任务进度） */
  progressFill: '#6AAEE0',
} as const;

/** 圆角体系。OpenMuse 的标志性大圆角，pill 类组件用完整半高圆角。 */
export const radius = {
  /** 卡片 */
  card: 23,
  /** Sheet 弹层 */
  sheet: 26,
  /** 消息气泡主体 */
  bubble: 22,
  /** 气泡"尾巴"角（靠发送方向一侧收小，形成方向感） */
  bubbleTail: 7,
  /** 输入框 pill */
  pill: 32,
  /** 底部 tab bar 容器 */
  tab: 40,
  /** tab bar 选中块 */
  tabItem: 28,
  /** 按钮 */
  button: 24,
  /** 表单输入框 */
  field: 19,
  /** 36×36 图标底盒 */
  iconBox: 13,
  /** 小胶囊（Chip / StatusBadge） */
  chip: 20,
  /** 错误/提示条 */
  notice: 14,
  /** 空状态图标底盒（55×55 大盒用） */
  emptyIcon: 18,
  /** 里程碑勾选框 */
  checkRow: 5,
  /** 精确圆角键：用于不属于通用圆角档位的局部几何。 */
  3: 3,
  4: 4,
  18: 18,
  22: 22,
} as const;

/**
 * 字号阶梯。[字号, 行高]，个别含字距（负字距是 OpenMuse 排版特征）。
 * label 用于全大写小标签（需配合 textTransform: 'uppercase'）。
 */
export const typography = {
  /** 正文 */
  text: { fontSize: 15, lineHeight: 23 },
  /** 次级说明 */
  muted: { fontSize: 14, lineHeight: 21 },
  /** 辅助小字 */
  small: { fontSize: 11, lineHeight: 17 },
  /** 全大写标签（配 letterSpacing 1.4 与 uppercase） */
  label: { fontSize: 10, lineHeight: 14, letterSpacing: 1.4 },
  /** 页面大标题 */
  title: { fontSize: 23, lineHeight: 28, letterSpacing: -0.7 },
  /** 卡片标题 */
  heading: { fontSize: 16, lineHeight: 22, letterSpacing: -0.25 },
  /** 工作台页大标题（比 title 大一档，OpenMuse 页头规格） */
  pageTitle: { fontSize: 25, lineHeight: 31, letterSpacing: -0.7 },
  /** 聊天正文（比普通正文大一档） */
  chat: { fontSize: 16, lineHeight: 24 },
  /** 空状态大标题 */
  empty: { fontSize: 28, lineHeight: 34, letterSpacing: -1 },
  /** 登录门大标题 */
  display: { fontSize: 32, lineHeight: 40, letterSpacing: -1 },
  /** 按钮文字 */
  button: { fontSize: 14, lineHeight: 20 },
  /** 胶囊小字（Chip / StatusBadge） */
  chip: { fontSize: 10, lineHeight: 14 },
} as const;

/** 布局常量：内容最大宽度（桌面也是居中窄栏，不做宽屏多栏）。 */
export const layout = {
  /** 内容区最大宽度 */
  contentMaxWidth: 760,
  /** 底部 tab bar 胶囊最大宽度 */
  tabBarMaxWidth: 370,
  /** 桌面断点：只影响顶栏高度与水平 padding，不改变布局结构 */
  desktopBreakpoint: 900,
  /** Sheet 底部抽屉形态断点（小于它用 slide-up 抽屉，否则居中模态） */
  sheetCompactBreakpoint: 600,
  /** Sheet 居中模态形态最大宽度 */
  sheetMaxWidth: 790,
  /** Sheet 宽形态（wide）最大宽度 */
  sheetWideMaxWidth: 1050,
  /** 登录门卡片最大宽度 */
  loginMaxWidth: 420,
  /** Sheet 最大高度，保留视口比例以适配不同设备 */
  sheetMaxHeight: '94%',
  /** 表单与内容栏占满父容器 */
  fullWidth: '100%',
  /** 用户消息气泡相对聊天栏的最大宽度 */
  userBubbleMaxWidth: '85%',
  /** 助手消息行宽度比例 */
  assistantRowWidth: '95%',
  /** 顶栏名称最大宽度比例 */
  topBarTitleWidth: '70%',
  /** Toast 内容最大宽度 */
  toastMaxWidth: 560,
  /** 空状态说明文字最大宽度 */
  emptyTextMaxWidth: 360,
  topBarHeight: 122,
  topBarDesktopHeight: 146,
  contentPadding: 22,
  contentDesktopPadding: 42,
  chatPadding: 17,
  chatLatestBottom: 96,
  toastBottom: 94,
} as const;

/** 布局间距集中声明；精确数值键保留既有视觉规格，常用语义键便于复用。 */
export const spacing = {
  /** 精确像素键：样式中遇到单次规格时直接用 spacing[值]，避免改动原值。 */
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  11: 11,
  12: 12,
  13: 13,
  14: 14,
  15: 15,
  16: 16,
  17: 17,
  18: 18,
  19: 19,
  20: 20,
  22: 22,
  24: 24,
  26: 26,
  28: 28,
  34: 34,
  36: 36,
  38: 38,
  40: 40,
  42: 42,
  44: 44,
  45: 45,
  47: 47,
  48: 48,
  /** 紧凑图标/文字间距 */
  xxs: 2,
  /** 紧凑行内间距 */
  xs: 4,
  /** 小间距 */
  sm: 8,
  /** 常规间距 */
  md: 12,
  /** 卡片内间距 */
  lg: 16,
  /** 区块间距 */
  xl: 22,
  /** 页面区块留白 */
  section: 24,
} as const;

/** 常用固定尺寸：用于统一命中区、图标盒与输入控件的几何规格。 */
export const sizing = {
  /** 精确尺寸键：用于单次出现的宽高与图标盒规格。 */
  borderWidth: 1,
  38: 38,
  3: 3,
  4: 4,
  6: 6,
  13: 13,
  14: 14,
  15: 15,
  16: 16,
  18: 18,
  19: 19,
  20: 20,
  22: 22,
  23: 23,
  24: 24,
  26: 26,
  28: 28,
  30: 30,
  34: 34,
  36: 36,
  42: 42,
  44: 44,
  47: 47,
  55: 55,
  58: 58,
  64: 64,
  70: 70,
  76: 76,
  94: 94,
  96: 96,
  120: 120,
  140: 140,
  360: 360,
  /** 常用触控命中区 */
  touchTarget: 44,
  avatar: 49,
  avatarDesktop: 58,
  /** 小图标 */
  iconSmall: 15,
  /** 中图标 */
  iconMedium: 18,
  /** 表单输入最小高度 */
  inputMinHeight: 45,
} as const;

/** 新版工作区共享几何与暗色基线。 */
export const workspaceTheme = {
  colors: {
    canvas: '#050505',
    surface: '#202020',
    control: '#343536',
    selected: '#292A2B',
    ink: '#F5F5F5',
    muted: '#96999D',
    faint: '#888B90',
    line: '#292929',
    blue: '#0878F9',
    onAccent: '#FFFFFF',
    danger: '#FF9992',
    success: '#A1D6B3',
    avatar: '#24282D',
    overlay: 'rgba(0,0,0,0.2)',
  },
  layout: {
    maxWidth: 760,
    sidePadding: 17,
    headerHeight: 156,
    chatContentTop: 172,
    imageRatio: 0.65,
    headerTop: 16,
    headerAvatar: 88,
    sessionAvatar: 72,
    sessionTop: 16,
    sessionNameTop: 24,
    sessionHeaderBottom: 24,
    controlSize: 50,
    smallControl: 44,
    iconSize: 25,
    navigationIconSize: 26,
    composerHeight: 52,
    composerMaxHeight: 128,
    composerPadding: 6,
    composerInputPadding: 14,
    composerBottom: 16,
    navigationHeight: 58,
    navigationBottom: 10,
    sessionTabsHeight: 60,
    sessionTabInset: 6,
    contentTop: 20,
    messageGap: 8,
    messagePadding: 17,
    imageWidth: '65%',
    userMessageWidth: '88%',
    drawerRatio: 0.78,
    drawerMaxWidth: 352,
    drawerTop: 26,
    drawerTitleBottom: 34,
    drawerRowHeight: 54,
    drawerFooterHeight: 72,
    gestureThreshold: 42,
    gestureAxisRatio: 1.3,
    edgeGestureWidth: 28,
    bubbleTail: 7,
    threadLabelGap: 8,
    stateDotSize: 8,
    typingDotSize: 8,
    typingWidth: 74,
    typingHeight: 48,
    timelineIconWidth: 42,
    listItemGap: 22,
    sampleLabelTop: 8,
    sampleLabelSize: 10,
    approvalPreviewMaxHeight: 300,
  },
  radius: {
    round: 999,
    message: 30,
    drawerForeground: 52,
    listItem: 14,
    tab: 32,
    image: 28,
    card: 22,
  },
  typography: {
    message: { fontSize: 17, lineHeight: 24 },
    name: { fontSize: 16, lineHeight: 22 },
    status: { fontSize: 14, lineHeight: 21 },
    heroName: { fontSize: 25, lineHeight: 34 },
    heroStatus: { fontSize: 18, lineHeight: 26 },
    section: { fontSize: 19, lineHeight: 28 },
    itemTitle: { fontSize: 18, lineHeight: 26 },
    detail: { fontSize: 16, lineHeight: 23 },
    caption: { fontSize: 12, lineHeight: 18 },
    drawerTitle: { fontSize: 28, lineHeight: 38 },
    input: { fontSize: 18, lineHeight: 26 },
  },
  motion: { drawerDuration: 280, feedbackDuration: 1800, replyDuration: 3600 },
  interaction: { disabledOpacity: 0.4 },
} as const;

export type WorkspaceAppearance = 'light' | 'dark';
export type WorkspaceColors = { readonly [Key in keyof typeof workspaceTheme.colors]: string };

/** 两种外观共用相同组件树和排版；蓝色气泡的前景色独立于普通正文。 */
export const workspacePalettes: Record<WorkspaceAppearance, WorkspaceColors> = {
  dark: workspaceTheme.colors,
  light: {
    canvas: '#FFFFFF',
    surface: '#F2F3F5',
    control: '#E9EBEF',
    selected: '#DDE1E7',
    ink: '#172027',
    muted: '#606A74',
    faint: '#717A84',
    line: '#E1E5EA',
    blue: '#0874ED',
    onAccent: '#FFFFFF',
    danger: '#B33730',
    success: '#267047',
    avatar: '#F6F4F7',
    overlay: 'rgba(23,32,39,0.12)',
  },
};
