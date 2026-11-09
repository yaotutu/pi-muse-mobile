import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { projectStreamingMarkdown as project } from '../src/chat/streaming-markdown.ts';
import { getChatVisibleText } from '../src/chat/chat-visible-text.ts';

// 执行真实 TSX 渲染函数，只替换原生宿主/主题/hooks；不声称这是 Android 布局测试。
const moduleSource = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return moduleSource(`
      export const Text='Text', View='View', Pressable='Pressable', ScrollView='ScrollView';
      export const StyleSheet={create: value=>value, hairlineWidth:1};
      export const Alert={alert:()=>{}};
      export const Linking={openURL: async url => { globalThis.openedMarkdownLinks.push(url); }};
    `);
    if (specifier === 'react' && context.parentURL?.includes('/src/')) return moduleSource(`
      export const useMemo = fn=>fn(), useState = initial=>[initial,()=>{}];
    `);
    if (specifier.endsWith('/theme/ThemeProvider')) return moduleSource(`
      export const useTheme=()=>({colors:new Proxy({}, {get:()=> '#111111'})});
    `);
    if (specifier === 'expo-clipboard') return moduleSource(`
      export const setStringAsync=async text=>{globalThis.copiedMarkdown=text; return true;};
    `);
    if (specifier === 'lucide-react-native') return moduleSource('export const Copy=()=>null, Check=()=>null, AlertCircle=()=>null;');
    return nextResolve(specifier, context);
  },
});
const { MessageContent } = await import('../src/workspace/MessageContent.tsx');
const { MarkdownContent } = await import('../src/ui/MarkdownContent.tsx');

function nativeTree(node) {
  if (Array.isArray(node)) return node.flatMap(nativeTree);
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (typeof node.type === 'function') return nativeTree(node.type(node.props));
  const { children, ...props } = node.props;
  return [{ type: node.type, props, children: nativeTree(children) }];
}
const render = (text, streaming = true, extra = {}) => nativeTree(MessageContent({ text, streaming, ...extra }));
const textOf = (tree) => tree.map((node) => typeof node === 'string' ? node : textOf(node.children)).join('');
function nodes(tree, predicate) {
  return tree.flatMap((node) => typeof node === 'string' ? [] : [...(predicate(node) ? [node] : []), ...nodes(node.children, predicate)]);
}
const snapshot = (tree) => JSON.parse(JSON.stringify(tree));
const bodyText = (text, streaming = true) => textOf(render(text, streaming));
const types = (parts) => parts.map((part) => part.type).filter((type) => type !== 'space');

function assertAppendOnly(text) {
  let previous = '';
  for (let length = 1; length <= text.length; length++) {
    const current = bodyText(text.slice(0, length));
    assert.ok(current.startsWith(previous), `${JSON.stringify(text.slice(0, length))}: ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`);
    previous = current;
  }
  assert.ok(bodyText(text, false).startsWith(previous), '完成仅释放尾部，不撤回已展示文字');
}

test('普通中文每个增量立即展示，不等换行或完成', () => {
  const text = '这是普通中文正文，持续展示。';
  for (let length = 1; length <= text.length; length++) assert.equal(bodyText(text.slice(0, length)), text.slice(0, length));
});

test('原生回排复现：未闭合跨行 code 不先展示四行再压成三行', () => {
  const start = '第一行\n第二行\n`第三行\n第四行';
  assert.equal(bodyText(start), '第一行\n第二行\n');
  assert.equal(bodyText(`${start}\``), '第一行\n第二行\n');
  assert.equal(bodyText(`${start}\`\n第五行`), '第一行\n第二行\n第三行 第四行\n第五行');
  assertAppendOnly(`${start}\`\n第五行`);
});

test('多反引号及可增长的关闭分隔符等待确认字符', () => {
  assert.equal(bodyText('正文 ``a`b'), '正文 ');
  assert.equal(bodyText('正文 ``a`b``'), '正文 ');
  assert.equal(bodyText('正文 ``a`b`` 好'), '正文 a`b 好');
  assertAppendOnly('正文 ``a`b`` 好');
});

test('长 URL link/image 分片不会先展示 URL 再收缩成 label', () => {
  const link = '正文 [短链接](https://example.com/a/very/long/path?q=one&b=two)';
  for (let length = '正文 ['.length; length < link.length; length++) assert.equal(bodyText(link.slice(0, length)), '正文 ');
  assert.equal(bodyText(link), '正文 短链接');
  assertAppendOnly(`${link}。`);
  assertAppendOnly('正文 ![替代文字](https://example.com/remote.png) 完成');
});

test('强调、加粗、删除线及嵌套强调分片保持 append-only', () => {
  for (const text of ['正文 *强调* 完成', '正文 **加粗** 完成', '正文 _强调_ 完成', '正文 ~~删除~~ 完成', '正文 **加粗 *嵌套*** 完成']) assertAppendOnly(text);
  assert.equal(bodyText('正文 **未闭合'), '正文 ');
  assert.equal(bodyText('正文 **闭合** 后续'), '正文 闭合 后续');
});

test('转义标点、实体与非强调下划线保留字面语义', () => {
  assertAppendOnly('正文 \\*不是强调 &amp; snake_case 已结束');
  assert.equal(bodyText('正文 \\*不是强调 &amp; snake_case 已结束'), '正文 *不是强调 & snake_case 已结束');
});

test('未闭合行内语法在空行封口时作为字面量释放，不阻塞下一段', () => {
  assert.equal(bodyText('正文 *未闭合\n\n下一段正在输出'), '正文 *未闭合下一段正在输出');
  assert.equal(bodyText('正文 [未闭合\n\n-'), '正文 [未闭合');
  assert.equal(bodyText('正文 `未闭合', false), '正文 `未闭合');
});

test('被暂存尾部截断的段落保留行占位，闭合后不整体减少已显示行数', () => {
  const start = '第一行\n第二行\n`第三行\n第四行';
  assert.equal(bodyText(start), '第一行\n第二行\n');
  assert.equal(bodyText(`${start}\``), '第一行\n第二行\n');
  const closed = bodyText(`${start}\`\n第五行`);
  assert.ok(closed.startsWith('第一行\n第二行\n'));
  assert.equal(closed.split('\n').length >= 4, true, closed);
  assertAppendOnly(`${start}\`\n第五行`);
});

test('完整稳定段落不随尾部增量改变节点、字体或断行策略', () => {
  const prefix = '稳定的 **加粗** 段落。\n\n';
  const first = snapshot(render(`${prefix}尾部`))[0].children[0];
  for (const tail of ['尾部 *', '尾部 *强调', '尾部 *强调* 后续', '| 表头 |\n| --- |\n', '```ts\nconst a = 1;\n``']) {
    assert.deepEqual(snapshot(render(prefix + tail))[0].children[0], first);
  }
  assert.equal(first.props.textBreakStrategy, 'simple');
});

test('fenced code 正文持续显示，关闭 fence 的每个前缀都不漏出', () => {
  const start = '```ts\nconst a = 1;\n';
  for (const suffix of ['', '`', '``', '```', '``` ', '```\n']) {
    const code = project(start + suffix, true).find((part) => part.type === 'code');
    assert.equal(code.text, 'const a = 1;', suffix);
  }
  assert.equal(project('```ts\nconst a = 12', true)[0].text, 'const a = 12');
  assert.equal(project(`${start}\`x`, true)[0].text, 'const a = 1;\n`x');
  assert.deepEqual(project(`${start}\`\`\`\n后文`, true), project(`${start}\`\`\`\n后文`, false));
});

test('tilde fence、长 fence、代码中的实体和字面标记不被重写', () => {
  assert.equal(project('~~~~text\n<think>&amp;\n~~~', true)[0].text, '<think>&amp;');
  assert.equal(project('~~~~text\n<think>&amp;\n~~~\n', true)[0].text, '<think>&amp;\n~~~');
  assert.equal(project('~~~text\nabc\n~~', true)[0].text, 'abc');
  assert.equal(project('~~~text\nabc\n~~~\n', true)[0].text, 'abc');
});

test('列表、数字列表、任务列表和分隔线的未定前缀等待明确', () => {
  for (const text of ['-', '1', '1.', '*', '---', '#', '>', '- [', '- [x]']) assert.equal(bodyText(text), '', text);
  assert.deepEqual(types(project('- 第一项', true)), ['list']);
  assert.deepEqual(types(project('1. 第一项', true)), ['list']);
  assert.equal(bodyText('- [x] 完成'), '☑完成');
  assert.equal(bodyText('123中文'), '123中文');
  assert.deepEqual(types(project('---\n', true)), ['hr']);
  assertAppendOnly('- 第一项\n- 第二项\n- 第三项');
});

test('列表旧行和嵌套 quote 中的 code/link 尾部稳定', () => {
  const first = snapshot(render('- 第一项\n- 第二项'))[0].children[0].children[0];
  assert.deepEqual(snapshot(render('- 第一项\n- 第二项更长\n- 第三项'))[0].children[0].children[0], first);
  assert.equal(bodyText('> 正文 [label](https://example.com/long'), '正文 ');
  assert.equal(bodyText('> ```ts\n> abc\n> ``'), 'ts复制abc');
});

test('表头与 delimiter 等完整确认，未完成的表格行不改变既有单元格', () => {
  const header = '| 名称 | 值 |\n| --- | --- |\n';
  assert.equal(bodyText('| 名称 |'), '');
  assert.equal(bodyText(header.slice(0, -1)), '');
  assert.deepEqual(types(project(header, true)), ['table']);
  const table = snapshot(render(header));
  for (const row of ['| 新', '| 新值 | 后', '| 新值 | 后值 |']) assert.deepEqual(snapshot(render(header + row)), table);
  assert.equal(project(`${header}| 新值 | 后值 |\n`, true)[0].rows.length, 1);
  const firstRow = project(`${header}| 一 | 二 |\n`, true)[0].rows[0];
  assert.deepEqual(project(`${header}| 一 | 二 |\n| 三 |`, true)[0].rows[0], firstRow);
});

test('非前导 pipe 的表格正文行同样等整行，CRLF 关闭围栏后恢复正文', () => {
  const header = '| 一 | 二 |\n| --- | --- |\n';
  for (const row of ['正文', '正文 | 次列', '正文 | 次列 |']) assert.equal(project(header + row, true)[0].rows.length, 0);
  assert.equal(project(`${header}正文 | 次列\n`, true)[0].rows.length, 1);
  assert.deepEqual(project(`${header}正文 | 次列\n`, true), project(`${header}正文 | 次列\n`, false));
  const fenced = '```text\r\n代码\r\n```\r\n\r\n';
  assert.equal(project(`${fenced}普通正文`, true).at(-1).text, '普通正文');
  assert.deepEqual(project(`${fenced}${header.replaceAll('\n', '\r\n')}`, true), project(`${fenced}${header}`, false));
});

test('非表格 pipe 行确认后按普通正文释放，跨段落不改变前段', () => {
  assert.equal(bodyText('| 只是正文\n不是 delimiter\n'), '| 只是正文\n不是 delimiter');
  const prefix = '前段。\n\n';
  const first = snapshot(render(prefix))[0].children[0];
  assert.deepEqual(snapshot(render(`${prefix}| 标题 |\n| --- |\n| 内容 |\n`))[0].children[0], first);
});

test('setext 与非行首 pipe 表格跨流式/完成/历史采用相同字面展示', () => {
  const source = '第一行\n标题\n---\n\n其他\n===\n\na | b\n--- | ---\nc | d\n';
  const complete = render(source, false);
  assert.deepEqual(snapshot(render(source, true)), snapshot(complete));
  assert.deepEqual(types(project('第一行\n标题\n---\n', false)), ['paragraph']);
  assert.equal(bodyText('第一行\n标题\n---\n', false), '第一行\n标题\n---');
  assertAppendOnly('第一行\n标题\n---\n后文');
  assertAppendOnly('a | b\n--- | ---\nc | d\n');
  assert.equal(project(source, false).some((part) => part.type === 'heading' || part.type === 'table'), false);
});

test('引用式链接不被后来 definition 追溯改写，引用原文不丢失', () => {
  assertAppendOnly('正文 [标签][ref]\n\n[ref]: https://example.com\n');
  assert.equal(bodyText('[标签][ref]\n\n[ref]: https://example.com', false), '[标签][ref][ref]: https://example.com');
});

test('完成仅释放未决尾部，完成视图和重新加载历史视图一致', () => {
  for (const source of ['普通正文', '正文 `跨\n行`', '正文 **加粗**', '正文 [标签](https://example.com)', '正文 `未闭合', '| a | b |\n| --- | --- |\n| c | d |', '```ts\nabc\n```', '```ts\nabc\n`']) {
    const streaming = bodyText(source);
    const complete = render(source, false);
    assert.ok(textOf(complete).startsWith(streaming), source);
    assert.deepEqual(snapshot(complete), snapshot(nativeTree(MessageContent({ text: source }))), source);
  }
});

test('权威非 append 替换、缩短、取消后的完成和过滤缩短不残留旧正文', () => {
  render('原有正文\n\n待撤销 [URL](https://example.com/');
  assert.equal(bodyText('权威替换'), '权威替换');
  assert.equal(bodyText('权'), '权');
  assert.equal(bodyText(''), '');
  assert.equal(bodyText('<think>不允许展示的思考'), '');
  assert.equal(bodyText('正文 *取消', false), '正文 *取消');
  assert.deepEqual(project('更新后的正文', true), project('更新后的正文', false));
});

test('space token 不生成空白 Text，inlinePrefix 跳过 space 只进入首段', () => {
  const tree = nativeTree(MarkdownContent({ text: '\n\n首段\n\n次段', inlinePrefix: '前缀' }));
  const outerTexts = tree[0].children.filter((node) => node.type === 'Text');
  assert.equal(outerTexts.length, 2);
  assert.equal(textOf([outerTexts[0]]), '前缀首段');
  assert.equal(textOf([outerTexts[1]]), '次段');
  assert.equal(nodes(nativeTree(MarkdownContent({ text: '\n\n' })), (node) => node.type === 'Text').length, 0);
});

test('HTML 始终是原样文字，图片不加载，链接仍只允许无凭据 HTTP(S)', async () => {
  globalThis.openedMarkdownLinks = [];
  const text = '<script>alert("x")</script>\n\n<img src="https://example.com/x">\n\n![替代](https://example.com/image) [安全](https://example.com) [脚本](javascript:alert(1)) [凭据](https://user:pass@example.com)';
  const tree = render(text, false);
  assert.ok(textOf(tree).includes('<script>alert("x")</script>'));
  assert.ok(textOf(tree).includes('<img src="https://example.com/x">'));
  assert.ok(textOf(tree).includes('替代 安全 脚本 凭据'));
  assert.equal(nodes(tree, (node) => ['Image', 'WebView', 'img', 'script'].includes(node.type)).length, 0);
  const links = nodes(tree, (node) => node.props.accessibilityRole === 'link');
  assert.equal(links.length, 1);
  links[0].props.onPress();
  await Promise.resolve();
  assert.deepEqual(globalThis.openedMarkdownLinks, ['https://example.com/']);
});

test('唯一 think 过滤入口先于投影；分片标签不泄露，代码字面量保留', () => {
  const source = '<think>隐藏内容</think>正式正文';
  for (let length = 1; length <= source.length; length++) {
    assert.equal(bodyText(source.slice(0, length)), getChatVisibleText(source.slice(0, length)).trimStart());
  }
  for (const text of ['正文 <th', '正文 <think>隐私', '<think>隐藏</think>正文 <thi']) assert.equal(bodyText(text), '正文 ');
  assert.equal(bodyText('`<think>字面量</think>`', false), '<think>字面量</think>');
  assert.equal(bodyText('```text\n<think>字面量</think>\n```', false), 'text复制<think>字面量</think>');
  assert.equal(textOf(nativeTree(MarkdownContent({ text: '<think>共享文件不删除</think>' }))), '<think>共享文件不删除</think>');
});

test('代码复制保持真实代码字符，不复制 fence/Markdown 转义或渲染实体', async () => {
  const tree = render('```html\n<think>&amp; `literal`</think>\n```', false);
  const copy = nodes(tree, (node) => node.props.accessibilityLabel === '复制代码');
  assert.equal(copy.length, 1);
  copy[0].props.onPress();
  await Promise.resolve();
  assert.equal(globalThis.copiedMarkdown, '<think>&amp; `literal`</think>');
});
