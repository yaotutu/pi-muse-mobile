/** 列表只过滤独立的 RSS 链接行并合并段落空白；详情继续展示原始正文。 */
export function newsListExcerpt(content: string): string | null {
  const text = content.split(/\r?\n/)
    .filter((line) => !/^\s*(?:(?:Article|Comments?)\s+URL\s*:\s*)?https?:\/\/\S+\s*$/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text && !/^(?:\.{3,}|…+)$/.test(text) ? text : null;
}

/** 列表元信息按设备本地时间简写；跨年时保留年份，详情仍用完整时间。 */
export function newsFeedDateLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const year = date.getFullYear();
  const day = `${date.getMonth() + 1}/${date.getDate()}`;
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year === now.getFullYear() ? '' : `${year}/`}${day} ${hour}:${minute}`;
}
