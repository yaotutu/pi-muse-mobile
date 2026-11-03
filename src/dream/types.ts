export const DREAM_PROMPT_LIMIT = 20_000;
export const MAIN_DREAM_AGENT = 'local-main';
export const DREAM_RUN_TIMEOUT_MS = 300_000;

export type DreamTarget = 'user' | 'soul' | 'instructions' | 'memory';
export type DreamPendingReason = 'ambiguous' | 'global_from_session' | 'no_purpose';
export type DreamRunStatus = 'running' | 'completed' | 'failed' | 'partial';

export type DreamPending = {
  id: string;
  text: string;
  suggestedTarget: DreamTarget;
  reason: DreamPendingReason;
  createdAt: string;
};

export type DreamRun = {
  at: string;
  status: DreamRunStatus;
  changed: readonly DreamTarget[];
  processed: number;
  error?: string;
};

export type DreamAgent = {
  agentId: string;
  enabled: boolean;
  inheritGlobalPrompt: boolean;
  cursor?: string;
  lastRun?: DreamRun;
  pending: readonly DreamPending[];
  prompt: string;
  purpose: string;
};

export type DreamOverview = {
  globalPrompt: string;
  defaultPrompt: string;
  intervalHours: number;
  running: boolean;
  agents: readonly DreamAgent[];
};

export type DreamAgentDraft = {
  enabled: boolean;
  inheritGlobalPrompt: boolean;
  prompt: string;
};

export type DreamAgentSettingsInput = Partial<DreamAgentDraft>;

export type DreamPendingDecision =
  | { action: 'apply'; target?: DreamTarget }
  | { action: 'dismiss' };

/**
 * HTTP 边界契约：所有 Dream 调用都接受可选 AbortSignal。
 * POST run 是同步等待受限模型轮，不是排队回执；客户端不得把它解释为远端已停止。
 */
export interface DreamClient {
  getDreamOverview(signal?: AbortSignal): Promise<DreamOverview>;
  saveGlobalDreamPrompt(prompt: string, signal?: AbortSignal): Promise<DreamOverview>;
  getAgentDream(agentId: string, signal?: AbortSignal): Promise<DreamAgent>;
  updateAgentDream(agentId: string, settings: DreamAgentSettingsInput, signal?: AbortSignal): Promise<DreamAgent>;
  runAgentDream(agentId: string, signal?: AbortSignal): Promise<DreamAgent>;
  resolveAgentDreamPending(agentId: string, pendingId: string, decision: DreamPendingDecision, signal?: AbortSignal): Promise<DreamAgent>;
}
