export type ConnectionRecord = {
  serverUrl: string;
  browserUrl?: string;
  token?: string;
  resetPending?: boolean;
};

export type ConnectionStatus = 'loading' | 'unconfigured' | 'connecting' | 'online' | 'offline' | 'authentication-required' | 'resetting' | 'reset-error' | 'storage-error';

export type ConnectionSnapshot = {
  status: ConnectionStatus;
  serverUrl?: string;
  browserUrl?: string;
  hasToken: boolean;
  workspaceReady: boolean;
  workspaceKey: number;
  refreshVersion: number;
  busy: boolean;
  error?: string;
};

export type ConnectionTest = { id: number; serverUrl: string };
