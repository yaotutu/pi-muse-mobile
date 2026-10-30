import { ChevronLeft } from 'lucide-react-native';
import { useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme } from '../ui/tokens';
import { ActionButton } from '../ui/ActionButton';
import { IconControl } from '../ui/IconControl';
import type { BrowserStore } from './types';
import { isBrowserLaunchUrl, isBrowserNavigationAllowed } from './nav-safety';

const { typography: t, layout: l } = workspaceTheme;

/** 全屏 viewer 只承载服务端 noVNC 页面；关闭卸载 WebView，Chrome 本身由服务端继续运行。 */
export function BrowserPanel({ store, baseUrl, onClose }: { store: BrowserStore; baseUrl: string; onClose: () => void }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { colors } = useTheme();
  const [viewFailure, setViewFailure] = useState<{ launchUrl: string; message: string } | null>(null);
  const currentMainUrl = useRef<string | null>(null);
  const launchUrl = snapshot.launchUrl;
  const validLaunch = !!launchUrl && isBrowserLaunchUrl(baseUrl, launchUrl);
  const failure = viewFailure?.launchUrl === launchUrl ? viewFailure.message : null;
  const showViewer = snapshot.phase === 'ready' && validLaunch && !failure;
  const retry = () => { setViewFailure(null); currentMainUrl.current = null; store.open(); };

  const message = snapshot.phase === 'disabled' ? '服务器未启用浏览器。'
    : snapshot.phase === 'unavailable' ? '远程桌面暂时不可用，请稍后重试。'
      : snapshot.phase === 'error' ? '连接浏览器失败，请检查网络或服务状态。'
        : !validLaunch && snapshot.phase === 'ready' ? '浏览器启动地址无效，请重试。'
          : failure;

  return <SafeAreaView style={[styles.root, { backgroundColor: colors.canvas }]} edges={['top', 'bottom', 'left', 'right']}
    accessibilityViewIsModal testID="viewer-panel">
    <View style={[styles.header, { borderBottomColor: colors.line }]}>
      <IconControl icon={ChevronLeft} label="关闭浏览器" testID="viewer-close" onPress={onClose} />
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>浏览器</Text>
      <View style={styles.headerSpacer} />
    </View>
    {showViewer ? <WebView
      key={launchUrl}
      testID="viewer-webview"
      style={styles.viewer}
      source={{ uri: launchUrl }}
      // originWhitelist 的不匹配地址会交给系统浏览器；交给回调统一拒绝。
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={(request) => isBrowserNavigationAllowed(baseUrl, launchUrl, request.url, request.isTopFrame !== false)}
      onOpenWindow={() => { /* 新窗口一律丢弃，不打开外部应用。 */ }}
      javaScriptCanOpenWindowsAutomatically={false}
      incognito
      // 原生默认错误页可能包含失败地址；票据 URL 只留在 WebView source。
      renderError={() => <View style={styles.viewer} />}
      onLoadStart={(event) => {
        if (isBrowserNavigationAllowed(baseUrl, launchUrl, event.nativeEvent.url)) currentMainUrl.current = event.nativeEvent.url;
      }}
      onHttpError={(event) => {
        const { url, statusCode } = event.nativeEvent;
        if (url !== launchUrl && url !== currentMainUrl.current) return;
        setViewFailure({ launchUrl, message: statusCode === 401 ? '浏览器会话已失效，请重试。' : '浏览器页面无法加载，请重试。' });
      }}
      onError={(event) => {
        const { url } = event.nativeEvent;
        if (url !== launchUrl && url !== currentMainUrl.current) return;
        setViewFailure({ launchUrl, message: '浏览器连接中断，请检查网络后重试。' });
      }}
      onRenderProcessGone={() => setViewFailure({ launchUrl, message: '浏览器页面已停止，请重试。' })}
    /> : <View style={styles.state}>
      {snapshot.phase === 'loading' ? <><ActivityIndicator color={colors.accentText} /><Text style={[styles.message, { color: colors.muted }]}>正在连接浏览器…</Text></>
        : <><Text accessibilityRole="alert" style={[styles.message, { color: colors.muted }]}>{message}</Text>
          <ActionButton label="重试打开浏览器" text="重试" testID="viewer-retry" onPress={retry} /></>}
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 10 },
  header: { minHeight: l.controlSize + spacing[16], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: l.sidePadding, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSpacer: { width: l.controlSize }, title: { ...t.itemTitle },
  viewer: { flex: 1 }, state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[16], padding: spacing[24] },
  message: { ...t.detail, textAlign: 'center' },
});
