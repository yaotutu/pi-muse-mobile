import type { ConversationAttachment, MessageAttachmentInput } from '../api/types';

/**
 * 客户端持有的完整附件草稿。dataBase64 是原始字节的逐字节编码，不是本地文件路径；
 * 重试时必须原样提交，不能依赖系统选择器的临时读权限。
 */
export type AttachmentDraft = {
  id: string;
  name: string;
  kind: 'image' | 'text';
  mimeType: string;
  size: number;
  dataBase64: string;
  /** 仅图片草稿提供本地预览；文本正文永不进入消息气泡。 */
  image?: ConversationAttachment['image'];
};

export type AttachmentDraftUpdateResult =
  | { ok: true }
  | { ok: false; error: string };

export type PickMessageAttachmentsResult =
  | { status: 'cancelled' }
  | { status: 'selected'; attachments: AttachmentDraft[] }
  | { status: 'error'; message: string };

export type { MessageAttachmentInput };
