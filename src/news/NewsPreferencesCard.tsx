import { useEffect, useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import type { NewsPreferencesStore } from './news-preferences-store';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { Card } from '../ui/Surfaces';
import { FeedbackNotice } from '../ui/Feedback';
import { SettingsTextField } from '../ui/SettingsTextField';
import { spacing, workspaceTheme } from '../ui/tokens';

/** 新闻明确偏好属于新闻子 Agent 本身，不影响主聊天指令；聊天调整后在此同步可见。 */
export function NewsPreferencesCard({ store }: { store: NewsPreferencesStore }) {
  const { colors } = useTheme();
  const { preferences, draftNotes, loading, saving, needsReadback, error, notice } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { store.open(); return () => store.close(); }, [store]);
  const [showLearned, setShowLearned] = useState(false);
  const dirty = !!preferences && preferences.notes !== draftNotes;
  const learnedNotes = preferences?.learnedNotes.trim() ?? '';
  return <View style={{ gap: spacing[12] }}>
    <Text style={{ ...workspaceTheme.typography.caption, color: colors.muted }}>填写希望多看或少看的内容，也可以在聊天中告诉助手。</Text>
    {preferences && <SettingsTextField label="推荐规则" empty="尚未设置新闻推荐规则。" value={draftNotes} saveDirect onChangeText={(notes) => { store.setDraftNotes(notes); void store.save(); }}
      editable={!saving && !needsReadback} maxLength={20000}
      placeholder="例如：关注技术进展，少推荐营销内容" />}
    {loading && !preferences && <Text style={{ ...workspaceTheme.typography.caption, color: colors.muted }}>正在读取新闻偏好…</Text>}
    <FeedbackNotice tone="danger" text={error} />
    <FeedbackNotice tone="success" text={notice} />
    {error && <ActionButton label="刷新核对新闻偏好" text="刷新核对" disabled={saving || loading} onPress={() => void store.reload()} />}
    {(dirty || saving) && <ActionButton label="保存新闻偏好" tone="primary" busy={saving} disabled={needsReadback} onPress={() => void store.save()} />}
    {!!learnedNotes && <ActionButton label="已学习的新闻兴趣画像" expanded={showLearned} onPress={() => setShowLearned(!showLearned)} />}
    {!!learnedNotes && showLearned && (
      <Card style={{ gap: spacing[6], padding: spacing[12] }} testID="news-learned-notes">
        <Text selectable style={{ ...workspaceTheme.typography.caption, color: colors.muted }}>{learnedNotes}</Text>
      </Card>
    )}
  </View>;
}
