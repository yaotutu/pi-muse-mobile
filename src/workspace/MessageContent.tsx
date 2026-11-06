import { MarkdownContent } from '../ui/MarkdownContent';
import type { ReactNode } from 'react';
import { getChatVisibleText } from '../chat/chat-visible-text';

/** 聊天独有的思考标签清理不得用于文件阅读，文件阅读始终传入真实原文。 */
export function MessageContent({ text, compact = false, inlinePrefix, onMessageLongPress }: { text: string; compact?: boolean; inlinePrefix?: ReactNode; onMessageLongPress?: () => void }) {
  // 未闭合的思考块也隐藏；共享 Markdown 阅读器和用户原文不使用此投影。
  const cleaned = getChatVisibleText(text).trim();
  return <MarkdownContent text={cleaned} compact={compact} inlinePrefix={inlinePrefix} onMessageLongPress={onMessageLongPress} />;
}
