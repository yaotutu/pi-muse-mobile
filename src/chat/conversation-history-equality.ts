import type { ConversationMessage } from '../api/types';

/** 同 revision 的 feedback 也可能变化；比较完整展示事实，最多检查 4MiB / 100k 节点。 */
export function sameConversationMessages(left: readonly ConversationMessage[], right: readonly ConversationMessage[]): boolean {
  let remaining = 4 * 1024 * 1024;
  let nodes = 100_000;
  const equal = (a: unknown, b: unknown): boolean => {
    if (--nodes < 0) return false;
    if (typeof a === 'string' && typeof b === 'string') {
      remaining -= a.length + b.length;
      return remaining >= 0 && a === b;
    }
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
    const ak = Object.keys(a); const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((key) => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  };
  return equal(left, right);
}
