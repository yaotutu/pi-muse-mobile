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
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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
import { useWorkspaceTheme } from './WorkspaceTheme';
import {
  describeStatus,
  isPlainHttp,
  tryNormalize,
  type StatusTone,
} from './connection-panel-helpers';

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
  const { mode, colors } = useWorkspaceTheme();

  // 草稿状态：URL/Key 仅在组件内存；保存成功后随面板卸载丢弃。
  const [url, setUrl] = useState<string>(snapshot.serverUrl ?? '');
  const [key, setKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [proof, setProof] = useState<ConnectionTest | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmChange, setConfirmChange] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

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

  const isLocked = busy || snapshot.busy || manager.isCritical();

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

  const statusBarStyle = mode === 'dark' ? 'light' : 'dark';

  return (
    <Modal
      visible
      presentationStyle="fullScreen"
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
      navigationBarTranslucent
      testID="workspace-connection-modal"
    >
      <StatusBar style={statusBarStyle} />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.column}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isLocked ? '保存中，暂时无法关闭' : '关闭服务器连接'
              }
              accessibilityState={{ disabled: isLocked }}
              hitSlop={spacing.md}
              disabled={isLocked}
              onPress={handleClose}
              style={({ pressed }) => [
                styles.headerSideButton,
                pressed && !isLocked && styles.pressed,
              ]}
              testID="workspace-connection-close"
            >
              <X
                size={workspaceTheme.layout.navigationIconSize}
                color={colors.ink}
                strokeWidth={2}
              />
            </Pressable>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>服务器连接</Text>
              <Text style={styles.headerStatus} numberOfLines={1}>
                {statusView.label}
              </Text>
            </View>
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
                <View
                  style={styles.proofBox}
                  accessibilityRole="text"
                  testID="workspace-connection-proof"
                >
                  <Text style={styles.proofLabel}>测试通过，尚未保存</Text>
                  <Text style={styles.proofHint}>
                    点击下方按钮以{isDifferentUrl ? '保存新地址' : snapshot.hasToken ? '重新认证' : '连接服务器'}
                  </Text>
                </View>
              )}

              <Section title="服务器地址" testID="workspace-connection-url-section">
                <TextInput
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
                  <TextInput
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showKey ? '隐藏访问密钥' : '显示访问密钥'}
                    hitSlop={spacing.sm}
                    onPress={() => setShowKey((value) => !value)}
                    disabled={isLocked}
                    style={({ pressed }) => [
                      styles.keyToggle,
                      pressed && !isLocked && styles.pressed,
                    ]}
                    testID="workspace-connection-key-toggle"
                  >
                    {showKey ? (
                      <EyeOff
                        size={workspaceTheme.layout.iconSize}
                        color={colors.muted}
                        strokeWidth={1.8}
                      />
                    ) : (
                      <Eye
                        size={workspaceTheme.layout.iconSize}
                        color={colors.muted}
                        strokeWidth={1.8}
                      />
                    )}
                  </Pressable>
                </View>
                <Text style={styles.helper}>
                  密钥仅保存在当前会话的内存中，关闭此面板后即被清空，不会写入设备存储
                </Text>
              </Section>

              {normalizedInput && !proof && <Pressable accessibilityRole="button" accessibilityLabel="仅保存服务器地址"
                disabled={isLocked || showConfirmStep} onPress={() => void onSaveOffline()} style={styles.linkButton}>
                <Text style={styles.helper}>暂时无法连接？仅保存地址，稍后认证</Text>
              </Pressable>}
              {(error || snapshot.error) && (
                <View style={styles.errorBox} accessibilityRole="alert" testID="workspace-connection-error">
                  <Text style={styles.errorText}>{error ?? snapshot.error}</Text>
                </View>
              )}

              {showConfirmStep && (
                <View style={styles.confirmBox} testID="workspace-connection-confirm">
                  <Text style={styles.confirmTitle}>更换服务器前请确认</Text>
                  <Text style={styles.confirmDetail}>
                    保存新地址将清除本地业务数据与旧凭据，但不会删除远端数据。清除后旧地址的会话、消息与缓存无法恢复。
                  </Text>
                  <View style={styles.confirmActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="暂不更换服务器"
                      onPress={() => setConfirmChange(false)}
                      disabled={isLocked}
                      style={({ pressed }) => [
                        styles.confirmButton,
                        styles.confirmButtonCancel,
                        pressed && !isLocked && styles.pressed,
                      ]}
                      testID="workspace-connection-confirm-cancel"
                    >
                      <Text style={styles.confirmButtonCancelText}>暂不更换</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="我已了解，继续保存新服务器"
                      onPress={() => setConfirmChange(true)}
                      disabled={isLocked}
                      style={({ pressed }) => [
                        styles.confirmButton,
                        styles.confirmButtonAccept,
                        pressed && !isLocked && styles.pressed,
                      ]}
                      testID="workspace-connection-confirm-accept"
                    >
                      <Text style={styles.confirmButtonAcceptText}>继续保存</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={testLabel}
                  accessibilityState={{ disabled: !testEnabled, busy }}
                  aria-busy={busy}
                  disabled={!testEnabled}
                  onPress={onTest}
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.actionButtonSecondary,
                    !testEnabled && styles.actionButtonDisabled,
                    pressed && testEnabled && styles.pressed,
                  ]}
                  testID="workspace-connection-test"
                >
                  {busy && !proof ? (
                    <ActivityIndicator color={colors.ink} size="small" />
                  ) : (
                    <Check
                      size={workspaceTheme.layout.iconSize}
                      color={colors.ink}
                      strokeWidth={1.8}
                    />
                  )}
                  <Text style={[styles.actionButtonText, { color: colors.ink }]}>
                    {testLabel}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${saveLabel}${showConfirmStep ? '（请先确认）' : ''}`}
                  accessibilityState={{ disabled: !saveEnabled, busy }}
                  aria-busy={busy}
                  disabled={!saveEnabled}
                  onPress={onSave}
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.actionButtonPrimary,
                    !saveEnabled && styles.actionButtonDisabled,
                    pressed && saveEnabled && styles.pressed,
                  ]}
                  testID="workspace-connection-save"
                >
                  {busy && proof ? (
                    <ActivityIndicator color={colors.onAccent} size="small" />
                  ) : (
                    <ShieldCheck
                      size={workspaceTheme.layout.iconSize}
                      color={colors.onAccent}
                      strokeWidth={1.8}
                    />
                  )}
                  <Text
                    style={[styles.actionButtonText, styles.actionButtonPrimaryText]}
                  >
                    {saveLabel}
                  </Text>
                </Pressable>
              </View>

              {snapshot.status === 'offline' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重试连接当前服务器"
                  onPress={onRetry}
                  disabled={isLocked}
                  style={({ pressed }) => [styles.linkButton, pressed && !isLocked && styles.pressed]}
                  testID="workspace-connection-retry"
                >
                  <RefreshCw
                    size={workspaceTheme.layout.iconSize}
                    color={colors.muted}
                    strokeWidth={1.6}
                  />
                  <Text style={styles.linkButtonText}>重试连接</Text>
                </Pressable>
              )}

              {snapshot.status === 'reset-error' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重试清理本地数据"
                  onPress={onRetryReset}
                  disabled={isLocked}
                  style={({ pressed }) => [styles.linkButton, pressed && !isLocked && styles.pressed]}
                  testID="workspace-connection-retry-reset"
                >
                  <ShieldAlert
                    size={workspaceTheme.layout.iconSize}
                    color={colors.danger}
                    strokeWidth={1.6}
                  />
                  <Text style={[styles.linkButtonText, { color: colors.danger }]}>
                    重试清理
                  </Text>
                </Pressable>
              )}

              {snapshot.status === 'storage-error' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重新加载本地连接配置"
                  onPress={onReload}
                  disabled={isLocked}
                  style={({ pressed }) => [styles.linkButton, pressed && !isLocked && styles.pressed]}
                  testID="workspace-connection-reload"
                >
                  <RefreshCw
                    size={workspaceTheme.layout.iconSize}
                    color={colors.muted}
                    strokeWidth={1.6}
                  />
                  <Text style={styles.linkButtonText}>重新加载</Text>
                </Pressable>
              )}

              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  所有连接信息由设备本地存储保护，更换服务器不会删除远端会话或文件
                </Text>
              </View>
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
  const { colors } = useWorkspaceTheme();
  const accent =
    tone === 'success'
      ? colors.success
      : tone === 'danger'
        ? colors.danger
        : tone === 'warning'
          ? colors.muted
          : colors.muted;
  return (
    <View style={styles.statusCard} accessibilityRole="summary">
      <View style={[styles.statusDot, { backgroundColor: accent }]} />
      <View style={styles.statusBody}>
        <Text style={styles.statusSection}>已保存连接</Text>
        <Text style={styles.statusLabel}>{statusLabel}</Text>
        <Text style={styles.statusDetail} numberOfLines={2}>
          {statusDetail}
        </Text>
        {!!normalizedUrl && (
          <Text style={styles.statusUrl} numberOfLines={1}>
            {normalizedUrl}
          </Text>
        )}
        {!!caption && (
          <Text style={styles.statusCaption} numberOfLines={1}>
            {caption}
          </Text>
        )}
      </View>
    </View>
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
  const { colors } = useWorkspaceTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

function createStyles(c: WorkspaceColors) {
  const { layout: l, radius: r, typography: t } = workspaceTheme;
  // pill 输入框：圆角取最小高度的半高，几何派生自 sizing.inputMinHeight。
  const inputRadius = sizing.inputMinHeight / 2;
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
      alignItems: 'flex-start',
      paddingHorizontal: l.sidePadding,
      paddingTop: l.sessionTop,
      paddingBottom: l.sessionHeaderBottom,
    },
    headerSideButton: {
      width: l.controlSize,
      height: l.controlSize,
      borderRadius: l.controlSize / 2,
      backgroundColor: c.control,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xs,
    },
    headerSideButtonSpacer: {
      width: l.controlSize,
      height: l.controlSize,
      marginTop: spacing.xs,
    },
    headerCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-start',
    },
    headerTitle: {
      ...t.heroName,
      color: c.ink,
      fontWeight: '600',
    },
    headerStatus: {
      marginTop: spacing.xs,
      ...t.status,
      color: c.muted,
    },

    bodyWrap: { flex: 1 },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: l.sidePadding,
      paddingBottom: spacing[24],
      gap: l.listItemGap,
    },

    statusCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: l.messagePadding,
      borderRadius: r.card,
      backgroundColor: c.surface,
      gap: spacing.md,
    },
    statusDot: {
      width: l.stateDotSize,
      height: l.stateDotSize,
      borderRadius: l.stateDotSize / 2,
      marginTop: spacing.sm,
    },
    statusBody: { flex: 1, gap: spacing.xxs },
    statusSection: {
      ...t.caption,
      color: c.faint,
      textTransform: 'uppercase',
      letterSpacing: 1.4,
      fontWeight: '600',
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
      ...t.caption,
      color: c.faint,
      marginTop: spacing.xs,
    },
    statusCaption: {
      ...t.caption,
      color: c.muted,
      marginTop: spacing.xs,
    },

    proofBox: {
      padding: spacing.md,
      borderRadius: r.card,
      backgroundColor: c.selected,
      borderWidth: sizing.borderWidth,
      borderColor: c.success,
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

    section: { gap: spacing.sm },
    sectionLabel: {
      ...t.caption,
      color: c.muted,
      textTransform: 'uppercase',
      letterSpacing: 1.4,
      fontWeight: '600',
    },

    input: {
      minHeight: sizing.inputMinHeight,
      paddingHorizontal: spacing[18],
      paddingVertical: spacing[12],
      borderRadius: inputRadius,
      backgroundColor: c.surface,
      color: c.ink,
      ...t.input,
      borderWidth: sizing.borderWidth,
      borderColor: c.line,
    },
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

    httpWarning: {
      ...t.caption,
      color: c.muted,
      marginTop: spacing.xs,
    },
    helper: {
      ...t.caption,
      color: c.faint,
      marginTop: spacing.xs,
    },

    errorBox: {
      padding: spacing.md,
      borderRadius: r.card,
      backgroundColor: c.selected,
      borderWidth: sizing.borderWidth,
      borderColor: c.danger,
    },
    errorText: {
      ...t.detail,
      color: c.danger,
    },

    confirmBox: {
      padding: spacing.lg,
      borderRadius: r.card,
      backgroundColor: c.surface,
      gap: spacing.md,
      borderWidth: sizing.borderWidth,
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
      justifyContent: 'flex-end',
      gap: spacing.sm,
    },
    confirmButton: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: r.round,
      minHeight: l.smallControl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmButtonCancel: {
      backgroundColor: 'transparent',
      borderWidth: sizing.borderWidth,
      borderColor: c.line,
    },
    confirmButtonCancelText: {
      color: c.muted,
      ...t.detail,
      fontWeight: '500',
    },
    confirmButtonAccept: {
      backgroundColor: c.danger,
    },
    // 危险按钮使用 c.canvas 作前景：亮色下深红配白字、暗色下浅红配黑字，两套主题都达到对比度门槛。
    confirmButtonAcceptText: {
      color: c.canvas,
      ...t.detail,
      fontWeight: '600',
    },

    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: l.controlSize,
      paddingHorizontal: spacing.lg,
      borderRadius: r.round,
    },
    actionButtonSecondary: {
      backgroundColor: c.control,
    },
    actionButtonPrimary: {
      backgroundColor: c.blue,
    },
    actionButtonDisabled: { opacity: 0.4 },
    pressed: { opacity: 0.7 },
    actionButtonText: {
      ...t.detail,
      fontWeight: '600',
    },
    actionButtonPrimaryText: {
      color: c.onAccent,
    },

    linkButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: l.smallControl,
      paddingHorizontal: spacing.lg,
    },
    linkButtonText: {
      ...t.detail,
      color: c.muted,
    },

    footer: {
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
    },
    footerText: {
      ...t.caption,
      color: c.faint,
      textAlign: 'center',
    },
  });
}
