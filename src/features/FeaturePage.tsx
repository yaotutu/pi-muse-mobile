import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { isRequestCancelled } from '../api/errors';
import { useTheme } from '../theme/ThemeProvider';
import { workspaceTheme, spacing } from '../ui/tokens';
import { ActionButton } from '../ui/ActionButton';
import { FeedbackNotice } from '../ui/Feedback';
import { AgentHeader } from '../workspace/AgentHeader';
import { SmsSettingsCard } from '../information/SmsSettingsCard';
import type { FeatureBinding, FeatureId } from './contracts';
import { NewsPreferencesCard } from './NewsPreferencesCard';
import type { NewsPreferencesStore } from './news-preferences-store';
export type FeatureSection = 'sms' | 'news-feature';

/** 后台功能设置由专用接口持有，不以当前私聊的 sessionId 代替 Feature 归属。 */
export function FeaturePage({ section, onBack, backLabel, agents, onNewsSettings, newsPreferences }: {
  section: FeatureSection; onBack: () => void; backLabel: string;
  agents: { id: string; title: string }[]; onNewsSettings: () => void;
  newsPreferences: NewsPreferencesStore;
}) {
  const api = useApi(); const { colors } = useTheme();
  const [features, setFeatures] = useState<FeatureBinding[]>([]);
  const [error, setError] = useState<string>(); const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false); const [needsReadback, setNeedsReadback] = useState(false);
  const [choosing, setChoosing] = useState(false); const mounted = useRef(true);
  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1 }, body: { padding: workspaceTheme.layout.sidePadding, gap: spacing[18], paddingBottom: spacing[28] },
    text: { ...workspaceTheme.typography.detail, color: colors.ink }, title: { ...workspaceTheme.typography.itemTitle, color: colors.ink },
    caption: { ...workspaceTheme.typography.caption, color: colors.muted }, row: { minHeight: workspaceTheme.layout.appSettingsRowHeight, padding: spacing[16], flexDirection: 'row', gap: spacing[14], alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
    group: { borderRadius: workspaceTheme.radius.card, backgroundColor: colors.surface, overflow: 'hidden' }, flex: { flex: 1, gap: spacing[4] }, pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  }), [colors]);
  const reload = useCallback((signal?: AbortSignal) => api.listFeatures(signal)
    .then((result) => {
      if (!mounted.current || signal?.aborted) return;
      setFeatures(result);
      setNeedsReadback(false);
      setError(undefined);
    })
    .catch((e: unknown) => {
      if (mounted.current && !signal?.aborted && !isRequestCancelled(e)) setError(e instanceof Error ? e.message : '功能读取失败');
    })
    .finally(() => { if (mounted.current && !signal?.aborted) setLoading(false); }), [api]);
  useEffect(() => { mounted.current = true; const controller = new AbortController(); void reload(controller.signal); return () => { mounted.current = false; controller.abort(); }; }, [reload]);
  const id: FeatureId = section === 'sms' ? 'sms' : 'news';
  const feature = features.find((item) => item.id === id);
  const name = (agentId: string) => agents.find((item) => item.id === agentId)?.title ?? (agentId === 'local-main' ? '主智能体' : agentId);
  const bind = async (agentId: string) => {
    if (saving || needsReadback) return;
    setSaving(true);
    try { const result = await api.bindFeature(id, agentId); if (mounted.current) { setFeatures((old) => old.map((item) => item.id === id ? result : item)); setChoosing(false); setError(undefined); } }
    catch (e) { if (mounted.current) { setNeedsReadback(true); setError(`${e instanceof Error ? e.message : '保存失败'}。请刷新核对承接智能体，不会自动重发。`); } }
    finally { if (mounted.current) setSaving(false); }
  };
  return <View style={styles.root}>
    <AgentHeader title={feature?.name ?? (id === 'sms' ? '短信' : '新闻')} caption="扩展设置" backLabel={backLabel} onBack={() => { setChoosing(false); onBack(); }} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <FeedbackNotice tone="danger" text={error} />
      {loading && <Text style={styles.caption}>正在读取功能…</Text>}
      {error && <ActionButton text="刷新核对" label="刷新功能绑定" onPress={() => { setLoading(true); void reload(); }} disabled={saving || loading} />}
      {feature && <>
        <View style={styles.group}><View style={styles.row}><View style={styles.flex}><Text style={styles.title}>交互承接智能体</Text><Text style={styles.text}>{name(feature.targetAgentId)}</Text><Text style={styles.caption}>仅改变后台通知及「带到会话讨论」的落点，不影响成员私聊或数据归属。</Text></View></View></View>
        <ActionButton label="更换交互承接智能体" text={saving ? '正在保存…' : '更换承接智能体'} disabled={loading || saving || needsReadback} onPress={() => setChoosing(!choosing)} />
        {choosing && <View style={styles.group}>{agents.map((agent) => <Pressable key={agent.id} accessibilityRole="button" accessibilityLabel={`绑定到${agent.title}`} disabled={saving} onPress={() => void bind(agent.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><Text style={styles.text}>{agent.title}{agent.id === feature.targetAgentId ? ' · 当前' : ''}</Text></Pressable>)}</View>}
        {id === 'news' ? <><ActionButton label="打开新闻RSS来源" text="RSS 来源管理" onPress={onNewsSettings} /><NewsPreferencesCard store={newsPreferences} /></> : <SmsSettingsCard />}
      </>}
    </ScrollView>
  </View>;
}
