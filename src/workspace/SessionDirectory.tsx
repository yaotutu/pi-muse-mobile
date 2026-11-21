import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { ApiError } from '../api/errors';
import type { SessionDeleteOptions, SessionSchedules } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import type { SessionRecord } from '../sessions/types';
import { useChatSessionStore, useSessionState } from '../sessions/SessionProvider';
import type { useSessions } from '../sessions/useSessions';
import { ActionButton } from '../ui/ActionButton';
import { Card } from '../ui/Surfaces';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { Sheet } from '../ui/Sheet';
import { spacing, workspaceTheme } from '../ui/tokens';

type Edit = { kind: 'create' } | { kind: 'rename' | 'delete'; session: SessionRecord };

export function SessionDirectory({ directory, selectedId, onClose, onSelect, onDelete }: {
  directory: ReturnType<typeof useSessions>;
  selectedId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string, options: SessionDeleteOptions) => Promise<boolean>;
}) {
  const { colors } = useTheme();
  const [edit, setEdit] = useState<Edit>();
  const [title, setTitle] = useState('');
  const lock = directory.busy || directory.uncertain;
  const start = (next: Edit) => {
    setTitle(next.kind === 'rename' ? next.session.title : '');
    setEdit(next);
  };

  if (edit?.kind === 'delete') return <SessionDeleteSheet session={edit.session}
    onClose={() => setEdit(undefined)} onDelete={onDelete} onRemoved={onClose} reload={directory.store.reload} />;

  return <Sheet title={edit ? edit.kind === 'create' ? '新建会话' : '重命名会话' : '会话'} onClose={() => {
    if (!directory.busy) { if (edit) setEdit(undefined); else onClose(); }
  }}>
    <View style={{ gap: spacing[12] }}>
      <FeedbackNotice text={directory.error} tone="danger" />
      {directory.uncertain && <FeedbackNotice text="上次修改结果不明。先核对会话列表，再继续操作。" tone="warning" />}
      {(directory.error || directory.uncertain) && <ActionButton label="重新核对会话" busy={directory.loading}
        onPress={() => void directory.store.reload({ reconcileUncertain: true })} />}
      {edit ? <>
        <FormInput accessibilityLabel="会话名称" value={title} onChangeText={setTitle} placeholder="会话名称" maxLength={200} editable={!lock} />
        <ActionButton label={edit.kind === 'create' ? '创建会话' : '保存会话名称'} tone="primary"
          busy={directory.busy} disabled={lock || (edit.kind === 'rename' && !title.trim())} onPress={() => void (async () => {
            const result = edit.kind === 'create' ? await directory.store.create(title.trim() || undefined)
              : await directory.store.rename(edit.session.id, title.trim());
            if (result) { if (edit.kind === 'create') onSelect(result.id); else setEdit(undefined); }
          })()} />
      </> : <>
        <ActionButton label="新建会话" tone="primary" disabled={lock} onPress={() => start({ kind: 'create' })} />
        {directory.loading && !directory.loaded && <Text style={{ color: colors.muted }}>正在读取会话…</Text>}
        {directory.sessions.map((session) => <Card key={session.id} style={{ gap: spacing[8] }}>
          <Text style={{ ...workspaceTheme.typography.detail, color: colors.ink }}>{session.isMain ? '主聊天' : session.title}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] }}>
            <ActionButton label={session.id === selectedId ? '当前会话' : `打开 ${session.title}`}
              text={session.id === selectedId ? '当前会话' : '打开'} onPress={() => onSelect(session.id)} />
            {!session.isMain && <>
              <ActionButton label={`重命名 ${session.title}`} text="重命名" onPress={() => start({ kind: 'rename', session })} disabled={lock} />
              <ActionButton label={`删除 ${session.title}`} text="删除" tone="danger" onPress={() => start({ kind: 'delete', session })} disabled={lock} />
            </>}
          </View>
        </Card>)}
      </>}
    </View>
  </Sheet>;
}

function SessionDeleteSheet({ session, onClose, onDelete, onRemoved, reload }: {
  session: SessionRecord;
  onClose: () => void;
  onDelete: (id: string, options: SessionDeleteOptions) => Promise<boolean>;
  onRemoved: () => void;
  reload: ReturnType<typeof useSessions>['store']['reload'];
}) {
  const api = useApi();
  const chats = useChatSessionStore();
  const state = useSessionState(session.id);
  const { colors } = useTheme();
  const [preview, setPreview] = useState<SessionSchedules>();
  const [request, refresh] = useState(0);
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void api.getSessionSchedules(session.id, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setPreview(value); },
      (cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取会话的定时任务'); },
    );
    return () => controller.abort();
  }, [api, session.id, request]);

  const retryPreview = () => { setPreview(undefined); setError(undefined); refresh((value) => value + 1); };
  const submit = async (scheduleDisposition: SessionDeleteOptions['scheduleDisposition']) => {
    if (!preview || state.deleting || state.deleteUncertain || checking) return;
    setError(undefined);
    try {
      if (await onDelete(session.id, { scheduleDisposition, scheduleRevision: preview.scheduleRevision })) onRemoved();
      else setError('当前会话无法删除，请检查连接状态后重试。');
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'SESSION_SCHEDULES_CHANGED') {
        setPreview(undefined);
        setError('所属任务已变化。请刷新列表并重新确认。');
      } else if (cause instanceof ApiError && cause.code === 'SESSION_JOB_RUNNING') {
        setError('会话的定时任务仍在执行。可在任务结束后保留并转移，或选择一并删除。');
      } else {
        setError(cause instanceof Error ? cause.message : '删除会话失败');
      }
    }
  };

  const reconcile = async () => {
    setChecking(true);
    try {
      if (!await reload()) { setError('无法重新核对会话。请检查连接后再核对。'); return; }
      if (chats.get(session.id).deleted) onRemoved();
      else { chats.acknowledgeDeletion(session.id); retryPreview(); }
    } finally { setChecking(false); }
  };

  const busy = state.deleting || checking;
  const hasSchedules = !!preview && preview.jobs.length + preview.monitors.length > 0;
  return <Sheet title={`删除 ${session.title}`} onClose={() => { if (!busy) onClose(); }}>
    <View style={{ gap: spacing[12] }}>
      <Text style={{ color: colors.ink }}>会话记录和消息反馈将永久删除。</Text>
      {!preview && !error && <Text style={{ color: colors.muted }}>正在读取所属任务和监控…</Text>}
      <FeedbackNotice text={error} tone="danger" />
      {state.deleteUncertain ? <>
        <FeedbackNotice text="删除结果未确认，请先核对会话，避免重复提交。" tone="warning" />
        <ActionButton label="核对删除结果" onPress={() => void reconcile()} busy={checking} />
      </> : !preview ? error && <ActionButton label="刷新所属任务" onPress={retryPreview} /> : <>
        {preview.jobs.map(({ id, title }) => <Text key={id} style={{ color: colors.ink }}>定时任务 · {title}</Text>)}
        {preview.monitors.map(({ id, title }) => <Text key={id} style={{ color: colors.ink }}>网页监控 · {title}</Text>)}
        {hasSchedules && <>
          <Text style={{ color: colors.muted }}>保留的任务和监控将转到主聊天。</Text>
          <ActionButton label="删除会话，保留任务" onPress={() => void submit('move-to-main')} disabled={busy} />
        </>}
        <ActionButton label={hasSchedules ? '删除会话和任务' : '确认删除会话'} tone="danger"
          onPress={() => void submit('delete')} disabled={busy} />
      </>}
    </View>
  </Sheet>;
}
