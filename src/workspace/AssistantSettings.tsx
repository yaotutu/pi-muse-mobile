import { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import type { SessionSkill } from '../api/types';
import { useAssistantSettings } from '../sessions/SessionProvider';
import { equalSwitches, INSTRUCTIONS_LIMIT } from '../sessions/assistant-settings-store';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { SettingsTextField } from '../ui/SettingsTextField';
import { MarkdownContent } from '../ui/MarkdownContent';
import { Card } from '../ui/Surfaces';
import { FeedbackNotice } from '../ui/Feedback';
import { spacing, workspaceTheme } from '../ui/tokens';

function SkillRow({ skill, checked, disabled, onToggle, onOpen, expanded }: {
  skill: SessionSkill;
  checked: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
  onOpen: () => void;
  expanded: boolean;
}) {
  const { colors } = useTheme();
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return <View style={styles.skillRow}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${skill.name} 说明`}
      accessibilityState={{ expanded }} onPress={onOpen} style={styles.skillInfo}>
      <View style={styles.skillText}>
        <Text style={[styles.label, { color: colors.ink }]}>{skill.name}</Text>
        {!!skill.description && <Text numberOfLines={2} style={[styles.caption, { color: colors.muted }]}>{skill.description}</Text>}
      </View>
      <Chevron size={16} color={colors.muted} />
    </Pressable>
    <Switch accessibilityLabel={`启用 ${skill.name}`} value={checked} disabled={disabled} onValueChange={onToggle} />
  </View>;
}

export function AssistantSettings({ section }: { section: 'rules' | 'skills' }) {
  const store = useAssistantSettings();
  const session = store.state;
  const { colors } = useTheme();
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [saved, setSaved] = useState(false);
  const isRules = section === 'rules';
  const field = isRules ? session.instructions : session.skills;
  const available = store.canWrite();
  const locked = !available || store.hasSettingsWrite() || field.writeUncertain;
  const dirty = isRules
    ? session.instructions.draft !== session.instructions.saved
    : !equalSwitches(session.skills.saved, session.skills.draft);
  const load = (reconcileUncertain = false) => isRules ? store.loadInstructions(reconcileUncertain) : store.loadSkills(reconcileUncertain);

  useEffect(() => {
    if (!available) return;
    if (section === 'rules') void store.loadInstructions();
    else void store.loadSkills();
    return () => store.cancelReads();
  }, [store, section, available]);

  const openSkill = (skill: SessionSkill) => {
    const next = expandedSkill === skill.id ? null : skill.id;
    setExpandedSkill(next);
    if (next && !session.skills.details[skill.name]?.loading) void store.loadSkillDetail(skill.name);
  };

  const groups = [
    { title: '内置与自建', skills: session.skills.catalog.filter((skill) => skill.source !== 'shared') },
    { title: '共享技能', skills: session.skills.catalog.filter((skill) => skill.source === 'shared') },
  ];
  const save = async () => {
    Keyboard.dismiss();
    setSaved(isRules ? await store.saveInstructions() : await store.saveSkills());
  };

  return <View style={styles.root}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      <Text style={[styles.caption, { color: colors.muted }]}>
        {isRules ? '告诉助手在所有会话中如何工作。保存后从下一轮起生效。' : '选择所有会话可使用的技能。保存后从下一轮起生效。'}
      </Text>
      {!!field.error && <FeedbackNotice text={field.error} tone="danger" />}
      {field.writeUncertain && <>
        <FeedbackNotice text="保存结果未明，核对服务器设置后再继续。" tone="warning" />
        <ActionButton label="核对服务器设置" disabled={!available || field.loading} onPress={() => void load(true)} />
      </>}
      {field.loading && <ActivityIndicator accessibilityLabel="正在读取设置" color={colors.blue} />}
      {!field.loaded && !field.loading && <ActionButton label="重新读取" onPress={() => void load()} />}
      {field.loaded && (isRules ? <SettingsTextField label="助手指令" empty="尚未设置助手指令。"
        value={session.instructions.draft} editable={!locked} saveDirect
        onChangeText={(text) => { store.setInstructions(text); void save(); }}
        maxLength={INSTRUCTIONS_LIMIT} placeholder="例如：先给结论，再补充依据"
        /> : <>
        {!session.skills.catalog.length && <Text style={[styles.caption, { color: colors.muted }]}>服务器暂无可用技能。</Text>}
        {groups.filter(({ skills }) => skills.length > 0).map(({ title, skills }) => <View key={title} style={styles.group}>
          <Text accessibilityRole="header" style={[styles.label, { color: colors.muted }]}>{title}</Text>
          <Card style={styles.skillList}>
            {skills.map((skill, index) => {
              const expanded = expandedSkill === skill.id;
              const detail = session.skills.details[skill.name];
              return <View key={skill.id} style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line } : undefined}>
                <SkillRow skill={skill} checked={!!session.skills.draft[skill.id]} disabled={locked}
                  onToggle={(value) => store.setSkill(skill.id, value)} onOpen={() => openSkill(skill)} expanded={expanded} />
                {expanded && <View style={styles.skillDetail}>
                  <Text style={[styles.caption, { color: colors.muted }]}>
                    {skill.source === 'shared' ? '共享目录 · 只读' : skill.source === 'user' ? '实例自建' : '内置'}
                  </Text>
                  {detail?.loading && <ActivityIndicator accessibilityLabel="正在读取技能说明" color={colors.blue} />}
                  {!!detail?.error && <>
                    <FeedbackNotice text={detail.error} tone="danger" />
                    <ActionButton label="重新读取说明" onPress={() => void store.loadSkillDetail(skill.name)} />
                  </>}
                  {detail?.content !== undefined && !detail.loading && <MarkdownContent text={detail.content || '暂无说明。'} compact />}
                </View>}
              </View>;
            })}
          </Card>
        </View>)}
        {!!session.skills.notice && <Text style={[styles.caption, { color: colors.muted }]}>{session.skills.notice}</Text>}
        {session.skills.diagnostics.length > 0 && <>
          <ActionButton label="技能加载诊断" expanded={showDiagnostics} onPress={() => setShowDiagnostics(!showDiagnostics)} />
          {showDiagnostics && session.skills.diagnostics.map(({ path, message }) => <Text key={`${path}:${message}`} style={[styles.caption, { color: colors.muted }]}>{path}：{message}</Text>)}
        </>}
        {field.error && !field.writeUncertain && <ActionButton label="刷新技能列表" disabled={locked || field.loading} onPress={() => void load()} />}
      </>)}
    </ScrollView>
    {field.loaded && (dirty || field.saving || (saved && !field.error)) && <View style={[styles.footer, { borderTopColor: colors.line, backgroundColor: colors.canvas }]}>
      {dirty || field.saving
        ? <ActionButton label={isRules ? '保存指令' : '保存技能'} tone="primary" style={styles.save}
          busy={field.saving} disabled={locked} onPress={() => void save()} />
        : <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: colors.success }]}>已保存，下轮对话生效</Text>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { gap: spacing[16], padding: spacing[20] },
  footer: { paddingHorizontal: spacing[20], paddingVertical: spacing[12], borderTopWidth: StyleSheet.hairlineWidth },
  save: { alignSelf: 'stretch', minHeight: 48 },
  group: { gap: spacing[8] },
  caption: { ...workspaceTheme.typography.caption },
  label: { ...workspaceTheme.typography.detail, fontWeight: '600' },
  skillList: { padding: 0 },
  skillRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[12], gap: spacing[12] },
  skillInfo: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing[8], paddingVertical: spacing[8] },
  skillText: { flex: 1, gap: spacing[4] },
  skillDetail: { padding: spacing[12], gap: spacing[8] },
});
