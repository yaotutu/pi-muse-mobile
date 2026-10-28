/** 将消息旁的短菜单限制在可见窗口内；长消息覆盖视口时选空间较大的一侧。 */
export type MenuRect = { x: number; y: number; width: number; height: number };

export function positionFeedbackMenu(
  anchor: MenuRect,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  safe: { top: number; bottom: number },
  align: 'left' | 'right',
  gap: number,
  margin: number,
  originOffsetY: number,
) {
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));
  // 气泡和 Modal 若来自不同窗口原点，先统一纵坐标，再判断可用空间与边界。
  const anchorY = anchor.y + originOffsetY;
  const minY = safe.top + margin;
  const maxY = Math.max(minY, viewport.height - safe.bottom - margin - menu.height);
  const above = anchorY - minY;
  const below = viewport.height - safe.bottom - margin - anchorY - anchor.height;
  // 上下都放得下时靠可用空间较多的一侧；短消息不会因坐标修正后恰好能放上方而突然压住顶栏。
  const useAbove = above > below;
  const preferredY = useAbove ? anchorY - menu.height - gap : anchorY + anchor.height + gap;
  const preferredX = align === 'right' ? anchor.x + anchor.width - menu.width : anchor.x;
  return {
    x: clamp(preferredX, margin, Math.max(margin, viewport.width - margin - menu.width)),
    y: clamp(preferredY, minY, maxY),
  };
}
