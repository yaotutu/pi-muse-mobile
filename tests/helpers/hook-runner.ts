/**
 * 驱动 useConversation 真实 Hook 的微型模拟 React 运行时（无 DOM / 外部测试库依赖）。
 *
 * 边界声明：这是模拟 React 的 Hook 契约测试，不是真实 React 渲染，也不是原生运行验收。
 * 与模拟实现的差异：
 * - 正确恢复 React 全局 dispatcher（不残留、不污染同进程其他 React 使用）；
 * - 订阅 SpaceStore 变更并触发重渲染（贴近真实 useSyncExternalStore 行为）；
 * - 卸载后丢弃一切排队的渲染周期，不再执行 Hook。
 */

import React from 'react';
import { SpaceStore } from '../../src/spaces/space-store';
import type { ApiClient } from '../../src/api/contracts';
import { useConversation } from '../../src/chat/useConversation';

type HookHandle<T> = {
  result: { current: T };
  rerender: () => Promise<void>;
  unmount: () => void;
};

export async function renderConversationHook(
  spaceId: string,
  api: ApiClient,
  store: SpaceStore,
  refreshKey = 0,
): Promise<HookHandle<ReturnType<typeof useConversation>>> {
  let stateIndex = 0;
  const states: unknown[] = [];
  let effectIndex = 0;
  const effects: Array<{ effect: () => void | (() => void); deps?: unknown[]; cleanup?: () => void }> = [];
  let callbackIndex = 0;
  const callbacks: Array<{ callback: unknown; deps?: unknown[] }> = [];
  let unmounted = false;
  let cycleRunning = false;
  let cycleQueued = false;

  const internals = (React as unknown as Record<string, { H: unknown } | undefined>)
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const prevH = internals?.H;

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
      const idx = stateIndex++;
      if (states.length <= idx) {
        states[idx] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      const setState = (next: unknown) => {
        states[idx] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(states[idx]) : next;
        scheduleCycle();
      };
      return [states[idx], setState];
    },
    useRef: (initial: unknown) => {
      const idx = stateIndex++;
      if (states.length <= idx) {
        states[idx] = { current: initial };
      }
      return states[idx];
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const idx = effectIndex++;
      const prev = effects[idx];
      let hasChanged = true;
      if (prev && prev.deps && deps) {
        hasChanged = deps.some((d, i) => !Object.is(d, prev.deps![i]));
      }
      if (hasChanged) {
        if (prev?.cleanup) {
          try {
            prev.cleanup();
          } catch {
            /* 测试支架忽略清理异常 */
          }
        }
        effects[idx] = { effect, deps };
        queueMicrotask(() => {
          if (unmounted) return;
          const cleanup = effect();
          if (typeof cleanup === 'function') {
            effects[idx].cleanup = cleanup;
          }
        });
      }
    },
    useCallback: <T>(callback: T, deps?: unknown[]): T => {
      const idx = callbackIndex++;
      const prev = callbacks[idx];
      let hasChanged = true;
      if (prev && prev.deps && deps) {
        hasChanged = deps.some((d, i) => !Object.is(d, prev.deps![i]));
      }
      if (hasChanged || !prev) {
        callbacks[idx] = { callback, deps };
        return callback;
      }
      return prev.callback as T;
    },
    // 测试进程内上下文按调用栈区分：SpaceProvider 系列返回 store，连接返回在线快照，其余为 ApiClient。
    useContext: (context: unknown) => {
      const stack = new Error().stack ?? '';
      if (stack.includes('useSpaceStore') || stack.includes('useSpaceState')) return store;
      if (stack.includes('useServiceConnection')) {
        return { enabled: true, snapshot: { status: 'online', refreshVersion: 0 }, retry: () => {} };
      }
      return api;
    },
    // 真实实现会订阅 store；订阅在 runCycle 外层建立，这里返回当前快照即可。
    useSyncExternalStore: (subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };

  const result = { current: null as unknown as ReturnType<typeof useConversation> };

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
        result.current = useConversation(spaceId, refreshKey);
        } finally {
          // 关键不变式：渲染结束立即恢复原 dispatcher，绝不在全局残留测试 dispatcher。
          if (internals) internals.H = prevH;
        }
      } while (cycleQueued && !unmounted);
    } finally {
      cycleRunning = false;
    }
    // 微任务队列中的 effect 在本轮渲染后入队；等待一轮让它们生效。
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // 贴近真实 useSyncExternalStore：store 变更驱动重渲染。
  const unsubscribe = store.subscribe(() => scheduleCycle());

  await runCycle();

  return {
    result,
    rerender: async (nextRefreshKey = refreshKey) => {
      refreshKey = nextRefreshKey;
      await runCycle();
    },
    unmount: () => {
      unmounted = true;
      unsubscribe();
      for (const eff of effects) {
        if (eff.cleanup) {
          try {
            eff.cleanup();
          } catch {
            /* 测试支架忽略清理异常 */
          }
        }
      }
      // 兜底恢复：保证任何路径下全局 dispatcher 都不残留。
      if (internals) internals.H = prevH;
    },
  };
}
