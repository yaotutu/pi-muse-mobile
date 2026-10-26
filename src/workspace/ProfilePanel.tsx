import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Check, RefreshCw, RotateCcw } from 'lucide-react-native';
import { useProfile } from '../profile/ProfileProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';

const NAME_LIMIT = 80;
const TEXT_LIMIT = 20000;
const TONES = [
  { value: 'warm', label: '温暖', description: '亲切自然' },
  { value: 'concise', label: '简洁', description: '直达重点' },
  { value: 'thoughtful', label: '周到', description: '细致考虑' },
] as const;

/** 仅管理页面挂载与输入；请求、草稿保留及结果未明后的刷新核对由连接内 ProfileStore 决定。 */
export function ProfilePanel({ onBack }: { onBack: () => void }) {
  const { store, snapshot } = useProfile();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  useEffect(() => { store.open(); return () => store.close(); }, [store]);

  const name = snapshot.draftIdentity.name;
  const tone = snapshot.draftIdentity.tone;
  const nameLength = name.trim().length;
  const nameValid = nameLength >= 1 && nameLength <= NAME_LIMIT;
  const toneKnown = TONES.some((option) => option.value === tone);
  // 草稿由 store 管理；服务端返回未识别语气时仍展示原值，不能用默认选中掩盖它。
  const serverTone = snapshot.identity?.tone;
  const unsupportedServerTone = serverTone && !TONES.some((option) => option.value === serverTone) ? serverTone : undefined;
  const canWrite = store.canWrite() && snapshot.loaded && !snapshot.loading && !snapshot.stale && !snapshot.writing;
  const canSaveIdentity = canWrite && snapshot.dirtyIdentity && nameValid && toneKnown;
  const canSaveProfile = canWrite && snapshot.dirtyProfile && snapshot.draftProfile.soul.length <= TEXT_LIMIT && snapshot.draftProfile.user.length <= TEXT_LIMIT;
  const canDiscard = snapshot.loaded && !snapshot.loading && !snapshot.stale && !snapshot.writing;

  return <View style={styles.root} testID="profile-panel">
    <View style={styles.topRow}>
      <ActionButton label="返回设置" text="返回设置" onPress={onBack} icon={ArrowLeft} />
      <ActionButton label="刷新助手与用户资料" text="刷新" onPress={() => void store.refresh()} disabled={snapshot.loading || !!snapshot.writing} icon={RefreshCw} />
    </View>
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>助手与用户资料</Text>
      <Text style={styles.intro}>全部空间共用，保存后从下一轮对话生效。草稿仅保留在当前连接内；助手设置和人设资料分别提交。</Text>
    </View>

    {snapshot.loading && <View style={styles.statusRow}><ActivityIndicator accessibilityLabel="正在读取助手与用户资料" color={colors.muted} /><Text style={styles.caption}>正在读取服务端资料…</Text></View>}
    {!!snapshot.error && <FeedbackNotice text={snapshot.error} tone="danger" />}
    {!!snapshot.notice && <FeedbackNotice text={snapshot.notice} tone="success" />}
    {snapshot.stale && snapshot.loaded && <Text accessibilityRole="alert" style={styles.warning}>当前显示最后一次读取的资料，最新服务端值尚未确认。请刷新核对后再保存或取消修改。</Text>}
    {!snapshot.loaded && !snapshot.loading && !snapshot.error && <Text style={styles.warning}>尚未读取服务端资料，请刷新后编辑。</Text>}

    <Card style={styles.card}>
      <View style={styles.cardHeading}><Text accessibilityRole="header" style={styles.cardTitle}>助手设置</Text><Text style={styles.caption}>名字与语气 · 独立保存</Text></View>
      <Text style={styles.fieldLabel}>助手名字</Text>
      <FormInput accessibilityLabel="助手名字" value={name} onChangeText={(value) => store.setIdentity('name', value)} editable={snapshot.loaded && !snapshot.loading && !snapshot.writing}
        maxLength={NAME_LIMIT} placeholder="给助手起个名字" placeholderTextColor={colors.faint} autoCapitalize="words" returnKeyType="done" style={styles.nameInput} />
      <Text style={[styles.caption, snapshot.loaded && !nameValid && styles.error]}>去除首尾空格后 {nameLength} / {NAME_LIMIT} 字，需填写 1–80 字</Text>
      <Text style={styles.fieldLabel}>说话语气</Text>
      <View style={styles.tones} accessibilityLabel="助手语气选项">
        {TONES.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={`语气${option.label}`} accessibilityState={{ checked: tone === option.value, disabled: !snapshot.loaded || snapshot.loading || !!snapshot.writing }}
          disabled={!snapshot.loaded || snapshot.loading || !!snapshot.writing} onPress={() => store.setIdentity('tone', option.value)} style={({ pressed }) => [styles.tone, tone === option.value && styles.toneSelected, pressed && styles.pressed]}>
          <Text style={[styles.toneTitle, tone === option.value && styles.toneTitleSelected]}>{option.label}</Text><Text style={styles.caption}>{option.description}</Text>
        </Pressable>)}
      </View>
      {snapshot.loaded && unsupportedServerTone && <Text accessibilityRole="alert" style={styles.warning}>服务端当前语气值为「{unsupportedServerTone}」，不在当前可选项中。请选择温暖、简洁或周到并保存。</Text>}
      {snapshot.loaded && !toneKnown && !unsupportedServerTone && <Text accessibilityRole="alert" style={styles.warning}>当前语气草稿为「{tone || '空值'}」，请选择温暖、简洁或周到后再保存。</Text>}
      <View style={styles.actions}>
        <ActionButton label="保存助手设置" text={snapshot.writing === 'identity' ? '正在保存助手设置…' : '保存助手设置'} onPress={() => { Keyboard.dismiss(); void store.saveIdentity(); }} disabled={!canSaveIdentity} tone="primary" wide icon={Check} />
        <ActionButton label="取消助手设置修改并采用最新服务端值" text="取消助手设置修改" onPress={() => store.discardIdentity()} disabled={!canDiscard || !snapshot.dirtyIdentity} wide icon={RotateCcw} />
      </View>
    </Card>

    <Card style={styles.card}>
      <View style={styles.cardHeading}><Text accessibilityRole="header" style={styles.cardTitle}>人设与资料</Text><Text style={styles.caption}>两段文本 · 同一次资料保存</Text></View>
      <Text style={styles.caption}>可留空清空对应内容。填写的内容会作为全局资料供下一轮对话使用。</Text>
      <Text style={styles.fieldLabel}>SOUL · 助手人设</Text>
      <FormInput accessibilityLabel="SOUL 助手人设" multiline value={snapshot.draftProfile.soul} onChangeText={(value) => store.setProfile('soul', value)} editable={snapshot.loaded && !snapshot.loading && !snapshot.writing}
        maxLength={TEXT_LIMIT} placeholder="希望助手具备怎样的性格与工作方式？" placeholderTextColor={colors.faint} style={styles.longInput} textAlignVertical="top" />
      <Text style={styles.count}>{snapshot.draftProfile.soul.length.toLocaleString()} / {TEXT_LIMIT.toLocaleString()} 字</Text>
      <Text style={styles.fieldLabel}>USER · 用户资料</Text>
      <FormInput accessibilityLabel="USER 用户资料" multiline value={snapshot.draftProfile.user} onChangeText={(value) => store.setProfile('user', value)} editable={snapshot.loaded && !snapshot.loading && !snapshot.writing}
        maxLength={TEXT_LIMIT} placeholder="希望助手了解你的哪些背景与偏好？" placeholderTextColor={colors.faint} style={styles.longInput} textAlignVertical="top" />
      <Text style={styles.count}>{snapshot.draftProfile.user.length.toLocaleString()} / {TEXT_LIMIT.toLocaleString()} 字</Text>
      <View style={styles.actions}>
        <ActionButton label="保存人设与资料" text={snapshot.writing === 'profile' ? '正在保存人设与资料…' : '保存人设与资料'} onPress={() => { Keyboard.dismiss(); void store.saveProfile(); }} disabled={!canSaveProfile} tone="primary" wide icon={Check} />
        <ActionButton label="取消人设与资料修改并采用最新服务端值" text="取消人设与资料修改" onPress={() => store.discardProfile()} disabled={!canDiscard || !snapshot.dirtyProfile} wide icon={RotateCcw} />
      </View>
    </Card>
  </View>;
}

const createStyles = (colors: WorkspaceColors) => StyleSheet.create({
  root: { gap: spacing[16], paddingBottom: spacing[24] },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing[8] },
  heading: { gap: spacing[6] }, title: { ...workspaceTheme.typography.section, color: colors.ink },
  intro: { ...workspaceTheme.typography.status, color: colors.muted },
  statusRow: { flexDirection: 'row', gap: spacing[10], alignItems: 'center' },
  card: { padding: spacing[16], gap: spacing[12], borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface },
  cardHeading: { gap: spacing[2], marginBottom: spacing[4] },
  cardTitle: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
  fieldLabel: { ...workspaceTheme.typography.status, color: colors.ink, marginTop: spacing[8] },
  nameInput: { minHeight: workspaceTheme.layout.inputMinHeight },
  longInput: { height: workspaceTheme.layout.profileTextHeight },
  tones: { flexDirection: 'row', gap: spacing[8] },
  tone: { flex: 1, minWidth: 0, minHeight: workspaceTheme.layout.controlSize, paddingHorizontal: spacing[8], paddingVertical: spacing[10], gap: spacing[2], borderRadius: workspaceTheme.radius.field, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, backgroundColor: colors.canvas },
  toneSelected: { borderColor: colors.blue, backgroundColor: colors.blueSoft }, toneTitle: { ...workspaceTheme.typography.status, color: colors.ink }, toneTitleSelected: { color: colors.accentText },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8], marginTop: spacing[10] },

  caption: { ...workspaceTheme.typography.caption, color: colors.faint }, count: { ...workspaceTheme.typography.caption, color: colors.faint, alignSelf: 'flex-end' },
  warning: { ...workspaceTheme.typography.detail, color: colors.warning }, error: { ...workspaceTheme.typography.detail, color: colors.danger },
   pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
});
