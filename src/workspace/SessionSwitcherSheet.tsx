import type { SessionRecord } from '../sessions/types';
import { Sheet } from '../ui/Sheet';
import { ActionButton } from '../ui/ActionButton';
import { SessionRows } from './SessionListScreen';

/** 原生 Modal 隔离底层触控与读屏；选择只改变可见会话，不重建其 SSE 所有者。 */
export function SessionSwitcherSheet({ sessions, currentId, title = '切换会话', busy, onSelect, onCreate, onClose }: {
  sessions: readonly SessionRecord[]; currentId?: string; title?: string; busy: boolean;
  onSelect: (id: string) => void; onCreate: () => void; onClose: () => void;
}) {
  return <Sheet title={title} onClose={onClose}>
    <SessionRows sessions={sessions} currentId={currentId} onSelect={onSelect} />
    <ActionButton label="新建会话" onPress={onCreate} disabled={busy} />
  </Sheet>;
}
