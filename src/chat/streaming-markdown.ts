import { Marked, type Token, type Tokens } from 'marked';

/**
 * 聊天的纯展示投影，不保存正文或分片历史，也不负责 think 清理。
 * 调用方必须先经过 getChatVisibleText；每次仅根据当前事实计算，替换/撤销自然重置。
 *
 * 跨流式、完成和历史使用同一语法：不追溯识别 setext/引用式链接，表格要求行首 |。
 * 这些语法会把已经展示的普通正文改判成另一种结构；共享文件阅读器不受此策略影响。
 */
const markdown = new Marked({
  gfm: true,
  breaks: true,
  tokenizer: {
    reflink() { return undefined; },
    def() { return undefined; },
    table(source) { return /^ {0,3}\|/.test(source) ? false : undefined; },
  },
});

const fenceStart = /^ {0,3}(`{3,}|~{3,})/;
// 只等待可能改变块类型的行首；普通中文不等换行就展示。
const structuralPrefix = /^ {0,3}(?:\d+[.)]?|[-+*_~`#>|]+)?[ \t]*$/;
const taskPrefix = /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+\[(?:[ xX]\]?)?[ \t]*$/;

/** 先暂存未定的块前缀，实际列表、表格和围栏语法仍由 Marked 判断。 */
function blockSafeSource(source: string): string {
  const lines = source.split('\n');
  let offset = 0;
  let fence: string | undefined;
  let table = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const complete = index < lines.length - 1;
    if (table) {
      if (!line.trim()) table = false;
      else {
        // GFM 的后续行不必以 | 开始；整行确认前不能先把单元格内容放错列。
        if (!complete) return source.slice(0, offset);
        // 保守等到空行离开表格，避免自己实现另一套 block 中断语法。
        offset += line.length + 1;
        continue;
      }
    }
    if (fence) {
      const marker = fence[0];
      const candidate = line.trimStart();
      // 未换行的关闭 fence（含 ` / `` 分片）不能先作为代码漏出再被吃掉。
      if (!complete && /^ {0,3}\S/.test(line) && candidate[0] === marker
        && [...candidate.trimEnd()].every((character) => character === marker)) return source.slice(0, offset);
      if (new RegExp(`^ {0,3}${marker}{${fence.length},}[ \\t]*$`).test(line)) fence = undefined;
    } else {
      const opening = line.match(fenceStart);
      if (opening) {
        if (!complete) return source.slice(0, offset);
        fence = opening[1];
      } else if (/^ {0,3}\|/.test(line)) {
        const delimiter = lines[index + 1];
        if (delimiter === undefined || index + 1 === lines.length - 1) return source.slice(0, offset);
        const pair = markdown.lexer(`${line}\n${delimiter}\n`);
        if (pair[0]?.type === 'table') {
          table = true;
          offset += line.length + 1 + delimiter.length + 1;
          index++;
          continue;
        }
      } else {
        if (!complete && (structuralPrefix.test(line) || taskPrefix.test(line))) return source.slice(0, offset);
      }
    }
    offset += line.length + 1;
  }
  return source;
}

/** Marked 已认定为普通 text 的部分，只寻找仍可能成为行内语法的尾部起点。 */
function pendingTextOffset(raw: string): number {
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (character === '`' || (character === '\\' && index === raw.length - 1)) return index;
    if (character === '<' && !raw.slice(index).includes('>')) return index;
    if (character === '!' && index === raw.length - 1) return index;
    if (character === '[' || (character === '!' && raw[index + 1] === '[')) {
      const start = character === '!' ? index + 1 : index;
      let depth = 1;
      let close = start + 1;
      for (; close < raw.length; close++) {
        if (raw[close] === '\\') { close++; continue; }
        if (raw[close] === '[') depth++;
        if (raw[close] === ']' && --depth === 0) break;
      }
      if (depth !== 0 || close + 1 === raw.length || raw[close + 1] === '(') return index;
      index = close;
    } else if ('*_~'.includes(character)) {
      let end = index + 1;
      while (raw[end] === character) end++;
      // 下划线词中不启动强调；其余只等待可能的开分隔符（空白后的标记是字面量）。
      const intraword = character === '_' && /[\p{L}\p{N}]/u.test(raw[index - 1] ?? '');
      if (!intraword && (end === raw.length || !/\s/.test(raw[end]))) return index;
      index = end - 1;
    } else if (character === '&' && /^&(?:#x?[\da-f]*|[a-z]*)$/i.test(raw.slice(index))) {
      // 避免实体从 &amp 分片变为单个字符，已展示的正文不被缩短。
      return index;
    }
  }
  return -1;
}

type InlineProjection = { tokens: Token[]; pending: boolean };
function inlineProjection(parts: Token[], mayGrow = true): InlineProjection {
  const result: Token[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const last = index === parts.length - 1;
    if (part.type === 'text') {
      const pending = pendingTextOffset(part.raw);
      if (pending !== -1) {
        if (pending > 0) result.push({ ...part, raw: part.raw.slice(0, pending), text: part.raw.slice(0, pending) });
        return { tokens: result, pending: true };
      }
    } else if (['em', 'strong', 'del', 'codespan'].includes(part.type)) {
      // 闭合分隔符位于当前 EOF 时仍可能继续增长（* → **、` → ``）。
      // 等下一个确认字符或完成事件；不会在完成时切换另一套 Markdown 解释。
      if (mayGrow && last && /[*_~`]$/.test(part.raw)) return { tokens: result, pending: true };
      if ('tokens' in part && part.tokens && inlineProjection(part.tokens, false).pending) return { tokens: result, pending: true };
    }
    result.push(part);
  }
  return { tokens: result, pending: false };
}

/** Marked 的 paragraph 规则会在 setext 前提前断开，合回相邻正文以免凭空增加段落间距。 */
function normalizeParagraphs(parts: Token[]): Token[] {
  const result: Token[] = [];
  for (let part of parts) {
    if (part.type === 'heading' && !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(part.raw)) {
      const text = part.raw.replace(/\n$/, '');
      part = { type: 'paragraph', raw: part.raw, text, tokens: markdown.Lexer.lexInline(text, markdown.defaults) };
    }
    if (part.type === 'blockquote') part = { ...part, tokens: normalizeParagraphs(part.tokens ?? []) };
    if (part.type === 'list') part = { ...part, items: part.items.map((item: Tokens.ListItem) => ({ ...item, tokens: normalizeParagraphs(item.tokens) })) };
    const previous = result.at(-1);
    if (previous && (previous.type === 'paragraph' || previous.type === 'text') && (part.type === 'paragraph' || part.type === 'text')) {
      const text = `${previous.text}\n${part.text}`;
      result[result.length - 1] = { type: previous.type, raw: previous.raw + part.raw, text, tokens: markdown.Lexer.lexInline(text, markdown.defaults) };
    } else result.push(part);
  }
  return result;
}

function projectBlocks(parts: Token[], open: boolean): Token[] {
  const last = parts.findLastIndex((part) => part.type !== 'space');
  return parts.flatMap((part, index): Token[] => {
    if (!open || index !== last) return [part];
    if (part.type === 'list') {
      const list = part as Tokens.List;
      return [{ ...list, items: list.items.map((item, itemIndex) => itemIndex !== list.items.length - 1 ? item
        : { ...item, tokens: projectStreamingMarkdown(item.text, true) }) }];
    }
    if (part.type === 'blockquote') return [{ ...part, tokens: projectStreamingMarkdown(part.text, true) }];
    if (part.type === 'paragraph' || part.type === 'text' || part.type === 'heading') {
      // 空行或 heading 换行后，未匹配的行内符号只能是字面量，可以安全释放。
      if (/\n[ \t]*\n$/.test(part.raw) || (part.type === 'heading' && part.raw.endsWith('\n'))) return [part];
      const projected = inlineProjection(part.tokens ?? []);
      if (projected.pending && projected.tokens.length) {
        // 被暂存尾段截断的段落保留一个换行占位：释放时只增加内容，不整体降低行数。
        const placeholder = { ...part, raw: `${part.raw}\n`, text: `${part.text}\n`, tokens: projected.tokens };
        return [placeholder];
      }
      return projected.tokens.length ? [{ ...part, tokens: projected.tokens }] : [];
    }
    return [part];
  });
}

/** streaming 只影响未决尾部的释放；同一完成正文与冷启动历史得到完全相同的节点。 */
export function projectStreamingMarkdown(visibleText: string, streaming = false): Token[] {
  // 与 Marked 本身的换行规范化一致，CRLF 分片同样能确认 fence/table 边界。
  const normalized = visibleText.replace(/\r\n?/g, '\n');
  try {
    const source = streaming ? blockSafeSource(normalized) : normalized;
    const parts = normalizeParagraphs(markdown.lexer(source));
    // 段落已由空行封口时，不能因下一个块前缀暂存而继续等待其行内符号。
    return projectBlocks(parts, streaming && !/\n[ \t]*\n$/.test(source));
  } catch {
    // 保持共享阅读器的容错语义：异常时仍只展示经过 think 过滤的字面正文。
    return normalized ? [{ type: 'text', raw: normalized, text: normalized }] : [];
  }
}
