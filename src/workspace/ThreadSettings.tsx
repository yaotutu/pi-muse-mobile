import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useThreadSession, useThreadSessionStore } from '../threads/ThreadSessionProvider';
import { INSTRUCTIONS_LIMIT, equalSwitches } from '../threads/thread-session-store';
import { workspaceTheme, spacing } from '../ui/tokens';
import { useWorkspaceTheme } from './WorkspaceTheme';

export function ThreadSettings({ threadId, onSaved }: { threadId: string; onSaved: () => void }) {
  const store = useThreadSessionStore();
  const session = useThreadSession(threadId);
  const { colors } = useWorkspaceTheme();
  const styles = useMemo(() => StyleSheet.create({
    section: { ...workspaceTheme.typography.section, color: colors.ink },
    card: { padding: spacing[16], gap: spacing[12], marginBottom: spacing[16], backgroundColor: colors.surface, borderRadius: workspaceTheme.radius.card },
    text: { ...workspaceTheme.typography.detail, color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, color: colors.muted },
    error: { ...workspaceTheme.typography.caption, color: colors.danger },
    input: { minHeight: workspaceTheme.layout.composerMaxHeight, padding: spacing[14], color: colors.ink, backgroundColor: colors.canvas, borderRadius: workspaceTheme.radius.listItem, ...workspaceTheme.typography.detail, textAlignVertical: 'top' },
    button: { alignSelf: 'flex-start', paddingHorizontal: spacing[14], paddingVertical: spacing[8], backgroundColor: colors.control, borderRadius: workspaceTheme.radius.round },
    buttonText: { ...workspaceTheme.typography.status, color: colors.ink },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing[12], justifyContent: 'space-between' },
    body: { flex: 1 },
    disabled: { opacity: 0.4 },
  }), [colors]);
  useEffect(() => { void store.loadSettings(threadId); return () => store.cancelReads(threadId); }, [store, threadId]);
  const locked = !store.canWrite(threadId) || store.hasSettingsWrite(threadId);
  const saveInstructions = async () => { if (await store.saveInstructions(threadId)) onSaved(); };
  const saveSkills = async (defaults = false) => { if (await store.saveSkills(threadId, defaults)) onSaved(); };
  return <View>
    <View style={styles.card}>
      <Text style={styles.section}>会话规则</Text>
      <Text style={styles.caption}>保存后在下一轮生效；关闭面板会保留本次连接内的草稿。</Text>
      <TextInput accessibilityLabel="会话规则" multiline value={session.instructions.draft}
        editable={!locked && session.instructions.loaded} onChangeText={(text) => store.setInstructions(threadId, text)}
        style={styles.input} maxLength={INSTRUCTIONS_LIMIT + 1} />
      <Text style={styles.caption}>{session.instructions.draft.length.toLocaleString()} / {INSTRUCTIONS_LIMIT.toLocaleString()}</Text>
      {!!session.instructions.error && <Text accessibilityRole="alert" style={styles.error}>{session.instructions.error}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="保存会话规则" style={[styles.button, (locked || !session.instructions.loaded) && styles.disabled]}
        disabled={locked || !session.instructions.loaded} onPress={() => void saveInstructions()}><Text style={styles.buttonText}>{session.instructions.saving ? '正在保存…' : '保存规则'}</Text></Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.section}>会话技能</Text>
      <Text style={styles.caption}>开关按当前会话生效，不影响其他会话。</Text>
      {session.skills.catalog.map((skill) => <Pressable key={skill.name} accessibilityRole="switch" accessibilityLabel={`技能 ${skill.name}`}
        accessibilityState={{ checked: !!session.skills.draft[skill.name], disabled: locked }} disabled={locked}
        onPress={() => store.setSkill(threadId, skill.name, !session.skills.draft[skill.name])} style={styles.row}>
        <View style={styles.body}><Text style={styles.text}>{skill.name}</Text><Text style={styles.caption}>{skill.description}</Text></View>
        <Text style={styles.text}>{session.skills.draft[skill.name] ? '已开启' : '已关闭'}</Text>
      </Pressable>)}
      {!!session.skills.error && <Text accessibilityRole="alert" style={styles.error}>{session.skills.error}</Text>}
      {!!session.skills.notice && <Text style={styles.caption}>{session.skills.notice}</Text>}
      {session.skills.diagnostics.map((diagnostic) => <Text key={`${diagnostic.path}:${diagnostic.message}`} style={styles.caption}>{diagnostic.path}：{diagnostic.message}</Text>)}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="保存会话技能" style={styles.button}
          disabled={locked || !session.skills.loaded || equalSwitches(session.skills.saved, session.skills.draft)} onPress={() => void saveSkills()}><Text style={styles.buttonText}>保存技能</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="恢复默认技能" style={styles.button}
          disabled={locked || !session.skills.loaded} onPress={() => void saveSkills(true)}><Text style={styles.buttonText}>恢复默认</Text></Pressable>
      </View>
    </View>
  </View>;
}
