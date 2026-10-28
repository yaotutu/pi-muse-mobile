/**
 * 驱动真实 useMessageFeedback Hook 的最小 React 测试支架。
 * 仅用于验证 Hook 状态机；真实 HTTP/CRUD 由独立 live 脚本验收。
 */
import React from 'react';
import type { ApiClient } from '../../src/api/contracts';
import { useMessageFeedback, type MessageFeedbackInput } from '../../src/feedback/useMessageFeedback';

export async function renderMessageFeedbackHook(api: ApiClient, input: MessageFeedbackInput) {
  let currentInput = input;
  let stateIndex = 0;
  let effectIndex = 0;
  let callbackIndex = 0;
  const states: unknown[] = [];
  const effects: Array<{ effect: () => void | (() => void); deps?: unknown[]; cleanup?: () => void }> = [];
  const callbacks: Array<{ callback: unknown; deps?: unknown[] }> = [];
  let unmounted = false;
  let cycleRunning = false;
  let cycleQueued = false;

  const internals = (React as unknown as Record<string, { H: unknown } | undefined>)
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals?.H;

  const scheduleCycle = () => {
    if (unmounted) return;
    if (cycleRunning) {
      cycleQueued = true;
      return;
    }
    queueMicrotask(() => {
      if (!unmounted) void runCycle();
    });
  };

  const dispatcher = {
    useState: (initial: unknown) => {
      const index = stateIndex++;
      if (states.length <= index) {
        states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      const setState = (next: unknown) => {
        states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(states[index]) : next;
        scheduleCycle();
      };
      return [states[index], setState];
    },
    useRef: (initial: unknown) => {
      const index = stateIndex++;
      if (states.length <= index) states[index] = { current: initial };
      return states[index];
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const index = effectIndex++;
      const previous = effects[index];
      const changed = !previous || !deps || !previous.deps ||
        deps.some((value, depIndex) => !Object.is(value, previous.deps![depIndex]));
      if (!changed) return;
      previous?.cleanup?.();
      effects[index] = { effect, deps };
      queueMicrotask(() => {
        if (unmounted) return;
        const cleanup = effect();
        if (typeof cleanup === 'function') effects[index].cleanup = cleanup;
      });
    },
    useCallback: <T,>(callback: T, deps?: unknown[]): T => {
      const index = callbackIndex++;
      const previous = callbacks[index];
      const changed = !previous || !deps || !previous.deps ||
        deps.some((value, depIndex) => !Object.is(value, previous.deps![depIndex]));
      if (changed) callbacks[index] = { callback, deps };
      return callbacks[index]!.callback as T;
    },
    useContext: () => api,
  };

  const result = { current: null as unknown as ReturnType<typeof useMessageFeedback> };

  async function runCycle(): Promise<void> {
    if (unmounted) return;
    if (cycleRunning) {
      cycleQueued = true;
      return;
    }
    cycleRunning = true;
    try {
      do {
        cycleQueued = false;
        stateIndex = 0;
        effectIndex = 0;
        callbackIndex = 0;
        if (internals) internals.H = dispatcher;
        try {
          result.current = useMessageFeedback(currentInput);
        } finally {
          if (internals) internals.H = previousDispatcher;
        }
      } while (cycleQueued && !unmounted);
    } finally {
      cycleRunning = false;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await runCycle();
  return {
    result,
    update: async (next: MessageFeedbackInput) => {
      currentInput = next;
      await runCycle();
    },
    unmount: () => {
      unmounted = true;
      for (const entry of effects) entry.cleanup?.();
      if (internals) internals.H = previousDispatcher;
    },
  };
}
