/** noVNC 页面地址由用户完整填写；不从 API 地址推测 host、端口或路径。 */
export function normalizeBrowserAddress(input: string): string {
  const text = input.trim();
  if (!text) throw new Error('请输入完整的真实浏览器 noVNC 地址');
  // URL 构造器会容忍部分控制字符和反斜杠，这里先拒绝以免保存与用户输入不同的目标。
  if (/[\u0000-\u001f\u007f\\]/.test(text)) throw new Error('浏览器地址包含无效字符');
  if (text.includes('#')) throw new Error('浏览器地址不能包含 # 片段');
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('请输入完整的 http 或 https 浏览器地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('浏览器地址只支持 http:// 或 https://');
  // 连空用户名的 @ 都拒绝；任何页面链接都不应携带 HTTP 凭据。
  const authority = text.match(/^https?:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (authority.includes('@') || url.username) throw new Error('请勿在浏览器地址中包含账号或密码');
  return url.toString();
}
