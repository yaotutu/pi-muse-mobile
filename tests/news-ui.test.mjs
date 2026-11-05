import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const { newsActionLocked } = await import('../src/news/news-action-interaction.ts');
const { newsArticleDateLabel, newsFeedDateLabel, newsListExcerpt } = await import('../src/news/news-feed-display.ts');
const { themeTokens } = await import('../src/theme/tokens.ts');

// 本地展示/状态回归不是模型或 Android 原生验收；真实链路另行执行。
test('列表摘要只去除独立 RSS 链接行，不修改详情原文', () => {
  assert.equal(newsListExcerpt('Article URL: https://example.com/a\nComments URL: https://example.com/c'), null);
  assert.equal(newsListExcerpt('https://example.com/a\n...'), null);
  assert.equal(newsListExcerpt('正文一。\nArticle URL: https://example.com/a\n正文二。'), '正文一。 正文二。');
  assert.equal(newsListExcerpt('2 min read\n\nNight Sky Notes'), '2 min read Night Sky Notes');
  assert.equal(newsListExcerpt('正文中的 https://example.com 是参考。'), '正文中的 https://example.com 是参考。');
  assert.match(read('workspace/NewsPage.tsx'), /article\.content \|\| 'RSS 未提供可显示的正文。'/);
});

test('中文时间区分本地今天、昨天、跨月、跨年，详情日期完整且无秒', () => {
  const now = new Date(2026, 10, 5, 0, 1);
  const iso = (...parts) => new Date(...parts).toISOString();
  assert.equal(newsFeedDateLabel(iso(2026, 10, 5, 0, 0, 42), now), '今天 00:00');
  assert.equal(newsFeedDateLabel(iso(2026, 10, 4, 23, 59), now), '昨天 23:59');
  assert.equal(newsFeedDateLabel(iso(2026, 9, 30, 18, 5), now), '10月30日 18:05');
  assert.equal(newsFeedDateLabel(iso(2025, 5, 3, 8, 9), now), '2025年6月3日 08:09');
  assert.equal(newsFeedDateLabel(iso(2025, 11, 31, 23, 59), new Date(2026, 0, 1)), '昨天 23:59');
  assert.equal(newsArticleDateLabel(iso(2026, 10, 5, 10, 3, 59)), '2026年11月5日 10:03');
  assert.equal(newsFeedDateLabel('invalid', now), '时间未知');
  assert.equal(newsArticleDateLabel('invalid'), '时间未知');
});

test('轻列表先来源时间、再标题摘要，反馈行独立，不展示推荐理由或大卡片', () => {
  const page = read('workspace/NewsPage.tsx');
  const card = page.split('function ArticleCard(')[1].split('function UncertainArticle(')[0];
  let previous = -1;
  for (const item of ['article.sourceTitle', 'styles.feedTitle', 'numberOfLines={2}', '</Pressable>', '<NewsArticleActions']) {
    const next = card.indexOf(item);
    assert.ok(next > previous, item);
    previous = next;
  }
  assert.match(card, /onPress=\{\(\) => store\.openArticle\(article\.id\)\}/);
  assert.doesNotMatch(card, /onLongPress|boxShadow|recommendation|newsCard|<Card\b/);
  assert.match(page, /article: \{[^\n]*borderBottomWidth: StyleSheet\.hairlineWidth/);
  assert.ok(themeTokens.newsReading.listTitle.fontSize > themeTokens.newsReading.listExcerpt.fontSize);
});

test('阅读反馈常驻三个独立按钮，显式选中态、命中区和写入保护', () => {
  const actions = read('news/NewsArticleActions.tsx');
  assert.match(actions, /action\('like', ThumbsUp/);
  assert.match(actions, /action\('dislike', ThumbsDown/);
  assert.match(actions, /action\('save', Bookmark/);
  assert.match(actions, /accessibilityState=\{\{ selected, disabled: locked, busy \}\}/);
  assert.match(actions, /disabled=\{locked\}/);
  assert.match(actions, /minHeight: themeTokens\.layout\.smallControl/);
  // 三个操作整组靠右对齐（详情底栏与列表行一致），不再把收藏单独推开或把喜欢留在最左。
  assert.match(actions, /justifyContent: 'flex-end'/);
  assert.doesNotMatch(actions, /marginLeft: 'auto'/);
  assert.match(actions, /onTouchStart=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(actions, /store\.toggleReaction\(article\.id, 'like'\)/);
  assert.match(actions, /store\.toggleSaved\(article\.id\)/);
  assert.doesNotMatch(actions, /onLongPress|<Modal|MessageCircle|onComments/);
  assert.equal(newsActionLocked(), false);
  for (const field of ['reactionWriting', 'savedWriting', 'reactionUncertain', 'savedUncertain']) {
    assert.equal(newsActionLocked({ [field]: true }), true, field);
  }
  assert.equal(newsActionLocked({ reactionReviewed: true, savedReviewed: true }), false);
});

test('详情顶栏只保留返回，讨论与三个反馈同在固定底部操作栏', () => {
  const page = read('workspace/NewsPage.tsx');
  const detail = page.split('function ArticleDetail(')[1].split('function Sources(')[0];
  assert.match(detail, /<Text selectable style=\{\[styles\.body/);
  assert.match(detail, /推荐理由 · \{article\.recommendation\.reason\}/);
  // 顶栏不再有外链按钮和三个点菜单；原文链接入口整体移除。
  assert.doesNotMatch(detail, /ExternalLink|safeMessageUrl|Linking\.openURL|news-original-link|news-detail-more|<ReaderMenu/);
  assert.match(detail, /内容来自 RSS 订阅源。/);
  // 底部固定操作栏：讨论按钮在反馈组左侧，整组靠右；未明回读与讨论核对提示同栏。
  assert.match(detail, /\{article && <View style=\{\[styles\.detailFooter, \{ borderTopColor: colors\.line \}\]\} testID="news-detail-footer">/);
  assert.ok(detail.indexOf('</ScrollView>') < detail.indexOf('<NewsArticleActions'), '反馈行在滚动区之外固定底部');
  assert.ok(detail.indexOf('testID="news-discuss"') < detail.indexOf('<NewsArticleActions'), '讨论按钮在底部栏内');
  assert.ok(detail.indexOf('testID="news-discuss"') > detail.indexOf('</ScrollView>'), '讨论按钮不随正文滚动');
  assert.match(detail, /disabled=\{discussDisabled\}/);
  assert.match(detail, /核对新闻承接会话/);
  assert.ok(detail.indexOf('styles.body,') < detail.indexOf('</ScrollView>'));
  assert.match(page, /detailFooter: \{ borderTopWidth: StyleSheet\.hairlineWidth, paddingHorizontal: l\.sidePadding, paddingVertical: spacing\[6\], gap: spacing\[8\] \},/);
  assert.doesNotMatch(page, /detailActions/);
  assert.doesNotMatch(detail, /numberOfLines|newsListExcerpt|onLongPress|commentDraft|发布评论|<FormInput/);
  assert.ok(themeTokens.newsReading.detailTitle.fontSize < 30);
  assert.ok(themeTokens.newsReading.detailBody.lineHeight > themeTokens.newsReading.listExcerpt.lineHeight);
});

test('推荐全部改为菜单，来源和抓取收进更多，收藏独立且不增加横向导航', () => {
  const page = read('workspace/NewsPage.tsx');
  const reader = page.split('export function NewsPage(')[1].split('const styles =')[0];
  assert.match(reader, /<ReaderMenu[^>]*label="选择新闻内容"/);
  assert.match(reader, /testID="news-filter-menu"/);
  assert.match(reader, /<ReaderMenu label="更多新闻操作"/);
  assert.match(reader, /onPress=\{\(\) => \{ close\(\); store\.setView\(view\); \}\}/);
  assert.match(reader, /accessibilityState=\{\{ selected: snapshot\.savedOnly \}\}/);
  assert.match(reader, /disabled=\{snapshot\.feedRefreshing \|\| snapshot\.feedUncertain \|\| !snapshot\.sources\.length\}/);
  assert.equal((reader.match(/store\.refreshFeeds\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(reader, /tablist|SegmentedControl|为你推荐|今日阅读/);
});

test('列表持续挂载、隐藏时屏蔽触控和读屏，菜单隐藏及卸载废弃迟到测量', () => {
  const page = read('workspace/NewsPage.tsx');
  assert.match(page, /!readingList && styles\.hidden/);
  assert.match(page, /pointerEvents=\{readingList \? 'auto' : 'none'\}/);
  assert.match(page, /importantForAccessibility=\{readingList \? 'auto' : 'no-hide-descendants'\}/);
  assert.match(page, /if \(menu\.visible !== visible\) setMenu\(\{ visible, anchor: null \}\)/);
  assert.match(page, /return \(\) => \{ sequence\.current \+= 1; \}/);
  assert.match(page, /request !== sequence\.current \|\| width <= 0 \|\| height <= 0/);
  assert.match(page, /visible && anchor && <Modal/);
});

test('未明写入回读和显式解锁仍可见，没有评论UI或客户端评论写路径', () => {
  const page = read('workspace/NewsPage.tsx');
  const store = read('news/news-store.ts');
  for (const name of ['listError', 'sourceError', 'articleError', 'feedUncertain', 'sourceUncertain', 'reactionUncertain', 'savedUncertain']) {
    assert.match(page, new RegExp(name));
  }
  assert.match(page, /store\.readbackArticle\(articleId\)/);
  assert.match(page, /store\.acknowledgeArticleReadback\(articleId\)/);
  assert.doesNotMatch(page + store + read('api/http-client.ts'), /setCommentDraft|addNewsComment|deleteNewsComment|news-comment-input|news-comments-open|news-delete-comment/);
  assert.match(read('news/contracts.ts'), /comments: value\.comments\.map\(parseComment\)/, '仍解析当前契约的历史评论，不改后端数据');
});

test('RSS 固定顶栏按入口返回，默认先展示已有来源，添加和精选按需展开', () => {
  const page = read('workspace/NewsPage.tsx');
  const sources = page.split('function Sources(')[1].split('export function NewsPage(')[0];
  assert.match(sources, /<AgentHeader title="RSS 来源" backLabel=\{backToSettings \? '返回新闻设置' : '返回新闻列表'\} onBack=\{onBack\} \/>\s*<ScrollView/);
  assert.doesNotMatch(sources, /styles\.sourceHeading|styles\.sourceTitle|news-sources-back/);
  assert.match(sources, /useState\(!!snapshot\.sourceDraft\.url \|\| !!snapshot\.sourceDraft\.title\)/);
  assert.match(sources, /const adding = showAddSource \|\| snapshot\.sourceWriting \|\| snapshot\.sourceUncertain/);
  assert.match(sources, /\{adding && <Card[\s\S]*news-source-url[\s\S]*\{showPresets && <View/);
  assert.match(sources, /onPress=\{\(\) => store\.setSourceDraft\(\{ url: preset\.url, title: preset\.title \}\)\}/);
  assert.ok(sources.indexOf('已有来源 ·') < sources.indexOf('{adding &&'));
  assert.ok(sources.indexOf('snapshot.sources.map(') < sources.indexOf('styles.sourceStatus'));
  assert.match(sources, /disabled=\{snapshot\.sourceWriting \|\| snapshot\.sourceUncertain\}/);
  assert.match(sources, /setShowAddSource\(!adding\)/);
  assert.doesNotMatch(sources, /setSourceDraft\(\{ url: ''|acknowledgeSourceCreateReadback\(\).*setShow/);
});

test('新闻来源支持推荐中文精选 RSS 源并可一键填入', () => {
  const page = read('workspace/NewsPage.tsx');
  assert.match(page, /PRESET_CHINESE_SOURCES/);
  assert.match(page, /少数派/);
  assert.match(page, /36氪/);
  assert.match(page, /机器之心/);
  assert.match(page, /阮一峰的网络日志/);
  assert.match(page, /IT之家/);
  assert.match(page, /推荐中文来源/);
  assert.match(page, /news-preset-select-/);
  assert.match(page, /store\.setSourceDraft\(\{ url: preset\.url, title: preset\.title \}\)/);
  assert.match(page, /已添加/);
});

test('新闻阅读归属新闻成员，不再有底栏，会话活动保留', () => {
  const workspace = read('workspace/WorkspaceScreen.tsx');
  const session = read('workspace/SessionPanel.tsx');
  assert.match(read('workspace/AgentPage.tsx'), /testID="agent-main-view"/);
  assert.doesNotMatch(workspace, /workspace-read-news/);
  assert.doesNotMatch(workspace, /const NAV:|<Navigation/);
  assert.doesNotMatch(workspace, /\{ id: 'activity', label: '任务'/);
  assert.match(workspace, /<NewsPage\b/);
  assert.match(session, /tab === 'history'.*ActivityPanel/);
});
