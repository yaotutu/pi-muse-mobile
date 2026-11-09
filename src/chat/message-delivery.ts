export type PendingDeliveryStatus = 'sending' | 'failed' | 'unconfirmed';
export type MessageDelivery = 'saved' | 'pending' | 'failed' | 'unconfirmed';

/** 消息送达与助手运行是两件事；已经取得保存证据不能因回复失败改成未发送。 */
export function messageDelivery(role: 'user' | 'assistant', persisted: boolean, pending?: PendingDeliveryStatus): MessageDelivery | undefined {
  if (role !== 'user') return undefined;
  if (persisted) return 'saved';
  if (pending === 'failed' || pending === 'unconfirmed') return pending;
  return 'pending';
}

/** 唯一正常进度区使用真实运行状态；暂存对账不再伪装成气泡里的网络发送进度。 */
export function mainProgressLabel({ synchronized, running, label, pendingApprovals, pending, runObserved }: {
  synchronized: boolean; running: boolean; label: string; pendingApprovals: number;
  pending?: PendingDeliveryStatus; runObserved: boolean;
}): string {
  if (!synchronized) return label;
  if (pendingApprovals > 0) return `等待你的审批（${pendingApprovals} 项）`;
  if (running) return label;
  if (pending === 'unconfirmed') return '消息保存结果待确认';
  if (pending === 'failed') return '消息未发送';
  if (pending === 'sending') return runObserved ? '正在同步消息' : '正在发送';
  return label;
}
