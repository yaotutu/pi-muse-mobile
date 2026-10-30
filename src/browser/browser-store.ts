import { ApiError } from '../api/errors';
import { buildLaunchUrl } from './contracts';
import type { BrowserClient, BrowserSnapshot, BrowserStore } from './types';

function toSafeErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return '认证失效，请重新登录';
    }
    if (err.status === 503) {
      return '远程桌面暂不可用，请稍后重试';
    }
    if (err.status === 408) {
      return '请求超时，请检查网络连接后重试';
    }
    if (err.status === 502) {
      return '服务器响应格式不正确，请确认服务版本';
    }
  }
  return '连接远程浏览器失败，请检查网络或服务状态';
}

export function createBrowserStore(api: BrowserClient, baseUrl: string): BrowserStore {
  let snapshot: BrowserSnapshot = {
    phase: 'idle',
    launchUrl: null,
    error: null,
  };

  let currentController: AbortController | null = null;
  let currentGeneration = 0;
  let disposed = false;

  const listeners = new Set<() => void>();

  function updateSnapshot(phase: BrowserSnapshot['phase'], launchUrl: string | null, error: string | null) {
    if (snapshot.phase === phase && snapshot.launchUrl === launchUrl && snapshot.error === error) {
      return;
    }
    snapshot = { phase, launchUrl, error };
    for (const listener of listeners) {
      listener();
    }
  }

  function getSnapshot(): BrowserSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function abortInFlight() {
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
    currentGeneration++;
  }

  function close() {
    abortInFlight();
    updateSnapshot('idle', null, null);
  }

  function dispose() {
    disposed = true;
    abortInFlight();
    updateSnapshot('idle', null, null);
    listeners.clear();
  }

  async function open() {
    if (disposed) return;

    abortInFlight();
    const generation = currentGeneration;
    const controller = new AbortController();
    currentController = controller;

    updateSnapshot('loading', null, null);

    try {
      const status = await api.getBrowserStatus(controller.signal);
      if (disposed || generation !== currentGeneration) return;

      if (!status.enabled) {
        updateSnapshot('disabled', null, null);
        return;
      }

      if (!status.desktopAvailable) {
        updateSnapshot('unavailable', null, null);
        return;
      }

      const ticket = await api.createBrowserDesktopTicket(controller.signal);
      if (disposed || generation !== currentGeneration) return;

      const absoluteUrl = buildLaunchUrl(baseUrl, ticket.launchPath);
      updateSnapshot('ready', absoluteUrl, null);
    } catch (err) {
      if (disposed || generation !== currentGeneration || controller.signal.aborted) {
        return;
      }
      updateSnapshot('error', null, toSafeErrorMessage(err));
    } finally {
      if (currentController === controller) {
        currentController = null;
      }
    }
  }

  return {
    getSnapshot,
    subscribe,
    open,
    close,
    dispose,
  };
}
