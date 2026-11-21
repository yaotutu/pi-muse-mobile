/**
 * 已打开会话的 Hook 与 SSE 持续挂载；切换会话或 Tab 只更新可见性。
 * 重置 epoch、删除会话或销毁连接时释放聊天生命周期。
 */
import { useCallback, useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSessionRuntime } from '../runtime/RuntimeProvider';
import { useSessionState } from '../sessions/SessionProvider';
import { ConversationView } from './ConversationView';
import { conversationRefreshKey } from './conversation-host-state';

function SessionConversation({ sessionId, visible, refreshVersion, onSettled, onBindingMismatch, openConnection, onOpenApprovals }: {
  sessionId: string; visible: boolean; refreshVersion: number;
  onSettled: (sessionId: string) => void; onBindingMismatch: () => void; openConnection: () => void;
  onOpenApprovals?: () => void;
}) {
  const session = useSessionState(sessionId);
  const runtime = useSessionRuntime(sessionId);
  const refreshKey = conversationRefreshKey(refreshVersion, runtime);
  useEffect(() => {
    if (runtime.synchronized && runtime.conversationInvalidationPiSessionId && session.piSessionId &&
      runtime.conversationInvalidationPiSessionId !== session.piSessionId) onBindingMismatch();
  }, [runtime.synchronized, runtime.conversationInvalidationPiSessionId, session.piSessionId, onBindingMismatch]);
  const settled = useCallback(() => onSettled(sessionId), [onSettled, sessionId]);
  return <View style={[styles.owner, !visible && styles.hidden]} accessibilityElementsHidden={!visible}
    importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} pointerEvents={visible ? 'auto' : 'none'}>
    <ConversationView key={`${sessionId}:${session.epoch}`} sessionId={sessionId} visible={visible} refreshKey={refreshKey}
      onSettled={settled} openConnection={openConnection} onOpenApprovals={onOpenApprovals} />
  </View>;
}

export function ConversationHost({ sessionIds, activeSessionId, chatVisible, otherPage, refreshVersions, onSettled, onBindingMismatch, openConnection, onOpenApprovals }: {
  sessionIds: readonly string[]; activeSessionId: string; chatVisible: boolean; otherPage: ReactNode;
  refreshVersions: Record<string, number>; onSettled: (sessionId: string) => void; onBindingMismatch: () => void; openConnection: () => void;
  onOpenApprovals?: () => void;
}) {
  // 不根据目录加载状态决定是否挂载 main，也不因切换到新闻/设置卸载 SSE。
  return <View style={styles.host}>
    {sessionIds.map((sessionId) => <SessionConversation key={sessionId} sessionId={sessionId} visible={chatVisible && sessionId === activeSessionId}
      refreshVersion={refreshVersions[sessionId] ?? 0} onSettled={onSettled} onBindingMismatch={onBindingMismatch}
      openConnection={openConnection} onOpenApprovals={onOpenApprovals} />)}
    {!chatVisible && <View style={styles.owner}>{otherPage}</View>}
  </View>;
}

const styles = StyleSheet.create({ host: { flex: 1, minHeight: 0 }, owner: { flex: 1, minHeight: 0 }, hidden: { display: 'none' } });
