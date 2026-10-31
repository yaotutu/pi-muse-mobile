import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Inbox, Play, Send } from 'lucide-react-native';
import { workspaceTheme, spacing } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { useInformation } from './useInformation';

const SAMPLE_COURIER = '【顺丰速运】您的包裹已送达菜鸟驿站，取件码 3-4-2018，请凭码及时取件。';
const SAMPLE_SPAM = '【特惠通知】年中大促火热开启，全场五折包邮，回复TD退订。';

export function InformationSettingsCard({ spaceId }: { spaceId: string }) {
  const { colors } = useTheme();
  const info = useInformation(spaceId);
  const [customSms, setCustomSms] = useState('');

  const styles = useMemo(() => StyleSheet.create({
    card: { padding: spacing[20], gap: spacing[16], marginTop: spacing[18], marginBottom: spacing[16], backgroundColor: colors.surface, borderRadius: workspaceTheme.radius.card },
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
    badge: { alignSelf: 'flex-start', paddingHorizontal: spacing[8], paddingVertical: spacing[4], backgroundColor: colors.control, borderRadius: workspaceTheme.radius.round },
    badgeText: { ...workspaceTheme.typography.caption, color: colors.muted },
  }), [colors]);

  const enabled = !!info.settings?.enabled;
  const pendingCount = info.items.filter((item) => item.status === 'pending').length;

  return (
    <Card style={styles.card}>
      <View style={styles.iconHeading}>
        <Inbox size={workspaceTheme.layout.iconSize - spacing[4]} strokeWidth={1.6} color={colors.muted} />
        <Text style={styles.section}>信息后台与短信整理</Text>
      </View>
      <Text style={styles.caption}>
        将此空间作为短信与消息的智能处理空间，根据偏好提醒重要内容，静默忽略垃圾信息。
      </Text>

      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="启用信息后台"
        accessibilityState={{ checked: enabled, disabled: info.loading || info.saving }}
        disabled={info.loading || info.saving}
        onPress={() => void info.toggleEnabled(!enabled)}
        style={styles.row}
      >
        <View style={styles.body}>
          <Text style={styles.text}>启用信息后台</Text>
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
            <Text style={styles.text}>过滤指示与偏好</Text>
            <Text style={styles.caption}>指导 Agent 如何筛选信息（哪些重要需要提醒，哪些静默）。</Text>
            <FormInput
              accessibilityLabel="信息过滤指示"
              multiline
              value={info.draftNotes}
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
              disabled={info.saving}
              onPress={() => void info.saveNotes()}
            />
          </View>

          {!!info.preferences?.feedbackExamples?.length && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                已沉淀 {info.preferences.feedbackExamples.length} 条基于消息反馈的学习例证
              </Text>
            </View>
          )}

          <View style={styles.subSection}>
            <Text style={styles.text}>短信接入与测试</Text>
            <Text style={styles.caption}>
              点击下方样例或输入短信正文，上报到当前空间待处理队列：
            </Text>
            <View style={styles.buttonRow}>
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
                disabled={info.ingesting || !customSms.trim()}
                onPress={async () => {
                  const textToIngest = customSms;
                  setCustomSms('');
                  await info.ingestSms(textToIngest);
                }}
              />
              {pendingCount > 0 && (
                <ActionButton
                  label="立即分析处理"
                  text={info.triggering ? '分析中…' : `立即分析 (${pendingCount}条待处理)`}
                  icon={Play}
                  tone="primary"
                  busy={info.triggering}
                  disabled={info.triggering}
                  onPress={() => void info.triggerRun()}
                />
              )}
            </View>
          </View>
        </>
      )}

      {!!info.error && <FeedbackNotice text={info.error} tone="danger" />}
      {!!info.notice && <Text style={styles.caption}>{info.notice}</Text>}
    </Card>
  );
}
