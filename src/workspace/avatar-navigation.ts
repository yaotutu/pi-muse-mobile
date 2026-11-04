/** 头像顺序只取决于身份，不随聊天时间变化，左右切换始终可预测。 */
export function avatarTargets(ids: string[]) {
  const builtins = ['local-main', 'news-internal', 'sms-internal'];
  const known = new Set(ids);
  return ['group', ...builtins.filter((id) => known.has(id)), ...[...known].filter((id) => !builtins.includes(id)).sort()];
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
