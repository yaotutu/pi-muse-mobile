import { createContext, useContext, useSyncExternalStore } from 'react';
import { sessionRuntime, type RuntimeStore } from './runtime-store';

export const RuntimeContext = createContext<RuntimeStore | null>(null);
const noopSubscribe = () => () => {};
const emptySnapshot = () => null;
/** 聊天独立于目录挂载；无通知 Provider 的纯 Hook 测试仍能验证发送安全边界。 */
export function useOptionalSessionRuntime(sessionId: string) {
  const context = useContext(RuntimeContext);
  const store = context && typeof context.getSnapshot === 'function' ? context : null;
  const snapshot = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? emptySnapshot, store?.getSnapshot ?? emptySnapshot);
  return snapshot ? sessionRuntime(snapshot, sessionId) : null;
}
