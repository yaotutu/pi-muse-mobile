/** 消息反馈只属于 spaceId + sessionId + messageId，不进入聊天历史或模型上下文。 */
export type MessageReaction = 'like' | 'dislike';

export type MessageComment = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageFeedback = {
  reaction: MessageReaction | null;
  comments: MessageComment[];
};

export type MessageFeedbackRole = 'user' | 'assistant';

/** 服务端保留的原始反馈操作；事件包含编辑前后或删除前文本，不由当前反馈反推。 */
export type MessageFeedbackEvent =
  | {
      id: string;
      type: 'reaction_changed';
      messageId: string;
      role: MessageFeedbackRole;
      from: MessageReaction | null;
      to: MessageReaction | null;
      at: string;
    }
  | {
      id: string;
      type: 'comment_added';
      messageId: string;
      role: MessageFeedbackRole;
      commentId: string;
      text: string;
      at: string;
    }
  | {
      id: string;
      type: 'comment_edited';
      messageId: string;
      role: MessageFeedbackRole;
      commentId: string;
      fromText: string;
      toText: string;
      at: string;
    }
  | {
      id: string;
      type: 'comment_deleted';
      messageId: string;
      role: MessageFeedbackRole;
      commentId: string;
      text: string;
      at: string;
    };

export type MessageFeedbackEvents = { events: MessageFeedbackEvent[] };
