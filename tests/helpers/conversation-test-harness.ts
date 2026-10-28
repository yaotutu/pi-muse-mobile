/** A01 对话流程隔离测试支架（模拟 React 运行时驱动真实 Hook 与 SpaceStore 生产路径，非原生运行）。 */

import type { ApiClient, RunInput } from '../../src/api/contracts';
import type { AgUiEvent, ConversationSnapshot } from '../../src/api/types';
import type { AgentStatusResponse, RunStatus } from '../../src/runtime/types';

export type MockApiHandlers = {
  getConversation?: (spaceId: string, signal?: AbortSignal) => Promise<ConversationSnapshot>;
  runAgent?: (
    input: RunInput,
    onEvent: (event: AgUiEvent) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
  stopRun?: (spaceId: string, runId: string) => Promise<boolean>;
  getAgentStatus?: (spaceId: string, runId: string) => Promise<AgentStatusResponse>;
};

/** 构造最小可用的运行状态响应；测试只消费 status 字段。 */
export function agentStatusOf(spaceId: string, runId: string, status: RunStatus): AgentStatusResponse {
  return {
    instanceId: 'mock-instance',
    status: {
      activityId: null,
      spaceId,
      runId,
      revision: 1,
      source: 'chat',
      jobId: null,
      title: '',
      status,
      phase: null,
      label: '',
      tools: [],
      subagents: [],
      pendingApprovalIds: [],
      startedAt: '2026-10-22T00:00:00.000Z',
      updatedAt: '2026-10-22T00:00:00.000Z',
      endedAt: status === 'running' ? null : '2026-10-22T00:00:01.000Z',
    },
  };
}

export function createMockApi(handlers: MockApiHandlers = {}) {
  return {
    getConversation: handlers.getConversation ?? (async () => ({ sessionId: 'mock-session', messages: [], revision: 'rev-0' })),
    runAgent: handlers.runAgent ?? (async () => {}),
    stopRun: handlers.stopRun ?? (async () => true),
    getServerTimeZone: async () => 'Asia/Shanghai',
    createSession: async () => ({ token: 'mock-token', mode: 'token' }),
    listSpaces: async () => [],
    resetSpace: async (spaceId) => ({ ok: true, spaceId, sessionId: 'mock-session', removed: { jobs: 0, monitors: 0 }, cancelledApprovals: 0 }),
    getSnapshot: async () => ({ identity: { name: '', tone: '' } }),
    getSpaceInstructions: async (spaceId) => ({ instructions: '' }),
    saveSpaceInstructions: async (spaceId, instructions) => ({ instructions }),
    getSpaceSkills: async (spaceId) => ({ skills: [], diagnostics: [] }),
    saveSpaceSkills: async (spaceId, overrides) => ({ skills: [], diagnostics: [] }),
    deleteSpace: async () => ({ ok: true, removed: { jobs: 0, monitors: 0 } }),
    listJobs: async () => [],
    getJob: async () => ({} as any),
    controlJob: async () => ({} as any),
    updateJob: async () => ({} as any),
    deleteJob: async () => ({} as any),
    listMonitors: async () => { throw new Error('Not implemented in test harness'); },
    getMonitor: async () => { throw new Error('Not implemented in test harness'); },
    controlMonitor: async () => { throw new Error('Not implemented in test harness'); },
    deleteMonitor: async () => { throw new Error('Not implemented in test harness'); },
    listGoals: async () => [],
    getGoal: async () => ({} as any),
    createGoal: async () => ({} as any),
    updateGoal: async () => ({} as any),
    setGoalStatus: async () => ({} as any),
    toggleMilestone: async () => ({} as any),
    removeGoal: async () => ({} as any),
    saveIdentity: async () => ({} as any),
    getProfile: async () => ({ user: '', soul: '' }),
    saveProfile: async () => ({ user: '', soul: '' }),
    getAgentStatus: handlers.getAgentStatus ?? (async () => { throw Object.assign(new Error('运行不存在'), { status: 404 }); }),
    subscribeRuntime: async () => {},
    listApprovals: async () => ({ approvals: [], pending: [], history: [], hasMore: false, nextCursor: null }),
    getPendingApprovals: async () => [],
    getApproval: async () => ({} as any),
    decideApproval: async () => ({} as any),
    listActivities: async () => ({ activities: [], hasMore: false, nextCursor: null }),
    getActivity: async () => ({} as any),
    listMemories: async () => ({ memories: [] }),
    getMemory: async () => ({} as any),
    addMemory: async () => ({} as any),
    editMemory: async () => ({} as any),
    forgetMemory: async () => ({} as any),
  } satisfies Partial<ApiClient>;
}
