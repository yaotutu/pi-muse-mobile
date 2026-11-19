import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Inbox, Play, Send, ShieldAlert, ShieldCheck } from 'lucide-react-native';
import { workspaceTheme, spacing } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { useSmsInformationState } from './SmsProvider';

const SAMPLE_COURIER = '【顺丰速运】您的包裹已送达菜鸟驿站，取件码 3-4-2018，请凭码及时取件。';
const SAMPLE_SPAM = '【特惠通知】年中大促火热开启，全场五折包邮，回复TD退订。';

export function SmsSettingsCard() {
  const { colors } = useTheme();
  const info = useSmsInformationState();
  const [customSms, setCustomSms] = useState('');
  const { setVisible } = info;
  useEffect(() => { setVisible(true); return () => setVisible(false); }, [setVisible]);

  const styles = useMemo(() => StyleSheet.create({
    card: { padding: spacing[16], gap: spacing[14], marginBottom: spacing[14], backgroundColor: colors.surface, borderRadius: workspaceTheme.radius.card },
    section: { ...workspaceTheme.typography.section, color: colors.ink },
    text: { ...workspaceTheme.typography.detail, color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, color: colors.muted },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: workspaceTheme.layout.controlSize, paddingVertical: spacing[10], gap: spacing[14], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
    iconHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing[10] },
    body: { flex: 1, gap: spacing[4] },
    input: { minHeight: 80 },
    smsInput: { minHeight: 60 },
    switch: { width: workspaceTheme.layout.switchWidth, height: workspaceTheme.layout.switchHeight, borderRadius: workspaceTheme.radius.round, backgroundColor: colors.control, padding: spacing[3] },
    switchOn: { backgroundColor: colors.blue },
    thumb: { width: workspaceTheme.layout.switchThumb, height: workspaceTheme.layout.switchThumb, borderRadius: workspaceTheme.radius.round, backgroundColor: colors.onAccent },
    thumbOn: { alignSelf: 'flex-end' },
    buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8], marginTop: spacing[4] },
    sampleButton: { paddingHorizontal: spacing[10], paddingVertical: spacing[6], backgroundColor: colors.control, borderRadius: workspaceTheme.radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
    sampleButtonText: { ...workspaceTheme.typography.caption, color: colors.ink },
    subSection: { gap: spacing[8], marginTop: spacing[8], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: spacing[12] },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    statusBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[8], padding: spacing[10], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.successSoft },
    statusBannerText: { ...workspaceTheme.typography.caption, color: colors.ink },
    permissionBox: { gap: spacing[8], padding: spacing[10], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.warningSoft },
    permissionText: { ...workspaceTheme.typography.caption, color: colors.ink },
    itemList: { gap: spacing[8], marginTop: spacing[4] },
    itemCard: { padding: spacing[10], backgroundColor: colors.control, borderRadius: workspaceTheme.radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, gap: spacing[4] },
    itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] },
    statusTag: { paddingHorizontal: spacing[6], paddingVertical: spacing[2], borderRadius: workspaceTheme.radius.round },
    statusPending: { backgroundColor: colors.warningSoft },
    statusProcessed: { backgroundColor: colors.surface },
    statusTagText: { ...workspaceTheme.typography.caption, fontSize: 11, fontWeight: '600' },
    itemSource: { ...workspaceTheme.typography.caption, color: colors.muted, flex: 1 },
    itemContent: { ...workspaceTheme.typography.detail, color: colors.ink },
    badge: { alignSelf: 'flex-start', paddingHorizontal: spacing[8], paddingVertical: spacing[4], backgroundColor: colors.control, borderRadius: workspaceTheme.radius.round },
    badgeText: { ...workspaceTheme.typography.caption, color: colors.muted },
  }), [colors]);

  const enabled = !!info.settings?.enabled;
  const statusCounts = info.status?.counts;
  const pendingCount = statusCounts?.pending ?? info.items.filter((item) => item.status === 'pending').length;
  const totalQueueCount = statusCounts?.total ?? info.items.length;
  const processedDoneCount = (statusCounts?.processed ?? 0) + (statusCounts?.failed ?? 0);
  const importBusy = info.ingesting || !!info.importProgress;

  return (
    <Card style={styles.card}>
      <View style={styles.iconHeading}>
        <Inbox size={workspaceTheme.layout.iconSize - spacing[4]} strokeWidth={1.6} color={colors.muted} />
        <Text style={styles.section}>短信处理</Text>
      </View>
      <Text style={styles.caption}>
        由独立短信 Sub-Agent 在后台筛选分析；重要通知以独立卡片展示在聊天界面中，默认不进入主对话大模型上下文。
      </Text>
      {info.loading && <Text style={styles.caption}>正在读取短信状态…</Text>}

      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="启用短信处理"
        accessibilityState={{ checked: enabled, disabled: info.loading || info.saving || info.needsReadback }}
        disabled={info.loading || info.saving || info.needsReadback}
        onPress={() => void info.toggleEnabled(!enabled)}
        style={styles.row}
      >
        <View style={styles.body}>
          <Text style={styles.text}>启用短信处理</Text>
          <Text style={styles.caption}>
            {enabled ? '已开启：信息上报后自动进行批处理分析' : '已关闭：不处理上报信息'}
          </Text>
        </View>
        <View pointerEvents="none" style={[styles.switch, enabled && styles.switchOn]}>
          <View style={[styles.thumb, enabled && styles.thumbOn]} />
        </View>
      </Pressable>

      {enabled && (
        <>
          <View style={styles.body}>
            <Text style={styles.text}>过滤规则与偏好</Text>
            <Text style={styles.caption}>短信专属过滤规则（独立保存，不写入主会话指令）：指导短信 Sub-Agent 如何筛选与判断（重要通知 vs 静默）。</Text>
            <FormInput
              accessibilityLabel="信息过滤指示"
              multiline
              value={info.draftNotes}
              editable={!info.loading && !info.saving && !info.needsReadback}
              onChangeText={info.setDraftNotes}
              placeholder="例如：整理快递取件码、验证码、重要账单等；营销推广与垃圾广告静默忽略。"
              placeholderTextColor={colors.faint}
              style={styles.input}
              maxLength={1000}
            />
            <ActionButton
              label="保存信息偏好"
              text={info.saving ? '正在保存…' : '保存偏好'}
              icon={Check}
              tone="primary"
              busy={info.saving}
              disabled={info.saving || info.needsReadback}
              onPress={() => void info.saveNotes()}
            />
          </View>

          {!!info.preferences?.learnedNotes?.trim() && (
            <View style={styles.itemCard} testID="sms-learned-notes">
              <Text style={styles.text}>Sub-Agent 已学习的敏感度画像</Text>
              <Text style={styles.caption}>{info.preferences.learnedNotes.trim()}</Text>
            </View>
          )}

          {!!info.preferences?.feedbackExamples?.length && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                已沉淀 {info.preferences.feedbackExamples.length} 条基于消息反馈的学习例证
              </Text>
            </View>
          )}

          <View style={styles.subSection}>
            <Text style={styles.text}>短信接入与历史全量分析</Text>
            {info.isSmsAvailable ? (
              info.hasSmsPermission === true ? (
                <View style={styles.statusBanner}>
                  <ShieldCheck size={16} strokeWidth={2} color={colors.success} />
                  <View style={styles.body}>
                    <Text style={styles.statusBannerText}>
                      Android 原生短信监听已激活：新收到的短信将自动上报至待处理队列。
                    </Text>
                    {info.inboxTotalCount !== null && (
                      <Text style={styles.caption} testID="sms-inbox-count">
                        {info.inboxTotalCount > 0
                          ? `本机收件箱共检测到 ${info.inboxTotalCount} 条历史短信，支持分页读取全部并后台逐批分析。`
                          : '本机收件箱当前读取到 0 条短信；若手机内有短信但无法读取，请在系统设置开启“读取短信”及“通知类短信”。'}
                      </Text>
                    )}
                    {info.inboxTotalCount === 0 && (
                      <View style={styles.buttonRow}>
                        <ActionButton
                          label="前往系统设置开启权限"
                          text="前往系统设置开启权限"
                          tone="secondary"
                          onPress={() => void info.openPermissionSettings()}
                        />
                      </View>
                    )}
                  </View>
                </View>
              ) : (
                <View style={styles.permissionBox}>
                  <View style={styles.itemHeader}>
                    <ShieldAlert size={16} strokeWidth={2} color={colors.warning} />
                    <Text style={styles.permissionText}>
                      尚未开启系统短信读取权限，无法读取全部历史短信或监听新短信（部分国产系统还需开启“通知类短信”）。
                    </Text>
                  </View>
                  <View style={styles.buttonRow}>
                    <ActionButton
                      label="授权短信读取权限"
                      text="授权短信读取权限"
                      tone="secondary"
                      onPress={() => void info.requestPermission()}
                    />
                    <ActionButton
                      label="前往系统设置开启权限"
                      text="前往系统设置开启权限"
                      tone="secondary"
                      onPress={() => void info.openPermissionSettings()}
                    />
                  </View>
                </View>
              )
            ) : (
              <Text style={styles.caption}>
                当前环境不支持原生短信监听，可点击「导入测试样例」或手动输入短信文本上报测试：
              </Text>
            )}
            {(info.importProgress || info.status?.running) && (
              <View style={styles.itemCard} testID="sms-import-progress">
                <Text style={styles.text}>
                  {info.importProgress?.phase === 'reading'
                    ? `正在分页读取本机短信：${info.importProgress.current} / ${info.importProgress.total} 条…`
                    : info.importProgress?.phase === 'uploading'
                      ? `正在分段上传历史短信：${info.importProgress.current} / ${info.importProgress.total} 条…`
                      : info.status?.running
                        ? `正在后台全量分析：已处理 ${processedDoneCount} / ${totalQueueCount} 条…`
                        : '正在启动后台全量分析…'}
                </Text>
                {info.status?.running && statusCounts && (
                  <Text style={styles.caption}>
                    待处理 {statusCounts.pending} 条 · 处理中 {statusCounts.processing} 条 · 已完成 {statusCounts.processed} 条
                    {statusCounts.failed > 0 ? ` · 失败 ${statusCounts.failed} 条` : ''}
                  </Text>
                )}
              </View>
            )}
            <View style={styles.buttonRow}>
              <Pressable
                style={styles.sampleButton}
                accessibilityRole="button"
                accessibilityLabel="一键导入全部历史短信并分析"
                disabled={importBusy || info.triggering || info.needsReadback}
                onPress={() => void info.importAllInboxSms()}
                testID="sms-import-history-button"
              >
                <Text style={styles.sampleButtonText}>
                  {importBusy
                    ? '全量导入中…'
                    : info.isSmsAvailable && info.inboxTotalCount && info.inboxTotalCount > 0
                      ? `导入全部 ${info.inboxTotalCount} 条短信并分析`
                      : '一键导入全部历史短信并分析'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.sampleButton}
                accessibilityRole="button"
                accessibilityLabel="导入测试样例"
                disabled={importBusy || info.triggering || info.needsReadback}
                onPress={() => void info.importSampleHistory()}
                testID="sms-import-sample-button"
              >
                <Text style={styles.sampleButtonText}>导入测试样例</Text>
              </Pressable>
              <Pressable
                style={styles.sampleButton}
                onPress={() => setCustomSms(SAMPLE_COURIER)}
              >
                <Text style={styles.sampleButtonText}>+ 快递样例</Text>
              </Pressable>
              <Pressable
                style={styles.sampleButton}
                onPress={() => setCustomSms(SAMPLE_SPAM)}
              >
                <Text style={styles.sampleButtonText}>+ 营销推广样例</Text>
              </Pressable>
            </View>
            <FormInput
              accessibilityLabel="短信文本输入"
              multiline
              value={customSms}
              onChangeText={setCustomSms}
              placeholder="输入或粘贴短信正文…"
              placeholderTextColor={colors.faint}
              style={styles.smsInput}
              maxLength={1000}
            />
            <View style={styles.buttonRow}>
              <ActionButton
                label="上报短信"
                text={info.ingesting ? '正在上报…' : '上报短信'}
                icon={Send}
                tone="secondary"
                busy={info.ingesting}
                disabled={info.ingesting || info.needsReadback || !customSms.trim()}
                onPress={async () => {
                  const textToIngest = customSms;
                  if (await info.ingestSms(textToIngest)) setCustomSms('');
                }}
              />
              {pendingCount > 0 && (
                <ActionButton
                  label="立即分析处理"
                  text={info.triggering || info.status?.running ? '后台分析中…' : `立即分析 (${pendingCount}条待处理)`}
                  icon={Play}
                  tone="primary"
                  busy={info.triggering || !!info.status?.running}
                  disabled={info.triggering || info.needsReadback || !!info.status?.running}
                  onPress={() => void info.triggerRun({ background: true })}
                />
              )}
            </View>
          </View>

          <View style={styles.subSection}>
            <View style={styles.headerRow}>
              <Text style={styles.text}>待处理与历史信息</Text>
              {totalQueueCount > 0 && (
                <Text style={styles.caption}>
                  {statusCounts
                    ? `共 ${statusCounts.total} 条 · 已处理 ${statusCounts.processed} 条${statusCounts.failed > 0 ? ` · 失败 ${statusCounts.failed} 条` : ''}`
                    : `最近 ${info.items.length} 条`}
                </Text>
              )}
            </View>
            {info.items.length > 0 ? (
              <View style={styles.itemList}>
                {info.items.slice(0, 4).map((item) => (
                  <View key={item.id} style={styles.itemCard}>
                    <View style={styles.itemHeader}>
                      <View style={[
                        styles.statusTag,
                        item.status === 'pending' ? styles.statusPending : styles.statusProcessed,
                      ]}>
                        <Text style={[
                          styles.statusTagText,
                          { color: item.status === 'pending' ? colors.warning : colors.muted },
                        ]}>
                          {{ pending: '待分析', processing: '分析中', processed: '已分析', failed: '分析失败' }[item.status]}
                        </Text>
                      </View>
                      <Text style={styles.itemSource} numberOfLines={1}>
                        {item.title || item.source}
                      </Text>
                    </View>
                    <Text style={styles.itemContent} numberOfLines={2}>
                      {item.content}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.caption}>暂无上报信息。收到短信或手动上报后将在此列出。</Text>
            )}
          </View>
        </>
      )}

      {!!info.error && <FeedbackNotice text={info.error} tone="danger" />}
      <ActionButton label="刷新短信状态" text="刷新核对" disabled={info.saving || info.ingesting || info.triggering} onPress={() => void info.reload()} />
      {!!info.notice && <Text style={styles.caption}>{info.notice}</Text>}
    </Card>
  );
}
