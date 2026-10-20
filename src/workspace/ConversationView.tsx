/**
 * 聊天会话主视图：消息列表、工具调用卡片、输入框与运行终态历史同步。
 *
 * 边界：单实例绑定单个空间的聊天代次（父级以 spaceId + epoch 隔离生命周期）；
 * 工具展示复用纯逻辑（tool-presentation / file-scope），不猜测审批决定。
 */
import { ArrowUp, Plus, Square } from 'lucide-react-native';
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
import { useWorkspaceTheme } from './WorkspaceTheme';

const { layout: l, radius: r, typography: t } = workspaceTheme;

function useStyles() {
  const { colors } = useWorkspaceTheme();
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
  const { colors } = useWorkspaceTheme();
  const scroll = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const previousRunning = useRef(false);
  const lastRun = useRef('');
  const [stopError, setStopError] = useState('');
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
  const canSend =
    !!connection?.enabled &&
    runtime.synchronized &&
    !busy &&
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
      (text) => {
        if (!sessions.get(spaceId).draft) sessions.setDraft(spaceId, text);
      },
    );
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
            nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < l.headerHeight;
          }}
          scrollEventThrottle={spacing[16]}
          onContentSizeChange={() => {
            if (nearBottom.current) scroll.current?.scrollToEnd({ animated: false });
          }}
        >
          {conversation.loading && !conversation.views.length ? (
            <Text style={styles.mutedText}>正在读取聊天记录…</Text>
          ) : (
            !conversation.views.length && (
              <View style={styles.emptyChat}>
                <Text style={styles.emptyTitle}>开始一段新的对话</Text>
                <Text style={styles.mutedText}>消息会发送到你配置的 Pi Muse 服务器。</Text>
              </View>
            )
          )}
          {conversation.views.map((message) => (
            <Message key={message.id} message={message} />
          ))}
          {conversation.running && <Text accessibilityLabel="正在生成回复" style={styles.mutedText}>正在生成回复…</Text>}
          {!!stopError && <Text accessibilityRole="alert" style={styles.error}>{stopError}</Text>}
          {!!conversation.error && <Text accessibilityRole="alert" style={styles.error}>{conversation.error}</Text>}
          {session.resetUncertain && <>
            <Text accessibilityRole="alert" style={styles.error}>重置结果未确认，已暂停发送。请核对空间列表中的当前会话，不会自动重发重置。</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="核对重置结果" onPress={onSettled} style={styles.actionButton}>
              <Text style={styles.actionText}>核对重置结果</Text>
            </Pressable>
          </>}
          {(conversation.historyFailed || connection?.snapshot.status === 'authentication-required') && (
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
      </View>
      {!visible && <View style={styles.chatBody}>{otherPage}</View>}
      {visible && (
        <View style={styles.composer}>
          <Pressable accessibilityRole="button" accessibilityLabel="附件尚未接入" style={styles.composerControl} disabled>
            <Plus size={l.iconSize} color={colors.faint} />
          </Pressable>
          <TextInput
            accessibilityLabel="消息输入框"
            placeholder="消息"
            placeholderTextColor={colors.faint}
            value={session.draft}
            onChangeText={(text) => sessions.setDraft(spaceId, text)}
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

function Message({ message }: { message: MessageView }) {
  const styles = useStyles();
  return (
    <View style={styles.messageBlock}>
      {!!message.text && (
        <View style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}>
          <Text selectable style={[styles.messageText, message.role === 'user' && styles.userMessageText]}>
            {message.text}
          </Text>
        </View>
      )}
      {message.toolCalls.map((tool) => {
        const scope = fileScope(toolTextField(parseToolRecord(tool.args), 'path'));
        const { summary, failure, fallback } = toolResultContent(tool.result);
        const output = failure || summary || fallback;
        return (
          <View style={styles.toolCard} key={tool.id}>
            <Text style={styles.caption}>{scope ? `${tool.name} · ${scope}` : tool.name}</Text>
            <Text selectable style={failure ? styles.error : styles.mutedText}>
              {output ?? '工具执行中…'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (c: WorkspaceColors) =>
  StyleSheet.create({
    chatBody: { flex: 1, minHeight: 0 },
    hidden: { display: 'none' },
    chatScroll: { flex: 1 },
    messageList: {
      paddingTop: l.chatContentTop,
      paddingHorizontal: l.sidePadding,
      paddingBottom: spacing[24],
      gap: l.messageGap,
    },
    messageBlock: { gap: l.messageGap },
    message: { padding: l.messagePadding, borderRadius: r.message },
    assistantMessage: {
      backgroundColor: c.surface,
      borderTopLeftRadius: l.bubbleTail,
      alignSelf: 'flex-start',
      maxWidth: '100%',
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
      padding: spacing[14],
      borderRadius: r.card,
      gap: spacing[8],
    },
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
    disabled: { opacity: 0.4 },
    emptyChat: {
      alignItems: 'center',
      paddingVertical: spacing[24],
      gap: spacing[12],
    },
    emptyTitle: { ...t.heroName, color: c.ink, textAlign: 'center' },
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
  });
