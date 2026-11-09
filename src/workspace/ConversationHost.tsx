import type { NotificationReference } from '../notifications/contracts';
/**
 * main 的会话 Hook 与 SSE 始终挂载；切换 Tab 只隐藏它。
 * 仅重置 epoch 或当前连接整体销毁时释放聊天生命周期。
 */
import { useCallback, useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSessionRuntime } from '../runtime/RuntimeProvider';
import { useSessionState } from '../sessions/SessionProvider';
import { ConversationView } from './ConversationView';
import { conversationRefreshKey } from './conversation-host-state';

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

export function ConversationHost({ chatVisible, otherPage, refreshVersions, onSettled, onBindingMismatch, openConnection, onOpenApprovals, onContinueNotification }: {
  chatVisible: boolean; otherPage: ReactNode;
  refreshVersions: Record<string, number>; onSettled: (sessionId: string) => void; onBindingMismatch: () => void; openConnection: () => void;
  onOpenApprovals?: () => void; onContinueNotification?: (reference: NotificationReference) => void;
}) {
  // 不根据目录加载状态决定是否挂载 main，也不因切换到新闻/设置卸载 SSE。
  return <View style={styles.host}>
    <SessionConversation sessionId="main" visible={chatVisible}
      refreshVersion={refreshVersions.main ?? 0} onSettled={onSettled} onBindingMismatch={onBindingMismatch} openConnection={openConnection} onOpenApprovals={onOpenApprovals} onContinueNotification={onContinueNotification} />
    {!chatVisible && <View style={styles.owner}>{otherPage}</View>}
  </View>;
}

const styles = StyleSheet.create({ host: { flex: 1, minHeight: 0 }, owner: { flex: 1, minHeight: 0 }, hidden: { display: 'none' } });
