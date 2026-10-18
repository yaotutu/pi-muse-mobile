import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ApiProvider, useApi } from '../api/ApiProvider';
import { ConnectionProvider, useServiceConnection } from '../connection/ConnectionProvider';
import { ConnectionScreen } from '../connection/ConnectionScreen';
import { ServerSettingsScreen } from '../connection/ServerSettingsScreen';
import { useConnection } from '../connection/useConnection';
import type { ConnectionTest } from '../connection/types';
import { DemoApiClient } from '../demo/DemoApiClient';
import { DemoProvider } from '../demo/DemoProvider';
import { useThreads } from '../threads/useThreads';
import { Button } from '../ui/Buttons';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { OverlayVisibilityProvider } from '../ui/overlay-visibility';
import { ToastProvider } from '../ui/toast';
import { colors, layout, spacing, typography } from '../ui/tokens';
import { UpdateProvider } from '../update/UpdateProvider';
import type { UpdateManager } from '../update/update-manager';
import { useWorkspaceSnapshot } from '../workspace/useWorkspaceSnapshot';
import { PreviewRoot } from '../preview/PreviewRoot';
import { AppShell } from './AppShell';

function Workspace({ onDemo, onPreview }: { onDemo: () => void; onPreview: () => void }) {
  const api = useApi();
  const connection = useServiceConnection();
  const enabled = connection?.enabled ?? true;
  const refreshVersion = connection?.snapshot.refreshVersion ?? 0;
  const { snapshot, error, refresh } = useWorkspaceSnapshot(api, enabled, 5000, refreshVersion);
  const { threads, currentThread, selectThread, createThread, error: threadsError, reload } = useThreads(enabled, refreshVersion);
  return <AppShell snapshot={snapshot} snapshotError={error} refresh={() => void refresh()}
    threads={threads} currentThread={currentThread} threadsError={threadsError} reloadThreads={reload}
    onSelectThread={selectThread} onCreateThread={createThread} onDemo={onDemo} onPreview={onPreview} />;
}

function ServiceRoot({ active, onDemo, onPreview }: { active: boolean; onDemo: () => void; onPreview: () => void }) {
  const [editing, setEditing] = useState(false);
  const { manager, snapshot, client, enabled } = useConnection(active && !editing);
  const changeServer = useCallback(() => {
    if (manager.isCritical()) return;
    manager.setActive(false);
    manager.cancelTest();
    setEditing(true);
  }, [manager]);
  const enterDemo = useCallback(() => {
    if (manager.isCritical()) return;
    manager.setActive(false);
    manager.cancelTest();
    onDemo();
  }, [manager, onDemo]);
  const enterPreview = useCallback(() => {
    if (manager.isCritical()) return;
    manager.setActive(false);
    manager.cancelTest();
    onPreview();
  }, [manager, onPreview]);
  const save = useCallback(async (url: string, key: string, test?: ConnectionTest) => {
    await manager.saveServer(url, key, test);
    setEditing(false);
  }, [manager]);
  const cancelEdit = useCallback(() => { manager.cancelTest(); setEditing(false); }, [manager]);
  const blocking = ['loading', 'storage-error', 'resetting', 'reset-error'].includes(snapshot.status);
  const showWorkspace = !editing && !blocking && snapshot.hasToken;

  return <ConnectionProvider value={{ snapshot, enabled, retry: manager.retry, changeServer }}>
    <View style={{ flex: 1 }}>
      {client && snapshot.workspaceReady && <ApiProvider client={client}>
        <OverlayVisibilityProvider visible={showWorkspace && active}>
          <View style={{ flex: 1, display: showWorkspace ? 'flex' : 'none' }}>
            <ToastProvider key={snapshot.workspaceKey}><Workspace key={snapshot.workspaceKey} onDemo={enterDemo} onPreview={enterPreview} /></ToastProvider>
          </View>
        </OverlayVisibilityProvider>
      </ApiProvider>}
      {editing && !['resetting', 'loading'].includes(snapshot.status) ? <ServerSettingsScreen
        currentServerUrl={snapshot.serverUrl} busy={snapshot.busy}
        onTest={manager.testConnection} onCancelTest={manager.cancelTest} onSave={save} onCancel={cancelEdit} />
        : blocking ? <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas, padding: spacing.section, justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: layout.fullWidth, maxWidth: layout.loginMaxWidth, gap: spacing.lg }}>
            <Text style={{ ...typography.heading, color: colors.ink }}>{snapshot.status === 'loading' ? '正在恢复连接配置…' : snapshot.status === 'resetting' ? '正在清理旧服务器的本地数据…' : snapshot.status === 'reset-error' ? '本地数据清理未完成' : '无法读取连接配置'}</Text>
            {!!snapshot.serverUrl && <Text style={{ ...typography.muted, color: colors.muted }}>{snapshot.serverUrl}</Text>}
            {!!snapshot.error && <Text style={{ ...typography.muted, color: colors.danger }}>{snapshot.error}</Text>}
            {snapshot.status === 'storage-error' && <Button onPress={() => void manager.start()}>重试读取配置</Button>}
            {snapshot.status === 'reset-error' && <Button onPress={manager.retryReset}>重试清理本地数据</Button>}
            {!snapshot.busy && <Button onPress={changeServer}>更改服务器</Button>}
            <Button disabled={snapshot.busy} onPress={enterPreview}>新 UI 预览</Button>
            <Button disabled={snapshot.busy} onPress={enterDemo}>体验演示工作区</Button>
          </View>
        </SafeAreaView>
          : !snapshot.hasToken && <ConnectionScreen key={snapshot.workspaceKey}
            mode={!snapshot.serverUrl ? 'initial' : snapshot.workspaceReady ? 'authenticate' : 'configured'}
            serverUrl={snapshot.serverUrl} initialAccessKey={manager.getPendingKey()} busy={snapshot.busy} error={snapshot.error}
            onTest={manager.testConnection} onCancelTest={manager.cancelTest} onConnect={manager.connect}
            onSaveOffline={manager.saveServer} onChangeServer={changeServer} onDemo={enterDemo} onPreview={enterPreview} />}
    </View>
  </ConnectionProvider>;
}

function DemoRoot({ client, reset, exit, preview, active }: { client: DemoApiClient; reset: (empty?: boolean) => void; exit: () => void; preview: () => void; active: boolean }) {
  useEffect(() => () => client.dispose(), [client]);
  return <DemoProvider value={{ client, reset, exit, preview }}>
    <ApiProvider client={client}><OverlayVisibilityProvider visible={active}>
      <ToastProvider><Workspace onDemo={() => reset()} onPreview={preview} /></ToastProvider>
    </OverlayVisibilityProvider></ApiProvider>
  </DemoProvider>;
}

export default function AppRoot({ updateManager }: { updateManager?: UpdateManager } = {}) {
  const [demo, setDemo] = useState<{ client: DemoApiClient; generation: number }>();
  const [preview, setPreview] = useState(false);
  const enterDemo = useCallback((empty = false) => setDemo((previous) => ({ client: new DemoApiClient(empty), generation: (previous?.generation ?? 0) + 1 })), []);
  const enterPreview = useCallback(() => setPreview(true), []);
  return <SafeAreaProvider><ErrorBoundary title="应用运行异常"><UpdateProvider manager={updateManager}>
    <StatusBar style={preview ? 'light' : 'dark'} />
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, display: demo || preview ? 'none' : 'flex' }}><ServiceRoot active={!demo && !preview} onDemo={enterDemo} onPreview={enterPreview} /></View>
      {demo && <View style={{ flex: 1, display: preview ? 'none' : 'flex' }}>
        <DemoRoot key={demo.generation} client={demo.client} reset={enterDemo} exit={() => setDemo(undefined)} preview={enterPreview} active={!preview} />
      </View>}
      {preview && <PreviewRoot onExit={() => setPreview(false)} />}
    </View>
  </UpdateProvider></ErrorBoundary></SafeAreaProvider>;
}
