/**
 * 助手形象状态机：把运行通知流的真实事实映射为八种形象状态。
 * 纯函数、无 React 依赖；图片与动画由 MuseCompanion 渲染，标签文案仍由 mainProgressLabel 单独维护。
 */
export type CompanionState =
  | 'idle'
  | 'thinking'
  | 'responding'
  | 'working'
  | 'waiting-approval'
  | 'success'
  | 'error'
  | 'stopped';

export const COMPANION_STATES: readonly CompanionState[] = [
  'idle', 'thinking', 'responding', 'working', 'waiting-approval', 'success', 'error', 'stopped',
];

/** 运行阶段来自 /api/events 的 session_status_updated；与 runtime/types.ts 的 RunPhase 保持一致。 */
export type CompanionRunPhase =
  | 'preparing'
  | 'waiting_model'
  | 'responding'
  | 'executing_tool'
  | 'waiting_subagents'
  | 'waiting_approval'
  | 'finalizing'
  | null;

export type CompanionInputs = {
  /** 通知流是否已同步；false 时形象整体置灰，不猜测运行状态。 */
  synchronized: boolean;
  /** 当前是否有 running 运行。 */
  running: boolean;
  /** running 运行的最新阶段。 */
  phase: CompanionRunPhase;
  /** 未决审批数量（优先级最高，必须被用户看见）。 */
  pendingApprovals: number;
  /** 客户端暂存：failed / unconfirmed / sending。 */
  pendingStatus?: 'sending' | 'failed' | 'unconfirmed';
  /** 最近一次终态运行的结果；进入瞬时庆祝/失败/停止姿态后回落 idle。 */
  lastOutcome?: 'succeeded' | 'failed' | 'cancelled';
};

/** 终态姿态展示时长；之后回 idle，除非被更高优先级状态取代。 */
export const COMPANION_OUTCOME_MS = 2200;

/**
 * 优先级：未同步(灰) > 暂存失败/未确认 > 未决审批 > 执行工具/子任务 > 回复 > 思考 > 瞬时结果 > idle。
 * 失败/未确认需要用户处理，保持 error 姿态不自动回落。
 */
export function companionState(inputs: CompanionInputs): CompanionState {
  if (!inputs.synchronized) return 'idle';
  if (inputs.pendingStatus === 'failed' || inputs.pendingStatus === 'unconfirmed') return 'error';
  if (inputs.pendingApprovals > 0) return 'waiting-approval';
  if (inputs.running) {
    if (inputs.phase === 'waiting_approval') return 'waiting-approval';
    if (inputs.phase === 'executing_tool' || inputs.phase === 'waiting_subagents') return 'working';
    if (inputs.phase === 'responding') return 'responding';
    return 'thinking';
  }
  if (inputs.pendingStatus === 'sending') return 'thinking';
  if (inputs.lastOutcome === 'succeeded') return 'success';
  if (inputs.lastOutcome === 'failed') return 'error';
  if (inputs.lastOutcome === 'cancelled') return 'stopped';
  return 'idle';
}

/** 状态是否为终态瞬时姿态（成功/停止自动回落；error 在有明确暂存问题时保持）。 */
export function isTransientOutcome(state: CompanionState): boolean {
  return state === 'success' || state === 'stopped';
}

const STATE_DESCRIPTIONS: Record<CompanionState, string> = {
  idle: '待机',
  thinking: '思考中',
  responding: '正在回复',
  working: '处理任务',
  'waiting-approval': '等待你的确认',
  success: '完成',
  error: '出现问题',
  stopped: '已停止',
};

export function describeCompanionState(state: CompanionState): string {
  return STATE_DESCRIPTIONS[state];
}
