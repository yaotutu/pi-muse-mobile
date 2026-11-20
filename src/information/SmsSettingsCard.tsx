import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  History,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from 'lucide-react-native';
import { workspaceTheme, spacing } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { PageHeader } from '../workspace/PageHeader';
import type { InformationItemStatus } from './types';
import { useSmsInformationState } from './SmsProvider';

export type SmsSubpage = 'briefing' | 'preferences' | 'habits' | 'records';

const SUBPAGE_TITLES: Record<SmsSubpage, string> = {
  briefing: '历史短信与简报',
  preferences: '提醒偏好',
  habits: '已学习的短信习惯',
  records: '处理记录与调试',
};

const SAMPLE_COURIER = '【顺丰速运】您的包裹已送达菜鸟驿站，取件码 3-4-2018，请凭码及时取件。';
const SAMPLE_SPAM = '【特惠通知】年中大促火热开启，全场五折包邮，回复TD退订。';

const STATUS_LABELS: Record<InformationItemStatus, string> = {
  pending: '待分析',
  processing: '分析中',
  processed: '已分析',
  failed: '分析失败',
};

const formatBriefingTime = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const describeLastError = (code?: string): string => {
  if (code === 'INVALID_MODEL_RESULT') return '模型返回结构异常，可点击重试恢复';
  if (code === 'MODEL_REQUEST_FAILED') return '模型请求超时或服务暂不可用';
  if (code === 'CANCELLED') return '分析过程被中断，可点击继续完成';
  return '后台处理中断，重试后将自动补齐简报';
};

function SmsNavRow({
  icon: Icon,
  label,
  description,
  divider = false,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  divider?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [navStyles.row, { backgroundColor: pressed ? colors.selected : colors.surface }]}
    >
      {divider && <View pointerEvents="none" style={[navStyles.divider, { backgroundColor: colors.line }]} />}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[navStyles.iconBox, { backgroundColor: colors.control }]}
      >
        <Icon size={workspaceTheme.layout.appSettingsIcon} strokeWidth={1.7} color={colors.ink} />
      </View>
      <View style={navStyles.rowText}>
        <Text style={[navStyles.rowTitle, { color: colors.ink }]}>{label}</Text>
        <Text style={[navStyles.description, { color: colors.muted }]}>{description}</Text>
      </View>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ChevronRight size={workspaceTheme.layout.appSettingsIcon} strokeWidth={1.7} color={colors.muted} />
      </View>
    </Pressable>
  );
}

const navStyles = StyleSheet.create({
  row: {
    minHeight: workspaceTheme.layout.appSettingsRowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
    gap: spacing[12],
  },
  divider: { position: 'absolute', top: 0, left: spacing[16], right: spacing[16], height: StyleSheet.hairlineWidth },
  iconBox: {
    width: workspaceTheme.layout.appSettingsIconBox,
    height: workspaceTheme.layout.appSettingsIconBox,
    flexShrink: 0,
    borderRadius: spacing[12],
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0, gap: spacing[2] },
  rowTitle: { ...workspaceTheme.typography.itemTitle, fontWeight: '500' },
  description: { ...workspaceTheme.typography.status },
});

/**
 * 短信设置：第一层只放开关、连接与精简二级入口；
 * 历史简报、提醒偏好、习惯画像与调试记录下钻到二级子页，且简报全文默认折叠。
 */
export function SmsSettingsCard({
  backRef,
  onBack,
  onOpenChat,
}: {
  backRef?: { current: (() => boolean) | null };
  onBack?: () => void;
  onOpenChat?: () => void;
}) {
  const { colors } = useTheme();
  const info = useSmsInformationState();
  const [subpage, setSubpage] = useState<SmsSubpage | null>(null);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [debugInputOpen, setDebugInputOpen] = useState(false);
  const [customSms, setCustomSms] = useState('');
  const { setVisible } = info;
  useEffect(() => { setVisible(true); return () => setVisible(false); }, [setVisible]);

  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (!subpage) return false;
      setSubpage(null);
      return true;
    };
    return () => {
      backRef.current = null;
    };
  }, [backRef, subpage]);

  const activeSubpage = subpage;
  const openSubpage = (next: SmsSubpage) => setSubpage(next);
  const goBack = () => {
    if (activeSubpage) {
      setSubpage(null);
      return;
    }
    onBack?.();
  };

  const styles = useMemo(() => StyleSheet.create({
    scroll: { padding: spacing[20], gap: spacing[16] },
    stack: { gap: spacing[16] },
    card: { gap: spacing[14] },
    listCard: { padding: 0, overflow: 'hidden' },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[12] },
    iconBox: {
      width: workspaceTheme.layout.appSettingsIconBox,
      height: workspaceTheme.layout.appSettingsIconBox,
      borderRadius: spacing[12],
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[12], minHeight: workspaceTheme.layout.smallControl },
    body: { flex: 1, minWidth: 0, gap: spacing[4] },
    title: { ...workspaceTheme.typography.itemTitle, fontWeight: '600', color: colors.ink },
    sectionTitle: { ...workspaceTheme.typography.itemTitle, fontWeight: '600', color: colors.ink, flex: 1 },
    detail: { ...workspaceTheme.typography.detail, color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, color: colors.muted },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
    switch: {
      width: workspaceTheme.layout.switchWidth,
      height: workspaceTheme.layout.switchHeight,
      borderRadius: workspaceTheme.radius.round,
      backgroundColor: colors.control,
      padding: spacing[3],
      flexShrink: 0,
    },
    switchOn: { backgroundColor: colors.blue },
    thumb: {
      width: workspaceTheme.layout.switchThumb,
      height: workspaceTheme.layout.switchThumb,
      borderRadius: workspaceTheme.radius.round,
      backgroundColor: colors.onAccent,
    },
    thumbOn: { alignSelf: 'flex-end' },
    pill: {
      paddingHorizontal: spacing[10],
      paddingVertical: spacing[4],
      borderRadius: workspaceTheme.radius.round,
      flexShrink: 0,
    },
    pillText: { ...workspaceTheme.typography.caption, fontWeight: '600' },
    compactStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[8],
    },
    actionBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[12],
    },
    warningBox: {
      gap: spacing[10],
      padding: spacing[12],
      borderRadius: workspaceTheme.radius.field,
      backgroundColor: colors.warningSoft,
    },
    warningHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[8] },
    dangerBox: {
      gap: spacing[6],
      padding: spacing[12],
      borderRadius: workspaceTheme.radius.field,
      backgroundColor: colors.dangerSoft,
    },
    progressBox: {
      gap: spacing[10],
      padding: spacing[14],
      borderRadius: workspaceTheme.radius.field,
      backgroundColor: colors.control,
    },
    progressTrack: {
      height: spacing[6],
      borderRadius: workspaceTheme.radius.round,
      backgroundColor: colors.line,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: workspaceTheme.radius.round,
      backgroundColor: colors.blue,
    },
    buttonRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
    input: { minHeight: 140 },
    smsInput: { minHeight: 68 },
    toggleRow: {
      minHeight: workspaceTheme.layout.smallControl,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[10],
    },
    toggleAction: { flexDirection: 'row', alignItems: 'center', gap: spacing[4], flexShrink: 0 },
    briefingPreview: { ...workspaceTheme.typography.status, color: colors.muted },
    briefingBodyBox: {
      gap: spacing[12],
      paddingTop: spacing[10],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    itemCard: {
      padding: spacing[12],
      backgroundColor: colors.control,
      borderRadius: workspaceTheme.radius.field,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      gap: spacing[6],
    },
    itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] },
    statusTag: { paddingHorizontal: spacing[8], paddingVertical: spacing[2], borderRadius: workspaceTheme.radius.round },
    statusTagText: { ...workspaceTheme.typography.caption, fontWeight: '600' },
  }), [colors]);

  const enabled = !!info.settings?.enabled;
  const counts = info.status?.counts;
  const pendingCount = counts?.pending ?? info.items.filter((item) => item.status === 'pending').length;
  const processedCount = counts?.processed ?? info.items.filter((item) => item.status === 'processed').length;
  const failedCount = counts?.failed ?? info.items.filter((item) => item.status === 'failed').length;
  const totalCount = counts?.total ?? info.items.length;
  const completedCount = processedCount + failedCount;
  const activeRun = Boolean(info.ingesting || info.importProgress || info.triggering || info.status?.running);
  const briefing = info.status?.latestBriefing;
  const customNotes = info.preferences?.notes?.trim() ?? '';
  const learnedText = info.preferences?.learnedNotes?.trim() ?? '';
  const notesDirty = info.draftNotes !== (info.preferences?.notes ?? '');

  const stageLabel = activeRun
    ? '整理中'
    : failedCount > 0
      ? `有 ${failedCount} 条失败`
      : briefing
        ? '已生成简报'
        : pendingCount > 0
          ? '待分析'
          : '准备就绪';
  const stagePalette = activeRun
    ? { bg: colors.blueSoft, fg: colors.accentText }
    : failedCount > 0
      ? { bg: colors.dangerSoft, fg: colors.danger }
      : briefing
        ? { bg: colors.successSoft, fg: colors.success }
        : { bg: colors.control, fg: colors.muted };

  const progressRatio = (() => {
    if (info.importProgress?.phase === 'reading' || info.importProgress?.phase === 'uploading') {
      return info.importProgress.total > 0 ? Math.max(0.08, Math.min(1, info.importProgress.current / info.importProgress.total)) : 0.15;
    }
    if (info.status?.running && totalCount > 0) {
      return Math.max(0.08, Math.min(1, completedCount / totalCount));
    }
    return 0.12;
  })();
  const progressPercent = `${Math.round(progressRatio * 100)}%` as `${number}%`;

  const progressHeadline = (() => {
    if (info.importProgress?.phase === 'reading') {
      return `正在读取本机短信 (${info.importProgress.current}/${info.importProgress.total})`;
    }
    if (info.importProgress?.phase === 'uploading') {
      return `正在上传到服务器 (${info.importProgress.current}/${info.importProgress.total})`;
    }
    if (info.status?.running) {
      return `正在后台整理 (${completedCount}/${totalCount})`;
    }
    return '正在启动后台整理…';
  })();

  const inboxCountKnown = info.isSmsAvailable && info.hasSmsPermission === true && info.inboxTotalCount !== null;
  const hasUnimportedInbox = inboxCountKnown && (info.inboxTotalCount ?? 0) > 0 && totalCount === 0;

  const briefingSummary = activeRun
    ? `正在整理 ${completedCount}/${totalCount} 条`
    : failedCount > 0
      ? `${failedCount} 条分析失败，需重试`
      : briefing
        ? `已整理 ${processedCount} 条 · ${formatBriefingTime(briefing.createdAt)} 简报`
        : pendingCount > 0
          ? `${pendingCount} 条待分析`
          : processedCount > 0
            ? `已整理 ${processedCount} 条`
            : '尚未整理历史短信';

  const habitsSummary = learnedText ? '已根据历史短信沉淀过滤画像' : '整理短信后自动总结过滤习惯';

  const briefingCollapsedPreview = briefing
    ? (() => {
        const line = briefing.text.replace(/\s+/g, ' ').trim();
        return line.length > 36 ? `${line.slice(0, 36)}…` : line;
      })()
    : '';

  const errorBanner = !!info.error && (
    <View>
      <FeedbackNotice tone="danger" text={info.error} />
      <ActionButton
        label="刷新短信状态"
        text="刷新核对"
        icon={RefreshCw}
        disabled={info.saving || info.ingesting || info.triggering}
        onPress={() => void info.reload()}
      />
    </View>
  );

  const renderHome = () => (
    <>
      {errorBanner}

      <Card style={styles.card}>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="启用短信处理"
          accessibilityState={{ checked: enabled, disabled: info.loading || info.saving || info.needsReadback }}
          disabled={info.loading || info.saving || info.needsReadback}
          onPress={() => void info.toggleEnabled(!enabled)}
          style={styles.switchRow}
          testID="sms-enable-switch"
        >
          <View style={[styles.iconBox, { backgroundColor: enabled ? colors.blueSoft : colors.control }]}>
            <MessageSquare size={workspaceTheme.layout.appSettingsIcon} strokeWidth={1.8} color={enabled ? colors.accentText : colors.muted} />
          </View>
          <View style={styles.body}>
            <Text style={styles.title}>短信自动整理</Text>
            <Text style={styles.caption}>
              {enabled ? '筛选快递、账单与行程提醒，忽略广告营销' : '开启后可整理历史短信并自动监听新短信'}
            </Text>
          </View>
          <View pointerEvents="none" style={[styles.switch, enabled && styles.switchOn]}>
            <View style={[styles.thumb, enabled && styles.thumbOn]} />
          </View>
        </Pressable>

        {info.loading && !info.settings && <Text style={styles.caption}>正在读取状态…</Text>}

        {enabled && (
          <>
            <View style={styles.divider} />
            {info.isSmsAvailable ? (
              info.hasSmsPermission === true ? (
                info.inboxTotalCount === 0 ? (
                  <View style={styles.warningBox}>
                    <View style={styles.warningHeader}>
                      <ShieldAlert size={18} strokeWidth={1.8} color={colors.warning} />
                      <Text style={[styles.caption, styles.body, { color: colors.ink }]} testID="sms-inbox-count">
                        当前读取到 0 条短信，请在系统设置开启“读取短信”及“通知类短信”。
                      </Text>
                    </View>
                    <View style={styles.buttonRow}>
                      <ActionButton label="前往系统设置开启权限" text="系统设置" onPress={() => void info.openPermissionSettings()} />
                      <ActionButton label="重新检测短信权限" text="重新检测" onPress={() => void info.checkPermission()} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.compactStatusRow}>
                    <ShieldCheck size={17} strokeWidth={1.9} color={colors.success} />
                    <Text style={[styles.caption, styles.body, { color: colors.ink }]} testID="sms-inbox-count">
                      {info.inboxTotalCount !== null
                        ? `本机收件箱 ${info.inboxTotalCount} 条 · 自动监听中`
                        : '正在检测本机收件箱…'}
                    </Text>
                  </View>
                )
              ) : (
                <View style={styles.warningBox}>
                  <View style={styles.warningHeader}>
                    <ShieldAlert size={18} strokeWidth={1.8} color={colors.warning} />
                    <Text style={[styles.caption, styles.body, { color: colors.ink }]}>
                      未授予短信权限（部分手机还需在系统设置开启“通知类短信”）。
                    </Text>
                  </View>
                  <View style={styles.buttonRow}>
                    <ActionButton label="授予短信读取权限" text="授予权限" tone="primary" onPress={() => void info.requestPermission()} />
                    <ActionButton label="前往系统设置开启权限" text="系统设置" onPress={() => void info.openPermissionSettings()} />
                  </View>
                </View>
              )
            ) : (
              <Text style={styles.caption}>当前设备不支持直接读取系统收件箱</Text>
            )}
          </>
        )}
      </Card>

      {enabled && (activeRun || failedCount > 0 || hasUnimportedInbox || pendingCount > 0) && (
        <Card
          tone={failedCount > 0 && !activeRun ? 'danger' : 'default'}
          style={styles.card}
        >
          {activeRun ? (
            <View style={{ gap: spacing[8] }} testID="sms-import-progress">
              <View style={styles.headerRow}>
                <Text style={styles.detail}>{progressHeadline}</Text>
                <Text style={styles.caption}>完成后推 1 份简报</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: progressPercent }]} />
              </View>
            </View>
          ) : failedCount > 0 ? (
            <View style={styles.actionBanner}>
              <Text style={[styles.detail, styles.body, { color: colors.danger }]}>
                有 {failedCount} 条历史短信分析失败
              </Text>
              <ActionButton
                label="重试失败短信并生成简报"
                text={`重试 ${failedCount} 条`}
                icon={RotateCcw}
                tone="primary"
                disabled={info.needsReadback}
                onPress={() => {
                  openSubpage('briefing');
                  void info.retryFailed();
                }}
                testID="sms-retry-failed-button"
              />
            </View>
          ) : hasUnimportedInbox ? (
            <View style={styles.actionBanner}>
              <Text style={[styles.detail, styles.body]}>
                本机 {info.inboxTotalCount} 条历史短信尚未整理
              </Text>
              <ActionButton
                label={`整理全部 ${info.inboxTotalCount} 条历史短信`}
                text="一键整理"
                icon={Sparkles}
                tone="primary"
                disabled={info.needsReadback}
                onPress={() => {
                  openSubpage('briefing');
                  void info.importAllInboxSms();
                }}
                testID="sms-import-history-button"
              />
            </View>
          ) : (
            <View style={styles.actionBanner}>
              <Text style={[styles.detail, styles.body]}>
                队列中有 {pendingCount} 条待分析短信
              </Text>
              <ActionButton
                label="立即分析待处理短信并生成简报"
                text="开始整理"
                icon={Play}
                tone="primary"
                disabled={info.needsReadback}
                onPress={() => {
                  openSubpage('briefing');
                  void info.triggerRun({ background: true, forceInitial: true });
                }}
                testID="sms-run-pending-button"
              />
            </View>
          )}
        </Card>
      )}

      {enabled && (
        <Card style={styles.listCard}>
          <SmsNavRow
            icon={FileText}
            label="历史短信与简报"
            description={briefingSummary}
            onPress={() => openSubpage('briefing')}
            testID="sms-nav-briefing"
          />
          <SmsNavRow
            icon={SlidersHorizontal}
            label="提醒偏好"
            description={customNotes ? '已自定义过滤规则' : '默认规则（快递、账单、行程）'}
            divider
            onPress={() => openSubpage('preferences')}
            testID="sms-nav-preferences"
          />
          <SmsNavRow
            icon={Brain}
            label="已学习的短信习惯"
            description={habitsSummary}
            divider
            onPress={() => openSubpage('habits')}
            testID="sms-nav-habits"
          />
          <SmsNavRow
            icon={History}
            label="处理记录与调试"
            description={`共 ${totalCount} 条记录`}
            divider
            onPress={() => openSubpage('records')}
            testID="sms-nav-records"
          />
        </Card>
      )}
    </>
  );

  const renderBriefingPage = () => (
    <>
      {errorBanner}
      {!info.error && !!info.notice && (failedCount === 0 || activeRun) && (
        <FeedbackNotice tone="success" text={info.notice} />
      )}

      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>全量整理状态</Text>
          <View style={[styles.pill, { backgroundColor: stagePalette.bg }]}>
            <Text style={[styles.pillText, { color: stagePalette.fg }]}>{stageLabel}</Text>
          </View>
        </View>

        {activeRun ? (
          <View style={styles.progressBox} testID="sms-import-progress">
            <Text style={styles.detail}>{progressHeadline}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: progressPercent }]} />
            </View>
            <Text style={styles.caption}>
              {info.status?.running && counts
                ? `待处理 ${counts.pending} 条 · 处理中 ${counts.processing} 条 · 已完成 ${counts.processed} 条；完成后合并为 1 份简报推送`
                : '正在整理历史短信，完成后仅推 1 份精炼简报，不会刷屏。'}
            </Text>
          </View>
        ) : failedCount > 0 ? (
          <>
            <View style={styles.dangerBox} testID="sms-failed-box">
              <Text style={[styles.detail, { color: colors.danger, fontWeight: '600' }]}>
                已完成 {processedCount} / {totalCount} 条，有 {failedCount} 条未能完成分析
              </Text>
              <Text style={[styles.caption, { color: colors.ink }]}>
                {describeLastError(info.status?.lastError)}
              </Text>
            </View>
            <View style={styles.buttonRow}>
              <ActionButton
                label="重试失败短信并生成简报"
                text={`重试 ${failedCount} 条失败短信`}
                icon={RotateCcw}
                tone="primary"
                wide
                disabled={info.needsReadback}
                onPress={() => void info.retryFailed()}
                testID="sms-retry-failed-button"
              />
              <ActionButton
                label="重新扫描本机短信"
                text="重新扫描"
                icon={RefreshCw}
                disabled={info.needsReadback}
                onPress={() => void info.importAllInboxSms()}
                testID="sms-import-history-button"
              />
            </View>
          </>
        ) : pendingCount > 0 ? (
          <>
            <Text style={styles.caption}>
              队列中有 {pendingCount} 条待分析短信，整理完成后将合并为 1 份精炼简报推送到消息页。
            </Text>
            <ActionButton
              label="立即分析待处理短信并生成简报"
              text={`开始分析 ${pendingCount} 条待处理短信`}
              icon={Play}
              tone="primary"
              wide
              disabled={info.needsReadback}
              onPress={() => void info.triggerRun({ background: true, forceInitial: true })}
              testID="sms-run-pending-button"
            />
          </>
        ) : briefing ? (
          <>
            <Text style={styles.caption}>
              已整理 {processedCount} 条历史短信 · 若有新到历史短信可重新扫描汇总
            </Text>
            <View style={styles.buttonRow}>
              {onOpenChat && (
                <ActionButton
                  label="前往消息页查看简报"
                  text="去消息页查看"
                  icon={MessageSquare}
                  tone="primary"
                  wide
                  onPress={onOpenChat}
                  testID="sms-open-chat-button"
                />
              )}
              <ActionButton
                label="检查并整理新增历史短信"
                text="检查新增短信"
                icon={RefreshCw}
                disabled={info.needsReadback}
                onPress={() => void info.importAllInboxSms()}
                testID="sms-import-history-button"
              />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.caption}>
              一次性读取全部历史短信并过滤营销与过期内容，最后只生成 1 份简报推送到消息页。
            </Text>
            <ActionButton
              label={inboxCountKnown && (info.inboxTotalCount ?? 0) > 0
                ? `整理全部 ${info.inboxTotalCount} 条历史短信`
                : '整理全部历史短信'}
              text={inboxCountKnown && (info.inboxTotalCount ?? 0) > 0
                ? `整理全部 ${info.inboxTotalCount} 条历史短信`
                : '整理全部历史短信'}
              icon={Sparkles}
              tone="primary"
              wide
              disabled={info.needsReadback}
              onPress={() => void info.importAllInboxSms()}
              testID="sms-import-history-button"
            />
          </>
        )}
      </Card>

      <Card style={styles.card}>
        {briefing ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: briefingExpanded }}
              onPress={() => setBriefingExpanded((prev) => !prev)}
              style={styles.toggleRow}
              testID="sms-briefing-toggle"
            >
              <View style={styles.body}>
                <Text style={styles.title}>最近一次简报</Text>
                <Text style={styles.caption}>
                  {formatBriefingTime(briefing.createdAt)} · {briefing.itemCount > 0 ? `含 ${briefing.itemCount} 条提醒` : '暂无待办'}
                </Text>
              </View>
              <View style={styles.toggleAction}>
                <Text style={styles.caption}>{briefingExpanded ? '收起' : '展开全文'}</Text>
                {briefingExpanded
                  ? <ChevronUp size={18} strokeWidth={1.8} color={colors.muted} />
                  : <ChevronDown size={18} strokeWidth={1.8} color={colors.muted} />}
              </View>
            </Pressable>

            {briefingExpanded ? (
              <View style={styles.briefingBodyBox} testID="sms-latest-briefing">
                <Text selectable style={styles.detail}>{briefing.text}</Text>
                {onOpenChat && (
                  <ActionButton
                    label="前往消息页查看"
                    text="去消息页查看"
                    icon={MessageSquare}
                    onPress={onOpenChat}
                  />
                )}
              </View>
            ) : (
              <Text style={styles.briefingPreview}>{briefingCollapsedPreview}</Text>
            )}
          </>
        ) : (
          <View style={styles.body}>
            <Text style={styles.title}>最近一次简报</Text>
            <Text style={styles.caption}>尚未生成简报，整理完历史短信后会收纳在此处（默认折叠）。</Text>
          </View>
        )}
      </Card>
    </>
  );

  const renderPreferencesPage = () => (
    <>
      {errorBanner}
      {!info.error && !!info.notice && <FeedbackNotice tone="success" text={info.notice} />}

      <Card style={styles.card}>
        <View style={styles.body}>
          <Text style={styles.title}>过滤规则与偏好</Text>
          <Text style={styles.caption}>仅用于短信筛选，不影响聊天会话或助手人设。</Text>
        </View>
        <FormInput
          accessibilityLabel="信息过滤指示"
          multiline
          value={info.draftNotes}
          editable={!info.loading && !info.saving && !info.needsReadback}
          onChangeText={info.setDraftNotes}
          placeholder="例如：重要取件码、机票火车票、银行还款提醒我；促销广告和历史验证码直接忽略。"
          placeholderTextColor={colors.faint}
          style={styles.input}
          maxLength={1000}
        />
        <ActionButton
          label="保存提醒偏好"
          text={info.saving ? '正在保存…' : notesDirty ? '保存偏好' : '已保存'}
          icon={Check}
          tone={notesDirty ? 'primary' : 'secondary'}
          busy={info.saving}
          disabled={!notesDirty || info.loading || info.saving || info.needsReadback}
          onPress={() => void info.saveNotes()}
        />
      </Card>
    </>
  );

  const renderHabitsPage = () => (
    <>
      {errorBanner}
      <Card style={styles.card} testID="sms-learned-notes">
        <View style={styles.body}>
          <Text style={styles.title}>已学习的短信习惯</Text>
          <Text style={styles.caption}>根据历史短信与消息反馈自动沉淀，用于减少营销与重复提醒。</Text>
        </View>
        {learnedText ? (
          <Text selectable style={styles.detail}>{learnedText}</Text>
        ) : (
          <Text style={styles.caption}>尚未沉淀画像，完成历史短信整理或对提醒点赞/少推反馈后会在这里展示。</Text>
        )}
      </Card>
    </>
  );

  const renderRecordsPage = () => (
    <>
      {errorBanner}
      {!info.error && !!info.notice && <FeedbackNotice tone="success" text={info.notice} />}

      <Card style={styles.card}>
        <View style={styles.buttonRow}>
          <ActionButton
            label="刷新短信状态"
            text="刷新状态"
            icon={RefreshCw}
            disabled={info.saving || info.ingesting || info.triggering}
            onPress={() => void info.reload()}
          />
          <ActionButton
            label="导入测试样例"
            text="导入测试样例"
            disabled={activeRun || info.needsReadback}
            onPress={() => void info.importSampleHistory()}
            testID="sms-import-sample-button"
          />
        </View>
      </Card>

      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>最近处理记录</Text>
          <Text style={styles.caption}>共 {totalCount} 条</Text>
        </View>
        {info.items.length > 0 ? (
          info.items.slice(0, 8).map((item) => {
            const snippet = item.content.replace(/\s+/g, ' ').trim();
            const clipped = snippet.length > 90 ? `${snippet.slice(0, 90)}…` : snippet;
            const isPending = item.status === 'pending';
            const isFailed = item.status === 'failed';
            return (
              <View key={item.id} style={styles.itemCard}>
                <View style={styles.itemHeader}>
                  <View style={[
                    styles.statusTag,
                    { backgroundColor: isFailed ? colors.dangerSoft : isPending ? colors.warningSoft : colors.surface },
                  ]}>
                    <Text style={[
                      styles.statusTagText,
                      { color: isFailed ? colors.danger : isPending ? colors.warning : colors.muted },
                    ]}>
                      {STATUS_LABELS[item.status]}
                    </Text>
                  </View>
                  <Text style={[styles.caption, styles.body]}>{item.title || item.source}</Text>
                </View>
                <Text style={styles.detail}>{clipped}</Text>
              </View>
            );
          })
        ) : (
          <Text style={styles.caption}>暂无处理记录。</Text>
        )}
      </Card>

      <Card style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: debugInputOpen }}
          onPress={() => setDebugInputOpen((prev) => !prev)}
          style={styles.toggleRow}
          testID="sms-debug-input-toggle"
        >
          <Text style={styles.title}>手动模拟单条短信</Text>
          <View style={styles.toggleAction}>
            <Text style={styles.caption}>{debugInputOpen ? '收起' : '展开'}</Text>
            {debugInputOpen
              ? <ChevronUp size={18} strokeWidth={1.8} color={colors.muted} />
              : <ChevronDown size={18} strokeWidth={1.8} color={colors.muted} />}
          </View>
        </Pressable>

        {debugInputOpen && (
          <>
            <FormInput
              accessibilityLabel="短信文本输入"
              multiline
              value={customSms}
              onChangeText={setCustomSms}
              placeholder="输入或粘贴一条短信用于调试…"
              placeholderTextColor={colors.faint}
              style={styles.smsInput}
              maxLength={1000}
            />
            <View style={styles.buttonRow}>
              <ActionButton
                label="上报短信"
                text={info.ingesting ? '正在上报…' : '上报短信'}
                icon={Send}
                busy={info.ingesting}
                disabled={info.ingesting || info.needsReadback || !customSms.trim()}
                onPress={async () => {
                  const textToIngest = customSms;
                  if (await info.ingestSms(textToIngest)) setCustomSms('');
                }}
              />
              <ActionButton label="填充快递样例" text="+ 快递样例" onPress={() => setCustomSms(SAMPLE_COURIER)} />
              <ActionButton label="填充营销样例" text="+ 营销样例" onPress={() => setCustomSms(SAMPLE_SPAM)} />
            </View>
          </>
        )}
      </Card>
    </>
  );

  const content = activeSubpage === 'briefing'
    ? renderBriefingPage()
    : activeSubpage === 'preferences'
      ? renderPreferencesPage()
      : activeSubpage === 'habits'
        ? renderHabitsPage()
        : activeSubpage === 'records'
          ? renderRecordsPage()
          : renderHome();

  if (!onBack && !activeSubpage) {
    return <View style={styles.stack}>{content}</View>;
  }

  return (
    <>
      <PageHeader
        title={activeSubpage ? SUBPAGE_TITLES[activeSubpage] : '短信设置'}
        backLabel={activeSubpage ? '返回短信设置' : '返回设置'}
        onBack={goBack}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        {content}
      </ScrollView>
    </>
  );
}
