import type { NotificationReference } from '../notifications/contracts';
/**
 * 每个已访问会话保留自己的会话 Hook 与 SSE 所有者。仅在会话删除、重置 epoch
 * 或当前连接整体销毁时卸载，切换页面和会话只控制可见性。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSessionRuntime } from '../runtime/RuntimeProvider';
import { useSessionState } from '../sessions/SessionProvider';
import { ConversationView } from './ConversationView';
import { conversationRefreshKey, reconcileConversationOwners } from './conversation-host-state';

function SessionConversation({ sessionId, visible, refreshVersion, onSettled, onBindingMismatch, openConnection, onOpenApprovals, onContinueNotification }: {
  sessionId: string; visible: boolean; refreshVersion: number;
  onSettled: (sessionId: string) => void; onBindingMismatch: () => void; openConnection: () => void;
  onOpenApprovals?: () => void; onContinueNotification?: (reference: NotificationReference) => void;
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
      onSettled={settled} openConnection={openConnection} onOpenApprovals={onOpenApprovals} onContinueNotification={onContinueNotification} />
  </View>;
}

export function ConversationHost({ currentSessionId, sessionIds, chatVisible, otherPage, refreshVersions, onSettled, onBindingMismatch, openConnection, onOpenApprovals, onContinueNotification }: {
  currentSessionId: string; sessionIds: string[]; chatVisible: boolean; otherPage: ReactNode;
  refreshVersions: Record<string, number>; onSettled: (sessionId: string) => void; onBindingMismatch: () => void; openConnection: () => void;
  onOpenApprovals?: () => void; onContinueNotification?: (reference: NotificationReference) => void;
}) {
  const [visited, setVisited] = useState<string[]>([currentSessionId]);
  // 同一 render 就挂载新会话，不让发送入口等待 effect；列表移除后释放对应所有者。
  const owners = reconcileConversationOwners(visited, currentSessionId, sessionIds);
  if (owners !== visited) setVisited(owners);
  return <View style={styles.host}>
    {owners.map((id) => <SessionConversation key={id} sessionId={id} visible={chatVisible && id === currentSessionId}
      refreshVersion={refreshVersions[id] ?? 0} onSettled={onSettled} onBindingMismatch={onBindingMismatch} openConnection={openConnection} onOpenApprovals={onOpenApprovals} onContinueNotification={onContinueNotification} />)}
    {!chatVisible && <View style={styles.owner}>{otherPage}</View>}
  </View>;
}

const styles = StyleSheet.create({ host: { flex: 1, minHeight: 0 }, owner: { flex: 1, minHeight: 0 }, hidden: { display: 'none' } });
