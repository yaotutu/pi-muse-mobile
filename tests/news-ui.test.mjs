import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const { canOpenMeasuredNewsMenu, createArticlePressGuard, newsActionPresentation } =
  await import('../src/news/news-action-interaction.ts');

test('新闻阅读页使用真实连接状态、共享控件和安全原文入口', () => {
  const page = read('workspace/NewsPage.tsx');
  for (const name of ['ActionButton', 'FormInput', 'Card', 'FeedbackNotice']) {
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

test('新闻长按菜单沿用聊天锚点和反应外观，评论只进入已有详情', () => {
  const page = read('workspace/NewsPage.tsx');
  const actions = read('news/NewsArticleActions.tsx');
  const shared = read('ui/AnchoredFeedbackMenu.tsx');
  assert.match(page, /onPressIn=\{pressGuard\.begin\} onLongPress=/);
  assert.match(page, /if \(pressGuard\.shouldOpen\(\)\) store\.openArticle\(article\.id\)/);
  assert.match(page, /accessibilityActions=\{\[\{ name: 'openNewsActions', label: '打开文章操作' \}\]\}/);
  assert.match(page, /<Text selectable=\{false\} onLongPress=/);
  assert.match(page, /setFocusCommentsId\(id\)/);
  assert.match(page, /scrollRef\.current\?\.scrollTo\(\{ y: commentsY, animated: true \}\)/);
  assert.doesNotMatch(page, /<ArticleActions|<ChoiceChip|你的反馈/);
  assert.match(actions, /<AnchoredFeedbackMenu/);
  assert.match(actions, /<FeedbackReactionPill/);
  assert.match(actions, /<FeedbackMenuRows>/);
  assert.match(actions, /onRequestClose=\{onClose\}/);
  assert.match(actions, /if \(!locked && await store\.toggleReaction\(article\.id, reaction\)\) onClose\(\)/);
  assert.match(actions, /if \(!locked && await store\.toggleSaved\(article\.id\)\) onClose\(\)/);
  assert.match(actions, /onPress=\{onComments\}/);
  assert.match(actions, /news-article-menu-readback/);
  assert.match(actions, /news-article-menu-acknowledge/);
  assert.match(shared, /accessibilityState=\{\{ selected: reaction === value, disabled: locked, busy \}\}/);
  assert.match(shared, /disabled=\{locked\} onPress=/);
  assert.doesNotMatch(actions, /Alert\.alert|BottomSheet/);
});

test('逐篇反馈视图与长按点击隔离按真实状态运行（本地夹具）', () => {
  const empty = { reaction: null, saved: false, comments: [] };
  assert.deepEqual(newsActionPresentation(empty), { reaction: null, saved: false, hasBadge: false, locked: false });
  const active = { reaction: 'like', saved: true, comments: [{ id: 'comment-1' }] };
  assert.deepEqual(newsActionPresentation(active), { reaction: 'like', saved: true, hasBadge: true, locked: false });
  assert.equal(newsActionPresentation({ ...active, reaction: 'dislike' }).reaction, 'dislike');
  for (const field of ['reactionWriting', 'savedWriting', 'commentWriting',
    'reactionUncertain', 'savedUncertain', 'commentUncertain']) {
    assert.equal(newsActionPresentation(active, { [field]: true }).locked, true, field);
  }
  const guard = createArticlePressGuard();
  guard.begin();
  assert.equal(guard.shouldOpen(), true, '普通点击打开详情');
  guard.begin();
  guard.longPress();
  assert.equal(guard.shouldOpen(), false, '长按松手不打开详情');
  guard.begin();
  assert.equal(guard.shouldOpen(), true, '下一次普通点击不被旧手势吞掉');

  const owner = {};
  const request = { sequence: 1, owner, articleId: 'article-1', width: 200, height: 80 };
  const current = { sequence: 1, owner, snapshot: { articleMissing: false,
    selectedArticleId: undefined, articles: [{ id: 'article-1' }] } };
  assert.equal(canOpenMeasuredNewsMenu(request, current), true);
  assert.equal(canOpenMeasuredNewsMenu(request, { ...current, sequence: 2 }), false, '后一次手势使旧测量失效');
  assert.equal(canOpenMeasuredNewsMenu(request, { ...current, owner: {} }), false, '页面或连接归属改变');
  assert.equal(canOpenMeasuredNewsMenu(request, { ...current, snapshot: { ...current.snapshot, articles: [] } }), false, '文章已离开列表');
  assert.equal(canOpenMeasuredNewsMenu({ ...request, width: 0 }, current), false, '卸载的锚点无有效尺寸');
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
