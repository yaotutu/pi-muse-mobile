/**
 * 单条已落盘消息的反馈外观与唯一状态所有者。组件始终与气泡同层挂载；
 * 长按时才打开 window 锚定菜单，评论作为二级界面，不复制或重挂正文/工具卡。
 */
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, MessageCircle, Pencil, RotateCw, Trash2, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text,
  View, type LayoutRectangle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { AnchoredFeedbackMenu, FeedbackMenuRow, FeedbackMenuRows, FeedbackReactionPill } from '../ui/AnchoredFeedbackMenu';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import type { MenuRect } from '../ui/menu-position';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import type { MessageComment, MessageFeedback } from './types';
import { useMessageFeedback } from './useMessageFeedback';

const { layout: l, radius: r, typography: t, messageFeedback: m } = workspaceTheme;
type Reaction = MessageFeedback['reaction'];

export function MessageFeedbackControls({
  spaceId, sessionId, messageId, messageText, role, initialFeedback, visible, anchor, bubbleLayout, onClose, onOpen,
}: {
  spaceId: string;
  sessionId: string;
  messageId: string;
  messageText: string;
  role: 'user' | 'assistant';
  initialFeedback: MessageFeedback;
  visible: boolean;
  anchor: MenuRect | null;
  bubbleLayout: LayoutRectangle | null;
  onClose: () => void;
  onOpen: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { feedback, loading, busy, error, uncertain, refresh, setReaction, addComment, editComment, deleteComment } =
    useMessageFeedback({ spaceId, sessionId, messageId, initialFeedback });
  const [section, setSection] = useState<'actions' | 'comments'>('actions');
  const [copyError, setCopyError] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const locked = loading || busy || uncertain;
  const count = feedback.comments.length;
  const hasBadge = feedback.reaction !== null || count > 0;
  const badgeWidth = m.badgeHitSize + (feedback.reaction && count > 0 ? m.badgeMixedExtra : 0);

  const closePanel = () => {
    Keyboard.dismiss();
    onClose();
    setSection('actions');
    setDeletingId(null);
    setCopyError(false);
  };
  const openComments = () => {
    setSection('comments');
    // 权威历史提供初值；用户进入评论时才 GET，避免聊天列表挂载产生逐条请求。
    if (!busy && !loading) void refresh();
  };
  const toggleReaction = async (reaction: Exclude<Reaction, null>) => {
    if (locked) return;
    // 互斥和撤销由同一服务端回写确定。失败保持菜单，结果未明保留核对入口。
    if (await setReaction(feedback.reaction === reaction ? null : reaction)) closePanel();
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
  const copyMessage = async () => {
    try {
      if (await Clipboard.setStringAsync(messageText)) closePanel();
      else setCopyError(true);
    } catch {
      setCopyError(true);
    }
  };
  return <>
    {/* 徽标与弹层共享本 Hook。没有反馈时完全不渲染控件；图形靠气泡边缘，44dp 命中区不覆盖正文读屏。 */}
    {hasBadge && bubbleLayout && <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看消息反馈，${feedback.reaction === 'like' ? '已喜欢' : feedback.reaction === 'dislike' ? '已不喜欢' : '无反应'}，${count} 条评论`}
      testID={`message-feedback-badge-${messageId}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.badgeHit, {
        width: badgeWidth,
        left: bubbleLayout.x + bubbleLayout.width - badgeWidth + m.badgeOverhang,
        top: bubbleLayout.y + bubbleLayout.height - m.badgeHitSize / 2,
      }, pressed && styles.pressed]}>
      <View style={styles.badgeFace}>
        {feedback.reaction && <Text style={styles.badgeEmoji}>{feedback.reaction === 'like' ? '👍' : '👎'}</Text>}
        {count > 0 && <><MessageCircle size={m.badgeIconSize} color={colors.ink} />
          <Text style={styles.badgeCount}>{count}</Text></>}
      </View>
    </Pressable>}
    {visible && <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent
      onRequestClose={closePanel}>
      <ThemeStatusBar />
      {section === 'actions' ? <AnchoredFeedbackMenu anchor={anchor} align={role === 'user' ? 'right' : 'left'}
        dismissLabel="关闭消息操作" onDismiss={closePanel} testID={`message-feedback-menu-${messageId}`}>
          <FeedbackReactionPill reaction={feedback.reaction} locked={locked} busy={busy}
            subjectLabel="这条消息" align={role === 'user' ? 'right' : 'left'}
            onReaction={(reaction) => void toggleReaction(reaction)} />
          <FeedbackMenuRows>
            <FeedbackMenuRow icon={MessageCircle} label={`查看评论，${count} 条`}
              text={`评论${count > 0 ? `  ${count}` : ''}`} testID={`message-comments-open-${messageId}`}
              onPress={openComments} />
            {!!messageText && <FeedbackMenuRow icon={Copy} label="复制消息" text="复制消息"
              onPress={() => void copyMessage()} />}
          </FeedbackMenuRows>
          {(copyError || error || uncertain) && <ScrollView style={styles.menuNotice}
            contentContainerStyle={styles.menuNoticeContent}>
            {copyError && <Text accessibilityRole="alert" style={styles.error}>复制失败，请重试</Text>}
            <FeedbackNotice text={error ?? undefined} tone="danger" />
            {uncertain && <View style={styles.uncertain}>
              <Text style={styles.caption}>结果待核对。请刷新确认后再修改；不会自动重试。</Text>
              <ActionButton label="刷新核对反馈" icon={RotateCw} disabled={loading || busy}
                onPress={() => void refresh()} />
            </View>}
          </ScrollView>}
      </AnchoredFeedbackMenu> : <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.commentShade}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭消息操作" onPress={closePanel}
          style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.commentPanel,
          { paddingBottom: Math.max(insets.bottom, spacing[16]) }]}
          testID={`message-comments-panel-${messageId}`}>
          <View style={styles.commentHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel="返回消息操作"
              onPress={() => { Keyboard.dismiss(); onOpen(); setSection('actions'); }} style={styles.headerButton}>
              <Text style={styles.actionText}>返回</Text>
            </Pressable>
            <Text style={styles.title}>评论</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭消息操作" onPress={closePanel}
              style={styles.headerButton}><X size={sizing.iconMedium} color={colors.ink} /></Pressable>
          </View>
          <ScrollView style={styles.commentScroll} contentContainerStyle={styles.commentList}
            keyboardShouldPersistTaps="handled">
            {loading && <Text style={styles.caption}>正在读取反馈…</Text>}
            {!loading && !error && !uncertain && count === 0 && <Text style={styles.caption}>还没有评论</Text>}
            {feedback.comments.map((comment: MessageComment) => <View key={comment.id} style={styles.commentRow}>
              {editingId === comment.id ? <>
                <FormInput multiline maxLength={4000} accessibilityLabel="编辑评论" value={editDraft}
                  editable={!locked} onChangeText={setEditDraft} style={styles.commentInput} />
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
              editable={!locked} onChangeText={setDraft} style={styles.commentInput} />
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
      </KeyboardAvoidingView>}
    </Modal>}
  </>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  caption: { ...t.caption, color: c.muted },
  error: { ...t.caption, color: c.danger },
  actionText: { ...t.detail, color: c.ink },
  badgeHit: { position: 'absolute', zIndex: 2, minWidth: m.badgeHitSize, height: m.badgeHitSize,
    alignItems: 'center', justifyContent: 'center' },
  badgeFace: { minWidth: m.badgeFaceSize, height: m.badgeFaceSize, paddingHorizontal: spacing[6],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[3],
    borderRadius: r.round, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line,
    backgroundColor: c.canvas, elevation: m.elevation },
  badgeEmoji: { fontSize: m.badgeEmojiSize },
  badgeCount: { ...t.caption, color: c.ink },
  menuNotice: { flexShrink: 1, borderRadius: r.field, backgroundColor: c.canvas },
  menuNoticeContent: { padding: spacing[8], gap: spacing[8] },
  uncertain: { gap: spacing[8], padding: spacing[8], borderRadius: r.field,
    backgroundColor: c.canvas },
  commentShade: { flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.scrim, padding: spacing[16] },
  commentPanel: { width: l.fullWidth, maxWidth: l.sheetMaxWidth, maxHeight: l.sheetMaxHeight,
    backgroundColor: c.canvas, borderRadius: r.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.line, padding: spacing[16], gap: spacing[12] },
  commentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { minWidth: l.smallControl, minHeight: l.smallControl,
    alignItems: 'center', justifyContent: 'center' },
  title: { ...t.section, color: c.ink },
  commentScroll: { flexShrink: 1 },
  commentList: { gap: spacing[12], paddingBottom: spacing[8] },
  commentRow: { paddingVertical: spacing[12], borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.line, gap: spacing[8] },
  commentText: { ...t.detail, color: c.ink },
  commentActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[8] },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[8] },
  commentInput: { flex: 1, minWidth: 0, maxHeight: l.composerMaxHeight },
});
