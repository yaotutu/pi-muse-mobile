import test from 'node:test';
import assert from 'node:assert/strict';
import { getChatVisibleText } from '../src/chat/chat-visible-text.ts';

test('主会话实证负例回归：代码反引号、嵌套/畸形思考块与转义反引号绝不泄露思考内容', () => {
  // 负例 1：行内代码后紧随思考标签（RegExp 反引号数量量词回归）
  assert.equal(
    getChatVisibleText('`x` <think>HIDDEN_SENTINEL</think>正文'),
    '`x` 正文',
    '闭合行内代码后的思考块必须正确清理，不得泄露 HIDDEN_SENTINEL'
  );

  // 负例 2：嵌套或畸形思考块按深度闭合，不得在内层闭合时提前截断泄露外层剩余思考
  assert.equal(
    getChatVisibleText('<think>outer<think>inner</think>HIDDEN_SENTINEL</think>正文'),
    '正文',
    '嵌套思考块必须在最外层闭合后才展示正文，不得泄露 HIDDEN_SENTINEL'
  );
  // 嵌套且外层未闭合时必须全数隐藏
  assert.equal(
    getChatVisibleText('<think>outer<think>inner</think>HIDDEN_SENTINEL'),
    '',
    '嵌套思考块在外层未闭合时必须全数隐藏'
  );

  // 负例 3：转义反引号不打开代码区，后续思考标签仍正常清理
  assert.equal(
    getChatVisibleText('\\`x <think>HIDDEN_SENTINEL</think>正文'),
    '\\`x 正文',
    '转义反引号不得开启代码区，其后思考块必须被清理'
  );
  // 双反斜杠（转义反斜杠，反引号未被转义）正常开启代码区
  assert.equal(
    getChatVisibleText('\\\\`<think>code</think>`正文'),
    '\\\\`<think>code</think>`正文',
    '双反斜杠后的反引号是有效代码界定符，内部标签应作为字面代码保留'
  );
});

test('重复投影幂等性保障：clean(clean(text)) === clean(text)', () => {
  const sampleTexts = [
    '<think>思考</think>正文',
    '`x` <think>HIDDEN</think>正文',
    '<think>outer<think>inner</think>HIDDEN</think>正文',
    '\\`x <think>HIDDEN</think>正文',
    '```xml\n<think>test</think>\n```',
    '普通正文 1 < 2',
    '',
    '<think>未闭合',
  ];
  for (const text of sampleTexts) {
    const once = getChatVisibleText(text);
    const twice = getChatVisibleText(once);
    assert.equal(twice, once, `重复投影在输入 "${text}" 下不幂等`);
  }
});

test('单字符前缀与代码片段混合流式模拟', () => {
  const stream = '`let a = 1;` <think>推导中...</think>结论';
  for (let i = 0; i <= stream.length; i++) {
    const visible = getChatVisibleText(stream.slice(0, i));
    assert.doesNotMatch(visible, /HIDDEN|推导中/);
    if (i < '`let a = 1;` <think>推导中...</think>'.length) {
      assert.ok(
        '`let a = 1;` '.startsWith(visible) || visible === '`let a = 1;`',
        `在索引 ${i} 出现异常泄露: "${visible}"`
      );
    }
  }
  assert.equal(getChatVisibleText(stream), '`let a = 1;` 结论');
});

test('未闭合思考标签：从 <think> 起的所有内容不展示', () => {
  assert.equal(getChatVisibleText('<think>正在进行深度推导，尚未闭合...'), '');
  assert.equal(getChatVisibleText('前置回答<think>内部思考中...'), '前置回答');
  assert.equal(getChatVisibleText('前置正文\n<think>第1行思考\n第2行思考\n第3行'), '前置正文\n');
});

test('每个字符前缀流式模拟：未闭合思考标签及其内部内容绝不泄漏，且正文增量平滑显示', () => {
  const fullText = '<think>正在深入分析用户需求，推导公式中...</think>这是正式的回答内容。';
  const thinkEndIndex = '<think>正在深入分析用户需求，推导公式中...</think>'.length;

  let lastVisible = '';
  for (let i = 0; i <= fullText.length; i++) {
    const prefix = fullText.slice(0, i);
    const visible = getChatVisibleText(prefix);

    if (i < thinkEndIndex) {
      assert.equal(visible, '', `在字符索引 ${i}（前缀 "${prefix}"）处不应展示思考内容`);
    } else {
      assert.ok(visible.length >= lastVisible.length, `字符索引 ${i} 出现内容长度回退（闪烁）`);
      assert.ok('这是正式的回答内容。'.startsWith(visible), `可见内容 "${visible}" 必须是正式答案的前缀`);
      lastVisible = visible;
    }
  }
  assert.equal(lastVisible, '这是正式的回答内容。');
});

test('前置正文 + 思考块 + 后置正文：逐字符流式模拟全程无闪烁且不泄露思考标签', () => {
  const fullText = '前置说明：\n<think>模型内部思考中...</think>\n正式结果如下。';
  let lastVisible = '';
  for (let i = 0; i <= fullText.length; i++) {
    const prefix = fullText.slice(0, i);
    const visible = getChatVisibleText(prefix);
    assert.doesNotMatch(visible, /<think|<th|<\/|思考中/i);
    if (prefix.startsWith('前置说明：\n<think>') && !prefix.includes('</think>')) {
      assert.equal(visible, '前置说明：\n');
    }
    lastVisible = visible;
  }
  assert.equal(lastVisible, '前置说明：\n\n正式结果如下。');
});

test('开闭标签跨分片：任意分片切分均不泄漏标签片段或内部思考', () => {
  const chunkSplits = [
    ['<', 'think>内部思考</think>答案'],
    ['<th', 'ink>内部思考</think>答案'],
    ['<thi', 'nk>内部思考</think>答案'],
    ['<thin', 'k>内部思考</think>答案'],
    ['<think', '>内部思考</think>答案'],
    ['<think>内部思考<', '/think>答案'],
    ['<think>内部思考</', 'think>答案'],
    ['<think>内部思考</th', 'ink>答案'],
    ['<think>内部思考</thi', 'nk>答案'],
    ['<think>内部思考</thin', 'k>答案'],
    ['<think>内部思考</think', '>答案'],
    ['<', 'think>', '内部思考', '</', 'think>', '答案'],
  ];

  for (const chunks of chunkSplits) {
    let stream = '';
    for (let j = 0; j < chunks.length - 1; j++) {
      stream += chunks[j];
      const visible = getChatVisibleText(stream);
      assert.equal(visible, '', `分片累积 "${stream}" 处泄露了非正式正文: "${visible}"`);
    }
    stream += chunks[chunks.length - 1];
    assert.equal(getChatVisibleText(stream), '答案');
  }
});

test('多思考块与大小写标签安全清理', () => {
  assert.equal(getChatVisibleText('<think>第一段思考</think>回答1<think>第二段思考</think>回答2'), '回答1回答2');
  assert.equal(getChatVisibleText('<THINK>第一段思考</THINK>回答1<Think>第二段思考</Think>回答2'), '回答1回答2');
  assert.equal(getChatVisibleText('<tHiNk>思考</ThInK>正式正文'), '正式正文');
  assert.equal(getChatVisibleText('<think>第一段思考</think>回答1<think>第二段思考未结束'), '回答1');
});

test('think-only、空值与中止前缀', () => {
  assert.equal(getChatVisibleText(''), '');
  assert.equal(getChatVisibleText(null), '');
  assert.equal(getChatVisibleText(undefined), '');
  assert.equal(getChatVisibleText('<think>全思考内容</think>'), '');
  assert.equal(getChatVisibleText('<think>未闭合思考'), '');

  // 中止或流式进行中的未完成标签前缀
  const incompletePrefixes = [
    '<',
    '</',
    '<t',
    '</t',
    '<th',
    '</th',
    '<thi',
    '</thi',
    '<thin',
    '</thin',
    '<think',
    '</think',
    '<THINK',
    '</THINK',
    '<think ',
    '</think ',
  ];

  for (const prefix of incompletePrefixes) {
    assert.equal(getChatVisibleText(prefix), '', `中止前缀 "${prefix}" 应该输出空字符串`);
    assert.equal(getChatVisibleText('正文前置 ' + prefix), '正文前置 ');
  }
});

test('前后合法正文保留完整', () => {
  assert.equal(getChatVisibleText('前置正文 <think>思考过程</think> 后置正文'), '前置正文  后置正文');
  assert.equal(getChatVisibleText('前置正文<think>思考过程</think>后置正文'), '前置正文后置正文');
  assert.equal(getChatVisibleText('前置正文 <think>思考过程未闭合'), '前置正文 ');
});

test('代码中的字面标签：行内代码与围栏代码内的标签必须原样保留', () => {
  // 行内代码
  assert.equal(getChatVisibleText('参考 `<think>` 标签说明'), '参考 `<think>` 标签说明');
  assert.equal(getChatVisibleText('参考 `</think>` 标签说明'), '参考 `</think>` 标签说明');
  assert.equal(getChatVisibleText('示例：`const x = "<think>test</think>";`'), '示例：`const x = "<think>test</think>";`');
  assert.equal(getChatVisibleText('双反引号：``<think>code</think>``示例'), '双反引号：``<think>code</think>``示例');

  // 围栏代码块（```）
  const markdownWithFence = '下面是示例代码：\n```xml\n<think>\n这是配置示例\n</think>\n```\n以上是全部配置。';
  assert.equal(getChatVisibleText(markdownWithFence), markdownWithFence);

  // 波浪线围栏代码块（~~~）
  const tildeFence = '~~~xml\n<think>\n~~~';
  assert.equal(getChatVisibleText(tildeFence), tildeFence);

  // 流式输出中尚未闭合的代码块（其中的 <think> 应作为代码保留而非思考块）
  const streamingFence = '代码片段：\n```html\n<think>';
  assert.equal(getChatVisibleText(streamingFence), streamingFence);
});

test('普通尖括号文本与正常中文绝不误删', () => {
  assert.equal(getChatVisibleText('1 < 2 && 3 > 2'), '1 < 2 && 3 > 2');
  assert.equal(getChatVisibleText('联系方式：<support@example.com>'), '联系方式：<support@example.com>');
  assert.equal(getChatVisibleText('HTML 表格：<table><tr><th>表头</th></tr></table>'), 'HTML 表格：<table><tr><th>表头</th></tr></table>');
  assert.equal(getChatVisibleText('正在思考解决方案，请稍等...'), '正在思考解决方案，请稍等...');
  assert.equal(getChatVisibleText('这个方案需要深入思考：第一步...'), '这个方案需要深入思考：第一步...');
  assert.equal(getChatVisibleText('<thinking>不是 think 标签</thinking>'), '<thinking>不是 think 标签</thinking>');
  assert.equal(getChatVisibleText('<thought>思考记录</thought>'), '<thought>思考记录</thought>');
});

test('工具结果与合成分片回归：未闭合块隐藏，闭合后仅显示正式正文', () => {
  assert.equal(
    getChatVisibleText('工具执行成功，结果为: <think>thought</think>{"code":0}'),
    '工具执行成功，结果为: {"code":0}'
  );

  // 合成纯函数回归，不保存真实模型思考原文；明确保证首块确实未闭合。
  const chunk1 = '<think>' + 'x'.repeat(56);
  assert.equal(chunk1.length, 63);
  assert.ok(!chunk1.includes('</think>'));
  assert.equal(getChatVisibleText(chunk1), '');
  const chunk2 = chunk1 + '</think>已为您完成状态查询。';
  assert.equal(getChatVisibleText(chunk2), '已为您完成状态查询。');
});

test('CRLF 代码围栏闭合后继续清理思考块，不误把后续正文当代码', () => {
  const code = '```xml\r\n<think>字面代码</think>\r\n```\r\n';
  assert.equal(getChatVisibleText(code + '<think>HIDDEN_SENTINEL</think>正文'), code + '正文');
});
