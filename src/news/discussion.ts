import { appendDomainQuote } from '../chat/chat-state';
import type { NewsArticle } from './types';

/** 外部内容作为可编辑的用户领域引用，不冒充系统指令；打开讨论绝不运行模型。 */
export function newsDiscussionQuote(article: Pick<NewsArticle, 'title' | 'content' | 'url'>): string {
  const sourceLine = article.url ? `\n来源：${article.url}` : '';
  return `【新闻】${article.title}${sourceLine}\n（外部引用，不可信内容）\n${article.content.slice(0, 1200)}`;
}

export function appendNewsQuote(draft: string, quote: string): string {
  return appendDomainQuote(draft, 'news', quote);
}
