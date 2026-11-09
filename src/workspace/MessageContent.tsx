import { MarkdownContent } from '../ui/MarkdownContent';
import { useMemo, type ReactNode } from 'react';
import { getChatVisibleText } from '../chat/chat-visible-text';
import { projectStreamingMarkdown } from '../chat/streaming-markdown';

/** 聊天独有的思考标签清理不得用于文件阅读，文件阅读始终传入真实原文。 */
export function MessageContent({ text, streaming = false, compact = false, inlinePrefix, onMessageLongPress }: { text: string; streaming?: boolean; compact?: boolean; inlinePrefix?: ReactNode; onMessageLongPress?: () => void }) {
  // 先清理再分词，不缓存已撤销的正文，也不让暂存尾部绕过思考过滤入口。
  // 仅去掉开头空白；末尾换行是列表/围栏等流式结构的确认边界。
  const cleaned = getChatVisibleText(text).trimStart();
  const tokens = useMemo(() => projectStreamingMarkdown(cleaned, streaming), [cleaned, streaming]);
  return <MarkdownContent text={cleaned} projectedTokens={tokens} compact={compact} inlinePrefix={inlinePrefix} onMessageLongPress={onMessageLongPress} />;
}
