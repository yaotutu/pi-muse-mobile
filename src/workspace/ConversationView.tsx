/**
 * 聊天会话主视图：消息列表、工具调用卡片、输入框与运行终态历史同步。
 *
 * 边界：单实例绑定单个空间的聊天代次（父级以 spaceId + epoch 隔离生命周期）；
 * 工具展示复用纯逻辑（tool-presentation / file-scope），不猜测审批决定。
 */
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Plus, Square, Terminal, Wrench } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import { useApi } from '../api/ApiProvider';
import type { MessageView } from '../chat/chat-state';
import { fileScope } from '../chat/file-scope';
import { parseToolRecord, toolResultContent, toolTextField } from '../chat/tool-presentation';
import { useConversation } from '../chat/useConversation';
import { useServiceConnection } from '../connection/ConnectionProvider';
import { useSpaceRuntime } from '../runtime/RuntimeProvider';
import { useSpaceState, useSpaceStore } from '../spaces/SpaceProvider';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { TypingIndicator } from './primitives';

const { layout: l, radius: r, typography: t } = workspaceTheme;

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

export type ConversationViewProps = {
  spaceId: string;
  visible: boolean;
  otherPage: ReactNode;
  refreshKey: number;
  onSettled: () => void;
  openConnection: () => void;
};

export function ConversationView({
  spaceId,
  visible,
  otherPage,
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
  const scroll = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const previousRunning = useRef(false);
  const lastRun = useRef('');
  const [stopError, setStopError] = useState('');
  const [showLatest, setShowLatest] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState(l.composerHeight - l.composerPadding * 2);

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
  const canSend =
    !!connection?.enabled &&
    runtime.synchronized &&
    !busy &&
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
    if (!canSend || !session.draft.trim()) return;
    setStopError('');
    void conversation.send(
      session.draft,
      () => sessions.setDraft(spaceId, ''),
    );
  };
  const followLatest = () => {
    // 键盘收缩和转为紧凑顶栏只改变视口尺寸；跟随最新时也要重新锚定，不能截掉尾条回复。
    if (nearBottom.current) scroll.current?.scrollToEnd({ animated: false });
  };

  return (
    <>
      <View style={[styles.chatBody, !visible && styles.hidden]}>
        <ScrollView
          ref={scroll}
          style={styles.chatScroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < l.scrollThreshold;
            setShowLatest(!nearBottom.current);
          }}
          scrollEventThrottle={spacing[16]}
          onLayout={followLatest}
          onContentSizeChange={followLatest}
        >
          {conversation.loading && !conversation.views.length ? (
            <Text style={styles.mutedText}>正在读取聊天记录…</Text>
          ) : (
            !conversation.views.length && (
              <View style={styles.emptyChat} testID="conversation-empty">
                <Text style={styles.eyebrow}>A LITTLE SPACE FOR BIG IDEAS</Text>
                <Text style={styles.emptyTitle}>想法，从这里开始。</Text>
                <Text style={styles.emptyDescription}>一个问题，一点灵感，或者还没成形的计划。{ '\n' }都可以和 Pi Muse 聊聊。</Text>
                <View style={styles.suggestions}>
                  {['帮我梳理一个想法', '一起拆解一个目标'].map((prompt) => <Pressable key={prompt} accessibilityRole="button" accessibilityLabel={`填入消息：${prompt}`} disabled={!canSend} onPress={() => sessions.setDraft(spaceId, prompt)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}><Text style={styles.suggestionText}>{prompt}</Text><ArrowUp size={sizing[14]} color={colors.muted} /></Pressable>)}
                </View>
              </View>
            )
          )}
          {conversation.views.map((message) => (
            <Message
              key={message.id}
              message={message}
              pendingStatus={pending && pending.messageId === message.id ? pending.status : undefined}
            />
          ))}
          {pending?.status === 'failed' && (
            <View style={styles.pendingBanner}>
              <Text accessibilityRole="alert" style={styles.error}>
                {pending.error ?? '消息未送达服务端'}
              </Text>
              {session.draft.length > 0 ? (
                <Text style={styles.mutedText}>输入框已有草稿：请先复制保存或清空当前草稿，再恢复此消息</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="恢复到输入框"
                  style={styles.actionButton}
                  onPress={() => sessions.restorePendingSubmissionToDraft(spaceId)}
                >
                  <Text style={styles.actionText}>恢复到输入框</Text>
                </Pressable>
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
            <Pressable accessibilityRole="button" accessibilityLabel="核对重置结果" onPress={onSettled} style={styles.actionButton}>
              <Text style={styles.actionText}>核对重置结果</Text>
            </Pressable>
          </>}
          {(conversation.historyFailed || pending?.status === 'unconfirmed' || connection?.snapshot.status === 'authentication-required') && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新同步会话"
              style={styles.actionButton}
              onPress={() => {
                if (connection?.snapshot.status === 'authentication-required') openConnection();
                else {
                  conversation.reload();
                  connection?.retry();
                }
              }}
            >
              <Text style={styles.actionText}>重新同步</Text>
            </Pressable>
          )}
        </ScrollView>
        {showLatest && <Pressable accessibilityRole="button" accessibilityLabel="回到最新消息" onPress={() => { nearBottom.current = true; setShowLatest(false); scroll.current?.scrollToEnd({ animated: true }); }} style={styles.latestButton}><ArrowDown size={sizing[18]} color={colors.ink} /><Text style={styles.caption}>回到最新</Text></Pressable>}
      </View>
      {!visible && <View style={styles.chatBody}>{otherPage}</View>}
      {visible && (
        <View style={[styles.composer, focused && styles.composerFocused]}>
          <Pressable accessibilityRole="button" accessibilityLabel="附件尚未接入" style={styles.composerControl} disabled>
            <Plus size={l.iconSize} color={colors.faint} />
          </Pressable>
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
                      send();
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? '停止当前运行' : '发送消息'}
            disabled={busy ? !runtime.synchronized || session.deleting : !canSend || !session.draft.trim()}
            style={[styles.sendButton, ((!canSend && !busy) || (!busy && !session.draft.trim())) && styles.disabled]}
            onPress={() => void (busy ? stop() : send())}
          >
            {busy ? <Square size={sizing[16]} color={colors.onAccent} fill={colors.onAccent} /> : <ArrowUp size={l.iconSize} color={colors.onAccent} />}
          </Pressable>
        </View>
      )}
    </>
  );
}

function Message({ message, pendingStatus }: { message: MessageView; pendingStatus?: 'sending' | 'failed' | 'unconfirmed' }) {
  const styles = useStyles();
  return (
    <View style={styles.messageBlock}>
      {!!message.text && (
        <View style={[
          styles.message,
          message.role === 'user' ? styles.userMessage : styles.assistantMessage,
          pendingStatus === 'failed' && styles.userMessageFailed,
          pendingStatus === 'unconfirmed' && styles.userMessageUnconfirmed,
        ]}>
          <Text selectable style={[styles.messageText, message.role === 'user' && styles.userMessageText]}>
            {message.text}
          </Text>
          {pendingStatus === 'sending' && (
            <Text style={styles.messageSubtext}>发送中…</Text>
          )}
          {pendingStatus === 'failed' && (
            <Text style={styles.messageSubtext}>未发送</Text>
          )}
          {pendingStatus === 'unconfirmed' && (
            <Text style={styles.messageSubtext}>待确认</Text>
          )}
        </View>
      )}
      {message.toolCalls.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
    </View>
  );
}

/** 工具卡只整理已有结果，不从“有结果”推断成功，也不猜测对应的审批。 */
function ToolCard({ tool }: { tool: MessageView['toolCalls'][number] }) {
  const styles = useStyles(); const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const scope = fileScope(toolTextField(parseToolRecord(tool.args), 'path'));
  const { summary, failure, fallback } = toolResultContent(tool.result);
  const output = failure || summary || fallback;
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return <View style={styles.toolCard}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? '收起' : '展开'}工具 ${tool.name}`} accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.toolHeading}>
      <View style={styles.toolIcon}><Wrench size={sizing[16]} color={colors.muted} /></View>
      <View style={styles.toolLabel}><Text style={styles.toolTitle}>{tool.name}</Text><Text style={styles.caption}>{scope ?? '工具调用'}{failure ? ' · 执行失败' : output ? ' · 查看结果' : ' · 尚无结果'}</Text></View>
      <Chevron size={sizing[16]} color={colors.faint} />
    </Pressable>
    {!!failure && <Text selectable style={styles.error}>{failure}</Text>}
    {expanded && <View style={styles.toolOutput}><Terminal size={sizing[14]} color={colors.faint} /><Text selectable style={[styles.toolResult, failure && styles.error]}>{output ?? '尚未收到工具结果；运行状态请查看会话面板。'}</Text></View>}
  </View>;
}

const createStyles = (c: WorkspaceColors) =>
  StyleSheet.create({
    chatBody: { flex: 1, minHeight: 0 },
    hidden: { display: 'none' },
    chatScroll: { flex: 1 },
    messageList: {
      paddingTop: l.contentTop,
      paddingHorizontal: l.sidePadding,
      paddingBottom: spacing[24],
      gap: l.messageGap,
    },
    messageBlock: { gap: spacing[8] },
    message: { padding: l.messagePadding, borderRadius: r.message },
    assistantMessage: {
      backgroundColor: c.surface,
      borderTopLeftRadius: l.bubbleTail,
      alignSelf: 'flex-start',
      maxWidth: l.assistantMessageWidth,
    },
    userMessage: {
      backgroundColor: c.blue,
      alignSelf: 'flex-end',
      maxWidth: l.userMessageWidth,
    },
    messageText: { ...t.message, color: c.ink },
    userMessageText: { color: c.onAccent },
    toolCard: {
      backgroundColor: c.surface,
      padding: spacing[16],
      borderRadius: r.card,
      gap: spacing[8],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    toolHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing[12] },
    toolIcon: { width: l.rowIcon, height: l.rowIcon, backgroundColor: c.control, alignItems: 'center', justifyContent: 'center', borderRadius: r.round },
    toolLabel: { flex: 1, gap: spacing[2] }, toolTitle: { ...t.status, color: c.ink },
    toolOutput: { flexDirection: 'row', gap: spacing[8], paddingTop: spacing[10], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    toolResult: { flex: 1, ...t.detail, color: c.muted },
    composer: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: l.composerHeight,
      padding: l.composerPadding,
      marginHorizontal: l.sidePadding,
      marginBottom: l.composerBottom,
      borderRadius: r.round,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    composerFocused: { borderColor: c.faint },
    composerControl: {
      width: l.smallControl,
      height: l.smallControl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    input: {
      flex: 1,
      minWidth: 0,
      ...t.input,
      color: c.ink,
      paddingHorizontal: spacing[6],
      paddingVertical: spacing[8],
      textAlignVertical: 'center',
      maxHeight: l.composerMaxHeight,
      backgroundColor: c.surface,
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
    disabled: { opacity: workspaceTheme.interaction.disabledOpacity },
    pressed: { opacity: workspaceTheme.interaction.pressedOpacity },
    emptyChat: {
      alignItems: 'center',
      paddingTop: spacing[48],
      paddingBottom: spacing[24],
      gap: spacing[18],
    },
    emptyTitle: { ...t.heroName, color: c.ink, textAlign: 'center' },
    emptyDescription: { ...t.detail, color: c.muted, textAlign: 'center' },
    eyebrow: { ...t.eyebrow, color: c.faint, textAlign: 'center' },
    suggestions: { alignItems: 'center', gap: spacing[10], marginTop: spacing[10] },
    suggestion: { minHeight: l.smallControl, flexDirection: 'row', alignItems: 'center', gap: spacing[14], borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, borderRadius: r.round, paddingVertical: spacing[8], paddingHorizontal: spacing[18] },
    suggestionText: { ...t.status, color: c.muted },
    latestButton: { position: 'absolute', bottom: spacing[12], alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing[8], backgroundColor: c.control, paddingHorizontal: spacing[16], minHeight: l.smallControl, borderRadius: r.round, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
    mutedText: { ...t.detail, color: c.muted },
    caption: { ...t.caption, color: c.faint },
    error: { ...t.caption, color: c.danger },
    actionButton: {
      backgroundColor: c.blue,
      paddingHorizontal: spacing[18],
      paddingVertical: spacing[12],
      borderRadius: r.round,
      alignSelf: 'center',
    },
    actionText: { ...t.status, color: c.onAccent },
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
