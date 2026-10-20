import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isRequestCancelled } from '../api/errors';
import { useApi } from '../api/ApiProvider';
import type { SpaceEntry } from '../api/types';
import { MAIN_SPACE, mainSpace, newSpace } from './space-state';
import { useSpaceStore } from './SpaceProvider';

export function useSpaces(enabled = true, refreshVersion = 0) {
  const api = useApi();
  const sessions = useSpaceStore();
  const [spaces, setSpaces] = useState<SpaceEntry[]>([]);
  const [localSpaces, setLocalSpaces] = useState<SpaceEntry[]>([]);
  const localRef = useRef<SpaceEntry[]>([]);
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
      const items = (await api.listSpaces(controller.signal)).filter((item) => !removed.current.has(item.id));
      if (controller.signal.aborted || generation.current !== version || sessions.getLifecycleVersion() !== lifecycle) return;
      const authoritative = items.some((item) => item.id === MAIN_SPACE) ? items : [mainSpace(), ...items];
      for (const item of items) sessions.bindSession(item.id, item.sessionId);
      setSpaces(authoritative);
      setError(undefined);
      // 首次 GET 不能丢掉用户刚建的本地空会话；一旦服务端确认存在，就不再用本地条目复活它。
      localRef.current = localRef.current.filter((item) => !authoritative.some((server) => server.id === item.id));
      setLocalSpaces(localRef.current);
      const active = currentRef.current;
      if (active !== MAIN_SPACE && !authoritative.some((item) => item.id === active) && !localRef.current.some((item) => item.id === active)) {
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

  const createSpace = () => {
    const space = newSpace();
    localRef.current = [space, ...localRef.current];
    setLocalSpaces(localRef.current);
    selectSpace(space.id);
  };
  const removeSpace = (id: string) => {
    generation.current++;
    request.current?.abort();
    removed.current.add(id);
    localRef.current = localRef.current.filter((item) => item.id !== id);
    setLocalSpaces(localRef.current);
    setSpaces((items) => items.filter((item) => item.id !== id));
    if (currentRef.current === id) selectSpace(MAIN_SPACE);
  };
  const merged = [...localSpaces, ...spaces.filter((space) => !localSpaces.some((item) => item.id === space.id))];
  const sourceSpaces = spaces.some((space) => space.id === MAIN_SPACE) ? spaces : [mainSpace(), ...spaces];
  return { spaces: merged.length ? merged : [mainSpace()], sourceSpaces, currentSpace, selectSpace, createSpace, removeSpace, error, reload };
}
