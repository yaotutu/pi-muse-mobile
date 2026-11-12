/** 聊天滚动跟随策略：发送先回到新消息，用户手动上滚后停止自动锚定。 */
export class ScrollFollow {
  private nearBottom = true;
  private sendingJump = false;
  private sentContentChanged = false;
  private dragging = false;
  private momentumExpected = false;

  beginSend() {
    this.nearBottom = true;
    this.sendingJump = true;
    this.sentContentChanged = false;
    this.dragging = false;
    this.momentumExpected = false;
  }
  restoreFollowing(following: boolean) {
    this.nearBottom = following;
    this.sendingJump = false;
    this.dragging = false;
    this.momentumExpected = false;
  }
  isFollowing() { return this.nearBottom || this.sendingJump; }
  isInteracting() { return this.dragging; }
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
  onDrag() {
    this.sendingJump = false;
    this.nearBottom = false;
    this.dragging = true;
    this.momentumExpected = true;
  }
  onMomentumBegin() {
    // 程序 scroll 不获得用户手势资格；发送/点最新也会废弃旧惯性事件。
    if (!this.momentumExpected) return;
    this.momentumExpected = false;
    this.dragging = true;
  }
  suspendInteraction() {
    this.dragging = false;
    this.momentumExpected = false;
  }
  onDragEnd(atBottom: boolean) {
    this.nearBottom = atBottom;
    this.dragging = false;
    return { anchor: false, showLatest: !this.nearBottom };
  }
  returnLatest() {
    this.nearBottom = true;
    this.sendingJump = false;
    this.dragging = false;
    this.momentumExpected = false;
  }
  shouldAnchor() { return !this.dragging && (this.nearBottom || this.sendingJump); }
}

/** 将连续布局纠偏合并到下一帧；取消代次拒绝隐藏后快速返回时的迟到回调。 */
export class ScrollAnchorFrame {
  private frame: number | null = null;
  private generation = 0;

  constructor(
    private readonly requestFrame: (callback: () => void) => number,
    private readonly cancelFrame: (frame: number) => void,
    private readonly canAnchor: () => boolean,
    private readonly anchor: () => void,
  ) {}

  schedule() {
    if (this.frame !== null) return;
    const generation = ++this.generation;
    this.frame = this.requestFrame(() => {
      if (generation !== this.generation) return;
      this.frame = null;
      if (this.canAnchor()) this.anchor();
    });
  }

  cancel() {
    ++this.generation;
    if (this.frame === null) return;
    this.cancelFrame(this.frame);
    this.frame = null;
  }
}
