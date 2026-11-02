import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Newspaper, Inbox } from 'lucide-react-native';
import { useApi } from '../api/ApiProvider';
import { isRequestCancelled } from '../api/errors';
import { useTheme } from '../theme/ThemeProvider';
import { workspaceTheme, spacing, sizing } from '../ui/tokens';
import { ActionButton } from '../ui/ActionButton';
import { FeedbackNotice } from '../ui/Feedback';
import { SpaceHeader } from '../workspace/SpaceHeader';
import { SmsSettingsCard } from '../information/SmsSettingsCard';
import type { FeatureBinding, FeatureId } from './contracts';
import { NewsPreferencesCard } from './NewsPreferencesCard';
export type FeatureSection = 'features' | 'sms' | 'news-feature';

/** 功能设置独立于当前聊天空间；不把功能内部 Space 暴露为可切换的会话。 */
export function FeaturePage({ section, onSection, onBack, spaces, onNewsSettings }: {
  section: FeatureSection; onSection: (section: FeatureSection) => void; onBack: () => void;
  spaces: { id: string; title: string }[]; onNewsSettings: () => void;
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
  const id: FeatureId | undefined = section === 'features' ? undefined : section === 'sms' ? 'sms' : 'news';
  const feature = features.find((item) => item.id === id);
  const name = (spaceId: string) => spaces.find((item) => item.id === spaceId)?.title ?? (spaceId === 'local-main' ? '主空间' : spaceId);
  const bind = async (spaceId: string) => {
    if (!id || saving || needsReadback) return;
    setSaving(true);
    try { const result = await api.bindFeature(id, spaceId); if (mounted.current) { setFeatures((old) => old.map((item) => item.id === id ? result : item)); setChoosing(false); setError(undefined); } }
    catch (e) { if (mounted.current) { setNeedsReadback(true); setError(`${e instanceof Error ? e.message : '保存失败'}。请刷新核对承接空间，不会自动重发。`); } }
    finally { if (mounted.current) setSaving(false); }
  };
  return <View style={styles.root}>
    <SpaceHeader title={feature?.name ?? (id === 'sms' ? '短信' : id === 'news' ? '新闻' : '功能')} caption={id ? '独立功能设置' : undefined} onBack={() => { setChoosing(false); if (id) onSection('features'); else onBack(); }} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <FeedbackNotice tone="danger" text={error} />
      {loading && <Text style={styles.caption}>正在读取功能…</Text>}
      {error && <ActionButton text="刷新核对" label="刷新功能绑定" onPress={() => { setLoading(true); void reload(); }} disabled={saving || loading} />}
      {!id && <><Text style={styles.caption}>功能独立保存数据与偏好；消息和讨论交给指定空间，默认主空间。切换聊天空间不会改变绑定。</Text>
        <View style={styles.group}>{features.map((item) => { const Icon = item.id === 'news' ? Newspaper : Inbox; return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`管理${item.name}功能`} onPress={() => { setChoosing(false); onSection(item.id === 'sms' ? 'sms' : 'news-feature'); }} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Icon size={sizing.iconMedium} color={colors.blue} /><View style={styles.flex}><Text style={styles.title}>{item.name}</Text><Text style={styles.caption}>{item.id === 'news' ? '阅读、RSS 与讨论' : '后台过滤与重要提醒'} · 承接：{name(item.targetSpaceId)}</Text></View><ChevronRight size={sizing[18]} color={colors.faint} />
        </Pressable>; })}</View></>}
      {!!id && feature && <>
        <View style={styles.group}><View style={styles.row}><View style={styles.flex}><Text style={styles.title}>交互承接空间</Text><Text style={styles.text}>{name(feature.targetSpaceId)}</Text><Text style={styles.caption}>只改变之后新发起交互的落点，不移动功能数据或聊天历史。</Text></View></View></View>
        <ActionButton label="更换交互承接空间" text={saving ? '正在保存…' : '更换承接空间'} disabled={loading || saving || needsReadback} onPress={() => setChoosing(!choosing)} />
        {choosing && <View style={styles.group}>{spaces.map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`绑定到${space.title}`} disabled={saving} onPress={() => void bind(space.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}><Text style={styles.text}>{space.title}{space.id === feature.targetSpaceId ? ' · 当前' : ''}</Text></Pressable>)}</View>}
        {id === 'news' ? <><ActionButton label="打开新闻RSS来源" text="RSS 来源管理" onPress={onNewsSettings} /><NewsPreferencesCard /></> : <SmsSettingsCard />}
      </>}
    </ScrollView>
  </View>;
}
