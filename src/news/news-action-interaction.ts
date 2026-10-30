import type { NewsArticleWork, NewsFeedback, NewsSnapshot } from './types';

/** 新闻逐篇写操作共用同一串行锁；读评论和回读核对不受此锁阻止。 */
export function newsActionLocked(work?: NewsArticleWork): boolean {
  return !!work && (work.reactionWriting || work.savedWriting || work.commentWriting ||
    work.reactionUncertain || work.savedUncertain || work.commentUncertain);
}

/** 徽标只在已有反馈时出现，菜单选中态直接取权威反馈。 */
export function newsActionPresentation(feedback: NewsFeedback, work?: NewsArticleWork) {
  return {
    reaction: feedback.reaction,
    saved: feedback.saved,
    hasBadge: feedback.reaction !== null || feedback.saved || feedback.comments.length > 0,
    locked: newsActionLocked(work),
  };
}

/** 某些原生触控路径会在长按松手后再派发 press；每次触摸开始先重置标记。 */
export function createArticlePressGuard() {
  let longPressed = false;
  return {
    begin: () => { longPressed = false; },
    longPress: () => { longPressed = true; },
    shouldOpen: () => !longPressed,
  };
}

/** 测量异步返回时核对页面归属和当前文章，避免在换页后弹出旧目标菜单。 */
export function canOpenMeasuredNewsMenu(
  request: { sequence: number; owner: object; articleId: string; width: number; height: number },
  current: { sequence: number; owner: object; snapshot: Pick<NewsSnapshot, 'articleMissing' | 'selectedArticleId' | 'articles'> },
): boolean {
  return request.sequence === current.sequence && request.owner === current.owner &&
    request.width > 0 && request.height > 0 && !current.snapshot.articleMissing &&
    (current.snapshot.selectedArticleId === request.articleId ||
      current.snapshot.articles.some((article) => article.id === request.articleId));
}
