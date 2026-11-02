import type { SpaceEntry } from '../api/types';
import { MAIN_SPACE } from '../spaces/space-state';

/** 服务端没有标题；首次见到空间时按时间排序分配空间编号，刷新不会重排已有编号。 */
export class SpaceLabels {
  constructor(private readonly labels = new Map<string, number>()) {}
  sync(spaces: SpaceEntry[]): SpaceLabels {
    const known = new Set(spaces.map((space) => space.id));
    const updated = new Map([...this.labels].filter(([id]) => known.has(id)));
    const next = Math.max(0, ...updated.values()) + 1;
    spaces.filter((space) => space.id !== MAIN_SPACE && !isBuiltinMember(space.id) && !updated.has(space.id))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
      .forEach((space, index) => updated.set(space.id, next + index));
    if (updated.size === this.labels.size && [...updated].every(([id, number]) => this.labels.get(id) === number)) return this;
    return new SpaceLabels(updated);
  }
  title(id: string) { return id === MAIN_SPACE ? 'Muse' : id === 'news-internal' ? '新闻' : id === 'sms-internal' ? '短信' : `成员 ${this.labels.get(id) ?? '…'}`; }
}

/** 头部只把非主空间的编号当作名称；聊天键盘打开时连名称浮层一起收起。 */
export function headerSpaceNames(labels: SpaceLabels, spaceId: string, keyboardVisible: boolean) {
  const name = spaceId === MAIN_SPACE ? null : labels.title(spaceId);
  return { chat: keyboardVisible ? null : name, session: name };
}

export function spaceTime(updatedAt: string) {
  const date = new Date(updatedAt);
  const time = date.getTime();
  if (Number.isNaN(time)) return '时间未知';
  return time === 0 ? '暂无聊天' : date.toLocaleString();
}

export function isBuiltinMember(id: string) { return id === 'news-internal' || id === 'sms-internal'; }
export function memberDescription(id: string) {
  return id === MAIN_SPACE ? '日常对话与协作，让 Muse 帮你安排。' : id === 'news-internal' ? '阅读新闻、整理资讯，和我聊聊你关心的内容。' : id === 'sms-internal' ? '整理短信、筛选重要信息，保留你自己的偏好。' : '独立的对话、文件与规则，专注处理自己的事情。';
}
