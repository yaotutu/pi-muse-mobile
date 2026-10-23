/** 只验证消息中的链接，不承担打开行为；非 HTTP(S) 与带凭据地址一律拒绝。 */
export function safeMessageUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
