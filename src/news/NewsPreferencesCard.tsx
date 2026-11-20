import { useEffect, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import type { NewsPreferencesStore } from './news-preferences-store';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { Card } from '../ui/Surfaces';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { spacing, workspaceTheme } from '../ui/tokens';

/** 新闻明确偏好属于新闻子 Agent 本身，不影响主聊天指令；聊天调整后在此同步可见。 */
export function NewsPreferencesCard({ store }: { store: NewsPreferencesStore }) {
  const { colors } = useTheme();
  const { preferences, draftNotes, loading, saving, needsReadback, error, notice } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  const learnedNotes = preferences?.learnedNotes.trim() ?? '';
  return <View style={{ gap: spacing[12] }}>
    <Text style={{ ...workspaceTheme.typography.itemTitle, color: colors.ink }}>新闻偏好</Text>
    <Text style={{ ...workspaceTheme.typography.caption, color: colors.muted }}>只用于新闻筛选，不影响聊天会话或全局资料；也可以在聊天中直接告诉助手调整新闻偏好。</Text>
    <FormInput accessibilityLabel="新闻偏好备注" multiline value={draftNotes} onChangeText={store.setDraftNotes}
      editable={!!preferences && !saving && !needsReadback} maxLength={20000}
      placeholder="例如：关注技术进展，少推荐营销内容" />
    {loading && !preferences && <Text style={{ ...workspaceTheme.typography.caption, color: colors.muted }}>正在读取新闻偏好…</Text>}
    <FeedbackNotice tone="danger" text={error} />
    <FeedbackNotice tone="success" text={notice} />
    {error && <ActionButton label="刷新核对新闻偏好" text="刷新核对" disabled={saving || loading} onPress={() => void store.reload()} />}
    <ActionButton label="保存新闻偏好" text={saving ? '正在保存…' : '保存偏好'} disabled={!preferences || saving || needsReadback} onPress={() => void store.save()} />
    {!!learnedNotes && (
      <Card style={{ gap: spacing[6], padding: spacing[12] }} testID="news-learned-notes">
        <Text style={{ ...workspaceTheme.typography.detail, fontWeight: '600', color: colors.ink }}>已学习的新闻兴趣画像</Text>
        <Text selectable style={{ ...workspaceTheme.typography.caption, color: colors.muted }}>{learnedNotes}</Text>
      </Card>
    )}
  </View>;
}
