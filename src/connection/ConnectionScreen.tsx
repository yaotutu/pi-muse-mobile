// 测试结果仅属于当前草稿，不代表已保存或允许复用旧凭证。
import { Server } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { normalizeServerAddress } from './server-address';
import type { ConnectionScreenProps, ConnectionTest } from './types';
import { Button } from '../ui/Buttons';
import { ErrorNotice } from '../ui/Feedback';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';
import { Card, IconBox } from '../ui/Surfaces';
import { colors, layout, radius, sizing, spacing, typography } from '../ui/tokens';
import { useAppUpdate } from '../update/UpdateProvider';

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; test: ConnectionTest }
  | { kind: 'failed'; message: string };

export function ConnectionScreen({
  mode,
  serverUrl,
  initialAccessKey,
  busy,
  error,
  onTest,
  onCancelTest,
  onConnect,
  onSaveOffline,
  onChangeServer,
  onDemo,
  onPreview,
}: ConnectionScreenProps) {
  const update = useAppUpdate();
  const [draftUrl, setDraftUrl] = useState(mode === 'initial' ? '' : serverUrl ?? '');
  const [draftKey, setDraftKey] = useState(initialAccessKey ?? '');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  /** 测试请求序号：递增作废上一次结果，防止晚到响应覆盖新结果。 */
  const testSeqRef = useRef(0);
  /** 当前进行中的 onTest promise，由卸载 effect 取消标记 seq。 */
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      testSeqRef.current += 1;
      onCancelTest();
    };
  }, [onCancelTest]);

  // 草稿变化时作废已有测试结果：草稿不一致，旧的 ok/failed 已无意义。
  const onChangeUrl = useCallback((next: string) => {
    testSeqRef.current += 1;
    onCancelTest();
    setDraftUrl(next);
    setTest({ kind: 'idle' });
  }, [onCancelTest]);

  const onChangeKey = useCallback((next: string) => {
    testSeqRef.current += 1;
    onCancelTest();
    setDraftKey(next);
    setTest({ kind: 'idle' });
  }, [onCancelTest]);

  const normalize = useCallback((): string | null => {
    try {
      return normalizeServerAddress(draftUrl);
    } catch (e) {
      setTest({ kind: 'failed', message: (e as Error).message });
      return null;
    }
  }, [draftUrl]);

  const handleTest = useCallback(async () => {
    const url = normalize();
    if (!url) return;
    setTest({ kind: 'running' });
    const seq = ++testSeqRef.current;
    try {
      const result = await onTest(url, draftKey);
      // 卸载或已被新测试覆盖时丢弃。
      if (!mountedRef.current || seq !== testSeqRef.current) return;
      setTest({ kind: 'ok', test: result });
    } catch (e) {
      if (!mountedRef.current || seq !== testSeqRef.current) return;
      setTest((e as Error).name === 'AbortError' ? { kind: 'idle' } : { kind: 'failed', message: (e as Error).message ?? '测试失败' });
    }
  }, [draftKey, normalize, onTest]);

  const handleCancelTest = useCallback(() => {
    // 递增 seq 让晚到响应作废；同时通知调用方取消在途请求。
    testSeqRef.current += 1;
    onCancelTest();
    if (test.kind === 'running') setTest({ kind: 'idle' });
  }, [onCancelTest, test.kind]);

  const handleConnect = useCallback(async () => {
    if (busy) return;
    const url = normalize();
    if (!url) return;
    const passable = test.kind === 'ok' ? test.test : undefined;
    try { await onConnect(url, draftKey, passable); }
    catch (e) { if (mountedRef.current) setTest({ kind: 'failed', message: (e as Error).message }); }
  }, [busy, draftKey, normalize, onConnect, test]);

  const handleRequestSave = useCallback(() => {
    if (busy) return;
    const url = normalize();
    if (!url) return;
    // 仅 initial 模式提供"保存地址，稍后连接"。
    if (mode !== 'initial') return;
    setSaveConfirmOpen(true);
  }, [busy, mode, normalize]);

  const handleConfirmSave = useCallback(async () => {
    const url = normalize();
    if (!url) {
      setSaveConfirmOpen(false);
      return;
    }
    try {
      await onSaveOffline(url, draftKey);
      if (mountedRef.current) setSaveConfirmOpen(false);
    } catch (e) { if (mountedRef.current) setTest({ kind: 'failed', message: (e as Error).message }); }
  }, [draftKey, normalize, onSaveOffline]);

  const isInitial = mode === 'initial';
  const canTest = !busy;
  const testButtonLabel =
    test.kind === 'running' ? '取消测试' : test.kind === 'ok' ? '重新测试' : '测试连接';
  const onTestPress = test.kind === 'running' ? handleCancelTest : handleTest;

  return (
    <SafeAreaView style={styles.canvas}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.column}>
            <IconBox icon={Server} size={sizing[64]} iconSize={sizing[28]} tint={colors.avatarSky} iconColor={colors.accent} />
            <Text style={styles.title}>
              {isInitial ? '连接你的服务器' : mode === 'configured' ? '连接已保存的服务器' : '重新认证'}
            </Text>
            <Text style={styles.subtitle}>
              {isInitial
                ? '填写 Pi Muse 服务地址，访问密钥仅在你服务器启用了访问控制时需要。'
                : mode === 'configured' ? '地址已经保存，请完成当前服务器的连接认证。' : '当前服务器要求重新输入访问密钥，原有业务数据会保留。'}
            </Text>

            <Card style={styles.card}>
              <ErrorNotice error={test.kind === 'failed' ? test.message : test.kind === 'ok' ? undefined : error} />
              {isInitial ? (
                <Field
                  label="服务器地址"
                  value={draftUrl}
                  editable={!busy}
                  onChangeText={onChangeUrl}
                  placeholder="https://pi-muse.example.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              ) : (
                <Field
                  label="服务器地址"
                  value={serverUrl ?? ''}
                  editable={false}
                  selectTextOnFocus={false}
                />
              )}
              <Field
                label="访问 Key（可选）"
                value={draftKey}
                editable={!busy}
                onChangeText={onChangeKey}
                secureTextEntry
                placeholder={isInitial ? '未启用访问控制可留空' : '请输入访问密钥'}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {/^http:\/\//i.test(draftUrl.trim()) && <Text style={{ ...typography.small, color: colors.danger, marginBottom: spacing.md }}>HTTP 会明文传输凭证与数据，请仅用于可信网络。</Text>}
              {test.kind === 'ok' && (
                <View style={styles.okRow} accessibilityRole="text">
                  <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
                  <Text style={{ ...typography.text, color: colors.success }}>
                    连接测试通过，可以继续连接。
                  </Text>
                </View>
              )}

              <View style={styles.actions}>
                <Button primary onPress={handleConnect} busy={busy} disabled={test.kind === 'running'}>
                  {mode === 'authenticate' ? '重新认证' : test.kind === 'failed' || error ? '重试连接' : '连接服务器'}
                </Button>
                <Button onPress={onTestPress} disabled={!canTest}>
                  {testButtonLabel}
                </Button>
                {isInitial && (
                  <Button onPress={handleRequestSave} disabled={busy || test.kind === 'running'}>
                    保存地址，稍后连接
                  </Button>
                )}
                {!isInitial && (
                  <Button onPress={onChangeServer} disabled={busy}>
                    更改服务器
                  </Button>
                )}
              </View>
            </Card>

            <View style={styles.demoRow}>
              {onPreview && <Button primary onPress={onPreview} disabled={busy}>新 UI 预览</Button>}
              <Button onPress={onDemo} disabled={busy}>
                体验演示工作区
              </Button>
              {update && <Button onPress={update.open}>检查应用更新</Button>}
              <Text style={styles.demoHint}>
                无需连接服务，所有数据与操作只保存在本次演示中。
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {saveConfirmOpen && (
        <Sheet title="尚未验证就保存？" onClose={() => { if (!busy) setSaveConfirmOpen(false); }}>
          <ErrorNotice error={test.kind === 'failed' ? test.message : undefined} />
          <Text style={styles.sheetText}>
            此次保存的地址尚未通过连接测试，保存后下次进入需要先完成连接或认证。
          </Text>
          <Text style={styles.sheetText}>
            是否继续保存当前地址？
          </Text>
          <View style={styles.sheetActions}>
            <Button onPress={() => setSaveConfirmOpen(false)}>取消</Button>
            <Button
              primary
              onPress={handleConfirmSave}
              disabled={busy}
              busy={busy}
            >
              保存地址
            </Button>
          </View>
        </Sheet>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.section },
  column: {
    width: layout.fullWidth,
    maxWidth: layout.loginMaxWidth,
    alignSelf: 'center',
    gap: spacing[14],
    alignItems: 'center',
  },
  title: { ...typography.display, fontWeight: '500', color: colors.ink, textAlign: 'center' },
  subtitle: {
    ...typography.muted,
    color: colors.muted,
    textAlign: 'center',
  },
  card: { width: layout.fullWidth },
  okRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.notice,
    backgroundColor: colors.successBg,
    marginBottom: spacing.md,
  },
  statusDot: {
    width: sizing[6],
    height: sizing[6],
    borderRadius: radius[3],
  },
  actions: { gap: spacing.md, marginTop: spacing.sm },
  demoRow: { alignItems: 'center', gap: spacing.sm },
  demoHint: { ...typography.small, color: colors.muted, textAlign: 'center' },
  sheetText: { ...typography.text, color: colors.ink, marginBottom: spacing.md },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    justifyContent: 'flex-end',
  },
});