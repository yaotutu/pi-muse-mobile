/** 聊天滚动跟随策略：发送先回到新消息，用户手动上滚后停止自动锚定。 */
export class ScrollFollow {
  private nearBottom = true;
  private sendingJump = false;
  private sentContentChanged = false;
  private dragging = false;

  beginSend() {
    this.nearBottom = true;
    this.sendingJump = true;
    this.sentContentChanged = false;
    this.dragging = false;
  }
  onContentSizeChange() {
    if (this.sendingJump) this.sentContentChanged = true;
    return this.shouldAnchor();
  }
  onLayout() { return this.shouldAnchor(); }
  onScroll(atBottom: boolean): { anchor: boolean; showLatest: boolean } {
    if (this.sendingJump) {
      if (!this.sentContentChanged) return { anchor: false, showLatest: false };
      if (!atBottom) return { anchor: true, showLatest: false };
      this.sendingJump = false;
    }
    // 键盘与导航改变视口时也会产生 scroll；保留跟随意图，并用最终偏移补锚。
    if (this.dragging) this.nearBottom = atBottom;
    return { anchor: !this.dragging && this.nearBottom && !atBottom, showLatest: !this.nearBottom };
  }
  onDrag() { this.sendingJump = false; this.dragging = true; }
  onDragEnd(atBottom: boolean) {
    this.nearBottom = atBottom;
    this.dragging = false;
    return { anchor: false, showLatest: !this.nearBottom };
  }
  returnLatest() { this.nearBottom = true; this.sendingJump = false; this.dragging = false; }
  shouldAnchor() { return !this.dragging && (this.nearBottom || this.sendingJump); }
}

/** 将连续布局纠偏合并到下一帧；执行时重新检查当前空间是否仍需锚定。 */
export class ScrollAnchorFrame {
  private frame: number | null = null;

  constructor(
    private readonly requestFrame: (callback: () => void) => number,
    private readonly cancelFrame: (frame: number) => void,
    private readonly canAnchor: () => boolean,
    private readonly anchor: () => void,
  ) {}

  schedule() {
    if (this.frame !== null) return;
    this.frame = this.requestFrame(() => {
      this.frame = null;
      if (this.canAnchor()) this.anchor();
    });
  }

  cancel() {
    if (this.frame === null) return;
    this.cancelFrame(this.frame);
    this.frame = null;
  }
}
