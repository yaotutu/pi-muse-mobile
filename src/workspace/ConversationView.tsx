/**
 * 聊天会话主视图：消息列表、工具调用卡片、输入框与运行终态历史同步。
 *
 * 边界：单实例绑定单个空间的聊天代次（父级以 spaceId + epoch 隔离生命周期）；
 * assistant Markdown 与工具专用展示由独立组件负责，不猜测审批决定。
 */
import { ArrowDown, ArrowUp, Square } from 'lucide-react-native';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutRectangle, type ScrollViewInstance, type TextStyle, type ViewInstance } from 'react-native';
import { useApi } from '../api/ApiProvider';
import { pickMessageAttachments } from '../attachments/picker';
import { AttachmentAction, AttachmentStrip, MessageAttachments } from '../attachments/AttachmentViews';
import type { MessageView } from '../chat/chat-state';
import { useConversation } from '../chat/useConversation';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { useSpaceRuntime } from '../runtime/RuntimeProvider';
import { useSpaceState, useSpaceStore } from '../spaces/SpaceProvider';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { TypingIndicator } from './primitives';
import { MessageContent } from './MessageContent';
import { ToolResultCard } from './ToolResultCard';
import { ActionButton } from '../ui/ActionButton';
import { MessageFeedbackControls } from '../feedback/MessageFeedbackControls';
import { ScrollAnchorFrame, ScrollFollow } from './scroll-follow';

const { layout: l, radius: r, typography: t } = workspaceTheme;

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

export type ConversationViewProps = {
  spaceId: string;
  visible: boolean;
  compactHeader: boolean;
  refreshKey: string | number;
  onSettled: () => void;
  openConnection: () => void;
};

export function ConversationView({
  spaceId,
  visible,
  compactHeader,
  refreshKey,
  onSettled,
  openConnection,
}: ConversationViewProps) {
  const api = useApi();
  const conversation = useConversation(spaceId, refreshKey);
  const sessions = useSpaceStore();
  const session = useSpaceState(spaceId);
  const runtime = useSpaceRuntime(spaceId);
  const connection = useServiceConnection();
  const styles = useStyles();
  const { colors } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const scrollFollow = useRef(new ScrollFollow());
  const visibleRef = useRef(visible);
  const [discardTarget, setDiscardTarget] = useState<string>();
  const previousRunning = useRef(false);
  const lastRun = useRef('');
  const [stopError, setStopError] = useState('');
  const [showLatest, setShowLatest] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState(l.composerHeight - l.composerPadding * 2);
  const [selecting, setSelecting] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const pickerInFlight = useRef(false);
  const pickerRequest = useRef(0);
  const mounted = useRef(true);
  const currentOwner = useRef({ sessions, spaceId, epoch: session.epoch });
  const anchorFrame = useRef<ScrollAnchorFrame | null>(null);

  useLayoutEffect(() => {
    anchorFrame.current = new ScrollAnchorFrame(
      requestAnimationFrame,
      cancelAnimationFrame,
      () => mounted.current && visibleRef.current && scrollFollow.current.shouldAnchor(),
      () => scroll.current?.scrollToEnd({ animated: false }),
    );
    return () => { anchorFrame.current?.cancel(); anchorFrame.current = null; };
  }, []);

  useLayoutEffect(() => {
    currentOwner.current = { sessions, spaceId, epoch: session.epoch };
  }, [sessions, spaceId, session.epoch]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; anchorFrame.current?.cancel(); };
  }, []);

  useLayoutEffect(() => {
    visibleRef.current = visible;
    if (!visible) anchorFrame.current?.cancel();
    // 隐藏空间继续接收流；重新显示后在下一布局帧锚到最新。
    else if (scrollFollow.current.shouldAnchor()) anchorFrame.current?.schedule();
  }, [visible]);

  useEffect(() => {
    if (previousRunning.current && !conversation.running) onSettled();
    previousRunning.current = conversation.running;
  }, [conversation.running, onSettled]);

  const recentTerminal = runtime.runs
    .filter((run) => run.status !== 'running')
    .map((run) => `${run.runId}:${run.revision}`)
    .join('|');
  useEffect(() => {
    if (recentTerminal && recentTerminal !== lastRun.current) {
      lastRun.current = recentTerminal;
      if (!conversation.running) conversation.reload();
    }
  }, [recentTerminal, conversation]);

  const busy = conversation.running || runtime.running;
  const pending = session.pendingSubmission;
  const [steering, setSteering] = useState(false);
  const hasInput = !!session.draft.trim() || session.draftAttachments.length > 0;
  const canSend =
    !!connection?.enabled &&
    runtime.synchronized &&
    !busy &&
    !selecting &&
    !pending &&
    !conversation.loading &&
    !conversation.historyFailed &&
    !session.deleted &&
    !session.deleting && !session.resetting && !session.resetUncertain;
  const canInterruptAndSend =
    !!connection?.enabled &&
    runtime.synchronized &&
    busy &&
    hasInput &&
    !selecting &&
    !pending &&
    !conversation.loading &&
    !conversation.historyFailed &&
    !session.deleted &&
    !session.deleting && !session.resetting && !session.resetUncertain;

  const stop = async () => {
    setStopError('');
    if (conversation.running) {
      await conversation.stop();
      return;
    }
    const run = runtime.runs.find((item) => item.status === 'running' && item.spaceId === spaceId);
    if (!run || !runtime.synchronized) return;
    try {
      const stopped = await api.stopRun(spaceId, run.runId);
      if (!stopped) {
        setStopError('该运行已结束或已变化，正在重新同步');
        runtime.retry();
      }
    } catch (error) {
      setStopError(error instanceof Error ? error.message : '停止失败，请重试');
    }
  };

  const send = () => {
    if (pickerInFlight.current || !canSend || !hasInput) return;
    setStopError('');
    // 从旧历史发送即转向新消息；之后只有用户主动上滚才停止跟随。
    scrollFollow.current.beginSend();
    setShowLatest(false);
    anchorFrame.current?.schedule();
    void conversation.send(
      session.draft,
      // send 只在消息已进入 pending 后同步调用此回调；失败或结果未明时原件仍由 pending 持有。
      () => {
        sessions.setDraft(spaceId, '');
        sessions.clearDraftAttachments(spaceId, session.epoch);
        setAttachmentError('');
      },
      session.draftAttachments,
    );
  };

  const interruptAndSend = () => {
    if (pickerInFlight.current || !canInterruptAndSend || steering) return;
    setStopError('');
    setSteering(true);
    scrollFollow.current.beginSend();
    setShowLatest(false);
    anchorFrame.current?.schedule();
    void conversation
      .interruptAndSend(
        session.draft,
        () => {
          sessions.setDraft(spaceId, '');
          sessions.clearDraftAttachments(spaceId, session.epoch);
          setAttachmentError('');
        },
        session.draftAttachments,
      )
      .catch((error) => {
        setStopError(error instanceof Error ? error.message : '打断并发送失败');
      })
      .finally(() => {
        setSteering(false);
      });
  };

  const selectAttachments = async () => {
    if (pickerInFlight.current || busy || pending || !sessions.canWrite(spaceId)) return;
    pickerInFlight.current = true;
    const request = ++pickerRequest.current;
    const owner = { sessions, spaceId, epoch: session.epoch, lifecycle: sessions.getLifecycleVersion() };
    const ownsResult = () => mounted.current && pickerRequest.current === request &&
      currentOwner.current.sessions === owner.sessions && currentOwner.current.spaceId === owner.spaceId &&
      currentOwner.current.epoch === owner.epoch && owner.sessions.getLifecycleVersion() === owner.lifecycle &&
      owner.sessions.get(owner.spaceId).epoch === owner.epoch && owner.sessions.canWrite(owner.spaceId);
    setSelecting(true);
    setAttachmentError('');
    try {
      const result = await pickMessageAttachments();
      // 系统选择器会短暂让连接 enabled=false；草稿归属由 store/epoch/lifecycle 决定。
      if (!ownsResult()) return;
      if (result.status === 'error') setAttachmentError(result.message);
      else if (result.status === 'selected') {
        const appended = owner.sessions.appendDraftAttachments(owner.spaceId, owner.epoch, result.attachments);
        if (!appended.ok) setAttachmentError(appended.error);
      }
    } catch (error) {
      if (ownsResult()) setAttachmentError(error instanceof Error ? error.message : '选择附件失败，请重试');
    } finally {
      if (pickerRequest.current === request) {
        pickerInFlight.current = false;
        if (mounted.current) setSelecting(false);
      }
    }
  };
  const followLatest = () => {
    // 键盘收缩和转为紧凑顶栏只改变视口尺寸；跟随最新时也要重新锚定，不能截掉尾条回复。
    if (visible && scrollFollow.current.onLayout()) anchorFrame.current?.schedule();
  };
  const atBottom = ({ contentOffset, contentSize, layoutMeasurement }: {
    contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number };
  }) => contentSize.height - contentOffset.y - layoutMeasurement.height < l.scrollThreshold;

  return (
    <>
      <View style={[styles.chatBody, !visible && styles.hidden]}>
        <ScrollView
          ref={scroll}
          style={styles.chatScroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.messageList, compactHeader && styles.messageListCompact]}
          showsVerticalScrollIndicator={false}
          onScroll={(event) => {
            if (!visible) return;
            const next = scrollFollow.current.onScroll(atBottom(event.nativeEvent));
            if (next.anchor) anchorFrame.current?.schedule();
            setShowLatest(next.showLatest);
          }}
          scrollEventThrottle={spacing[16]}
          onScrollBeginDrag={() => { scrollFollow.current.onDrag(); anchorFrame.current?.cancel(); }}
          onScrollEndDrag={(event) => {
            const next = scrollFollow.current.onDragEnd(atBottom(event.nativeEvent));
            if (visible) setShowLatest(next.showLatest);
          }}
          onLayout={followLatest}
          onContentSizeChange={() => { scrollFollow.current.onContentSizeChange(); followLatest(); }}
        >
          {conversation.loading && !conversation.views.length ? (
            <Text style={styles.mutedText}>正在读取聊天记录…</Text>
          ) : (
            !conversation.views.length && (
              <View style={styles.emptyChat} testID="conversation-empty">
                <Text style={styles.emptyHint}>有什么想聊的？</Text>
              </View>
            )
          )}
          {conversation.views.map((message) => (
            <Message
              key={message.id}
              message={message}
              pendingStatus={pending && pending.messageId === message.id ? pending.status : undefined}
              feedbackScope={message.feedbackAvailable === true && conversation.sessionId &&
                conversation.persistedMessageIds.has(message.id) && message.feedback
                ? { spaceId, sessionId: conversation.sessionId, initialFeedback: message.feedback }
                : undefined}
            />
          ))}
          {pending?.status === 'failed' && (
            <View style={styles.pendingBanner}>
              <Text accessibilityRole="alert" style={styles.error}>
                {pending.error ?? '消息未送达服务端'}
              </Text>
              {session.draft.length > 0 || session.draftAttachments.length > 0 ? (
                <>
                  <Text style={styles.mutedText}>当前草稿会保留；也可先清空草稿，再恢复这条未发送消息。</Text>
                  {discardTarget === pending.messageId ? <>
                    <Text style={styles.error}>确认放弃未发送消息，保留当前草稿？此操作无法撤销。</Text>
                    <ActionButton label="放弃未发送消息，保留当前草稿" tone="danger" onPress={() => {
                      if (sessions.discardFailedSubmission(spaceId, session.epoch, pending.messageId)) conversation.reload();
                      setDiscardTarget(undefined);
                    }} />
                    <ActionButton label="取消放弃未发送消息" onPress={() => setDiscardTarget(undefined)} />
                  </> : <ActionButton label="放弃未发送消息" onPress={() => setDiscardTarget(pending.messageId)} />}
                </>
              ) : (
                <ActionButton label="恢复到输入框" onPress={() => sessions.restorePendingSubmissionToDraft(spaceId)} />
              )}
            </View>
          )}
          {pending?.status === 'unconfirmed' && (
            <View style={styles.pendingBanner}>
              <Text accessibilityRole="alert" style={styles.mutedText}>
                {pending.error ?? '消息保存状态待确认，请重新同步核对'}
              </Text>
            </View>
          )}
          {conversation.running && <TypingIndicator />}
          {!!stopError && <Text accessibilityRole="alert" style={styles.error}>{stopError}</Text>}
          {!!conversation.error && <Text accessibilityRole="alert" style={styles.error}>{conversation.error}</Text>}
          {session.resetUncertain && <>
            <Text accessibilityRole="alert" style={styles.error}>重置结果未确认，已暂停发送。请核对空间列表中的当前会话，不会自动重发重置。</Text>
            <ActionButton label="核对重置结果" onPress={onSettled} />
          </>}
          {(conversation.historyFailed || pending?.status === 'unconfirmed' || connection?.snapshot.status === 'authentication-required') && (
            <ActionButton label="重新同步会话" text="重新同步"
              onPress={() => {
                if (connection?.snapshot.status === 'authentication-required') openConnection();
                else {
                  conversation.reload();
                  connection?.retry();
                }
              }}
            />
          )}
        </ScrollView>
        {showLatest && <Pressable accessibilityRole="button" accessibilityLabel="回到最新消息" onPress={() => { scrollFollow.current.returnLatest(); setShowLatest(false); scroll.current?.scrollToEnd({ animated: true }); }} style={styles.latestButton}><ArrowDown size={sizing[18]} color={colors.ink} /><Text style={styles.caption}>回到最新</Text></Pressable>}
      </View>
      {visible && <>
        {(session.draftAttachments.length > 0 || !!attachmentError) && <View style={styles.attachmentArea}>
          <AttachmentStrip items={session.draftAttachments} disabled={selecting || !!pending || busy || !sessions.canWrite(spaceId)} onRemove={(id) => {
            sessions.removeDraftAttachment(spaceId, session.epoch, id);
            setAttachmentError('');
          }} />
          {!!attachmentError && <Text accessibilityRole="alert" style={styles.error}>{attachmentError}</Text>}
        </View>}
        <View style={[styles.composer, focused && styles.composerFocused]}>
          <AttachmentAction disabled={busy || !!pending || !sessions.canWrite(spaceId)} selecting={selecting} onPress={() => void selectAttachments()} />
          {/* 聊天输入与发送/停止共用动态高度胶囊；保留专用 TextInput 以维持光标、键盘和流式操作。 */}
          <TextInput
            accessibilityLabel="消息输入框"
            placeholder="消息"
            placeholderTextColor={colors.faint}
            value={session.draft}
            onChangeText={(text) => sessions.setDraft(spaceId, text)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={!session.deleting && !session.deleted && !session.resetting && !session.resetUncertain}
            multiline
            onContentSizeChange={(event) =>
              setInputHeight(
                Math.max(
                  l.composerHeight - l.composerPadding * 2,
                  Math.min(l.composerMaxHeight, event.nativeEvent.contentSize.height),
                ),
              )
            }
            onKeyPress={
              Platform.OS === 'web'
                ? (event) => {
                    const key = event.nativeEvent as typeof event.nativeEvent & {
                      shiftKey?: boolean;
                      isComposing?: boolean;
                      keyCode?: number;
                    };
                    if (key.key === 'Enter' && !key.shiftKey && !key.isComposing && key.keyCode !== 229) {
                      event.preventDefault();
                      if (busy && hasInput) {
                        interruptAndSend();
                      } else {
                        send();
                      }
                    }
                  }
                : undefined
            }
            style={[
              styles.input,
              { height: session.draft ? inputHeight : l.composerHeight - l.composerPadding * 2 },
              Platform.OS === 'web' && ({ outlineStyle: 'none' } as unknown as TextStyle),
            ]}
          />
          {busy && hasInput && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="仅停止当前运行"
              disabled={!runtime.synchronized || session.deleting || steering}
              style={[
                styles.stopButton,
                (!runtime.synchronized || session.deleting || steering) && styles.disabled,
              ]}
              onPress={() => void stop()}
            >
            <Square size={sizing[14]} color={colors.ink} fill={colors.ink} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? (hasInput ? '打断并发送新消息' : '停止当前运行') : '发送消息'}
            disabled={
              busy
                ? (hasInput ? !canInterruptAndSend || steering : !runtime.synchronized || session.deleting)
                : !canSend || !hasInput
            }
            style={[
              styles.sendButton,
              (busy
                ? hasInput && (!canInterruptAndSend || steering)
                : !canSend || !hasInput) && styles.disabled,
            ]}
            onPress={() => void (busy ? (hasInput ? interruptAndSend() : stop()) : send())}
          >
            {busy && !hasInput ? (
              <Square size={sizing[16]} color={colors.onAccent} fill={colors.onAccent} />
            ) : (
              <ArrowUp size={l.iconSize} color={colors.onAccent} />
            )}
          </Pressable>
        </View>
      </>}
    </>
  );
}

function Message({ message, pendingStatus, feedbackScope }: {
  message: MessageView;
  pendingStatus?: 'sending' | 'failed' | 'unconfirmed';
  feedbackScope?: { spaceId: string; sessionId: string; initialFeedback: NonNullable<MessageView['feedback']> };
}) {
  const styles = useStyles();
  const bubbleRef = useRef<ViewInstance>(null);
  const [bubbleLayout, setBubbleLayout] = useState<LayoutRectangle | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // 整条消息保持原有 key；弹层按空间和会话归属开启，测量迟到也不能打开新目标。
  const feedbackOwner = feedbackScope ? `${feedbackScope.spaceId}:${feedbackScope.sessionId}` : null;
  const latestFeedbackOwner = useRef(feedbackOwner);
  useLayoutEffect(() => { latestFeedbackOwner.current = feedbackOwner; }, [feedbackOwner]);
  const [feedbackOpenOwner, setFeedbackOpenOwner] = useState<string | null>(null);
  const openFeedback = () => {
    if (!feedbackOwner) return;
    const owner = feedbackOwner;
    // 长按时才测量原气泡的 window 坐标；历史刷新只更新反馈数据，不重建正文或工具卡。
    Keyboard.dismiss();
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      if (latestFeedbackOwner.current !== owner || width <= 0 || height <= 0) return;
      setAnchor({ x, y, width, height });
      setFeedbackOpenOwner(owner);
    });
  };
  const bubbleContent = <>
    {!!message.text && (message.role === 'user'
      ? <Text selectable={!feedbackScope} onLongPress={feedbackScope ? openFeedback : undefined}
        accessibilityActions={feedbackScope ? [{ name: 'openMessageActions', label: '打开消息操作' }] : undefined}
        onAccessibilityAction={feedbackScope ? (event) => { if (event.nativeEvent.actionName === 'openMessageActions') openFeedback(); } : undefined}
        style={[styles.messageText, styles.userMessageText]}>{message.text}</Text>
      : <MessageContent text={message.text} onMessageLongPress={feedbackScope ? openFeedback : undefined} />)}
    {message.role === 'user' && !!message.attachments?.length && <MessageAttachments items={message.attachments} />}
    {pendingStatus === 'sending' && <Text style={styles.messageSubtext}>发送中…</Text>}
    {pendingStatus === 'failed' && <Text style={styles.messageSubtext}>未发送</Text>}
    {pendingStatus === 'unconfirmed' && <Text style={styles.messageSubtext}>待确认</Text>}
  </>;
  const bubbleStyle = [
    styles.message,
    message.role === 'user' ? styles.userMessage : styles.assistantMessage,
    message.role === 'user' && !!message.attachments?.length && styles.userMessageWithAttachments,
    pendingStatus === 'failed' && styles.userMessageFailed,
    pendingStatus === 'unconfirmed' && styles.userMessageUnconfirmed,
  ];
  return (
    <View style={styles.messageBlock}>
      {(!!message.text || (message.role === 'user' && !!message.attachments?.length)) && (
        <View style={styles.bubbleWrap}>
        <Pressable ref={bubbleRef} style={bubbleStyle} disabled={!feedbackScope}
          onLayout={(event) => setBubbleLayout(event.nativeEvent.layout)}
          onLongPress={feedbackScope ? openFeedback : undefined} accessible={false} focusable={false}
          testID={feedbackScope ? `message-bubble-${message.id}` : undefined}>
          {bubbleContent}
        </Pressable>
        {feedbackScope && <MessageFeedbackControls
          key={`${feedbackScope.spaceId}:${feedbackScope.sessionId}:${message.id}`}
          visible={feedbackOpenOwner === feedbackOwner && !!anchor}
          anchor={anchor}
          bubbleLayout={bubbleLayout}
          onClose={() => { setFeedbackOpenOwner(null); setAnchor(null); }}
          onOpen={openFeedback}
          spaceId={feedbackScope.spaceId}
          sessionId={feedbackScope.sessionId}
          messageId={message.id}
          messageText={message.text}
          role={message.role}
          initialFeedback={feedbackScope.initialFeedback}
        />}
        </View>
      )}
      {message.toolCalls.map((tool) => <ToolResultCard key={tool.id} tool={tool} />)}
    </View>
  );
}

const createStyles = (c: WorkspaceColors) =>
  StyleSheet.create({
    chatBody: { flex: 1, minHeight: 0 },
    hidden: { display: 'none' },
    chatScroll: { flex: 1 },
    messageList: {
      // 首条消息避开浮动会话信息；长历史仍可从浮层下方滚过。
      flexGrow: 1,
      paddingTop: l.chatContentTop,
      paddingHorizontal: l.sidePadding,
      paddingBottom: spacing[24],
      gap: l.messageGap,
    },
    messageListCompact: { paddingTop: l.chatContentTopCompact },
    messageBlock: { gap: spacing[8] },
    bubbleWrap: { position: 'relative' },
    message: { padding: l.chatMessagePadding, borderRadius: r.message },
    assistantMessage: {
      backgroundColor: c.surface,
      alignSelf: 'flex-start',
      // Markdown 内部用百分比宽度布局代码块与表格，气泡给出明确宽度以免原生端压缩。
      width: l.assistantMessageWidth,
      maxWidth: l.assistantMessageWidth,
    },
    userMessage: {
      backgroundColor: c.blue,
      alignSelf: 'flex-end',
      maxWidth: l.userMessageWidth,
    },
    // 附件列表使用百分比宽度；明确气泡宽度，避免 Android 在内容固有尺寸计算时把附件信息压到零宽。
    userMessageWithAttachments: { width: l.userMessageWidth },
    messageText: { ...t.message, color: c.ink },
    userMessageText: { color: c.onAccent },
    composer: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: l.composerHeight,
      padding: l.composerPadding,
      marginHorizontal: l.sidePadding,
      marginBottom: l.composerBottom,
      borderRadius: r.round,
      backgroundColor: c.surface,
    },
    composerFocused: { backgroundColor: c.control },
    attachmentArea: { marginHorizontal: l.sidePadding, marginBottom: spacing[8], gap: spacing[6] },
    input: {
      flex: 1,
      minWidth: 0,
      ...t.input,
      color: c.ink,
      paddingHorizontal: spacing[6],
      paddingVertical: spacing[8],
      textAlignVertical: 'center',
      maxHeight: l.composerMaxHeight,
      backgroundColor: 'transparent',
      borderWidth: 0,
      overflow: 'hidden',
    },
    sendButton: {
      width: l.smallControl,
      height: l.smallControl,
      borderRadius: r.round,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.blue,
    },
    stopButton: {
      width: l.smallControl,
      height: l.smallControl,
      borderRadius: r.round,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
    // 空态只保留低对比短句；整块填满剩余视口，在不同屏高和键盘状态下自然居中。
    emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: spacing[48] },
    emptyHint: { ...t.detail, color: c.muted, textAlign: 'center' },
    latestButton: { position: 'absolute', bottom: spacing[12], alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing[8], backgroundColor: c.control, paddingHorizontal: spacing[16], minHeight: l.smallControl, borderRadius: r.round, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    mutedText: { ...t.detail, color: c.muted },
    caption: { ...t.caption, color: c.faint },
    error: { ...t.caption, color: c.danger },

    userMessageFailed: { backgroundColor: c.danger },
    userMessageUnconfirmed: { opacity: 0.75 },
    messageSubtext: { ...t.caption, color: c.onAccent, marginTop: spacing[4], alignSelf: 'flex-end' },
    pendingBanner: {
      padding: spacing[12],
      borderRadius: r.card,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
      gap: spacing[8],
      alignItems: 'center',
    },
  });
