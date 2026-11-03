import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isRequestCancelled } from '../api/errors';
import { useApi } from '../api/ApiProvider';
import type { SpaceEntry } from '../api/types';
import { MAIN_SPACE, mainSpace, newSpace } from './space-state';
import { useSpaceStore } from './SpaceProvider';
import { createMember } from './create-member';

export function useSpaces(enabled = true, refreshVersion = 0) {
  const api = useApi();
  const sessions = useSpaceStore();
  const [spaces, setSpaces] = useState<SpaceEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const creation = useRef<{ id: string; controller?: AbortController } | undefined>(undefined);
  const [currentSpace, setCurrentSpace] = useState(MAIN_SPACE);
  const currentRef = useRef(MAIN_SPACE);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const removed = useRef(new Set<string>());

  const selectSpace = useCallback((id: string) => {
    if (removed.current.has(id)) return;
    sessions.revive(id);
    currentRef.current = id;
    setCurrentSpace(id);
  }, [sessions]);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const version = ++generation.current;
    const lifecycle = sessions.getLifecycleVersion();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const items = (await api.listMembers(controller.signal)).filter((item) => !removed.current.has(item.id));
      if (controller.signal.aborted || generation.current !== version || sessions.getLifecycleVersion() !== lifecycle) return;
      const authoritative = items.some((item) => item.id === MAIN_SPACE) ? items : [mainSpace(), ...items];
      for (const item of items) if (item.sessionId) sessions.bindSession(item.id, item.sessionId);
      setSpaces(authoritative);
      setError(undefined);
      const active = currentRef.current;
      if (active !== MAIN_SPACE && !authoritative.some((item) => item.id === active)) {
        sessions.clear(active);
        selectSpace(MAIN_SPACE);
      }
    } catch (e) {
      if (!controller.signal.aborted && version === generation.current && !isRequestCancelled(e)) setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, enabled, sessions, selectSpace]);

  const cancelReload = useCallback(() => { generation.current++; request.current?.abort(); }, []);
  useEffect(() => {
    void reload();
    return cancelReload;
  }, [reload, refreshVersion, cancelReload]);
  // 另一设备可能已重置当前空间；前台先核对 sessionId，而不是仅靠消息 revision 判断。
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void reload(); });
    return () => subscription.remove();
  }, [reload]);

  useEffect(() => () => { creation.current?.controller?.abort(); }, []);
  const createSpace = async () => {
    if (!enabled || creation.current?.controller) return;
    const id = creation.current?.id ?? newSpace().id;
    const controller = new AbortController();
    creation.current = { id, controller };
    setCreating(true);
    try {
      const space = await createMember(api, id, controller.signal);
      if (controller.signal.aborted) return;
      // 废弃创建前发出的目录 GET，避免迟到的旧列表抹掉刚确认的成员。
      cancelReload();
      sessions.bindSession(id, space.sessionId);
      setSpaces((items) => [space, ...items.filter((item) => item.id !== id)]);
      creation.current = undefined;
      selectSpace(id);
      setError(undefined);
      return id;
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(`添加成员失败：${e instanceof Error ? e.message : String(e)}。可刷新核对，或再次点击添加确认同一成员。`);
        // 手动重试仍使用同一 ID；端点只确认存在，不重置已成功建立的空间。
        creation.current = { id };
      }
    } finally { if (!controller.signal.aborted) setCreating(false); }
  };
  const removeSpace = (id: string) => {
    generation.current++;
    request.current?.abort();
    removed.current.add(id);
    setSpaces((items) => items.filter((item) => item.id !== id));
    if (currentRef.current === id) selectSpace(MAIN_SPACE);
  };
  const workspaces = spaces.filter((space) => space.id !== 'news-internal' && space.id !== 'sms-internal');
  const sourceSpaces = workspaces.some((space) => space.id === MAIN_SPACE) ? workspaces : [mainSpace(), ...workspaces];
  return { spaces: spaces.length ? spaces : [mainSpace()], sourceSpaces, currentSpace, selectSpace, createSpace, creating, removeSpace, error, reload };
}
