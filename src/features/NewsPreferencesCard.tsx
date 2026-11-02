import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { isRequestCancelled } from '../api/errors';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { spacing, workspaceTheme } from '../ui/tokens';

/** 新闻明确偏好属于功能本身；不修改承接空间规则或模型维护的学习摘要。 */
export function NewsPreferencesCard() {
  const api = useApi();
  const { colors } = useTheme();
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsReadback, setNeedsReadback] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const read = useCallback((signal?: AbortSignal) => api.getNewsPreferences(signal)
    .then((preferences) => {
      if (signal?.aborted) return;
      setNotes(preferences.notes);
      setLoaded(true);
      setNeedsReadback(false);
      setError(undefined);
    })
    .catch((e: unknown) => {
      if (!signal?.aborted && !isRequestCancelled(e)) setError(e instanceof Error ? e.message : '新闻偏好读取失败');
    }), [api]);
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
  }, [read]);
  const save = async () => {
    if (!loaded || saving || needsReadback) return;
    setSaving(true);
    setNotice(undefined);
    try {
      const result = await api.saveNewsPreferences({ notes });
      setNotes(result.notes);
      setError(undefined);
      setNotice('已保存新闻偏好，从下一轮筛选生效');
    } catch (e) {
      setNeedsReadback(true);
      setError(`${e instanceof Error ? e.message : '保存失败'}。请先刷新核对，不会自动重发。`);
    } finally { setSaving(false); }
  };
  return <View style={{ gap: spacing[10] }}>
    <Text style={{ ...workspaceTheme.typography.itemTitle, color: colors.ink }}>新闻偏好</Text>
    <Text style={{ ...workspaceTheme.typography.caption, color: colors.muted }}>只用于新闻筛选，不影响聊天空间或全局资料。</Text>
    <FormInput accessibilityLabel="新闻偏好备注" multiline value={notes} onChangeText={setNotes}
      editable={loaded && !saving && !needsReadback} maxLength={20000}
      placeholder="例如：关注技术进展，少推荐营销内容" />
    <FeedbackNotice tone="danger" text={error} />
    <FeedbackNotice tone="success" text={notice} />
    {error && <ActionButton label="刷新核对新闻偏好" text="刷新核对" disabled={saving} onPress={() => void read()} />}
    <ActionButton label="保存新闻偏好" text={saving ? '正在保存…' : '保存偏好'} disabled={!loaded || saving || needsReadback} onPress={() => void save()} />
  </View>;
}
