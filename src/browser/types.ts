export type BrowserStatus = {
  enabled: boolean;
  viewerPath: string | null;
  desktopPath: string | null;
  desktopAvailable: boolean;
};

export type BrowserDesktopTicket = {
  launchPath: string;
  expiresAt: string;
};

export interface BrowserClient {
  getBrowserStatus(signal?: AbortSignal): Promise<BrowserStatus>;
  createBrowserDesktopTicket(signal?: AbortSignal): Promise<BrowserDesktopTicket>;
}

export type BrowserPhase = 'idle' | 'loading' | 'disabled' | 'unavailable' | 'ready' | 'error';

export type BrowserSnapshot = {
  phase: BrowserPhase;
  launchUrl: string | null;
  error: string | null;
};

export interface BrowserStore {
  getSnapshot(): BrowserSnapshot;
  subscribe(listener: () => void): () => void;
  open(): void;
  close(): void;
  dispose(): void;
}
