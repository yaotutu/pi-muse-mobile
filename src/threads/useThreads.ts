import { useCallback, useEffect, useRef, useState } from 'react';
import { isRequestCancelled } from '../api/errors';
import { useApi } from '../api/ApiProvider';
import type { ThreadInfo } from '../api/types';
import { MAIN_THREAD, mainThread, newThread } from './thread-state';
import { useThreadSessionStore } from './ThreadSessionProvider';

export function useThreads(enabled = true, refreshVersion = 0) {
  const api = useApi();
  const sessions = useThreadSessionStore();
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [localThreads, setLocalThreads] = useState<ThreadInfo[]>([]);
  const localRef = useRef<ThreadInfo[]>([]);
  const [currentThread, setCurrentThread] = useState(MAIN_THREAD);
  const currentRef = useRef(MAIN_THREAD);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const removed = useRef(new Set<string>());

  const selectThread = useCallback((id: string) => {
    if (removed.current.has(id)) return;
    sessions.revive(id);
    currentRef.current = id;
    setCurrentThread(id);
  }, [sessions]);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const version = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const items = (await api.listThreads(controller.signal)).filter((item) => !item.id.startsWith('task-') && !removed.current.has(item.id));
      if (controller.signal.aborted || generation.current !== version) return;
      const authoritative = items.some((item) => item.id === MAIN_THREAD) ? items : [mainThread(), ...items];
      setThreads(authoritative);
      setError(undefined);
      // 首次 GET 不能丢掉用户刚建的本地空会话；一旦服务端确认存在，就不再用本地条目复活它。
      localRef.current = localRef.current.filter((item) => !authoritative.some((server) => server.id === item.id));
      setLocalThreads(localRef.current);
      const active = currentRef.current;
      if (active !== MAIN_THREAD && !authoritative.some((item) => item.id === active) && !localRef.current.some((item) => item.id === active)) {
        sessions.clear(active);
        selectThread(MAIN_THREAD);
      }
    } catch (e) {
      if (!controller.signal.aborted && version === generation.current && !isRequestCancelled(e)) setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, enabled, sessions, selectThread]);

  const cancelReload = useCallback(() => { generation.current++; request.current?.abort(); }, []);
  useEffect(() => {
    void reload();
    return cancelReload;
  }, [reload, refreshVersion, cancelReload]);

  const createThread = () => {
    const thread = newThread();
    localRef.current = [thread, ...localRef.current];
    setLocalThreads(localRef.current);
    selectThread(thread.id);
  };
  const removeThread = (id: string) => {
    generation.current++;
    request.current?.abort();
    removed.current.add(id);
    localRef.current = localRef.current.filter((item) => item.id !== id);
    setLocalThreads(localRef.current);
    setThreads((items) => items.filter((item) => item.id !== id));
    if (currentRef.current === id) selectThread(MAIN_THREAD);
  };
  const merged = [...localThreads, ...threads.filter((thread) => !localThreads.some((item) => item.id === thread.id))];
  const sourceThreads = threads.some((thread) => thread.id === MAIN_THREAD) ? threads : [mainThread(), ...threads];
  return { threads: merged.length ? merged : [mainThread()], sourceThreads, currentThread, selectThread, createThread, removeThread, error, reload };
}
