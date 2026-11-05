import type { GroupInput, GroupSnapshot, RouteSuggestion } from './contracts';

type PendingDraft = { id: string; draft: string; target?: string; content: string; absent: boolean };
type ComposerSnapshot = { draft: string; target?: string; pending?: PendingDraft; suggestion?: RouteSuggestion };

/** 输入草稿与已提交正文分离：发送即交接所有权，不用模型回复完成来清输入框。
 * 未确认正文留在 pending；权威回读确认未接收后才能恢复，绝不自动重发或覆盖下一条草稿。
 */
export class GroupComposer {
  private state: ComposerSnapshot = { draft: '' };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ComposerSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setDraft = (draft: string) => { this.publish({ draft }); };
  setTarget = (target?: string) => { this.publish({ target }); };
  submit = (input: GroupInput): boolean => {
    if (this.state.pending || this.state.suggestion) return false;
    this.publish({ pending: { id: input.id, draft: this.state.draft, target: this.state.target, content: input.content, absent: false }, draft: '', target: undefined });
    return true;
  };
  suggest = (suggestion: RouteSuggestion) => {
    // 只接纳本次发送的建议；确认前不产生目标执行，不覆盖已经输入的下一条消息。
    if (this.state.pending?.id !== suggestion.id || this.state.pending.content !== suggestion.content) return;
    this.publish({ pending: undefined, suggestion });
  };
  cancelSuggestion = () => this.publish({ suggestion: undefined });
  confirmSuggestion = (id: string, targetAgentId: string): GroupInput | undefined => {
    const suggestion = this.state.suggestion;
    if (!suggestion || this.state.pending || !suggestion.targetAgentIds.includes(targetAgentId)) return;
    const content = suggestion.content;
    // 与普通提交相同地保留未确认原文，但不消费当前输入框里的新草稿。
    this.publish({ suggestion: undefined, pending: { id, content, draft: content, target: targetAgentId, absent: false } });
    return { id, content, targetAgentId };
  };
  accept = (id: string) => {
    if (this.state.pending?.id === id) this.publish({ pending: undefined });
  };
  reconcile = (snapshot: GroupSnapshot) => {
    const pending = this.state.pending;
    if (!pending) return;
    const turn = snapshot.turns.find((item) => item.id === pending.id);
    if (turn?.messages.some((message) => message.role === 'user')) { this.accept(pending.id); return; }
    if (snapshot.running === pending.id) return;
    // 只在发送结束后的权威 GET 使用；未接收的旧消息不得冲掉用户正在准备的新内容。
    this.publish({ pending: { ...pending, absent: true } });
    this.restore();
  };
  restore = (): boolean => {
    const pending = this.state.pending;
    if (!pending?.absent || this.state.draft || this.state.target) return false;
    this.publish({ draft: pending.draft, target: pending.target, pending: undefined });
    return true;
  };
  discard = () => {
    if (this.state.pending?.absent) this.publish({ pending: undefined });
  };
}
