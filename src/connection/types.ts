export type ConnectionRecord = {
  serverUrl: string;
  token?: string;
  resetPending?: boolean;
};

export type ConnectionStatus = 'loading' | 'unconfigured' | 'connecting' | 'online' | 'offline' | 'authentication-required' | 'resetting' | 'reset-error' | 'storage-error';

export type ConnectionSnapshot = {
  status: ConnectionStatus;
  serverUrl?: string;
  hasToken: boolean;
  workspaceReady: boolean;
  workspaceKey: number;
  refreshVersion: number;
  busy: boolean;
  error?: string;
};

export type ConnectionTest = { id: number; serverUrl: string };

export type ConnectionScreenProps = {
  mode: 'initial' | 'configured' | 'authenticate';
  serverUrl?: string;
  initialAccessKey?: string;
  busy: boolean;
  error?: string;
  onTest: (serverUrl: string, accessKey: string) => Promise<ConnectionTest>;
  onCancelTest: () => void;
  onConnect: (serverUrl: string, accessKey: string, test?: ConnectionTest) => Promise<void>;
  onSaveOffline: (serverUrl: string, accessKey: string) => Promise<void>;
  onChangeServer: () => void;
  onDemo: () => void;
  onPreview?: () => void;
};

export type ServerSettingsScreenProps = {
  currentServerUrl?: string;
  busy: boolean;
  onTest: (serverUrl: string, accessKey: string) => Promise<ConnectionTest>;
  onCancelTest: () => void;
  onSave: (serverUrl: string, accessKey: string, test?: ConnectionTest) => Promise<void>;
  onCancel: () => void;
};
