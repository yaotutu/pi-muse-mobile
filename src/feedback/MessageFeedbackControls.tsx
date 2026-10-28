/**
 * 已落盘消息的局部反馈 UI。父级负责确认消息归属；此处只管理展开、草稿与删除确认，
 * 所有反馈读写交给 Hook。评论输入与聊天发送完全独立，不触发模型运行。
 */
import { Check, MessageCircle, MoreHorizontal, Pencil, RotateCw, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { useReducedMotion } from '../ui/use-reduced-motion';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import type { MessageComment, MessageFeedback } from './types';
import { useMessageFeedback } from './useMessageFeedback';

const { layout: l, radius: r, typography: t } = workspaceTheme;

type Reaction = MessageFeedback['reaction'];

export function MessageFeedbackControls({ spaceId, sessionId, messageId, role, initialFeedback }: {
  spaceId: string;
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant';
  initialFeedback: MessageFeedback;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const compact = width < l.sheetCompactBreakpoint;
  const { feedback, loading, busy, error, uncertain, refresh, setReaction, addComment, editComment, deleteComment } =
    useMessageFeedback({ spaceId, sessionId, messageId, initialFeedback });
  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const locked = loading || busy || uncertain;
  const ownerLabel = role === 'user' ? '用户消息' : '助手消息';
  const count = feedback.comments.length;
  const summary = [
    feedback.reaction === 'like' ? '已喜欢' : feedback.reaction === 'dislike' ? '已不喜欢' : '',
    count ? `${count} 条评论` : '',
  ].filter(Boolean).join(' · ');

  const closeComments = () => {
    Keyboard.dismiss();
    setCommentsOpen(false);
    setDeletingId(null);
  };
  const openComments = () => {
    setCommentsOpen(true);
    // 历史已有初值；只有用户打开评论时才按需读取，避免每条消息挂载即请求。
    if (!busy && !loading) void refresh();
  };
  const toggleReaction = (reaction: Exclude<Reaction, null>) => {
    if (locked) return;
    // 同一反应再次点击即撤销；互斥结果以服务端回写为准。
    void setReaction(feedback.reaction === reaction ? null : reaction);
  };
  const submitComment = async () => {
    const text = draft.trim();
    if (!text || locked) return;
    if (await addComment(text)) setDraft('');
  };
  const submitEdit = async () => {
    const text = editDraft.trim();
    if (!editingId || !text || locked) return;
    if (await editComment(editingId, text)) {
      setEditingId(null);
      setEditDraft('');
    }
  };
  const confirmDelete = async (id: string) => {
    if (locked) return;
    if (await deleteComment(id)) setDeletingId(null);
  };

  return (
    <View style={[styles.root, role === 'user' ? styles.userRoot : styles.assistantRoot]} testID={`message-feedback-${messageId}`}>
      <View style={styles.compactRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${ownerLabel}反馈操作${summary ? `，${summary}` : ''}`}
          accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => [styles.entry, pressed && styles.pressed]} testID={`message-feedback-open-${messageId}`}>
          <MoreHorizontal size={sizing.iconMedium} color={summary ? colors.accentText : colors.muted} />
          {!!summary && <Text style={styles.summary}>{summary}</Text>}
        </Pressable>
        {!!error && !expanded && <Text style={styles.errorDot} accessibilityLabel="反馈操作失败">!</Text>}
      </View>
      {expanded && <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={feedback.reaction === 'like' ? '撤销喜欢' : '喜欢这条消息'}
          accessibilityState={{ selected: feedback.reaction === 'like', disabled: locked, busy }}
          disabled={locked} onPress={() => toggleReaction('like')}
          style={({ pressed }) => [styles.iconAction, feedback.reaction === 'like' && styles.selected, pressed && styles.pressed, locked && styles.disabled]}>
          <ThumbsUp size={sizing.iconMedium} color={feedback.reaction === 'like' ? colors.accentText : colors.muted} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={feedback.reaction === 'dislike' ? '撤销不喜欢' : '不喜欢这条消息'}
          accessibilityState={{ selected: feedback.reaction === 'dislike', disabled: locked, busy }}
          disabled={locked} onPress={() => toggleReaction('dislike')}
          style={({ pressed }) => [styles.iconAction, feedback.reaction === 'dislike' && styles.selected, pressed && styles.pressed, locked && styles.disabled]}>
          <ThumbsDown size={sizing.iconMedium} color={feedback.reaction === 'dislike' ? colors.accentText : colors.muted} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看${ownerLabel}评论，${count} 条`}
          onPress={openComments}
          style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]} testID={`message-comments-open-${messageId}`}>
          <MessageCircle size={sizing.iconMedium} color={colors.muted} />
          {!!count && <Text style={styles.count}>{count}</Text>}
        </Pressable>
      </View>}
      {expanded && !!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {expanded && uncertain && <ActionButton label="刷新核对反馈" icon={RotateCw} disabled={loading || busy}
        onPress={() => void refresh()} />}

      {commentsOpen && <Modal transparent visible animationType={reducedMotion ? 'none' : 'slide'}
        onRequestClose={closeComments} accessibilityLabel={`${ownerLabel}评论`}>
        <ThemeStatusBar />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.shade, compact && styles.compactShade]}>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭评论" onPress={closeComments}
            style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={[styles.panel, compact && styles.compactPanel,
            compact && { paddingBottom: Math.max(insets.bottom, spacing[16]) }]}>
            {compact && <View style={styles.grabber} />}
            <View style={styles.panelHeader}>
              <View style={styles.panelHeading}>
                <Text style={styles.title}>评论</Text>
                <Text style={styles.caption}>{ownerLabel} · {count} 条</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭评论" onPress={closeComments}
                style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}>
                <X size={sizing.iconMedium} color={colors.ink} />
              </Pressable>
            </View>
            <ScrollView style={styles.commentScroll} contentContainerStyle={styles.commentList}
              keyboardShouldPersistTaps="handled">
              {loading && <Text style={styles.caption}>正在读取反馈…</Text>}
              {!loading && !error && !uncertain && count === 0 && <Text style={styles.caption}>还没有评论</Text>}
              {feedback.comments.map((comment: MessageComment) => <View key={comment.id} style={styles.commentRow}>
                {editingId === comment.id ? <>
                  <FormInput multiline maxLength={4000} accessibilityLabel="编辑评论" value={editDraft}
                    editable={!locked} onChangeText={setEditDraft}
                    style={styles.commentInput} />
                  <View style={styles.commentActions}>
                    <ActionButton label="保存评论" icon={Check} disabled={locked || !editDraft.trim()}
                      onPress={() => void submitEdit()} />
                    <ActionButton label="取消编辑" disabled={busy} onPress={() => { setEditingId(null); setEditDraft(''); }} />
                  </View>
                </> : <>
                  <Text selectable style={styles.commentText}>{comment.text}</Text>
                  {deletingId === comment.id ? <View style={styles.commentActions}>
                    <Text style={styles.caption}>确认删除这条评论？</Text>
                    <ActionButton label="确认删除评论" text="删除" tone="danger" icon={Trash2}
                      disabled={locked} onPress={() => void confirmDelete(comment.id)} />
                    <ActionButton label="取消删除" text="取消" disabled={busy} onPress={() => setDeletingId(null)} />
                  </View> : <View style={styles.commentActions}>
                    <ActionButton label="编辑评论" text="编辑" icon={Pencil} disabled={locked}
                      onPress={() => { setEditingId(comment.id); setEditDraft(comment.text); setDeletingId(null); }} />
                    <ActionButton label="删除评论" text="删除" icon={Trash2} disabled={locked}
                      onPress={() => { setDeletingId(comment.id); setEditingId(null); }} />
                  </View>}
                </>}
              </View>)}
            </ScrollView>
            <View style={styles.composer}>
              <FormInput multiline maxLength={4000} accessibilityLabel="新评论" placeholder="写评论" value={draft}
                editable={!locked} onChangeText={setDraft}
                style={styles.commentInput} />
              <ActionButton label="添加评论" text="发送" disabled={locked || !draft.trim()}
                onPress={() => void submitComment()} />
            </View>
            <FeedbackNotice text={error ?? undefined} tone="danger" />
            {uncertain && <View style={styles.uncertain}>
              <Text style={styles.caption}>结果待核对。请刷新确认后再修改；不会自动重试。</Text>
              <ActionButton label="刷新核对反馈" icon={RotateCw} disabled={loading || busy}
                onPress={() => void refresh()} />
            </View>}
          </View>
        </KeyboardAvoidingView>
      </Modal>}
    </View>
  );
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { gap: spacing[2], maxWidth: l.assistantMessageWidth },
  userRoot: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  assistantRoot: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  compactRow: { flexDirection: 'row', alignItems: 'center' },
  entry: { minHeight: l.smallControl, minWidth: l.smallControl, flexDirection: 'row', alignItems: 'center',
    gap: spacing[6], paddingHorizontal: spacing[10], borderRadius: r.round },
  summary: { ...t.caption, color: c.muted },
  count: { ...t.caption, color: c.muted },
  errorDot: { ...t.caption, color: c.danger },
  error: { ...t.caption, color: c.danger },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  iconAction: { minWidth: l.smallControl, minHeight: l.smallControl, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: spacing[4], borderRadius: r.round },
  selected: { backgroundColor: c.blueSoft },
  pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
  shade: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[20], backgroundColor: c.scrim },
  compactShade: { justifyContent: 'flex-end', padding: 0 },
  panel: { width: l.fullWidth, maxWidth: l.sheetMaxWidth, maxHeight: l.sheetMaxHeight,
    backgroundColor: c.canvas, borderRadius: r.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.line, padding: spacing[16], gap: spacing[12] },
  compactPanel: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  grabber: { alignSelf: 'center', width: sizing[34], height: sizing[4], borderRadius: r.round, backgroundColor: c.control },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  panelHeading: { gap: spacing[2] },
  title: { ...t.section, color: c.ink },
  caption: { ...t.caption, color: c.muted },
  commentScroll: { flexShrink: 1 },
  commentList: { gap: spacing[12], paddingBottom: spacing[8] },
  commentRow: { paddingVertical: spacing[12], borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line, gap: spacing[8] },
  commentText: { ...t.detail, color: c.ink },
  commentActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[8] },
  commentInput: { flex: 1, minWidth: 0, maxHeight: l.composerMaxHeight },
  uncertain: { gap: spacing[8] },
});
