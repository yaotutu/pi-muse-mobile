import type { ChatReadingPosition } from '../chat/chat-local-data';
import { ScrollFollow } from './scroll-follow';

export type MessageRowLayout = { y: number; height: number };

/** offset = 消息行顶部 y - 视口 scrollY；负值表示该行顶部已滚出视口。 */
export function selectReadingAnchor(
  ids: readonly string[],
  rows: ReadonlyMap<string, MessageRowLayout>,
  scrollY: number,
): ChatReadingPosition | null {
  const measured = ids.filter((id) => (rows.get(id)?.height ?? 0) > 0);
  const messageId = measured.find((id) => {
    const row = rows.get(id)!;
    return row.y + row.height > scrollY;
  }) ?? measured[measured.length - 1];
  if (!messageId) return null;
  return { messageId, offset: rows.get(messageId)!.y - scrollY, following: false };
}

/**
 * 保存的是消息锚点而非 scrollY。布局/程序滚动只更新几何，不改阅读意图；
 * 用户拖动（含惯性）才重选锚点，发送/点最新才显式恢复跟随。
 */
export class ConversationScroll extends ScrollFollow {
  private ids: readonly string[] = [];
  private rows = new Map<string, MessageRowLayout>();
  private localReady = false;
  private initialized = false;
  private anchor: ChatReadingPosition | null = null;
  private scrollY = 0;
  private viewportHeight = 0;
  private contentHeight = 0;

  updateMessages(localLoaded: boolean, saved: ChatReadingPosition | null, ids: readonly string[]) {
    this.ids = ids;
    const current = new Set(ids);
    for (const id of this.rows.keys()) if (!current.has(id)) this.rows.delete(id);
    this.localReady = localLoaded;
    // hydrate 的 state 通知可早于 views 的 React commit；空列表不消耗冷启动恢复资格。
    if (!localLoaded || !ids.length) return;
    if (!this.initialized) {
      this.initialized = true;
      this.restoreFollowing(saved?.following ?? true);
      this.anchor = saved?.following === false ? { ...saved } : null;
    }
    if (this.anchor && !current.has(this.anchor.messageId ?? '')) {
      // 近期缓存裁掉旧锚点时展示当前最早一行，仍保持阅读模式，不意外转为跟随。
      this.anchor = { messageId: ids[0], offset: 0, following: false };
    }
  }

  onRowLayout(id: string, layout: MessageRowLayout) {
    // display:none 的零尺寸不能覆盖最后一次可见测量。
    if (layout.height > 0 && this.ids.includes(id)) this.rows.set(id, layout);
  }
  onViewport(height: number) { if (height > 0) this.viewportHeight = height; }
  onContent(height: number) {
    if (height > 0) this.contentHeight = height;
    this.onContentSizeChange();
  }
  onViewportScroll(y: number, atBottom: boolean) {
    this.scrollY = Math.max(0, y);
    const result = this.onScroll(atBottom);
    if (this.isInteracting()) this.capture();
    return result;
  }
  override onDrag() {
    super.onDrag();
    // 即使本地读取/行测量尚未完成，用户动作也取消迟到的冷启动恢复。
    this.initialized = true;
    this.capture();
  }
  override onDragEnd(atBottom: boolean) {
    const result = super.onDragEnd(atBottom);
    this.capture();
    return result;
  }
  override beginSend() {
    super.beginSend();
    this.initialized = true;
    this.anchor = null;
  }
  override returnLatest() {
    super.returnLatest();
    this.initialized = true;
    this.anchor = null;
  }
  private capture() { this.anchor = selectReadingAnchor(this.ids, this.rows, this.scrollY); }

  /** 未恢复时不生成新的持久化位置，避免首帧的零偏移覆盖磁盘锚点。 */
  position(): ChatReadingPosition | null {
    if (!this.localReady || !this.initialized) return null;
    if (this.isFollowing()) return { messageId: null, offset: 0, following: true };
    return this.anchor ? { ...this.anchor } : null;
  }

  target(): { latest: true } | { y: number } | null {
    if (!this.localReady || !this.initialized || this.isInteracting() || this.viewportHeight <= 0 || this.contentHeight <= 0) return null;
    if (this.shouldAnchor()) return { latest: true };
    if (!this.anchor?.messageId) return null;
    const row = this.rows.get(this.anchor.messageId);
    if (!row) return null;
    const y = Math.max(0, Math.min(row.y - this.anchor.offset, this.contentHeight - this.viewportHeight));
    return Math.abs(y - this.scrollY) > 0.5 ? { y } : null;
  }
}
