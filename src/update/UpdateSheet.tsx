// 收起弹层不取消后台持有的下载任务。

import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { ActionButton } from '../ui/ActionButton';
import { ErrorNotice } from '../ui/Feedback';
import { Sheet } from '../ui/Sheet';
import { Card } from '../ui/Surfaces';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import type { UpdateSheetProps, UpdateSnapshot } from './types';

export function UpdateSheet({
  snapshot,
  onClose,
  onCheck,
  onCancel,
  onInstall,
  onRetryDownload,
  onOpenSettings,
}: UpdateSheetProps) {
  const styles = useStyles(); const { colors } = useTheme();
  const subtitle = buildSubtitle(snapshot);
  return (
    <Sheet title="应用更新" subtitle={subtitle} onClose={onClose}>
      <View style={styles.content}>
        <Card style={styles.statusCard}>
          <StatusBlock snapshot={snapshot} />
          {snapshot.status === 'downloading' && <View accessibilityRole="progressbar" accessibilityLabel="安装包下载进度" accessibilityValue={snapshot.totalBytes ? { min: 0, max: 100, now: Math.round(Math.min(1, snapshot.bytesWritten / snapshot.totalBytes) * 100) } : undefined}>
            {snapshot.totalBytes ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, snapshot.bytesWritten / snapshot.totalBytes * 100)}%` as DimensionValue }]} /></View> : <ActivityIndicator color={colors.blue} />}
          </View>}
        </Card>

        <ErrorNotice error={snapshot.error} />

        {/* 后台/返回场景下由父级注入的提示语（snapshot.message），例如"下载已在后台完成"。 */}
        {!!snapshot.message && (
          <Text style={styles.message}>{snapshot.message}</Text>
        )}

        {snapshot.status !== 'unsupported' && (
          <Text style={styles.notice}>
            自动下载会使用当前网络，可能消耗移动流量。系统安装可能重启应用，请先保存未完成的编辑。
          </Text>
        )}

        <Actions
          snapshot={snapshot}
          {...{ onCheck, onCancel, onInstall, onRetryDownload, onOpenSettings }}
        />
      </View>
    </Sheet>
  );
}

function StatusBlock({ snapshot }: { snapshot: UpdateSnapshot }) {
  const styles = useStyles();
  switch (snapshot.status) {
    case 'unsupported':
      return (
        <View style={styles.statusContent}>
          <Text style={styles.heading}>当前环境不支持 APK 更新</Text>
          <Text style={styles.detail}>{snapshot.unsupportedReason ?? '请使用 Android 独立安装包检查与安装更新。'}</Text>
        </View>
      );
    case 'idle':
      return (
        <View style={styles.statusContent}>
          <Text style={styles.heading}>尚未检查更新</Text>
          <Text style={styles.detail}>轻点下方按钮立即检查。</Text>
        </View>
      );
    case 'checking':
      return (
        <View style={styles.statusContent}>
          <Text style={styles.heading}>正在检查更新…</Text>
          <Text style={styles.detail}>请稍候。</Text>
        </View>
      );
    case 'current':
      return (
        <View style={styles.statusContent}>
          <Text style={styles.heading}>已是最新版本</Text>
          <Text style={styles.detail}>{versionLine(snapshot)}</Text>
        </View>
      );
    case 'downloading': {
      const { mbText, percentText } = progressText(snapshot.bytesWritten, snapshot.totalBytes);
      return (
        <View style={styles.statusContent}>
          <Text style={styles.heading}>正在下载更新</Text>
          <Text style={styles.detail}>
            已下载 {mbText}
            {percentText} · 安装包大小约 {totalSizeText(snapshot)}
          </Text>
          <Text style={styles.hint}>下载过程中可继续使用应用。</Text>
        </View>
      );
    }
    case 'ready':
      return (
        <View style={styles.statusContent}>
          <Text style={styles.heading}>安装包已下载</Text>
          <Text style={styles.detail}>
            {snapshot.installAttempted ? '安装尚未确认完成，可继续安装。' : '返回应用前台后将打开系统安装界面。'}
          </Text>
        </View>
      );
    case 'installing':
      return (
        <View style={styles.statusContent}>
          <Text style={styles.heading}>正在请求系统安装</Text>
          <Text style={styles.detail}>请等待系统安装器返回结果。</Text>
        </View>
      );
    case 'cancelled':
      return (
        <View style={styles.statusContent}>
          <Text style={styles.heading}>已取消本次下载</Text>
          <Text style={styles.detail}>如需重试可重新检查或直接重试下载。</Text>
        </View>
      );
    case 'error':
      return (
        <View style={styles.statusContent}>
          <Text style={styles.heading}>更新出错</Text>
          <Text style={styles.detail}>{stageHint(snapshot.errorStage)}</Text>
        </View>
      );
  }
}

/** busy 时整体防重复点；"取消检查/下载"是用户中途止损口，故意不锁。 */
function Actions({
  snapshot,
  onCheck,
  onCancel,
  onInstall,
  onRetryDownload,
  onOpenSettings,
}: {
  snapshot: UpdateSnapshot;
  onCheck: () => void;
  onCancel: () => void;
  onInstall: () => void;
  onRetryDownload: () => void;
  onOpenSettings: () => void;
}) {
  const lock = snapshot.busy;
  const hasRelease = !!snapshot.release;

  switch (snapshot.status) {
    case 'unsupported':
      // Web / iOS / ExpoGo 没有此能力，只展示说明，关闭 Sheet 即可。
      return null;
    case 'idle':
      return (
        <ActionButton label="立即检查更新" onPress={onCheck} tone="primary" disabled={lock} />
      );
    case 'checking':
      return (
        <ActionButton label="取消检查" onPress={onCancel} />
      );
    case 'current':
      return (
        <ActionButton label="再次检查" onPress={onCheck} disabled={lock} />
      );
    case 'downloading':
      return (
        <ActionButton label="取消下载" onPress={onCancel} />
      );
    case 'ready':
      return (
        <View style={{ gap: spacing.sm }}>
          <ActionButton label="继续安装" onPress={onInstall} tone="primary" disabled={lock} />
          <ActionButton label="安装授权设置" onPress={onOpenSettings} disabled={lock} />
          <ActionButton label="重新下载" onPress={onRetryDownload} disabled={lock} />
          <ActionButton label="重新检查" onPress={onCheck} disabled={lock} />
        </View>
      );
    case 'installing':
      // 安装 job 正在系统侧，授权按钮点了也无效，仅展示状态。
      return null;
    case 'cancelled':
      return (
        <View style={{ gap: spacing.sm }}>
          {hasRelease && (
            <ActionButton label="重试下载" onPress={onRetryDownload} tone="primary" disabled={lock} />
          )}
          <ActionButton label="重新检查" onPress={onCheck} disabled={lock} />
        </View>
      );
    case 'error':
      switch (snapshot.errorStage) {
        case 'check':
          // 没有 release 时不该给"重试下载"，否则会无目标地下发。
          return (
            <ActionButton label="重新检查" onPress={onCheck} tone="primary" disabled={lock} />
          );
        case 'download':
          return (
            <ActionButton label="重试下载" onPress={onRetryDownload} tone="primary" disabled={lock} />
          );
        case 'install':
          return (
            <View style={{ gap: spacing.sm }}>
              <ActionButton label="继续安装" onPress={onInstall} tone="primary" disabled={lock} />
              <ActionButton label="安装授权设置" onPress={onOpenSettings} disabled={lock} />
              <ActionButton label="重新下载" onPress={onRetryDownload} disabled={lock} />
              <ActionButton label="重新检查" onPress={onCheck} disabled={lock} />
            </View>
          );
        default:
          return (
            <View style={{ gap: spacing.sm }}>
              {hasRelease && (
                <ActionButton label="重试下载" onPress={onRetryDownload} tone="primary" disabled={lock} />
              )}
              <ActionButton label="重新检查" onPress={onCheck} disabled={lock} />
            </View>
          );
      }
  }
}

function buildSubtitle(snapshot: UpdateSnapshot): string {
  const cur = snapshot.currentVersion ?? '未知';
  const target = snapshot.release?.version;
  return target ? `当前 ${cur} → 目标 ${target}` : `当前版本 ${cur}`;
}

function versionLine(snapshot: UpdateSnapshot): string {
  const cur = snapshot.currentVersion ?? '未知';
  const target = snapshot.release?.version;
  return target && target !== cur ? `${cur}（最新 ${target}）` : cur;
}

function totalSizeText(snapshot: UpdateSnapshot): string {
  const size = snapshot.release?.size;
  if (typeof size === 'number' && size > 0) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return '未知';
}

function progressText(
  bytesWritten: number,
  totalBytes?: number,
): { mbText: string; percentText: string } {
  const mb = bytesWritten / (1024 * 1024);
  const mbText = `${mb.toFixed(1)} MB`;
  let percentText = '';
  if (typeof totalBytes === 'number' && totalBytes > 0) {
    const pct = Math.min(100, Math.round((bytesWritten / totalBytes) * 100));
    percentText = ` (${pct}%)`;
  }
  return { mbText, percentText };
}

function stageHint(stage: UpdateSnapshot['errorStage']): string {
  switch (stage) {
    case 'check':
      return '检查更新时遇到问题，请稍后重试。';
    case 'download':
      return '下载过程中遇到问题，可重试下载。';
    case 'install':
      return '请求系统安装时未获授权，请前往系统设置开启"安装未知应用"权限。';
    default:
      return '请稍后重试。';
  }
}

function useStyles() { const { colors } = useTheme(); return useMemo(() => createStyles(colors), [colors]); }
const createStyles = (colors: WorkspaceColors) => StyleSheet.create({
  content: { gap: spacing[12] },
  statusCard: { padding: spacing[16], gap: spacing[14] },
  statusContent: { gap: spacing[4] },
  heading: { ...workspaceTheme.typography.itemTitle, color: colors.ink, fontWeight: '600' },
  detail: { ...workspaceTheme.typography.detail, color: colors.muted },
  hint: { ...workspaceTheme.typography.caption, color: colors.faint },
  message: { ...workspaceTheme.typography.status, color: colors.muted, paddingHorizontal: spacing[6] },
  notice: { ...workspaceTheme.typography.caption, color: colors.faint, paddingHorizontal: spacing[6] },
  progressTrack: { height: spacing[6], borderRadius: workspaceTheme.radius.round, backgroundColor: colors.control, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.blue, borderRadius: workspaceTheme.radius.round },
});
