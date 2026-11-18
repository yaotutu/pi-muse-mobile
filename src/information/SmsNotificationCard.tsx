import { useMemo } from 'react';
import { Bookmark, Inbox, MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MessageView } from '../chat/chat-state';
import { getChatVisibleText } from '../chat/chat-visible-text';
import { useMessageFeedback } from '../feedback/useMessageFeedback';
import { useTheme } from '../theme/ThemeProvider';
import { spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { MessageContent } from '../workspace/MessageContent';

const { layout: l, radius: r, typography: t } = workspaceTheme;
const SMS_BOOKMARK_PREFIX = '[收藏]';
const SMS_BOOKMARK_COMMENT = '[收藏] 用户收藏了此条重要短信';

function SmsCardFeedbackRow({
  sessionId,
  piSessionId,
  messageId,
  initialFeedback,
  canQuote,
  onQuote,
  styles,
  colors,
}: {
  sessionId: string;
  piSessionId: string;
  messageId: string;
  initialFeedback: NonNullable<MessageView['feedback']>;
  canQuote: boolean;
  onQuote: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: WorkspaceColors;
}) {
  const { feedback, busy, error, uncertain, refresh, setReaction, addComment, deleteComment } = useMessageFeedback({
    sessionId,
    piSessionId,
    messageId,
    initialFeedback,
  });
  const bookmark = feedback.comments.find((comment) => comment.text.startsWith(SMS_BOOKMARK_PREFIX));
  const liked = feedback.reaction === 'like';
  const disliked = feedback.reaction === 'dislike';
  const disabled = busy || uncertain;

  return (
    <>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {uncertain && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="核对短信反馈状态"
          disabled={busy}
          onPress={() => void refresh()}
          style={({ pressed }) => [styles.actionChip, busy && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>刷新核对</Text>
        </Pressable>
      )}
      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="有用"
          accessibilityState={{ selected: liked, disabled }}
          disabled={disabled}
          onPress={() => void setReaction(liked ? null : 'like')}
          style={({ pressed }) => [styles.actionChip, liked && styles.actionChipLike, disabled && styles.disabled, pressed && styles.pressed]}
          testID={`sms-like-${messageId}`}
        >
          <ThumbsUp size={14} color={liked ? colors.blue : colors.muted} />
          <Text style={[styles.actionText, liked && styles.actionTextActive]}>有用</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="收藏短信"
          accessibilityState={{ selected: !!bookmark, disabled }}
          disabled={disabled}
          onPress={() => void (bookmark ? deleteComment(bookmark.id) : addComment(SMS_BOOKMARK_COMMENT))}
          style={({ pressed }) => [styles.actionChip, !!bookmark && styles.actionChipSave, disabled && styles.disabled, pressed && styles.pressed]}
          testID={`sms-save-${messageId}`}
        >
          <Bookmark size={14} color={bookmark ? colors.warning : colors.muted} fill={bookmark ? colors.warning : 'transparent'} />
          <Text style={[styles.actionText, !!bookmark && styles.actionTextSave]}>收藏</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="少推此类"
          accessibilityState={{ selected: disliked, disabled }}
          disabled={disabled}
          onPress={() => void setReaction(disliked ? null : 'dislike')}
          style={({ pressed }) => [styles.actionChip, disliked && styles.actionChipDislike, disabled && styles.disabled, pressed && styles.pressed]}
          testID={`sms-dislike-${messageId}`}
        >
          <ThumbsDown size={14} color={disliked ? colors.danger : colors.muted} />
          <Text style={[styles.actionText, disliked && styles.actionTextDislike]}>少推</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="引用短信到对话"
          disabled={!canQuote}
          onPress={onQuote}
          style={({ pressed }) => [styles.actionChip, styles.actionQuote, !canQuote && styles.disabled, pressed && styles.pressed]}
          testID={`sms-quote-${messageId}`}
        >
          <MessageSquare size={14} color={colors.blue} />
          <Text style={[styles.actionText, styles.actionTextActive]}>引用到对话</Text>
        </Pressable>
      </View>
    </>
  );
}

/** 独立通道的短信速递卡片：在聊天框可见并支持点赞/收藏/少推反馈与引用，不参与主对话上下文。 */
export function SmsNotificationCard({
  message,
  feedbackScope,
  canQuote,
  onQuote,
}: {
  message: MessageView;
  feedbackScope?: { sessionId: string; piSessionId: string; initialFeedback: NonNullable<MessageView['feedback']> };
  canQuote: boolean;
  onQuote?: (text: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const visibleText = getChatVisibleText(message.text);
  const canQuoteText = canQuote && Boolean(onQuote) && !!visibleText.trim();

  return (
    <View style={styles.card} testID={`sms-card-${message.id}`}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Inbox size={15} color={colors.blue} />
          <Text style={styles.title}>短信速递</Text>
        </View>
        <Text style={styles.badge}>独立通道 · 不占对话上下文</Text>
      </View>
      {!!visibleText && <MessageContent text={visibleText} streaming={message.streaming === true} />}
      {feedbackScope ? (
        <SmsCardFeedbackRow
          sessionId={feedbackScope.sessionId}
          piSessionId={feedbackScope.piSessionId}
          messageId={message.id}
          initialFeedback={feedbackScope.initialFeedback}
          canQuote={canQuoteText}
          onQuote={() => onQuote?.(visibleText)}
          styles={styles}
          colors={colors}
        />
      ) : (
        <View style={styles.actionsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="引用短信到对话"
            disabled={!canQuoteText}
            onPress={() => onQuote?.(visibleText)}
            style={({ pressed }) => [styles.actionChip, styles.actionQuote, !canQuoteText && styles.disabled, pressed && styles.pressed]}
            testID={`sms-quote-${message.id}`}
          >
            <MessageSquare size={14} color={colors.blue} />
            <Text style={[styles.actionText, styles.actionTextActive]}>引用到对话</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const createStyles = (c: WorkspaceColors) =>
  StyleSheet.create({
    card: {
      alignSelf: 'stretch',
      padding: l.chatMessagePadding,
      borderRadius: r.card,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      gap: spacing[10],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[8],
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[6],
    },
    title: {
      ...t.caption,
      color: c.ink,
      fontWeight: '600',
    },
    badge: {
      ...t.caption,
      color: c.muted,
    },
    actionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing[8],
      paddingTop: spacing[6],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
    },
    actionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[4],
      paddingHorizontal: spacing[10],
      paddingVertical: spacing[6],
      borderRadius: r.round,
      backgroundColor: c.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    actionChipLike: {
      backgroundColor: c.blueSoft,
      borderColor: c.blue,
    },
    actionChipSave: {
      backgroundColor: c.warningSoft,
      borderColor: c.warning,
    },
    actionChipDislike: {
      backgroundColor: c.dangerSoft,
      borderColor: c.danger,
    },
    actionQuote: {
      marginLeft: 'auto',
    },
    actionText: {
      ...t.caption,
      color: c.muted,
    },
    actionTextActive: {
      color: c.blue,
      fontWeight: '600',
    },
    actionTextSave: {
      color: c.warning,
      fontWeight: '600',
    },
    actionTextDislike: {
      color: c.danger,
      fontWeight: '600',
    },
    error: { ...t.caption, color: c.danger },
    disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
    pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
  });
