import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, FileText, Sparkles } from 'lucide-react-native';
import { useSpaceState, useSpaceStore } from '../spaces/SpaceProvider';
import { INSTRUCTIONS_LIMIT, equalSwitches } from '../spaces/space-store';
import { workspaceTheme, spacing } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';

export function SpaceSettings({ spaceId, onSaved }: { spaceId: string; onSaved: () => void }) {
  const store = useSpaceStore();
  const session = useSpaceState(spaceId);
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    section: { ...workspaceTheme.typography.section, color: colors.ink },
    card: { padding: spacing[20], gap: spacing[16], marginTop: spacing[18], marginBottom: spacing[16], backgroundColor: colors.surface, borderRadius: workspaceTheme.radius.card },
    text: { ...workspaceTheme.typography.detail, color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, color: colors.muted },

    input: { minHeight: workspaceTheme.layout.composerMaxHeight },

    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[12], justifyContent: 'space-between' },
    skillRow: { flexDirection: 'row', alignItems: 'center', minHeight: workspaceTheme.layout.controlSize, paddingVertical: spacing[14], gap: spacing[14], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
    iconHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing[10] },
    body: { flex: 1, gap: spacing[4] },
    disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
    switch: { width: workspaceTheme.layout.switchWidth, height: workspaceTheme.layout.switchHeight, borderRadius: workspaceTheme.radius.round, backgroundColor: colors.control, padding: spacing[3] },
    switchOn: { backgroundColor: colors.blue }, thumb: { width: workspaceTheme.layout.switchThumb, height: workspaceTheme.layout.switchThumb, borderRadius: workspaceTheme.radius.round, backgroundColor: colors.onAccent }, thumbOn: { alignSelf: 'flex-end' },
  }), [colors]);
  useEffect(() => { void store.loadSettings(spaceId); return () => store.cancelReads(spaceId); }, [store, spaceId]);
  const locked = !store.canWrite(spaceId) || store.hasSettingsWrite(spaceId);
  const saveInstructions = async () => { if (await store.saveInstructions(spaceId)) onSaved(); };
  const saveSkills = async (defaults = false) => { if (await store.saveSkills(spaceId, defaults)) onSaved(); };
  return <View>
    <Card style={styles.card}>
      <View style={styles.iconHeading}><FileText size={workspaceTheme.layout.iconSize - spacing[4]} strokeWidth={1.6} color={colors.muted} /><Text style={styles.section}>空间规则</Text></View>
      <Text style={styles.caption}>保存后在下一轮生效；关闭面板会保留本次连接内的草稿。</Text>
      <FormInput accessibilityLabel="空间规则" multiline value={session.instructions.draft}
        editable={!locked && session.instructions.loaded} onChangeText={(text) => store.setInstructions(spaceId, text)}
        placeholder={session.instructions.loaded ? '你希望 Pi Muse 如何在这个空间里工作？' : '正在读取空间规则…'} placeholderTextColor={colors.faint}
        style={styles.input} maxLength={INSTRUCTIONS_LIMIT + 1} />
      <Text style={styles.caption}>{session.instructions.draft.length.toLocaleString()} / {INSTRUCTIONS_LIMIT.toLocaleString()}</Text>
      {!!session.instructions.error && <FeedbackNotice text={session.instructions.error} tone="danger" />}
      <ActionButton label="保存空间规则" text={session.instructions.saving ? '正在保存…' : '保存规则'}
        icon={Check} tone="primary" busy={session.instructions.saving} disabled={locked || !session.instructions.loaded}
        onPress={() => void saveInstructions()} />
    </Card>
    <Card style={styles.card}>
      <View style={styles.iconHeading}><Sparkles size={workspaceTheme.layout.iconSize - spacing[4]} strokeWidth={1.6} color={colors.muted} /><Text style={styles.section}>空间技能</Text></View>
      <Text style={styles.caption}>开关按当前空间生效，不影响其他空间。</Text>
      {session.skills.catalog.map((skill) => <Pressable key={skill.name} accessibilityRole="switch" accessibilityLabel={`技能 ${skill.name}`}
        accessibilityState={{ checked: !!session.skills.draft[skill.name], disabled: locked }} disabled={locked}
        onPress={() => store.setSkill(spaceId, skill.name, !session.skills.draft[skill.name])} style={[styles.skillRow, locked && styles.disabled]}>
        <View style={styles.body}><Text style={styles.text}>{skill.name}</Text><Text style={styles.caption}>{skill.description}</Text></View>
        <View pointerEvents="none" style={[styles.switch, !!session.skills.draft[skill.name] && styles.switchOn]}><View style={[styles.thumb, !!session.skills.draft[skill.name] && styles.thumbOn]} /></View>
      </Pressable>)}
      {!!session.skills.error && <FeedbackNotice text={session.skills.error} tone="danger" />}
      {!!session.skills.notice && <Text style={styles.caption}>{session.skills.notice}</Text>}
      {session.skills.diagnostics.map((diagnostic) => <Text key={`${diagnostic.path}:${diagnostic.message}`} style={styles.caption}>{diagnostic.path}：{diagnostic.message}</Text>)}
      <View style={styles.row}>
        <ActionButton label="保存空间技能" tone="primary" disabled={locked || !session.skills.loaded || equalSwitches(session.skills.saved, session.skills.draft)} onPress={() => void saveSkills()} />
        <ActionButton label="恢复默认技能" disabled={locked || !session.skills.loaded} onPress={() => void saveSkills(true)} />
      </View>
    </Card>
  </View>;
}
