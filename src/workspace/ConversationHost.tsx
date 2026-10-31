/**
 * 每个已访问空间保留自己的会话 Hook 与 SSE 所有者。仅在空间删除、重置 epoch
 * 或当前连接整体销毁时卸载，切换页面和空间只控制可见性。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSpaceRuntime } from '../runtime/RuntimeProvider';
import { useSpaceState } from '../spaces/SpaceProvider';
import { ConversationView } from './ConversationView';
import { conversationRefreshKey, reconcileConversationOwners } from './conversation-host-state';

function SpaceConversation({ spaceId, visible, compactHeader, refreshVersion, onSettled, onBindingMismatch, openConnection, onOpenApprovals }: {
  spaceId: string; visible: boolean; compactHeader: boolean; refreshVersion: number;
  onSettled: (spaceId: string) => void; onBindingMismatch: () => void; openConnection: () => void;
  onOpenApprovals?: () => void;
}) {
  const session = useSpaceState(spaceId);
  const runtime = useSpaceRuntime(spaceId);
  const refreshKey = conversationRefreshKey(refreshVersion, runtime, session.sessionId);
  useEffect(() => {
    if (runtime.synchronized && runtime.conversationInvalidationSessionId && session.sessionId &&
      runtime.conversationInvalidationSessionId !== session.sessionId) onBindingMismatch();
  }, [runtime.synchronized, runtime.conversationInvalidationSessionId, session.sessionId, onBindingMismatch]);
  const settled = useCallback(() => onSettled(spaceId), [onSettled, spaceId]);
  return <View style={[styles.owner, !visible && styles.hidden]} accessibilityElementsHidden={!visible}
    importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} pointerEvents={visible ? 'auto' : 'none'}>
    <ConversationView key={`${spaceId}:${session.epoch}`} spaceId={spaceId} visible={visible} compactHeader={compactHeader} refreshKey={refreshKey}
      onSettled={settled} openConnection={openConnection} onOpenApprovals={onOpenApprovals} />
  </View>;
}

export function ConversationHost({ currentSpaceId, spaceIds, chatVisible, compactHeader, otherPage, refreshVersions, onSettled, onBindingMismatch, openConnection, onOpenApprovals }: {
  currentSpaceId: string; spaceIds: string[]; chatVisible: boolean; compactHeader: boolean; otherPage: ReactNode;
  refreshVersions: Record<string, number>; onSettled: (spaceId: string) => void; onBindingMismatch: () => void; openConnection: () => void;
  onOpenApprovals?: () => void;
}) {
  const [visited, setVisited] = useState<string[]>([currentSpaceId]);
  // 同一 render 就挂载新空间，不让发送入口等待 effect；列表移除后释放对应所有者。
  const owners = reconcileConversationOwners(visited, currentSpaceId, spaceIds);
  if (owners !== visited) setVisited(owners);
  return <View style={styles.host}>
    {owners.map((id) => <SpaceConversation key={id} spaceId={id} visible={chatVisible && id === currentSpaceId} compactHeader={compactHeader}
      refreshVersion={refreshVersions[id] ?? 0} onSettled={onSettled} onBindingMismatch={onBindingMismatch} openConnection={openConnection} onOpenApprovals={onOpenApprovals} />)}
    {!chatVisible && <View style={styles.owner}>{otherPage}</View>}
  </View>;
}

const styles = StyleSheet.create({ host: { flex: 1, minHeight: 0 }, owner: { flex: 1, minHeight: 0 }, hidden: { display: 'none' } });
