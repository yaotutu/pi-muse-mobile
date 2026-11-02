import { MarkdownContent } from '../ui/MarkdownContent';

/** 聊天独有的思考标签清理不得用于文件阅读，文件阅读始终传入真实原文。 */
export function MessageContent({ text, onMessageLongPress }: { text: string; onMessageLongPress?: () => void }) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return <MarkdownContent text={cleaned} onMessageLongPress={onMessageLongPress} />;
}
