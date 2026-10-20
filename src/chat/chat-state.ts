/**
 * 聊天运行时状态：把 AG-UI 事件流聚合为可渲染的消息视图。
 *
 * 逻辑翻译自 pi-muse web/src/chat/chat-state.ts（已验证的实现），
 * 按本项目类型系统重写。协议要点：
 * - 运行期由聚合器维护乐观视图；RUN_FINISHED 后调用方应拉取
 *   GET /api/conversation 权威历史整体替换，避免双份事实；
 * - 工具调用以 toolCallId 关联：TOOL_CALL_START/ARGS/END 流式补全参数，
 *   TOOL_CALL_RESULT 迟到一步，回填到之前的调用上；
 * - role=tool 的历史消息是结果投影，归并进对应 assistant 消息。
 */

import type { AgUiEvent, ConversationMessage } from '../api/types';

/** 单次工具调用的渲染视图 */
export type ToolCallView = {
  id: string;
  name: string;
  args: string;
  result?: string;
};

/** 消息渲染视图：assistant 消息可同时含文本与多个工具卡 */
export type MessageView = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls: ToolCallView[];
  /** 运行中的 assistant 消息（流式聚合中） */
  streaming?: boolean;
};

/** 把服务端权威历史（含工具投影）转为视图；role=tool 回填到对应调用。 */
export function projectHistory(messages: ConversationMessage[]): MessageView[] {
  const views: MessageView[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      views.push({
        id: message.id,
        role: 'user',
        text: message.content ?? '',
        toolCalls: [],
      });
    } else if (message.role === 'assistant') {
      views.push({
        id: message.id,
        role: 'assistant',
        text: message.content ?? '',
        toolCalls: (message.toolCalls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          args: call.function.arguments,
        })),
      });
    } else if (message.role === 'tool' && message.toolCallId) {
      for (let i = views.length - 1; i >= 0; i--) {
        const hit = views[i]!.toolCalls.find((x) => x.id === message.toolCallId);
        if (hit) {
          hit.result = message.content ?? '';
          break;
        }
      }
    }
  }
  return views;
}

/** 运行期聚合器：消费 SSE 事件，就地更新 messages 数组（UI 负责拷贝触发渲染）。 */
export class StreamAggregator {
  readonly messages: MessageView[];
  /** RUN_ERROR 的受控文案；调用方负责展示，不将协议失败伪装成 assistant 回复。 */
  error?: string;
  private current?: MessageView;
  /** TOOL_CALL_ARGS 的增量缓冲：END 时一次性写到调用上 */
  private readonly args = new Map<string, string>();
  private fallbackSeq = 0;

  constructor(existing: MessageView[]) {
    this.messages = [...existing];
  }

  private nextFallbackId(): string {
    this.fallbackSeq += 1;
    return `assistant-${Date.now()}-${this.fallbackSeq}`;
  }

  /**
   * 显式消息 ID 是协议中的归属依据，不能因为 current 指向别处就回退到它。
   * 仅缺失 ID 的兼容事件沿用 current；限定 assistant，避免污染用户历史。
   */
  private findMessage(id?: string | null): MessageView | undefined {
    return id == null
      ? this.current
      : this.messages.find((message) => message.role === 'assistant' && message.id === id);
  }

  push(event: AgUiEvent): void {
    switch (event.type) {
      case 'TEXT_MESSAGE_START': {
        // 服务端可能先发同一 assistant 的工具，再开始文本；复用宿主以保留工具卡。
        this.current = (event.messageId == null ? undefined : this.findMessage(event.messageId)) ?? {
          id: event.messageId ?? this.nextFallbackId(),
          role: 'assistant',
          text: '',
          toolCalls: [],
          streaming: true,
        };
        this.current.streaming = true;
        if (!this.messages.includes(this.current)) this.messages.push(this.current);
        break;
      }
      case 'TEXT_MESSAGE_CONTENT': {
        const target = this.findMessage(event.messageId);
        if (target && event.delta) target.text += event.delta;
        break;
      }
      case 'TEXT_MESSAGE_END': {
        const target = this.findMessage(event.messageId);
        if (target) target.streaming = false;
        break;
      }
      case 'TOOL_CALL_START': {
        // parentMessageId 可以不是当前文本段；纯工具轮还可能尚未创建宿主。
        // 显式父 ID 找不到时新建对应消息，绝不将工具挂到无关的 current 上。
        const target = this.findMessage(event.parentMessageId) ?? {
          id: event.parentMessageId ?? this.nextFallbackId(),
          role: 'assistant',
          text: '',
          toolCalls: [],
          streaming: true,
        };
        this.current = target;
        if (!this.messages.includes(target)) this.messages.push(target);
        target.toolCalls.push({
          id: event.toolCallId ?? '',
          name: event.toolCallName ?? '',
          args: '',
        });
        break;
      }
      case 'TOOL_CALL_ARGS': {
        if (event.toolCallId && event.delta) {
          this.args.set(
            event.toolCallId,
            (this.args.get(event.toolCallId) ?? '') + event.delta,
          );
        }
        break;
      }
      case 'TOOL_CALL_END': {
        if (event.toolCallId) {
          const args = this.args.get(event.toolCallId);
          this.args.delete(event.toolCallId);
          for (let i = this.messages.length - 1; i >= 0; i--) {
            const call = this.messages[i]!.toolCalls.find((x) => x.id === event.toolCallId);
            if (call) {
              // 快照可能已携带完整参数；没有新增量时 END 不应将其覆写成 {}。
              call.args = args ?? (call.args || '{}');
              break;
            }
          }
        }
        break;
      }
      case 'TOOL_CALL_RESULT': {
        if (event.toolCallId) {
          for (let i = this.messages.length - 1; i >= 0; i--) {
            const call = this.messages[i]!.toolCalls.find((x) => x.id === event.toolCallId);
            if (call) {
              call.result = event.content ?? '';
              break;
            }
          }
        }
        break;
      }
      case 'MESSAGES_SNAPSHOT': {
        if (event.messages) {
          // 快照是权威替换，旧对象随数组清空而失效；只按原 ID 重新绑定。
          // 若该消息已不在快照中，清空指针，避免后续无 ID 事件写入被移除对象。
          const currentId = this.current?.id;
          const wasStreaming = this.current?.streaming;
          this.messages.length = 0;
          this.messages.push(...projectHistory(event.messages));
          this.current = currentId == null ? undefined : this.findMessage(currentId);
          if (this.current) this.current.streaming = wasStreaming;
        }
        break;
      }
      case 'RUN_ERROR': {
        // RUN_ERROR 是失败终态，message 已由服务端约束为可展示文案；
        // 收尾保留已生成内容与工具卡，不能把错误文本混进模型回复。
        this.error = event.message ?? event.code ?? '运行失败';
        this.settle();
        break;
      }
    }
  }

  /** 运行结束：去除 streaming 标记（拉权威历史失败时保留聚合视图的收尾动作）。 */
  settle(): void {
    for (const message of this.messages) message.streaming = false;
  }
}
