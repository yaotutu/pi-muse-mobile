import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { UpdateProvider } from '../update/UpdateProvider';
import type { UpdateManager } from '../update/update-manager';
import { WorkspaceScreen } from '../workspace/WorkspaceScreen';

/** 唯一新版工作区持有真实连接；Android 更新仍与业务服务器和凭据隔离。 */
export default function AppRoot({ updateManager }: { updateManager?: UpdateManager } = {}) {
  return <SafeAreaProvider>
    <ErrorBoundary title="应用运行异常">
      <UpdateProvider manager={updateManager}>
        <WorkspaceScreen />
      </UpdateProvider>
    </ErrorBoundary>
  </SafeAreaProvider>;
}
