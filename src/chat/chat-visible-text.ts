/**
 * 聊天专有的思考块（<think>...</think>）投影纯函数。
 *
 * 协议与生命周期边界：
 * 1. 仅用于聊天消息展示（如 MessageContent），不进入文件原文直编或审批预览；
 * 2. 流式生成中，未闭合的 <think> 起的所有内容一律隐藏，避免思考过程泄漏与先漏后删闪烁；
 * 3. 开标签/闭标签分片到达（如 '<', '<th', '</thi' 等）在末尾时不展示，等待完整标签确认；
 * 4. 闭合标签后，正式答案支持增量显示；多 think 块及大小写标签均安全清理；
 * 5. Markdown 中的行内代码（`...`）与围栏代码（```...```）内的字面标签视为文档展示内容予以保留；
 * 6. 严禁按“思考/正在”等关键词误删中文正文，普通尖括号文本（数学对比、HTML 标签等）安全保留。
 */

// 匹配末尾未完成的思考标签前缀（含开/闭标签及部分属性片段）
const INCOMPLETE_TAG_PREFIX = /^<\/?(?:t(?:h(?:i(?:n(?:k\b[^>]*)?)?)?)?)?$/i;
const FENCE_START_REGEX = /^[ ]{0,3}(`{3,}|~{3,})/;
const OPEN_THINK_REGEX = /^<think\b[^>]*>/i;
const CLOSE_THINK_REGEX = /^<\/think\s*>/i;

/** 检查当前位置的字符是否被奇数个反斜杠转义 */
function isEscaped(text: string, pos: number): boolean {
  let backslashes = 0;
  let p = pos - 1;
  while (p >= 0 && text[p] === '\\') {
    backslashes++;
    p--;
  }
  return backslashes % 2 === 1;
}

/** 在行内代码中寻找长度完全匹配 count 个反引号的闭合序列（不跨双换行） */
function findClosingBackticks(text: string, startPos: number, count: number): number {
  let p = startPos;
  const len = text.length;

  while (p < len) {
    // 跨双换行说明中断了段落，CommonMark 规范中行内代码不能跨段落
    if (text[p] === '\n' && p + 1 < len && text[p + 1] === '\n') {
      return -1;
    }

    if (text[p] === '`') {
      let runLen = 0;
      while (p + runLen < len && text[p + runLen] === '`') {
        runLen++;
      }
      if (runLen === count) {
        return p;
      }
      p += runLen;
    } else {
      p++;
    }
  }
  return -1;
}

export function getChatVisibleText(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let result = '';
  let pos = 0;
  const len = text.length;

  while (pos < len) {
    // 1. 围栏代码块检测（必须在行首或文本开头，前导空格 0-3 个）
    if (pos === 0 || text[pos - 1] === '\n') {
      const fenceMatch: RegExpMatchArray | null = text.slice(pos).match(FENCE_START_REGEX);
      if (fenceMatch) {
        const marker: string = fenceMatch[1];
        const markerChar = marker[0];
        const markerLen = marker.length;
        const lineEnd = text.indexOf('\n', pos);

        if (lineEnd === -1) {
          // 处于代码块的首行且尚未换行，整段作为代码保留
          result += text.slice(pos);
          break;
        }

        // 寻找闭合围栏（换行后 0-3 空格 + 相同字符且长度不少于开启围栏）
        const escapedChar = markerChar === '~' ? '~' : '`';
        const closeRegex: RegExp = new RegExp('\\n[ ]{0,3}' + escapedChar + '{' + markerLen + ',}[ ]*\\r?(?:\\n|$)', 'g');
        closeRegex.lastIndex = lineEnd;
        const closeMatch = closeRegex.exec(text);

        if (closeMatch) {
          const fenceEnd = closeMatch.index + closeMatch[0].length;
          result += text.slice(pos, fenceEnd);
          pos = fenceEnd;
        } else {
          // 未闭合的围栏代码块（仍在流式输出中），后续全部作为代码保留
          result += text.slice(pos);
          break;
        }
        continue;
      }
    }

    // 2. 行内代码检测（`...`）
    if (text[pos] === '`' && !isEscaped(text, pos)) {
      let count = 0;
      while (pos + count < len && text[pos + count] === '`') {
        count++;
      }
      const closingPos = findClosingBackticks(text, pos + count, count);
      if (closingPos !== -1) {
        const inlineEnd = closingPos + count;
        result += text.slice(pos, inlineEnd);
        pos = inlineEnd;
      } else if (!text.slice(pos + count).includes('\n\n')) {
        // 未闭合行内代码（仍在流式输出中），作为代码内容保留
        result += text.slice(pos);
        break;
      } else {
        // 跨越双换行说明非合法行内代码，仅保留起始反引号
        result += text.slice(pos, pos + count);
        pos += count;
      }
      continue;
    }

    // 3. 开启思考标签 <think...>
    const openMatch = text.slice(pos).match(OPEN_THINK_REGEX);
    if (openMatch) {
      let depth = 1;
      let scanPos = pos + openMatch[0].length;
      let blockEnd = -1;

      while (scanPos < len) {
        if (text[scanPos] === '<') {
          const rest = text.slice(scanPos);
          const innerOpen = rest.match(OPEN_THINK_REGEX);
          if (innerOpen) {
            depth++;
            scanPos += innerOpen[0].length;
            continue;
          }
          const innerClose = rest.match(CLOSE_THINK_REGEX);
          if (innerClose) {
            depth--;
            scanPos += innerClose[0].length;
            if (depth === 0) {
              blockEnd = scanPos;
              break;
            }
            continue;
          }
        }
        scanPos++;
      }

      if (blockEnd !== -1) {
        pos = blockEnd;
        if (result === '' && pos < len) {
          const leadingWs = text.slice(pos).match(/^[\r\n]+/);
          if (leadingWs) {
            pos += leadingWs[0].length;
          }
        }
      } else {
        // 未闭合或深度未归零的嵌套畸形思考块：全数截断隐藏，确保不泄露
        break;
      }
      continue;
    }

    // 4. 孤立闭合标签 </think...> 处理（丢弃孤立标签，避免在界面裸露）
    const orphanCloseMatch = text.slice(pos).match(CLOSE_THINK_REGEX);
    if (orphanCloseMatch) {
      pos += orphanCloseMatch[0].length;
      continue;
    }

    // 5. 末尾不完整思考标签前缀检测（流式中截断，防止泄漏 '<', '<th' 等）
    const trailing = text.slice(pos);
    if (INCOMPLETE_TAG_PREFIX.test(trailing)) {
      break;
    }

    // 6. 普通文本扫描，前进至下一个可能的控制字符
    let nextPos = pos + 1;
    while (nextPos < len) {
      const ch = text[nextPos];
      if (ch === '`' || ch === '<' || ch === '\n' || ch === '~') {
        break;
      }
      nextPos++;
    }
    result += text.slice(pos, nextPos);
    pos = nextPos;
  }

  return result;
}
