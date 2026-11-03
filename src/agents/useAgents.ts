import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isRequestCancelled } from '../api/errors';
import { useApi } from '../api/ApiProvider';
import type { AgentEntry } from '../api/types';
import { MAIN_AGENT, mainAgent, newAgent } from './agent-state';
import { useAgentStore } from './AgentProvider';
import { createMember } from './create-member';

export function useAgents(enabled = true, refreshVersion = 0) {
  const api = useApi();
  const sessions = useAgentStore();
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const creation = useRef<{ id: string; controller?: AbortController } | undefined>(undefined);
  const [currentAgent, setCurrentAgent] = useState(MAIN_AGENT);
  const currentRef = useRef(MAIN_AGENT);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const request = useRef<AbortController | undefined>(undefined);
  const removed = useRef(new Set<string>());

  const selectAgent = useCallback((id: string) => {
    if (removed.current.has(id)) return;
    sessions.revive(id);
    currentRef.current = id;
    setCurrentAgent(id);
  }, [sessions]);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const version = ++generation.current;
    const lifecycle = sessions.getLifecycleVersion();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const items = (await api.listAgents(controller.signal)).filter((item) => !removed.current.has(item.id));
      if (controller.signal.aborted || generation.current !== version || sessions.getLifecycleVersion() !== lifecycle) return;
      const authoritative = items.some((item) => item.id === MAIN_AGENT) ? items : [mainAgent(), ...items];
      for (const item of items) if (item.sessionId) sessions.bindSession(item.id, item.sessionId);
      setAgents(authoritative);
      setError(undefined);
      const active = currentRef.current;
      if (active !== MAIN_AGENT && !authoritative.some((item) => item.id === active)) {
        sessions.clear(active);
        selectAgent(MAIN_AGENT);
      }
    } catch (e) {
      if (!controller.signal.aborted && version === generation.current && !isRequestCancelled(e)) setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, enabled, sessions, selectAgent]);

  const cancelReload = useCallback(() => { generation.current++; request.current?.abort(); }, []);
  useEffect(() => {
    void reload();
    return cancelReload;
  }, [reload, refreshVersion, cancelReload]);
  // 另一设备可能已重置当前智能体；前台先核对 sessionId，而不是仅靠消息 revision 判断。
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void reload(); });
    return () => subscription.remove();
  }, [reload]);

  useEffect(() => () => { creation.current?.controller?.abort(); }, []);
  const createAgent = async () => {
    if (!enabled || creation.current?.controller) return;
    const id = creation.current?.id ?? newAgent().id;
    const controller = new AbortController();
    creation.current = { id, controller };
    setCreating(true);
    try {
      const agent = await createMember(api, id, controller.signal);
      if (controller.signal.aborted) return;
      // 废弃创建前发出的目录 GET，避免迟到的旧列表抹掉刚确认的成员。
      cancelReload();
      sessions.bindSession(id, agent.sessionId);
      setAgents((items) => [agent, ...items.filter((item) => item.id !== id)]);
      creation.current = undefined;
      selectAgent(id);
      setError(undefined);
      return id;
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(`添加成员失败：${e instanceof Error ? e.message : String(e)}。可刷新核对，或再次点击添加确认同一成员。`);
        // 手动重试仍使用同一 ID；端点只确认存在，不重置已成功建立的智能体。
        creation.current = { id };
      }
    } finally { if (!controller.signal.aborted) setCreating(false); }
  };
  const removeAgent = (id: string) => {
    generation.current++;
    request.current?.abort();
    removed.current.add(id);
    setAgents((items) => items.filter((item) => item.id !== id));
    if (currentRef.current === id) selectAgent(MAIN_AGENT);
  };
  const notificationTargets = agents;
  const sourceAgents = notificationTargets.some((agent) => agent.id === MAIN_AGENT) ? notificationTargets : [mainAgent(), ...notificationTargets];
  return { agents: agents.length ? agents : [mainAgent()], sourceAgents, currentAgent, selectAgent, createAgent, creating, removeAgent, error, reload };
}
