import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ApprovalStore } from './approval-store';

const Context = createContext<ApprovalStore | null>(null);
/** store 由运行通知 Provider 同域创建；不持有第二条连接，也不另存审批正文。 */
export function ApprovalProvider({ store, children }: { store: ApprovalStore; children: ReactNode }) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useApprovals() {
  const store = useContext(Context);
  if (!store) throw new Error('ApprovalProvider is required');
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, snapshot };
}
