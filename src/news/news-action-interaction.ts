import type { NewsArticleWork } from './types';

/** 逐篇反馈共用写入/未明结果锁；打开文章和显式回读不受此锁阻止。 */
export function newsActionLocked(work?: NewsArticleWork): boolean {
  return !!(work && (work.reactionWriting || work.savedWriting ||
    work.reactionUncertain || work.savedUncertain));
}
