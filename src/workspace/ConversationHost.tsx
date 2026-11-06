/**
 * 每个已访问智能体保留自己的会话 Hook 与 SSE 所有者。仅在智能体删除、重置 epoch
 * 或当前连接整体销毁时卸载，切换页面和智能体只控制可见性。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAgentRuntime } from '../runtime/RuntimeProvider';
import { useAgentState } from '../agents/AgentProvider';
import type { NotificationReference } from '../group/contracts';
import { ConversationView } from './ConversationView';
import { conversationRefreshKey, reconcileConversationOwners } from './conversation-host-state';

function AgentConversation({ agentId, visible, refreshVersion, onSettled, onBindingMismatch, openConnection, onOpenApprovals, onContinueNotification }: {
  agentId: string; visible: boolean; refreshVersion: number;
  onSettled: (agentId: string) => void; onBindingMismatch: () => void; openConnection: () => void;
  onOpenApprovals?: () => void; onContinueNotification?: (reference: NotificationReference) => void;
}) {
  const session = useAgentState(agentId);
  const runtime = useAgentRuntime(agentId);
  const refreshKey = conversationRefreshKey(refreshVersion, runtime, session.sessionId);
  useEffect(() => {
    if (runtime.synchronized && runtime.conversationInvalidationSessionId && session.sessionId &&
      runtime.conversationInvalidationSessionId !== session.sessionId) onBindingMismatch();
  }, [runtime.synchronized, runtime.conversationInvalidationSessionId, session.sessionId, onBindingMismatch]);
  const settled = useCallback(() => onSettled(agentId), [onSettled, agentId]);
  return <View style={[styles.owner, !visible && styles.hidden]} accessibilityElementsHidden={!visible}
    importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} pointerEvents={visible ? 'auto' : 'none'}>
    <ConversationView key={`${agentId}:${session.epoch}`} agentId={agentId} visible={visible} refreshKey={refreshKey}
      onSettled={settled} openConnection={openConnection} onOpenApprovals={onOpenApprovals} onContinueNotification={onContinueNotification} />
  </View>;
}

export function ConversationHost({ currentAgentId, agentIds, chatVisible, otherPage, refreshVersions, onSettled, onBindingMismatch, openConnection, onOpenApprovals, onContinueNotification }: {
  currentAgentId: string; agentIds: string[]; chatVisible: boolean; otherPage: ReactNode;
  refreshVersions: Record<string, number>; onSettled: (agentId: string) => void; onBindingMismatch: () => void; openConnection: () => void;
  onOpenApprovals?: () => void; onContinueNotification?: (reference: NotificationReference) => void;
}) {
  const [visited, setVisited] = useState<string[]>([currentAgentId]);
  // 同一 render 就挂载新智能体，不让发送入口等待 effect；列表移除后释放对应所有者。
  const owners = reconcileConversationOwners(visited, currentAgentId, agentIds);
  if (owners !== visited) setVisited(owners);
  return <View style={styles.host}>
    {owners.map((id) => <AgentConversation key={id} agentId={id} visible={chatVisible && id === currentAgentId}
      refreshVersion={refreshVersions[id] ?? 0} onSettled={onSettled} onBindingMismatch={onBindingMismatch} openConnection={openConnection} onOpenApprovals={onOpenApprovals} onContinueNotification={onContinueNotification} />)}
    {!chatVisible && <View style={styles.owner}>{otherPage}</View>}
  </View>;
}

const styles = StyleSheet.create({ host: { flex: 1, minHeight: 0 }, owner: { flex: 1, minHeight: 0 }, hidden: { display: 'none' } });
