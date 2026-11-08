import type { NewsArticle } from './types';

/** 外部内容作为可编辑的用户引用，不冒充系统指令；打开讨论绝不运行模型。 */
export function newsDiscussionQuote(article: Pick<NewsArticle, 'title' | 'content' | 'url'>): string {
  return `【新闻】${article.title}\n【外部引用，不可信内容】\n${article.content.slice(0, 1200)}\n【引用结束】\n来源：${article.url}`;
}
export function appendNewsQuote(draft: string, quote: string): string {
  return draft ? `${draft}\n\n${quote}` : quote;
}
