/** 列表只过滤独立的 RSS 链接行并合并段落空白；详情继续展示原始正文。 */
export function newsListExcerpt(content: string): string | null {
  const text = content.split(/\r?\n/)
    .filter((line) => !/^\s*(?:(?:Article|Comments?)\s+URL\s*:\s*)?https?:\/\/\S+\s*$/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text && !/^(?:\.{3,}|…+)$/.test(text) ? text : null;
}

/** 用设备本地日历判断今天/昨天，避免夏令时或午夜边界被固定毫秒数误判。 */
export function newsFeedDateLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, now)) return `今天 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return `昨天 ${time}`;
  return `${date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/** 详情和来源状态使用完整中文日期，无秒，无区域设置造成的 AM/PM 混排。 */
export function newsArticleDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
