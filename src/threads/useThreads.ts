import { useEffect, useState } from 'react';
import { isRequestCancelled } from '../api/errors';
import { useApi } from '../api/ApiProvider';
import type { ThreadInfo } from '../api/types';
import { MAIN_THREAD, mainThread, newThread } from './thread-state';

export function useThreads(enabled = true, refreshVersion = 0) {
  const api = useApi();
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [localThreads, setLocalThreads] = useState<ThreadInfo[]>([]);
  const [currentThread, selectThread] = useState(MAIN_THREAD);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const controller = new AbortController();
    api.listThreads(controller.signal)
      .then((items) => { if (alive) { setThreads(items); setError(undefined); } })
      .catch((e) => { if (alive && !isRequestCancelled(e)) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; controller.abort(); };
  }, [api, attempt, enabled, refreshVersion]);

  const createThread = () => {
    const thread = newThread();
    setLocalThreads((previous) => [thread, ...previous]);
    selectThread(thread.id);
  };
  // 首次列表响应不能覆盖用户在请求期间新建的旁支。
  const merged = [...localThreads, ...threads.filter((thread) => !localThreads.some((item) => item.id === thread.id))];
  return { threads: merged.length ? merged : [mainThread()], currentThread, selectThread, createThread, error, reload: () => setAttempt((value) => value + 1) };
}
