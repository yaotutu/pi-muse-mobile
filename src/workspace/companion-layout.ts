import { sizing, spacing, workspaceTheme } from '../ui/tokens';

/** 形象与聊天共用纯几何，聊天不反向依赖悬浮 UI。所有坐标相对安全区顶部，数值派生自主题 token。 */
export const COMPANION_SIZE = sizing[64];
export const COMPANION_TOP = spacing[8];
export const COMPANION_STATUS_LINE_HEIGHT = workspaceTheme.typography.caption.lineHeight;
export const COMPANION_STATUS_GAP = spacing[4];
export const COMPANION_STATUS_PADDING = spacing[4];
export const COMPANION_CONTENT_INSET = COMPANION_TOP + COMPANION_SIZE + COMPANION_STATUS_GAP
  + COMPANION_STATUS_LINE_HEIGHT + COMPANION_STATUS_PADDING * 2 + spacing[12];
export const COMPANION_TRANSITION_MS = 280;

/** 状态只显示一行，但随系统字体增高；起排留白仍在 ScrollView 内容中随内容滚走。 */
export function companionContentInset(fontScale = 1): number {
  const scale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  return COMPANION_CONTENT_INSET + Math.ceil(COMPANION_STATUS_LINE_HEIGHT * (scale - 1));
}

/** 从同一个人物中心向最远角铺开；圆半径覆盖安全区，不借用页面平移伪装共享形象。 */
export function companionSurfaceGeometry(width: number, height: number) {
  const centerX = Math.max(0, width) / 2;
  const centerY = COMPANION_TOP + COMPANION_SIZE / 2;
  const radius = Math.ceil(Math.hypot(centerX, Math.max(centerY, height - centerY)));
  return { diameter: radius * 2, left: centerX - radius, top: centerY - radius };
}
