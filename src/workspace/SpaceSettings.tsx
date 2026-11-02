import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useSpaceState, useSpaceStore } from '../spaces/SpaceProvider';
import { INSTRUCTIONS_LIMIT, equalSwitches } from '../spaces/space-store';
import { workspaceTheme, spacing } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { MarkdownContent } from '../ui/MarkdownContent';

export function SpaceSettings({ spaceId, section, onSaved }: { spaceId: string; section: 'rules' | 'skills'; onSaved: () => void }) {
  const store = useSpaceStore();
  const [editing, setEditing] = useState(false);
  const session = useSpaceState(spaceId);
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    card: { padding: spacing[16], gap: spacing[14], marginBottom: spacing[14], backgroundColor: colors.surface, borderRadius: workspaceTheme.radius.card },
    text: { ...workspaceTheme.typography.detail, color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, color: colors.muted },

    input: { minHeight: workspaceTheme.layout.composerMaxHeight },

    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[12], justifyContent: 'space-between' },
    skillRow: { flexDirection: 'row', alignItems: 'center', minHeight: workspaceTheme.layout.controlSize, paddingVertical: spacing[14], gap: spacing[14], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
    body: { flex: 1, gap: spacing[4] },
    disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
    switch: { width: workspaceTheme.layout.switchWidth, height: workspaceTheme.layout.switchHeight, borderRadius: workspaceTheme.radius.round, backgroundColor: colors.control, padding: spacing[3] },
    switchOn: { backgroundColor: colors.blue }, thumb: { width: workspaceTheme.layout.switchThumb, height: workspaceTheme.layout.switchThumb, borderRadius: workspaceTheme.radius.round, backgroundColor: colors.onAccent }, thumbOn: { alignSelf: 'flex-end' },
  }), [colors]);
  useEffect(() => { if (section === 'rules') void store.loadInstructions(spaceId); else void store.loadSkills(spaceId); return () => store.cancelReads(spaceId); }, [store, spaceId, section]);
  const locked = !store.canWrite(spaceId) || store.hasSettingsWrite(spaceId);
  const saveInstructions = async () => { if (await store.saveInstructions(spaceId)) { setEditing(false); onSaved(); } };
  const saveSkills = async () => { if (await store.saveSkills(spaceId)) onSaved(); };
  return <View>
    {section === 'rules' && <Card style={styles.card}>
      {session.instructions.draft !== session.instructions.saved && <Text style={styles.caption}>当前显示未保存草稿</Text>}
      <Text style={styles.caption}>保存后在下一轮生效；返回会保留本次连接内的草稿，不影响其他空间。</Text>
      {!editing && <>
        <MarkdownContent text={session.instructions.draft || (!session.instructions.loaded ? '空间规则尚未读取。' : '尚未设置空间规则。')} />
        <ActionButton label="编辑空间规则" text="编辑规则" onPress={() => setEditing(true)} disabled={locked || !session.instructions.loaded} />
      </>}
      {editing && <><FormInput variant="code" accessibilityLabel="空间规则" multiline value={session.instructions.draft}
        editable={!locked && session.instructions.loaded} onChangeText={(text) => store.setInstructions(spaceId, text)}
        placeholder={session.instructions.loaded ? '你希望 Pi Muse 如何在这个空间里工作？' : '正在读取空间规则…'} placeholderTextColor={colors.faint}
        style={styles.input} maxLength={INSTRUCTIONS_LIMIT + 1} />
      <Text style={styles.caption}>{session.instructions.draft.length.toLocaleString()} / {INSTRUCTIONS_LIMIT.toLocaleString()}</Text>
      {!!session.instructions.error && <FeedbackNotice text={session.instructions.error} tone="danger" />}
      <ActionButton label="保存空间规则" text={session.instructions.saving ? '正在保存…' : '保存规则'}
        icon={Check} tone="primary" busy={session.instructions.saving} disabled={locked || !session.instructions.loaded}
        onPress={() => void saveInstructions()} />
      </>}
      {session.instructions.error && !editing && <FeedbackNotice text={session.instructions.error} tone="danger" />}
      {!session.instructions.loaded && !session.instructions.loading && <ActionButton label="重试读取空间规则" text="重试" onPress={() => void store.loadInstructions(spaceId)} />}
    </Card>}
    {section === 'skills' && <Card style={styles.card}>
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
      {!equalSwitches(session.skills.saved, session.skills.draft) && <View style={styles.row}>
        <ActionButton label="保存空间技能" text="保存技能" tone="primary" disabled={locked || !session.skills.loaded} onPress={() => void saveSkills()} />
      </View>}
      {session.skills.loading && <Text style={styles.caption}>正在读取技能…</Text>}
      {session.skills.loaded && !session.skills.catalog.length && <Text style={styles.caption}>尚无可用技能；技能资产由服务端管理。</Text>}
      {!session.skills.loading && <ActionButton label="刷新空间技能" text="刷新技能" onPress={() => void store.loadSkills(spaceId)} disabled={locked} />}
    </Card>}
  </View>;
}
