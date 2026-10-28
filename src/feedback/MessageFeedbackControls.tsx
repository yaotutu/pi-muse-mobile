/**
 * 单条已落盘消息的反馈外观与唯一状态所有者。组件始终与气泡同层挂载；
 * 长按时才打开 window 锚定菜单，评论作为二级界面，不复制或重挂正文/工具卡。
 */
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, MessageCircle, Pencil, RotateCw, Trash2, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text,
  useWindowDimensions, View, type LayoutRectangle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeStatusBar } from '../theme/ThemeStatusBar';
import { useTheme } from '../theme/ThemeProvider';
import { ActionButton } from '../ui/ActionButton';
import { FeedbackNotice } from '../ui/Feedback';
import { FormInput } from '../ui/FormInput';
import { useReducedMotion } from '../ui/use-reduced-motion';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { positionFeedbackMenu, type MenuRect } from './menu-position';
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
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { feedback, loading, busy, error, uncertain, refresh, setReaction, addComment, editComment, deleteComment } =
    useMessageFeedback({ spaceId, sessionId, messageId, initialFeedback });
  const [section, setSection] = useState<'actions' | 'comments'>('actions');
  const [copyError, setCopyError] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: window.width, height: window.height });
  const [menuHeight, setMenuHeight] = useState<number>(m.initialMenuHeight);
  const reveal = useSharedValue(0);
  const locked = loading || busy || uncertain;
  const count = feedback.comments.length;
  const hasBadge = feedback.reaction !== null || count > 0;
  const badgeWidth = m.badgeHitSize + (feedback.reaction && count > 0 ? m.badgeMixedExtra : 0);
  const menuOpen = visible && !!anchor && section === 'actions';

  useEffect(() => {
    reveal.value = menuOpen
      ? (reducedMotion ? 1 : withTiming(1, { duration: m.revealDuration }))
      : 0;
  }, [menuOpen, reducedMotion, reveal]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: m.revealScale + (1 - m.revealScale) * reveal.value }],
  }));

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
  const menuPosition = anchor ? positionFeedbackMenu(
    anchor, { width: m.menuWidth, height: menuHeight }, viewport, insets,
    role === 'user' ? 'right' : 'left', m.anchorGap, m.screenMargin,
    // Android Fabric 的气泡测量相对状态栏下方的应用窗口；全屏透明 Modal 从屏幕顶部绘制。
    // 使用真实安全区修正两个窗口原点，iOS/Web 的同源窗口不需要偏移。
    Platform.OS === 'android' ? insets.top : 0,
  ) : { x: 0, y: 0 };

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
      {section === 'actions' ? <View style={styles.overlay} onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width !== viewport.width || height !== viewport.height) setViewport({ width, height });
      }}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭消息操作" onPress={closePanel}
          style={StyleSheet.absoluteFill} />
        <Animated.View accessibilityViewIsModal testID={`message-feedback-menu-${messageId}`}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            if (height !== menuHeight) setMenuHeight(height);
          }}
          style={[styles.context, revealStyle, { left: menuPosition.x, top: menuPosition.y,
            maxHeight: viewport.height - insets.top - insets.bottom - m.screenMargin * 2 }]}>
          <View style={[styles.reactionPill, role === 'user' && styles.reactionPillRight]}>
            <Pressable accessibilityRole="button"
              accessibilityLabel={feedback.reaction === 'like' ? '撤销喜欢' : '喜欢这条消息'}
              accessibilityState={{ selected: feedback.reaction === 'like', disabled: locked, busy }}
              disabled={locked} onPress={() => void toggleReaction('like')}
              style={({ pressed }) => [styles.reactionButton, feedback.reaction === 'like' && styles.selected,
                pressed && styles.pressed, locked && styles.disabled]}>
              <Text style={styles.reactionEmoji}>👍</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              accessibilityLabel={feedback.reaction === 'dislike' ? '撤销不喜欢' : '不喜欢这条消息'}
              accessibilityState={{ selected: feedback.reaction === 'dislike', disabled: locked, busy }}
              disabled={locked} onPress={() => void toggleReaction('dislike')}
              style={({ pressed }) => [styles.reactionButton, feedback.reaction === 'dislike' && styles.selected,
                pressed && styles.pressed, locked && styles.disabled]}>
              <Text style={styles.reactionEmoji}>👎</Text>
            </Pressable>
          </View>
          <View style={styles.actionMenu}>
            <Pressable accessibilityRole="button" accessibilityLabel={`查看评论，${count} 条`}
              testID={`message-comments-open-${messageId}`} onPress={openComments}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}>
              <MessageCircle size={sizing.iconMedium} color={colors.ink} />
              <Text style={styles.actionText}>评论{count > 0 ? `  ${count}` : ''}</Text>
            </Pressable>
            {!!messageText && <Pressable accessibilityRole="button" accessibilityLabel="复制消息"
              onPress={() => void copyMessage()} style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}>
              <Copy size={sizing.iconMedium} color={colors.ink} />
              <Text style={styles.actionText}>复制消息</Text>
            </Pressable>}
          </View>
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
        </Animated.View>
      </View> : <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
  disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
  selected: { backgroundColor: c.blueSoft },
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
  overlay: { flex: 1, backgroundColor: c.scrim },
  context: { position: 'absolute', width: m.menuWidth, gap: spacing[8],
    elevation: m.elevation },
  reactionPill: { alignSelf: 'flex-start', flexDirection: 'row', padding: spacing[4],
    borderRadius: r.round, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line,
    backgroundColor: c.canvas },
  reactionPillRight: { alignSelf: 'flex-end' },
  reactionButton: { width: m.reactionSize, height: m.reactionSize, alignItems: 'center',
    justifyContent: 'center', borderRadius: r.round },
  reactionEmoji: { fontSize: m.reactionEmojiSize },
  actionMenu: { borderRadius: r.field, borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.line, backgroundColor: c.canvas, overflow: 'hidden' },
  actionRow: { minHeight: m.actionHeight, flexDirection: 'row', gap: spacing[12],
    alignItems: 'center', paddingHorizontal: spacing[16] },
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
