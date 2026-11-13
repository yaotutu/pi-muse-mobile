import { FeedbackNotice } from '../ui/Feedback';
import { Card } from '../ui/Surfaces';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useSessionState, useChatSessionStore } from '../sessions/SessionProvider';
import { INSTRUCTIONS_LIMIT, equalSwitches } from '../sessions/chat-session-store';
import { workspaceTheme, spacing } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { MarkdownContent } from '../ui/MarkdownContent';
import type { SessionSkill, SessionSkillSource } from '../api/types';

function sourceLabel(source?: SessionSkillSource): string {
  if (source === 'user') return '实例自建';
  if (source === 'shared') return '通用';
  return '内置';
}

export function SessionSettings({ sessionId, section, onSaved }: { sessionId: string; section: 'rules' | 'skills'; onSaved: () => void }) {
  const store = useChatSessionStore();
  const [editing, setEditing] = useState(false);
  const [expandedSkills, setExpandedSkills] = useState<Record<string, boolean>>({});
  const session = useSessionState(sessionId);
  const { colors } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    card: { padding: spacing[16], gap: spacing[12], marginBottom: spacing[14], backgroundColor: colors.surface, borderRadius: workspaceTheme.radius.card },
    text: { ...workspaceTheme.typography.detail, color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, color: colors.muted },

    input: { minHeight: workspaceTheme.layout.composerMaxHeight },

    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[12], justifyContent: 'space-between' },

    // 分组
    group: { gap: spacing[4], marginTop: spacing[4] },
    groupHeader: { gap: spacing[2], paddingTop: spacing[2], paddingBottom: spacing[2] },
    groupTitle: { ...workspaceTheme.typography.status, fontWeight: '600', color: colors.ink },
    sharedNotice: { ...workspaceTheme.typography.caption, color: colors.muted, lineHeight: 16 },

    // 技能行
    skillItem: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingBottom: spacing[6] },
    skillRow: { flexDirection: 'row', alignItems: 'center', minHeight: workspaceTheme.layout.smallControl, paddingVertical: spacing[8], gap: spacing[8] },
    skillContent: { flex: 1, minWidth: 0, gap: spacing[2] },
    skillHeaderPress: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[6] },
    skillName: { ...workspaceTheme.typography.detail, fontWeight: '600', color: colors.ink },
    descRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[8] },

    // 来源与默认标签
    badge: { paddingHorizontal: spacing[6], paddingVertical: 1, borderRadius: workspaceTheme.radius.round },
    badgeBuiltin: { backgroundColor: colors.control },
    badgeUser: { backgroundColor: colors.blueSoft },
    badgeShared: { backgroundColor: colors.warningSoft },
    badgeText: { ...workspaceTheme.typography.caption, fontSize: 10, lineHeight: 14, fontWeight: '500' },
    badgeTextBuiltin: { color: colors.muted },
    badgeTextUser: { color: colors.accentText },
    badgeTextShared: { color: colors.warning },
    defaultTag: { ...workspaceTheme.typography.caption, fontSize: 11, color: colors.faint },

    // 说明入口
    detailLink: { paddingHorizontal: spacing[4], paddingVertical: 2 },
    detailLinkText: { ...workspaceTheme.typography.caption, fontSize: 11, fontWeight: '500', color: colors.blue },

    // 展开详情卡片
    detailContainer: { backgroundColor: colors.canvas, borderRadius: workspaceTheme.radius.field, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: spacing[10], gap: spacing[6], marginTop: spacing[4], marginBottom: spacing[6] },
    detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[8] },
    detailTitle: { ...workspaceTheme.typography.caption, fontWeight: '600', color: colors.ink },

    // 开关
    switchPress: { minHeight: workspaceTheme.layout.smallControl, justifyContent: 'center' },
    switch: { width: workspaceTheme.layout.switchWidth, height: workspaceTheme.layout.switchHeight, borderRadius: workspaceTheme.radius.round, backgroundColor: colors.control, padding: spacing[3] },
    switchOn: { backgroundColor: colors.blue },
    thumb: { width: workspaceTheme.layout.switchThumb, height: workspaceTheme.layout.switchThumb, borderRadius: workspaceTheme.radius.round, backgroundColor: colors.onAccent },
    thumbOn: { alignSelf: 'flex-end' },
    disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
  }), [colors]);

  useEffect(() => {
    if (section === 'rules') void store.loadInstructions(sessionId);
    else void store.loadSkills(sessionId);
    return () => store.cancelReads(sessionId);
  }, [store, sessionId, section]);

  const locked = !store.canWrite(sessionId) || store.hasSettingsWrite(sessionId);
  const saveInstructions = async () => { if (await store.saveInstructions(sessionId)) { setEditing(false); onSaved(); } };
  const saveSkills = async () => { if (await store.saveSkills(sessionId)) onSaved(); };

  const toggleDetail = (skill: SessionSkill) => {
    const next = !expandedSkills[skill.id];
    setExpandedSkills((prev) => ({ ...prev, [skill.id]: next }));
    // 请求在点击事件内发起，不放进 React 状态 updater，避免严格模式重复读取。
    const detail = session.skills.details[skill.name];
    if (next && !detail?.loading) void store.loadSkillDetail(sessionId, skill.name);
  };

  const ownSkills = useMemo(
    () => session.skills.catalog.filter((skill) => skill.source !== 'shared'),
    [session.skills.catalog],
  );
  const sharedSkills = useMemo(
    () => session.skills.catalog.filter((skill) => skill.source === 'shared'),
    [session.skills.catalog],
  );

  const renderSkillRow = (skill: SessionSkill) => {
    const isChecked = !!session.skills.draft[skill.id];
    const expanded = !!expandedSkills[skill.id];
    const detailState = session.skills.details[skill.name];

    return (
      <View key={skill.id} style={styles.skillItem}>
        <View style={styles.skillRow}>
          <View style={styles.skillContent}>
            {/* 点击顶部名称与标签区域切换开关 */}
            <Pressable
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              disabled={locked}
              onPress={() => store.setSkill(sessionId, skill.id, !isChecked)}
              style={[styles.skillHeaderPress, locked && styles.disabled]}
            >
              <Text style={styles.skillName}>{skill.name}</Text>
              {skill.sourceDeclared && (
                <View style={[styles.badge, skill.source === 'shared' ? styles.badgeShared : skill.source === 'user' ? styles.badgeUser : styles.badgeBuiltin]}>
                  <Text style={[styles.badgeText, skill.source === 'shared' ? styles.badgeTextShared : skill.source === 'user' ? styles.badgeTextUser : styles.badgeTextBuiltin]}>
                    {sourceLabel(skill.source)}
                  </Text>
                </View>
              )}
              {skill.defaultEnabled && (
                <Text style={styles.defaultTag}>默认开启</Text>
              )}
            </Pressable>

            {/* 第二行：描述 + 行尾“查看说明”入口 */}
            <View style={styles.descRow}>
              <Pressable
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                disabled={locked}
                onPress={() => store.setSkill(sessionId, skill.id, !isChecked)}
                style={{ flex: 1, minWidth: 0 }}
              >
                <Text numberOfLines={1} ellipsizeMode="tail" style={styles.caption}>
                  {skill.description}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${expanded ? '收起' : '查看'} ${skill.name} 说明`}
                onPress={() => toggleDetail(skill)}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                style={styles.detailLink}
              >
                <Text style={styles.detailLinkText}>{expanded ? '收起说明' : '查看说明'}</Text>
              </Pressable>
            </View>
          </View>

          {/* 开关：视觉区域在最右侧，与左侧文本各自独立，触控区>=44dp */}
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={`技能 ${skill.name}`}
            accessibilityHint={`${skill.sourceDeclared ? `${sourceLabel(skill.source)}，` : ''}${skill.description}`}
            accessibilityState={{ checked: isChecked, disabled: locked }}
            disabled={locked}
            onPress={() => store.setSkill(sessionId, skill.id, !isChecked)}
            style={[styles.switchPress, locked && styles.disabled]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View pointerEvents="none" style={[styles.switch, isChecked && styles.switchOn]}>
              <View style={[styles.thumb, isChecked && styles.thumbOn]} />
            </View>
          </Pressable>
        </View>

        {/* 展开的详情正文 */}
        {expanded && (
          <View style={styles.detailContainer}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{skill.name} 正文说明</Text>
              {skill.sourceDeclared && (
                <View style={[styles.badge, skill.source === 'shared' ? styles.badgeShared : skill.source === 'user' ? styles.badgeUser : styles.badgeBuiltin]}>
                  <Text style={[styles.badgeText, skill.source === 'shared' ? styles.badgeTextShared : skill.source === 'user' ? styles.badgeTextUser : styles.badgeTextBuiltin]}>
                    {sourceLabel(skill.source)}
                  </Text>
                </View>
              )}
            </View>
            {detailState?.loading && <Text style={styles.caption}>正在读取技能说明…</Text>}
            {!!detailState?.error && <FeedbackNotice text={detailState.error} tone="danger" />}
            {!detailState?.loading && !detailState?.error && detailState?.content !== undefined && (
              <MarkdownContent text={detailState.content || '（此技能正文为空）'} compact />
            )}
          </View>
        )}
      </View>
    );
  };

  return <View>
    {section === 'rules' && <Card style={styles.card}>
      {session.instructions.draft !== session.instructions.saved && <Text style={styles.caption}>当前显示未保存草稿</Text>}
      <Text style={styles.caption}>保存后在下一轮生效；返回会保留本次连接内的草稿，不影响其他会话。</Text>
      {!editing && <>
        <MarkdownContent text={session.instructions.draft || (!session.instructions.loaded ? '会话规则尚未读取。' : '尚未设置会话规则。')} />
        <ActionButton label="编辑会话规则" text="编辑规则" onPress={() => setEditing(true)} disabled={locked || !session.instructions.loaded} />
      </>}
      {editing && <><FormInput variant="code" accessibilityLabel="会话规则" multiline value={session.instructions.draft}
        editable={!locked && session.instructions.loaded} onChangeText={(text) => store.setInstructions(sessionId, text)}
        placeholder={session.instructions.loaded ? '你希望 Pi Muse 如何在这个会话里工作？' : '正在读取会话规则…'} placeholderTextColor={colors.faint}
        style={styles.input} maxLength={INSTRUCTIONS_LIMIT + 1} />
      <Text style={styles.caption}>{session.instructions.draft.length.toLocaleString()} / {INSTRUCTIONS_LIMIT.toLocaleString()}</Text>
      {!!session.instructions.error && <FeedbackNotice text={session.instructions.error} tone="danger" />}
      <ActionButton label="保存会话规则" text={session.instructions.saving ? '正在保存…' : '保存规则'}
        icon={Check} tone="primary" busy={session.instructions.saving} disabled={locked || !session.instructions.loaded}
        onPress={() => void saveInstructions()} />
      </>}
      {session.instructions.error && !editing && <FeedbackNotice text={session.instructions.error} tone="danger" />}
      {!session.instructions.loaded && !session.instructions.loading && <ActionButton label="重试读取会话规则" text="重试" onPress={() => void store.loadInstructions(sessionId)} />}
    </Card>}
    {section === 'skills' && <Card style={styles.card}>
      <Text style={styles.caption}>开关按当前会话生效，不影响其他会话。</Text>

      {/* 自有技能分组 */}
      {ownSkills.length > 0 && (
        <View style={styles.group}>
          <View style={styles.groupHeader}>
            <Text style={styles.groupTitle}>自有技能 · {ownSkills.length}</Text>
          </View>
          {ownSkills.map(renderSkillRow)}
        </View>
      )}

      {/* 通用技能分组 */}
      {sharedSkills.length > 0 && (
        <View style={styles.group}>
          <View style={styles.groupHeader}>
            <Text style={styles.groupTitle}>通用技能（共享目录）· {sharedSkills.length}</Text>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.sharedNotice}>
              来自服务端运行用户的共享目录（~/.agents/skills），只读、其中的脚本不会执行、默认关闭。
            </Text>
          </View>
          {sharedSkills.map(renderSkillRow)}
        </View>
      )}

      {!!session.skills.error && <FeedbackNotice text={session.skills.error} tone="danger" />}
      {!!session.skills.notice && <Text style={styles.caption}>{session.skills.notice}</Text>}
      {session.skills.diagnostics.map((diagnostic) => <Text key={`${diagnostic.path}:${diagnostic.message}`} style={styles.caption}>{diagnostic.path}：{diagnostic.message}</Text>)}
      {!equalSwitches(session.skills.saved, session.skills.draft) && <View style={styles.row}>
        <ActionButton label="保存会话技能" text="保存技能" tone="primary" disabled={locked || !session.skills.loaded} onPress={() => void saveSkills()} />
      </View>}
      {session.skills.loading && <Text style={styles.caption}>正在读取技能…</Text>}
      {session.skills.loaded && !session.skills.catalog.length && <Text style={styles.caption}>尚无可用技能；技能资产由服务端管理。</Text>}
      {!session.skills.loading && <ActionButton label="刷新会话技能" text="刷新技能" onPress={() => void store.loadSkills(sessionId)} disabled={locked} />}
    </Card>}
  </View>;
}
