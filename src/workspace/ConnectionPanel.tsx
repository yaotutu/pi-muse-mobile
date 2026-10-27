/**
 * 连接配置只通过管理器保存；Key 仅驻留表单内存，测试成功不自动覆盖配置。
 * 更换服务器必须明确确认清除本地业务数据与旧凭据，绝不删除远端数据。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { IconControl } from '../ui/IconControl';
import { Card } from '../ui/Surfaces';
import {
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Server,
  X,
} from 'lucide-react-native';

import {
  workspaceTheme,
  sizing,
  spacing,
  type WorkspaceColors,
} from '../ui/tokens';
import type { ConnectionManager } from '../connection/connection-manager';
import type {
  ConnectionSnapshot,
  ConnectionTest,
} from '../connection/types';
import { useTheme } from '../theme/ThemeProvider';
import {
  describeStatus,
  isPlainHttp,
  tryNormalize,
  type StatusTone,
} from './connection-panel-helpers';
import { useReducedMotion } from './primitives';

// 内部归一化包装，不抛异常的便捷方法。
function normalizeSafe(input: string): string | undefined {
  const result = tryNormalize(input);
  return result.ok ? result.value : undefined;
}

// ─── 组件 ───────────────────────────────────────────────────────────────────

export interface ConnectionPanelProps {
  manager: ConnectionManager;
  snapshot: ConnectionSnapshot;
  onClose: () => void;
}

export function ConnectionPanel({ manager, snapshot, onClose }: ConnectionPanelProps) {
  const styles = useConnectionStyles();
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();

  // 草稿状态：URL/Key 仅在组件内存；保存成功后随面板卸载丢弃。
  const [url, setUrl] = useState<string>(snapshot.serverUrl ?? '');
  const [key, setKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [proof, setProof] = useState<ConnectionTest | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmChange, setConfirmChange] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [browserUrl, setBrowserUrl] = useState<string>(snapshot.browserUrl ?? '');
  const [browserBusy, setBrowserBusy] = useState(false);
  const [browserError, setBrowserError] = useState<string | undefined>();
  const [browserSaved, setBrowserSaved] = useState(false);

  // 草稿守卫：异步 resolve 时检查 unmounted + draftId 再写入本地 state。
  const operationRef = useRef(false);
  const unmountedRef = useRef<boolean>(false);
  const draftIdRef = useRef<number>(0);
  const initializedRef = useRef<boolean>(false);

  const normalizedStored = useMemo(
    () => normalizeSafe(snapshot.serverUrl ?? ''),
    [snapshot.serverUrl],
  );
  const normalizedInput = useMemo(() => normalizeSafe(url), [url]);
  const isDifferentUrl =
    !!normalizedInput && !!normalizedStored && normalizedInput !== normalizedStored;

  // URL 或 Key 变更 → 取消旧探测并清 proof/error；草稿 ID 自增以拒掉迟到的 resolve。
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    draftIdRef.current += 1;
    manager.cancelTest();
    setProof(undefined);
    setError(undefined);
    setConfirmChange(false);
  }, [manager, url, key]);

  // Strict Mode 下 effect mount→cleanup→mount；每次挂载都重置 unmountedRef。
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      manager.cancelTest();
    };
  }, [manager]);

  const isLocked = busy || browserBusy || snapshot.busy || manager.isCritical();

  const statusView = useMemo(() => describeStatus(snapshot.status), [snapshot.status]);
  const httpWarning = useMemo(() => isPlainHttp(url), [url]);

  // Test 仅校验 URL 合法：mock/无 Key 服务允许空 Key。
  const testEnabled = !!normalizedInput && !isLocked;

  // saveServer 路由：不同址 / 未配置 / 存储异常 / 清理过程中；首次与同址走 connect。
  const useSaveServer =
    isDifferentUrl ||
    snapshot.status === 'unconfigured' ||
    snapshot.status === 'storage-error' ||
    snapshot.status === 'resetting' ||
    snapshot.status === 'reset-error';

  const runWithDraft = useCallback(
    async (id: number, action: () => Promise<void>) => {
      if (operationRef.current || manager.isCritical()) return;
      operationRef.current = true;
      setBusy(true);
      try {
        await action();
      } finally {
        operationRef.current = false;
        if (!unmountedRef.current && id === draftIdRef.current) setBusy(false);
      }
    },
    [manager],
  );

  const onTest = useCallback(async () => {
    if (!normalizedInput) return;
    const id = draftIdRef.current;
    setError(undefined);
    await runWithDraft(id, async () => {
      try {
        const result = await manager.testConnection(url, key);
        if (unmountedRef.current || id !== draftIdRef.current) return;
        setProof(result);
      } catch (e) {
        if (unmountedRef.current || id !== draftIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setProof(undefined);
      }
    });
  }, [manager, url, key, normalizedInput, runWithDraft]);

  const onSave = useCallback(async () => {
    if (!proof || !normalizedInput) return;
    const id = draftIdRef.current;
    setError(undefined);
    let saved = false;
    await runWithDraft(id, async () => {
      try {
        if (useSaveServer) await manager.saveServer(url, key, proof);
        else await manager.connect(url, key, proof);
        saved = true;
      } catch (e) {
        if (unmountedRef.current || id !== draftIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    // 成功 → 关闭面板；不调 setKey/setProof 以免触发 URL/Key 副作用把 draftId 推后导致 busy 卡死。
    if (saved && !unmountedRef.current && id === draftIdRef.current) {
      manager.cancelTest();
      onClose();
    }
  }, [manager, url, key, proof, normalizedInput, useSaveServer, runWithDraft, onClose]);

  const onRetry = useCallback(async () => {
    const id = draftIdRef.current;
    await runWithDraft(id, async () => {
      try {
        await manager.retry();
      } catch (e) {
        if (unmountedRef.current || id !== draftIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [manager, runWithDraft]);

  const onRetryReset = useCallback(async () => {
    const id = draftIdRef.current;
    await runWithDraft(id, async () => {
      try {
        await manager.retryReset();
      } catch (e) {
        if (unmountedRef.current || id !== draftIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [manager, runWithDraft]);

  const onReload = useCallback(async () => {
    const id = draftIdRef.current;
    await runWithDraft(id, async () => {
      try {
        await manager.start();
      } catch (e) {
        if (unmountedRef.current || id !== draftIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [manager, runWithDraft]);

  const onSaveBrowserUrl = useCallback(async () => {
    setBrowserError(undefined);
    setBrowserSaved(false);
    setBrowserBusy(true);
    try {
      await manager.saveBrowserUrl(browserUrl);
      if (!unmountedRef.current) {
        setBrowserUrl(manager.getSnapshot().browserUrl ?? '');
        setBrowserSaved(true);
      }
    } catch (e) {
      if (!unmountedRef.current) setBrowserError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!unmountedRef.current) setBrowserBusy(false);
    }
  }, [manager, browserUrl]);

  // 关闭：busy/critical 时禁止；否则取消探测并清 Key/proof。
  const handleClose = useCallback(() => {
    if (isLocked) return;
    manager.cancelTest();
    setKey('');
    setProof(undefined);
    onClose();
  }, [isLocked, manager, onClose]);

  const testLabel = proof ? '重新测试' : '测试连接';
  const saveLabel =
    isDifferentUrl
      ? '保存新地址'
      : snapshot.hasToken
        ? '重新认证'
        : '连接服务器';
  const showConfirmStep = isDifferentUrl && !confirmChange;
  const saveEnabled = !!proof && !showConfirmStep && !isLocked;

  const onSaveOffline = useCallback(async () => {
    if (!normalizedInput || isLocked || showConfirmStep) return;
    const id = draftIdRef.current;
    await runWithDraft(id, async () => {
      try {
        await manager.saveServer(url, '');
        if (!unmountedRef.current && id === draftIdRef.current) onClose();
      } catch (e) {
        if (!unmountedRef.current && id === draftIdRef.current) setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [manager, url, normalizedInput, isLocked, showConfirmStep, runWithDraft, onClose]);

  // 暂不更换是撤销草稿，而不是确认步骤内的一次空状态切换。
  const handleCancelChange = useCallback(() => {
    manager.cancelTest();
    setUrl(snapshot.serverUrl ?? '');
    setKey('');
    setProof(undefined);
    setError(undefined);
    setConfirmChange(false);
  }, [manager, snapshot.serverUrl]);

  return (
    <Modal
      visible
      presentationStyle="fullScreen"
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={handleClose}
      statusBarTranslucent
      navigationBarTranslucent
      testID="workspace-connection-modal"
    >
      <ThemeStatusBar />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.column}>
          <View style={styles.header}>
            <IconControl icon={X} label={isLocked ? '保存中，暂时无法关闭' : '关闭服务器连接'}
              disabled={isLocked} onPress={handleClose} testID="workspace-connection-close" />
            <Text accessibilityRole="header" style={styles.headerTitle}>服务器连接</Text>
            <View style={styles.headerSideButtonSpacer} />
          </View>

          <KeyboardAvoidingView
            style={styles.bodyWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            enabled={Platform.OS !== 'web'}
          >
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <StatusCard
                statusLabel={statusView.label}
                statusDetail={statusView.detail}
                tone={statusView.tone}
                normalizedUrl={snapshot.serverUrl ?? ''}
                caption={isDifferentUrl ? '草稿地址尚未保存' : undefined}
              />

              {!!proof && !error && (
                <Card
                  style={styles.proofBox}
                  tone="success"
                  accessibilityRole="text"
                  testID="workspace-connection-proof"
                >
                  <Text style={styles.proofLabel}>测试通过，尚未保存</Text>
                  <Text style={styles.proofHint}>
                    点击下方按钮以{isDifferentUrl ? '保存新地址' : snapshot.hasToken ? '重新认证' : '连接服务器'}
                  </Text>
                </Card>
              )}

              <Card style={styles.formGroup}>
                <Text accessibilityRole="header" style={styles.formTitle}>连接设置</Text>
                <Section title="服务器地址" testID="workspace-connection-url-section">
                  <FormInput
                    accessibilityLabel="服务器地址"
                    accessibilityHint="支持 http 或 https，不含查询参数与账号信息"
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://example.com"
                    placeholderTextColor={colors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    keyboardType="url"
                    editable={!isLocked}
                    testID="workspace-connection-url"
                    style={styles.input}
                  />
                  {httpWarning && (
                    <Text style={styles.helper}>
                      当前使用 http 明文传输，访问密钥与业务数据可被网络中间设备读取，请仅在可信网络使用
                    </Text>
                  )}
                </Section>

                <Section title="访问密钥" testID="workspace-connection-key-section">
                  <View style={styles.keyWrap}>
                    <FormInput
                      accessibilityLabel="访问密钥"
                      accessibilityHint="仅保存在当前会话内存中，关闭面板即清空"
                      value={key}
                      onChangeText={setKey}
                      placeholder={
                        snapshot.hasToken && normalizedStored === normalizedInput
                          ? '留空沿用当前 Token'
                          : '请输入访问密钥'
                      }
                      placeholderTextColor={colors.faint}
                      secureTextEntry={!showKey}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="off"
                      editable={!isLocked}
                      testID="workspace-connection-key"
                      style={[styles.input, styles.keyInput]}
                    />
                    <IconControl icon={showKey ? EyeOff : Eye}
                      label={showKey ? '隐藏访问密钥' : '显示访问密钥'}
                      onPress={() => setShowKey((value) => !value)} disabled={isLocked}
                      style={styles.keyToggle} small testID="workspace-connection-key-toggle" />
                  </View>
                  <Text style={styles.helper}>
                    密钥仅保存在本次表单内存中，关闭面板后清空，不写入设备存储
                  </Text>
                </Section>
              </Card>

              <Card style={styles.formGroup} testID="workspace-browser-address-section">
                <Text accessibilityRole="header" style={styles.formTitle}>真实浏览器</Text>
                <Section title="真实浏览器 noVNC 地址">
                  <FormInput
                    accessibilityLabel="真实浏览器 noVNC 地址"
                    accessibilityHint="填写完整的 http 或 https noVNC 页面地址；留空保存可清除配置"
                    value={browserUrl}
                    onChangeText={(value) => { setBrowserUrl(value); setBrowserError(undefined); setBrowserSaved(false); }}
                    placeholder="https://browser.example.com/vnc.html"
                    placeholderTextColor={colors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    keyboardType="url"
                    editable={!browserBusy}
                    testID="workspace-browser-address"
                    style={styles.input}
                  />
                  <Text style={styles.helper}>保存完整 noVNC 页面链接；在设置中由系统浏览器打开。地址不随服务器状态变化。</Text>
                </Section>
                <ActionButton label="保存真实浏览器地址" text="保存浏览器地址" icon={Check}
                  onPress={() => void onSaveBrowserUrl()} busy={browserBusy} disabled={isLocked || !snapshot.serverUrl}
                  testID="workspace-browser-address-save" />
                {!snapshot.serverUrl && <Text style={styles.helper}>请先保存服务器地址</Text>}
                {!!browserError && <Text accessibilityRole="alert" style={styles.errorText}>{browserError}</Text>}
                {browserSaved && <Text accessibilityLiveRegion="polite" style={styles.helper}>{snapshot.browserUrl ? '浏览器地址已保存' : '浏览器地址已清除'}</Text>}
              </Card>

              {normalizedInput && !proof && <ActionButton label="仅保存服务器地址" text="仅保存地址，稍后认证"
                disabled={isLocked || showConfirmStep} onPress={() => void onSaveOffline()} />}
              {(error || snapshot.error) && (
                <Card style={styles.errorBox} tone="danger" accessibilityRole="alert" testID="workspace-connection-error">
                  <Text style={styles.errorText}>{error ?? snapshot.error}</Text>
                </Card>
              )}

              {showConfirmStep && (
                <Card style={styles.confirmBox} tone="danger" testID="workspace-connection-confirm">
                  <Text style={styles.confirmTitle}>更换服务器前请确认</Text>
                  <Text style={styles.confirmDetail}>
                    保存新地址将清除本地业务数据与旧凭据，但不会删除远端数据。清除后旧地址的会话、消息与缓存无法恢复。
                  </Text>
                  <View style={styles.confirmActions}>
                    <ActionButton label="暂不更换服务器" text="暂不更换" wide
                      onPress={handleCancelChange} disabled={isLocked} testID="workspace-connection-confirm-cancel" />
                    <ActionButton label="我已了解，继续保存新服务器" text="继续保存" tone="danger" wide
                      onPress={() => setConfirmChange(true)} disabled={isLocked} testID="workspace-connection-confirm-accept" />
                  </View>
                </Card>
              )}

              <View style={styles.actions}>
                <ActionButton label={testLabel} icon={Check} busy={busy && !proof} disabled={!testEnabled}
                  text={testLabel} onPress={onTest} wide testID="workspace-connection-test" />
                <ActionButton label={`${saveLabel}${showConfirmStep ? '（请先确认）' : ''}`}
                  icon={ShieldCheck} busy={busy && !!proof} disabled={!saveEnabled}
                  text={saveLabel} tone="primary" onPress={onSave} wide testID="workspace-connection-save" />
              </View>

              {snapshot.status === 'offline' && (
                <ActionButton label="重试连接当前服务器" text="重试连接" icon={RefreshCw}
                  onPress={onRetry} disabled={isLocked} testID="workspace-connection-retry" />
              )}

              {snapshot.status === 'reset-error' && (
                <ActionButton label="重试清理本地数据" text="重试清理" icon={ShieldAlert}
                  tone="danger" onPress={onRetryReset} disabled={isLocked} testID="workspace-connection-retry-reset" />
              )}

              {snapshot.status === 'storage-error' && (
                <ActionButton label="重新加载本地连接配置" text="重新加载" icon={RefreshCw}
                  onPress={onReload} disabled={isLocked} testID="workspace-connection-reload" />
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── 子组件 ────────────────────────────────────────────────────────────────

function StatusCard({
  statusLabel,
  statusDetail,
  tone,
  normalizedUrl,
  caption,
}: {
  statusLabel: string;
  statusDetail: string;
  tone: StatusTone;
  normalizedUrl: string;
  caption?: string;
}) {
  const styles = useConnectionStyles();
  const { colors } = useTheme();
  const accent =
    tone === 'success'
      ? colors.success
      : tone === 'danger'
        ? colors.danger
        : tone === 'warning'
          ? colors.warning
          : colors.muted;
  return (
    <Card style={styles.statusCard} accessibilityRole="summary">
      <View style={styles.serverIcon}><Server size={workspaceTheme.layout.iconSize} color={accent} strokeWidth={1.5} /></View>
      <View style={styles.statusBody}>
        <Text style={styles.statusSection}>当前连接</Text>
        <Text style={styles.statusLabel}>{statusLabel}</Text>
        <Text style={styles.statusDetail} numberOfLines={2}>
          {statusDetail}
        </Text>
        {!!normalizedUrl && (
          <Text style={styles.statusUrl}>
            {normalizedUrl}
          </Text>
        )}
        {!!caption && (
          <Text style={styles.statusCaption}>
            {caption}
          </Text>
        )}
      </View>
    </Card>
  );
}

function Section({
  title,
  children,
  testID,
}: {
  title: string;
  children: ReactNode;
  testID?: string;
}) {
  const styles = useConnectionStyles();
  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

// ─── 样式 ──────────────────────────────────────────────────────────────────

function useConnectionStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

function createStyles(c: WorkspaceColors) {
  const { layout: l, radius: r, typography: t } = workspaceTheme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.canvas },
    column: {
      flex: 1,
      width: '100%',
      maxWidth: l.maxWidth,
      alignSelf: 'center',
    },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: l.sidePadding,
      paddingTop: spacing[14],
      paddingBottom: spacing[14],
    },

    headerSideButtonSpacer: {
      width: l.controlSize,
      height: l.controlSize,
      marginTop: spacing.xs,
    },
    headerTitle: {
      ...t.section,
      color: c.ink,
      fontWeight: '600',
    },

    bodyWrap: { flex: 1 },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: l.sidePadding,
      paddingBottom: spacing[24],
      gap: spacing[16],
      paddingTop: spacing[6],
    },

    statusCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: spacing[16],
      borderRadius: r.card,
      backgroundColor: c.surface,
      gap: spacing.md,
    },
    serverIcon: { width: l.rowIcon, height: l.rowIcon, alignItems: 'center', justifyContent: 'center', borderRadius: r.round, backgroundColor: c.control },
    statusBody: { flex: 1, minWidth: 0, gap: spacing.xxs },
    statusSection: {
      ...t.caption,
      color: c.faint,
    },
    statusLabel: {
      ...t.itemTitle,
      color: c.ink,
      fontWeight: '600',
    },
    statusDetail: {
      ...t.detail,
      color: c.muted,
    },
    statusUrl: {
      ...t.status,
      color: c.muted,
      marginTop: spacing.xs,
      flexShrink: 1,
    },
    statusCaption: {
      ...t.caption,
      color: c.muted,
      marginTop: spacing.xs,
    },

    proofBox: {
      padding: spacing.md,
      borderRadius: r.card,
      backgroundColor: c.successSoft,
      gap: spacing.xxs,
    },
    proofLabel: {
      ...t.itemTitle,
      color: c.success,
      fontWeight: '600',
    },
    proofHint: {
      ...t.detail,
      color: c.muted,
    },

    formGroup: {
      backgroundColor: c.surface,
      borderRadius: r.card,
      padding: spacing[16],
      gap: spacing[16],
    },
    formTitle: { ...t.itemTitle, color: c.ink, fontWeight: '600' },
    section: { gap: spacing.sm },
    sectionLabel: {
      ...t.status,
      color: c.ink,
    },

    input: { minHeight: l.inputMinHeight, paddingVertical: spacing[12] },
    keyWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      position: 'relative',
    },
    keyInput: {
      flex: 1,
      paddingRight: sizing[44],
    },
    keyToggle: {
      position: 'absolute',
      right: spacing[6],
      width: l.smallControl,
      height: l.smallControl,
      borderRadius: l.smallControl / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },

    helper: {
      ...t.caption,
      color: c.muted,
      marginTop: spacing.xs,
    },

    errorBox: {
      padding: spacing.md,
      borderRadius: r.card,
      backgroundColor: c.dangerSoft,
    },
    errorText: {
      ...t.detail,
      color: c.danger,
    },

    confirmBox: {
      padding: spacing.lg,
      borderRadius: r.card,
      backgroundColor: c.dangerSoft,
      gap: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.danger,
    },
    confirmTitle: {
      ...t.itemTitle,
      color: c.danger,
      fontWeight: '600',
    },
    confirmDetail: {
      ...t.detail,
      color: c.muted,
    },
    confirmActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },

    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },

  });
}
