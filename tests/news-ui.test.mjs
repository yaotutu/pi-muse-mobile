import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('新闻阅读页使用真实连接状态、共享控件和安全原文入口', () => {
  const page = read('workspace/NewsPage.tsx');
  for (const name of ['ChoiceChip', 'ActionButton', 'FormInput', 'Card', 'FeedbackNotice']) {
    assert.match(page, new RegExp(`<${name}\\b`));
  }
  assert.match(page, /useNews\(store\)/);
  assert.match(page, /safeMessageUrl\(article\.url\)/);
  assert.match(page, /Linking\.openURL\(url\)/);
  assert.doesNotMatch(page, /WebView|dangerouslySetInnerHTML|chatQuery|spaceId/);
  assert.match(page, /testID=\{`news-view-\$\{view\}`\}/);
  for (const id of ['news-saved-filter', 'news-manage-sources', 'news-refresh-feeds',
    'news-source-url', 'news-source-add', 'news-source-confirm-delete', 'news-comment-input', 'news-comment-submit',
    'news-article-readback', 'news-source-readback', 'news-feed-readback']) assert.match(page, new RegExp(id));
});

test('新闻默认首屏从44dp文字筛选直接进入文章，状态详情留在来源页', () => {
  const page = read('workspace/NewsPage.tsx');
  const iconControl = read('ui/IconControl.tsx');
  const reader = page.split('export function NewsPage(')[1].split('const styles =')[0];
  const sources = page.split('function Sources(')[1].split('export function NewsPage(')[0];
  assert.match(reader, /accessibilityRole="tablist" accessibilityLabel="新闻视图"/);
  assert.match(reader, /accessibilityRole="tab"[\s\S]*?accessibilityState=\{\{ selected: snapshot\.view === view \}\}/);
  assert.match(page, /textTab: \{[\s\S]*?minHeight: l\.smallControl/);
  assert.match(page, /import \{ IconControl \} from '\.\.\/ui\/IconControl'/);
  assert.equal((reader.match(/<IconControl small\b/g) ?? []).length, 3);
  assert.doesNotMatch(page, /ToolbarIcon|styles\.toolbarIcon/);
  assert.match(iconControl, /small \? themeTokens\.layout\.smallControl : themeTokens\.layout\.controlSize/);
  assert.match(iconControl, /accessibilityState=\{\{ disabled: disabled \|\| busy, busy, selected \}\}/);
  assert.match(reader, /selected=\{snapshot\.savedOnly\}[\s\S]*?style=\{snapshot\.savedOnly \? \{ borderColor: colors\.blue \} : undefined\}/);
  assert.match(reader, /busy=\{snapshot\.feedRefreshing\}/);
  assert.match(reader, /snapshot\.articles\.map\(\(article\) => <ArticleCard/);
  assert.doesNotMatch(reader, /今日阅读|从你订阅|<SegmentedControl|来源已就绪|上次抓取|为你推荐|styles\.sectionHeading/);
  assert.match(sources, /snapshot\.status\.failedCount/);
  assert.match(sources, /snapshot\.status\.lastRefreshedAt/);
  assert.match(sources, /snapshot\.status\.lastError/);
  assert.match(reader, /snapshot\.listError && <ActionButton label="重试读取新闻列表"/);
  assert.match(reader, /snapshot\.feedUncertain/);
  assert.equal((page.match(/store\.refreshFeeds\(\)/g) ?? []).length, 1, '只有一个抓取写入口');
});

test('新闻空态、错误和未明状态保留各自操作入口', () => {
  const page = read('workspace/NewsPage.tsx');
  assert.match(page, /snapshot\.view === 'recommended' \? '还没有推荐文章' : '还没有文章'/);
  assert.match(page, /snapshot\.listError/);
  assert.match(page, /snapshot\.sourceError/);
  assert.match(page, /snapshot\.articleError/);
  assert.match(page, /snapshot\.feedUncertain/);
  assert.match(page, /snapshot\.sourceUncertain/);
  assert.match(page, /work\.commentUncertain/);
  assert.match(page, /readbackArticle/);
  assert.match(page, /acknowledgeArticleReadback/);
  assert.match(page, /maxLength=\{4000\}/);
  assert.match(page, /!\(snapshot\.commentDrafts\[id\] \?\? ''\)\.trim\(\)/);
});

test('主导航以新闻替换任务根页，会话活动保留', () => {
  const workspace = read('workspace/WorkspaceScreen.tsx');
  const session = read('workspace/SessionPanel.tsx');
  assert.match(workspace, /\{ id: 'news', label: '新闻'/);
  assert.doesNotMatch(workspace, /\{ id: 'activity', label: '任务'/);
  assert.match(workspace, /<NewsPage\b/);
  assert.match(session, /tab === 'history'.*ActivityPanel/);
});
