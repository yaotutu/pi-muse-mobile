/** 全部固定在最左；置顶分组优先，各组按有效活动时间排序，同时间使用稳定身份顺序。 */
export function avatarTargets(ids: string[], pinned: readonly string[] = [], recency: Readonly<Record<string, string | null>> = {}) {
  const builtins = ['local-main', 'news-internal', 'sms-internal'];
  const known = new Set(ids);
  const stable = [...builtins.filter((id) => known.has(id)), ...[...known].filter((id) => id !== 'group' && !builtins.includes(id)).sort()];
  const rank = new Map(stable.map((id, index) => [id, index]));
  return ['group', ...stable.sort((a, b) => Number(pinned.includes(b)) - Number(pinned.includes(a)) || (recency[b] ?? '').localeCompare(recency[a] ?? '') || rank.get(a)! - rank.get(b)!)];
}

export function adjacentAvatar(targets: string[], current: string, direction: -1 | 1) {
  const index = targets.indexOf(current);
  return index < 0 ? undefined : targets[index + direction];
}

/** 快速、单指、明显横向移动才切换；慢拖选字与纵向阅读不触发。 */
export function swipeDirection(dx: number, dy: number, elapsed: number): -1 | 1 | undefined {
  if (elapsed > 450 || elapsed < 0 || Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 2) return;
  return dx < 0 ? 1 : -1;
}
