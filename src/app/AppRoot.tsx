import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { UpdateProvider } from '../update/UpdateProvider';
import type { UpdateManager } from '../update/update-manager';
import { WorkspaceScreen } from '../workspace/WorkspaceScreen';

/** 只挂载新版工作区；真实服务接入前不恢复凭据或启动业务轮询。 */
export default function AppRoot({ updateManager }: { updateManager?: UpdateManager } = {}) {
  return <SafeAreaProvider>
    <ErrorBoundary title="应用运行异常">
      <UpdateProvider manager={updateManager}>
        <WorkspaceScreen />
      </UpdateProvider>
    </ErrorBoundary>
  </SafeAreaProvider>;
}
