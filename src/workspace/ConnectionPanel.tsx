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
  connectionSaveAvailability,
  describeStatus,
  isPlainHttp,
  ownsConnectionDraft,
  runConnectionOperation,
  tryNormalize,
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
  const [testing, setTesting] = useState(false);

  // 草稿守卫：异步 resolve 时检查 unmounted + draftId 再写入本地 state。
  const operationRef = useRef(false);
  const unmountedRef = useRef<boolean>(false);
  const draftIdRef = useRef<number>(0);

  const normalizedStored = useMemo(
    () => normalizeSafe(snapshot.serverUrl ?? ''),
    [snapshot.serverUrl],
  );
  const normalizedInput = useMemo(() => normalizeSafe(url), [url]);
  // 输入事件同步废弃旧证明和请求；旧探测或直接保存的迟到结果不能关闭新草稿。
  const invalidateDraft = useCallback(() => {
    draftIdRef.current += 1;
    manager.cancelTest();
    setTesting(false);
    setProof(undefined);
    setError(undefined);
    setConfirmChange(false);
  }, [manager]);

  const changeUrl = useCallback((value: string) => {
    invalidateDraft();
    setUrl(value);
  }, [invalidateDraft]);

  const changeKey = useCallback((value: string) => {
    invalidateDraft();
    setKey(value);
  }, [invalidateDraft]);

  // Strict Mode 下 effect mount→cleanup→mount；每次挂载都重置 unmountedRef。
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      manager.cancelTest();
    };
  }, [manager]);

  // 探测可取消；只有真实保存或清理阶段阻止关闭。
  const isLocked = manager.isCritical();
  const actionsBusy = busy || snapshot.busy || testing;

  const statusView = useMemo(() => describeStatus(snapshot.status), [snapshot.status]);
  const httpWarning = useMemo(() => isPlainHttp(url), [url]);

  // 探测只在本地校验 URL 格式；是否需要访问密钥由实际服务端决定。
  const testEnabled = !!normalizedInput && !actionsBusy && !isLocked;

  const saveState = connectionSaveAvailability({
    serverUrl: normalizedInput,
    storedUrl: normalizedStored,
    status: snapshot.status,
    confirmed: confirmChange,
    busy: actionsBusy,
    locked: isLocked,
  });

  const runOperation = useCallback(
    (action: () => Promise<void>) => runConnectionOperation(
      operationRef, manager.isCritical, () => !unmountedRef.current, setBusy, action,
    ),
    [manager],
  );

  const onTest = useCallback(async () => {
    if (!normalizedInput || testing) return;
    const id = draftIdRef.current;
    setError(undefined);
    setTesting(true);
    try {
      const result = await manager.testConnection(url, key);
      if (!ownsConnectionDraft(id, draftIdRef.current, unmountedRef.current)) return;
      setProof(result);
    } catch (e) {
      if (!ownsConnectionDraft(id, draftIdRef.current, unmountedRef.current)) return;
      setError(e instanceof Error ? e.message : String(e));
      setProof(undefined);
    } finally {
      if (ownsConnectionDraft(id, draftIdRef.current, unmountedRef.current)) setTesting(false);
    }
  }, [manager, url, key, normalizedInput, testing]);

  const cancelTest = useCallback(() => {
    draftIdRef.current += 1;
    manager.cancelTest();
    setTesting(false);
    setProof(undefined);
    setError(undefined);
  }, [manager]);

  const onSave = useCallback(async () => {
    if (!saveState.enabled) return;
    const id = draftIdRef.current;
    setError(undefined);
    let saved = false;
    await runOperation(async () => {
      try {
        // 无证明时由管理器先校验当前地址和密钥；通过后才进入不可关闭的存储阶段。
        await manager.saveConnection(url, key, { test: proof, confirmChange });
        saved = true;
      } catch (e) {
        if (!ownsConnectionDraft(id, draftIdRef.current, unmountedRef.current)) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    // 保存成功才关闭；草稿若已改变，旧请求不得关闭新表单。
    if (saved && ownsConnectionDraft(id, draftIdRef.current, unmountedRef.current)) {
      manager.cancelTest();
      onClose();
    }
  }, [manager, url, key, proof, confirmChange, saveState.enabled, runOperation, onClose]);

  const onRetry = useCallback(async () => {
    const id = draftIdRef.current;
    await runOperation(async () => {
      try {
        await manager.retry();
      } catch (e) {
        if (!ownsConnectionDraft(id, draftIdRef.current, unmountedRef.current)) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [manager, runOperation]);

  const onRetryReset = useCallback(async () => {
    const id = draftIdRef.current;
    await runOperation(async () => {
      try {
        await manager.retryReset();
      } catch (e) {
        if (!ownsConnectionDraft(id, draftIdRef.current, unmountedRef.current)) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [manager, runOperation]);

  const onReload = useCallback(async () => {
    const id = draftIdRef.current;
    await runOperation(async () => {
      try {
        await manager.start();
      } catch (e) {
        if (!ownsConnectionDraft(id, draftIdRef.current, unmountedRef.current)) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [manager, runOperation]);

  // 原生 Back 与 X 共用关闭路径；迟到探测不得更新下次打开的表单。
  const handleClose = useCallback(() => {
    if (manager.isCritical()) return;
    cancelTest();
    setKey('');
    onClose();
  }, [manager, cancelTest, onClose]);

  const showConfirmStep = saveState.requiresConfirmation && !confirmChange;

  // 暂不更换是撤销草稿，而不是确认步骤内的一次空状态切换。
  const handleCancelChange = useCallback(() => {
    invalidateDraft();
    setUrl(snapshot.serverUrl ?? '');
    setKey('');
  }, [invalidateDraft, snapshot.serverUrl]);

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
              <Text accessibilityLiveRegion="polite" style={styles.helper}>{statusView.label} · {statusView.detail}</Text>

              {!!proof && !error && (
                <Card
                  style={styles.proofBox}
                  tone="success"
                  accessibilityRole="text"
                  testID="workspace-connection-proof"
                >
                  <Text style={styles.proofLabel}>连接正常</Text>
                  <Text style={styles.proofHint}>保存后生效</Text>
                </Card>
              )}

              <Card style={styles.formGroup}>
                <Section title="服务器地址" testID="workspace-connection-url-section">
                  <FormInput
                    accessibilityLabel="服务器地址"
                    accessibilityHint="支持 http 或 https，不含查询参数与账号信息"
                    value={url}
                    onChangeText={changeUrl}
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
                      onChangeText={changeKey}
                      placeholder={
                        snapshot.hasToken && normalizedStored === normalizedInput
                          ? '留空沿用当前登录状态'
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

              {(error || snapshot.error) && (
                <Card style={styles.errorBox} tone="danger" accessibilityRole="alert" testID="workspace-connection-error">
                  <Text style={styles.errorText}>{error ?? snapshot.error}</Text>
                </Card>
              )}

              {showConfirmStep && (
                <Card style={styles.confirmBox} tone="danger" testID="workspace-connection-confirm">
                  <Text style={styles.confirmTitle}>保存前请确认</Text>
                  <Text style={styles.confirmDetail}>
                    {snapshot.status === 'storage-error'
                      ? '无法确认原有服务器配置。继续保存将清除本地业务数据与旧凭据，但不会删除远端数据。清除后旧地址的会话、消息与缓存无法恢复。'
                      : '保存新地址将清除本地业务数据与旧凭据，但不会删除远端数据。清除后旧地址的会话、消息与缓存无法恢复。'}
                  </Text>
                  <View style={styles.confirmActions}>
                    <ActionButton label="暂不保存服务器连接" text="暂不保存" wide
                      onPress={snapshot.status === 'storage-error' ? handleClose : handleCancelChange}
                      disabled={isLocked || actionsBusy} testID="workspace-connection-confirm-cancel" />
                    <ActionButton label="我已了解本地清理影响" text="确认清理" tone="danger" wide
                      onPress={() => setConfirmChange(true)} disabled={isLocked || actionsBusy} testID="workspace-connection-confirm-accept" />
                  </View>
                </Card>
              )}

              <View style={styles.actions}>
                <ActionButton label="测试连接" icon={Check} busy={testing} disabled={!testEnabled}
                  text="测试连接" onPress={onTest} wide testID="workspace-connection-test" />
                {testing && <ActionButton label="取消连接测试" text="取消测试" onPress={cancelTest} testID="workspace-connection-cancel-test" />}
                <ActionButton label="保存" icon={ShieldCheck} busy={busy} disabled={!saveState.enabled}
                  text={busy ? '保存中' : '保存'} tone="primary" onPress={onSave} wide testID="workspace-connection-save" />
              </View>

              {snapshot.status === 'offline' && (
                <ActionButton label="重试连接当前服务器" text="重试连接" icon={RefreshCw}
                  onPress={onRetry} disabled={isLocked || actionsBusy} testID="workspace-connection-retry" />
              )}

              {snapshot.status === 'reset-error' && (
                <ActionButton label="重试清理本地数据" text="重试清理" icon={ShieldAlert}
                  tone="danger" onPress={onRetryReset} disabled={isLocked || actionsBusy} testID="workspace-connection-retry-reset" />
              )}

              {snapshot.status === 'storage-error' && (
                <ActionButton label="重新加载本地连接配置" text="重新加载" icon={RefreshCw}
                  onPress={onReload} disabled={isLocked || actionsBusy} testID="workspace-connection-reload" />
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── 子组件 ────────────────────────────────────────────────────────────────

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
