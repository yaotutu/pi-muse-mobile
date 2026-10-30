import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('新闻阅读页使用真实连接状态、共享控件和安全原文入口', () => {
  const page = read('workspace/NewsPage.tsx');
  for (const name of ['SegmentedControl', 'ChoiceChip', 'ActionButton', 'FormInput', 'Card', 'FeedbackNotice']) {
    assert.match(page, new RegExp(`<${name}\\b`));
  }
  assert.match(page, /useNews\(store\)/);
  assert.match(page, /safeMessageUrl\(article\.url\)/);
  assert.match(page, /Linking\.openURL\(url\)/);
  assert.doesNotMatch(page, /WebView|dangerouslySetInnerHTML|chatQuery|spaceId/);
  for (const id of ['news-view-recommended', 'news-view-all', 'news-saved-filter', 'news-manage-sources',
    'news-source-url', 'news-source-add', 'news-source-confirm-delete', 'news-comment-input', 'news-comment-submit',
    'news-article-readback', 'news-source-readback', 'news-feed-readback']) assert.match(page, new RegExp(id));
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
