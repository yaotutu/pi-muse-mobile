/**
 * assistant 消息的原生 Markdown 展示。Marked 只负责分词，所有节点由 RN 组件绘制；
 * HTML 永远作为字面文字显示，图片只显示替代文字，外链必须经过统一安全校验。
 * 流式文本每次以当前内容重新分词，因此未闭合的 fence/link 会随后续文字自然更新。
 */
import * as Clipboard from 'expo-clipboard';
import { decodeHTML } from 'entities';
import { Copy, Check, AlertCircle } from 'lucide-react-native';
import { marked } from 'marked';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View, type TextProps, type TextStyle } from 'react-native';
import { safeMessageUrl } from '../chat/message-links';
import { useTheme } from '../theme/ThemeProvider';
import { sizing, spacing, workspaceTheme, type WorkspaceColors } from '../ui/tokens';

const { typography: t, radius: r, messageContent: m } = workspaceTheme;

// 此结构只描述 UI 使用的 Marked token 字段；语法识别始终交给 Marked。
type MarkdownToken = {
  type: string;
  text?: string;
  raw?: string;
  lang?: string;
  depth?: number;
  ordered?: boolean;
  start?: number;
  task?: boolean;
  checked?: boolean;
  href?: string;
  tokens?: MarkdownToken[];
  items?: MarkdownToken[];
  header?: MarkdownToken[];
  rows?: MarkdownToken[][];
};

/** 将读屏自定操作放在正文 Text 上，避免气泡容器覆盖正文朗读和子控件焦点。 */
function messageActionAccessibility(onOpen?: () => void): Pick<TextProps, 'accessibilityActions' | 'onAccessibilityAction'> {
  return onOpen ? {
    accessibilityActions: [{ name: 'openMessageActions', label: '打开消息操作' }],
    onAccessibilityAction: (event) => { if (event.nativeEvent.actionName === 'openMessageActions') onOpen(); },
  } : {};
}

export function MessageContent({ text, onMessageLongPress }: { text: string; onMessageLongPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tokens = useMemo(() => {
    try {
      // 部分模型（如 MiniMax）会在输出中夹带 <think> 标签，需过滤掉。
      const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return marked.lexer(cleaned, { gfm: true, breaks: true }) as MarkdownToken[];
    } catch {
      // 即使流中出现暂时不完整的标记，也仍展示原文，不丢失 assistant 回复。
      return [{ type: 'text', text }];
    }
  }, [text]);

  const inline = (parts: MarkdownToken[] | undefined, fallback = ''): ReactNode => {
    if (!parts?.length) return fallback;
    return parts.map((part, index) => {
      const value = part.text ?? part.raw ?? '';
      const key = index;
      switch (part.type) {
        // Marked 18 只解码数字实体。对原始 text token 解码一次，避免把
        // &#38;amp; 先变为 &amp; 再误解成 &；Markdown 转义和代码不走这里。
        case 'text': return <Text key={key}>{decodeHTML(part.raw ?? value)}</Text>;
        case 'strong': return <Text key={key} style={styles.bold}>{inline(part.tokens, value)}</Text>;
        case 'em': return <Text key={key} style={styles.italic}>{inline(part.tokens, value)}</Text>;
        case 'del': return <Text key={key} style={styles.strike}>{inline(part.tokens, value)}</Text>;
        case 'codespan': return <Text key={key} style={styles.inlineCode}>{value}</Text>;
        case 'br': return <Text key={key}>{'\n'}</Text>;
        case 'link': {
          const url = safeMessageUrl(decodeHTML(part.href ?? ''));
          const label = inline(part.tokens, value);
          return url
            ? <Text key={key} accessibilityRole="link" style={styles.link} onLongPress={onMessageLongPress}
              {...messageActionAccessibility(onMessageLongPress)} onPress={() => {
                void Linking.openURL(url).catch(() => Alert.alert('无法打开链接', '请稍后重试。'));
              }}>{label}</Text>
            : <Text key={key}>{label}</Text>;
        }
        case 'image': return <Text key={key}>{inline(part.tokens, value)}</Text>;
        case 'html': return <Text key={key}>{value}</Text>;
        // 包括原始 HTML：不创建 WebView，也不把原文交给 HTML 渲染器。
        default: return <Text key={key}>{part.tokens?.length ? inline(part.tokens, value) : value}</Text>;
      }
    });
  };

  const blocks = (parts: MarkdownToken[]): ReactNode => parts.map((part, index) => {
    const value = part.text ?? part.raw ?? '';
    const key = index;
    switch (part.type) {
      case 'space': return null;
      case 'heading': {
        const headingStyle = part.depth === 1 ? styles.heading1 : part.depth === 2 ? styles.heading2 : styles.heading3;
        return <Text key={key} selectable={!onMessageLongPress} onLongPress={onMessageLongPress}
          {...messageActionAccessibility(onMessageLongPress)} style={[styles.body, headingStyle]}>{inline(part.tokens, value)}</Text>;
      }
      case 'paragraph':
      case 'text': return <Text key={key} selectable={!onMessageLongPress} onLongPress={onMessageLongPress}
        {...messageActionAccessibility(onMessageLongPress)} style={styles.body}>{inline(part.tokens, value)}</Text>;
      case 'code': return <CodeBlock key={key} code={value} language={part.lang} onMessageLongPress={onMessageLongPress} />;
      case 'blockquote': return <View key={key} style={styles.quote}>{blocks(part.tokens ?? [{ type: 'text', text: value }])}</View>;
      case 'list': return <View key={key} style={styles.list}>{part.items?.map((item, itemIndex) => (
        <View key={itemIndex} style={styles.listItem}>
          <Text style={styles.listMarker}>{item.task ? item.checked ? '☑' : '☐' : part.ordered ? `${(part.start ?? 1) + itemIndex}.` : '•'}</Text>
          <View style={styles.listBody}>{blocks(item.tokens ?? [{ type: 'text', text: item.text ?? '' }])}</View>
        </View>
      ))}</View>;
      case 'table': return <MarkdownTable key={key} token={part} inline={inline} onMessageLongPress={onMessageLongPress} />;
      case 'hr': return <View key={key} style={styles.rule} />;
      // 未识别结构及 HTML 保留字面内容；不会执行标签、脚本或图片请求。
      default: return value ? <Text key={key} selectable={!onMessageLongPress} onLongPress={onMessageLongPress}
        {...messageActionAccessibility(onMessageLongPress)} style={styles.body}>{value}</Text> : null;
    }
  });

  return <View style={styles.root}>{blocks(tokens)}</View>;
}

function CodeBlock({ code, language, onMessageLongPress }: { code: string; language?: string; onMessageLongPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [lastCopy, setLastCopy] = useState<{ code: string; status: 'copied' | 'failed' }>();
  const copyState = lastCopy?.code === code ? lastCopy.status : 'idle';
  const copy = async () => {
    try {
      const saved = await Clipboard.setStringAsync(code);
      setLastCopy({ code, status: saved ? 'copied' : 'failed' });
    } catch {
      setLastCopy({ code, status: 'failed' });
    }
  };
  const Icon = copyState === 'copied' ? Check : copyState === 'failed' ? AlertCircle : Copy;
  return <View style={styles.codeBlock}>
    <View style={styles.codeHeader}>
      <Text style={styles.codeLanguage}>{language?.trim() || '代码'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="复制代码" onPress={() => void copy()} style={styles.copyButton}>
        <Icon size={sizing[14]} color={copyState === 'failed' ? colors.danger : colors.muted} />
        <Text style={styles.copyLabel}>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}</Text>
      </Pressable>
    </View>
    <ScrollView horizontal style={styles.horizontalContent} contentContainerStyle={styles.codeScroll} showsHorizontalScrollIndicator>
      {onMessageLongPress
        ? <Text onLongPress={onMessageLongPress} {...messageActionAccessibility(onMessageLongPress)} style={styles.codeText}>{code}</Text>
        : <Text selectable style={styles.codeText}>{code}</Text>}
    </ScrollView>
  </View>;
}

function MarkdownTable({ token, inline, onMessageLongPress }: { token: MarkdownToken; inline: (parts: MarkdownToken[] | undefined, fallback?: string) => ReactNode; onMessageLongPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const rows = [token.header ?? [], ...(token.rows ?? [])];
  return <ScrollView horizontal style={styles.horizontalContent} contentContainerStyle={styles.table} showsHorizontalScrollIndicator>
    {rows.map((row, rowIndex) => <View key={rowIndex} style={styles.tableRow}>
      {row.map((cell, cellIndex) => <View key={cellIndex} style={[styles.tableCell, rowIndex === 0 && styles.tableHeader]}>
        <Text selectable={!onMessageLongPress} onLongPress={onMessageLongPress}
          {...messageActionAccessibility(onMessageLongPress)} style={[styles.tableText, rowIndex === 0 && styles.bold]}>{inline(cell.tokens, cell.text ?? '')}</Text>
      </View>)}
    </View>)}
  </ScrollView>;
}

const createStyles = (c: WorkspaceColors) => StyleSheet.create({
  root: { width: '100%', minWidth: 0, gap: spacing[10] },
  body: { ...t.message, color: c.ink },
  heading1: { ...m.heading1, fontWeight: '700' },
  heading2: { ...m.heading2, fontWeight: '700' },
  heading3: { ...m.heading3, fontWeight: '700' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { color: c.accentText, textDecorationLine: 'underline' },
  inlineCode: { ...t.mono, color: c.ink, backgroundColor: c.control },
  quote: { borderLeftWidth: sizing[3], borderLeftColor: c.blue, paddingLeft: spacing[12], gap: spacing[8] },
  list: { gap: spacing[6] },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[8] },
  listMarker: { ...t.message, color: c.muted },
  listBody: { flex: 1, minWidth: 0, gap: spacing[4] },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginVertical: spacing[4] },
  horizontalContent: { width: '100%', maxWidth: '100%' },
  codeBlock: { width: '100%', maxWidth: '100%', backgroundColor: c.canvas, borderRadius: r.field, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  codeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: sizing.touchTarget, paddingHorizontal: spacing[12], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
  codeLanguage: { ...t.caption, color: c.muted, flex: 1 },
  copyButton: { flexDirection: 'row', alignItems: 'center', gap: spacing[6], minHeight: sizing.touchTarget, paddingLeft: spacing[12] },
  copyLabel: { ...t.caption, color: c.muted },
  codeScroll: { padding: spacing[12] },
  codeText: { ...t.mono, color: c.ink } as TextStyle,
  table: { flexDirection: 'column' },
  tableRow: { flexDirection: 'row' },
  tableCell: { minWidth: m.tableCellMinWidth, maxWidth: m.tableCellMinWidth, padding: spacing[8], borderWidth: StyleSheet.hairlineWidth, borderColor: c.line, justifyContent: 'center' },
  tableHeader: { backgroundColor: c.control },
  tableText: { ...t.detail, color: c.ink },
});
