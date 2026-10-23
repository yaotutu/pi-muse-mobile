import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { RuntimeStore, spaceRuntime } from './runtime-store';
import { ApprovalStore } from '../approvals/approval-store';
import { ApprovalProvider } from '../approvals/ApprovalProvider';
import { ActivityStore } from '../activities/activity-store';
import { ActivityProvider } from '../activities/ActivityProvider';
import { MemoryStore } from '../memories/memory-store';
import { MemoryProvider } from '../memories/MemoryProvider';
import { JobStore } from '../jobs/job-store';
import { JobProvider } from '../jobs/JobProvider';
import { GoalStore } from '../goals/goal-store';
import { GoalProvider } from '../goals/GoalProvider';
import { MonitorStore } from '../monitors/monitor-store';
import { MonitorProvider } from '../monitors/MonitorProvider';

const Context = createContext<RuntimeStore | null>(null);

/** 原生通知流仅前台订阅；开发 Web 的宿主可见性不等于 App 生命周期。 */
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const connection = useServiceConnection();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const approvals = useMemo(() => new ApprovalStore(api), [api]);
  const activities = useMemo(() => new ActivityStore(api), [api]);
  const memories = useMemo(() => new MemoryStore(api), [api]);
  const jobs = useMemo(() => new JobStore(api), [api]);
  const goals = useMemo(() => new GoalStore(api), [api]);
  const monitors = useMemo(() => new MonitorStore(api), [api]);
  const store = useMemo(() => new RuntimeStore(api, {
    onEvent: (event) => { approvals.receive(event); activities.receive(event); jobs.receive(event); },
    onConnection: (state) => { approvals.setConnection(state); activities.setConnection(state); },
  }), [api, approvals, activities, jobs]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  const enabled = !!connection?.enabled && (Platform.OS === 'web' || foreground);
  useEffect(() => {
    approvals.setActive(enabled); activities.setActive(enabled); memories.setActive(enabled); jobs.setActive(enabled); goals.setActive(enabled); monitors.setActive(enabled); store.setActive(enabled);
    return () => { store.setActive(false); approvals.setActive(false); activities.setActive(false); memories.setActive(false); jobs.setActive(false); goals.setActive(false); monitors.setActive(false); };
  }, [store, approvals, activities, memories, jobs, goals, monitors, enabled, connection?.snapshot.refreshVersion]);
  useEffect(() => () => { store.dispose(); approvals.dispose(); activities.dispose(); memories.dispose(); jobs.dispose(); goals.dispose(); monitors.dispose(); }, [store, approvals, activities, memories, jobs, goals, monitors]);
  return <Context.Provider value={store}><ApprovalProvider store={approvals}><ActivityProvider store={activities}><MemoryProvider store={memories}><JobProvider store={jobs}><GoalProvider store={goals}><MonitorProvider store={monitors}>{children}</MonitorProvider></GoalProvider></JobProvider></MemoryProvider></ActivityProvider></ApprovalProvider></Context.Provider>;
}

export function useRuntimeStore() {
  const store = useContext(Context);
  if (!store) throw new Error('RuntimeProvider is required');
  return store;
}
export function useSpaceRuntime(spaceId: string) {
  const store = useRuntimeStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...spaceRuntime(snapshot, spaceId), retry: store.retry, forgetSpace: (id: string) => store.forgetSpace(id) };
}
