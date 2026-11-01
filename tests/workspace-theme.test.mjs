import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { workspaceTheme } from '../src/ui/tokens.ts';
import { availableThemes, DEFAULT_THEME_ID, themeRegistry } from '../src/theme/registry.ts';

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

test('三套主题拥有相同颜色语义，主题身份不再与明暗模式混用', () => {
  assert.deepEqual(availableThemes.map((theme) => theme.id), ['classic', 'light', 'dark']);
  assert.equal(DEFAULT_THEME_ID, 'classic');
  assert.equal(themeRegistry.classic.appearance, 'light');
  assert.equal(themeRegistry.light.appearance, 'light');
  assert.equal(themeRegistry.dark.appearance, 'dark');
  assert.equal('colors' in workspaceTheme, false, '共享几何不能暗中携带某套固定配色');
  for (const theme of availableThemes) {
    assert.equal(themeRegistry[theme.id], theme);
    assert.deepEqual(Object.keys(theme.colors).sort(), Object.keys(themeRegistry.classic.colors).sort());
  }
});

test('经典蓝白恢复 Muse 原色板的浅蓝、淡紫和沙色，不改变白底或其他主题画布', () => {
  const c = themeRegistry.classic.colors;
  assert.equal(c.canvas, '#FFFFFF');
  assert.equal(c.surface, '#EDF7FD');
  assert.equal(c.control, '#ECF5FA');
  assert.equal(c.selected, '#C8E7FF');
  assert.equal(c.userBubble, '#C8E7FF');
  assert.equal(c.assistantBubble, '#EEEEF0');
  assert.equal(c.blue, '#1473C8');
  assert.equal(c.lavender, '#F0EEFA');
  assert.equal(c.sand, '#FAF0DF');
  assert.equal(c.ink, '#172027');
  assert.equal(c.muted, '#606A74');
  assert.equal(c.line, '#DFEAF2');
  assert.equal(c.avatar, '#ECF5FA');
  assert.notEqual(c.canvas, themeRegistry.light.colors.canvas);
  assert.equal(themeRegistry.light.colors.canvas, '#FAFAF7');
  assert.equal(themeRegistry.dark.colors.canvas, '#080909');
});

test('消息、辅助操作和设置图标实际消费恢复后的色板，不把按钮白字带入浅蓝气泡', () => {
  const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
  const chat = read('workspace/ConversationView.tsx');
  assert.match(chat, /userMessage:\s*\{\s*backgroundColor: c\.userBubble/);
  assert.match(chat, /userMessageText: \{ color: c\.onUserBubble \}/);
  assert.match(chat, /assistantMessage:\s*\{\s*backgroundColor: c\.assistantBubble/);
  assert.match(chat, /pendingStatus === 'failed' && styles\.failedMessageText/);
  assert.match(chat, /failedMessageText: \{ color: c\.danger \}/);
  const settings = read('workspace/WorkspaceScreen.tsx');
  for (const tone of ['lavender', 'sand', 'successSoft']) assert.ok(settings.includes(`tone="${tone}"`));
  assert.match(read('ui/ActionButton.tsx'), /colors\.dangerSoft : colors\.blueSoft/);
});

test('会话面板保留头像几何，聊天首条 inset 避开浮层且键盘时缩小', () => {
  const { layout: l, typography: t } = workspaceTheme;
  const identityHeight = l.headerAvatar + 6 + t.name.lineHeight + 3 + t.caption.lineHeight + 8;
  assert.ok(l.headerHeight >= identityHeight, '会话面板信息区需完整显示');
  assert.ok(l.chatContentTop >= l.headerTop + l.controlSize, '首条消息需避开实体灵动岛顶栏');
  assert.ok(l.chatContentTopCompact < l.chatContentTop, '键盘打开时减少顶部 inset');
  assert.equal(l.sessionHeaderBottom, 28, '不缩小连接页共用的标题间距');
});

for (const theme of availableThemes) {
  const mode = theme.id;
  test(`${mode} 普通文字与表面保持可读对比`, () => {
    const c = theme.colors;
    for (const foreground of ['ink', 'muted', 'faint']) {
      for (const background of ['canvas', 'surface', 'assistantBubble']) {
        assert.ok(contrast(c[foreground], c[background]) >= 4.5, `${mode} ${foreground}/${background}`);
      }
    }
    assert.ok(contrast(c.canvas, c.surface) >= 1.05, `${mode} 淡色表面与画布保留层次`);
    assert.ok(contrast(c.canvas, c.line) >= 1.1, `${mode} 细边界保留分组轮廓`);
  });
  test(`${mode} 主按钮和消息分别使用各自可读的前景色`, () => {
    const c = theme.colors;
    assert.equal(c.onAccent, '#FFFFFF');
    assert.ok(contrast(c.onAccent, c.blue) >= 4.5);
    assert.ok(contrast(c.onUserBubble, c.userBubble) >= 4.5);
    assert.ok(contrast(c.accentText, c.selected) >= 4.5);
    for (const background of ['lavender', 'sand']) assert.ok(contrast(c.accentText, c[background]) >= 4.5);
    assert.notEqual(c.selected, c.surface);
  });
  test(`${mode} 语义状态胶囊具有可读前景，不复用按钮蓝作为小字`, () => {
    const c = theme.colors;
    for (const [foreground, background] of [['accentText', 'blueSoft'], ['success', 'successSoft'], ['danger', 'dangerSoft'], ['warning', 'warningSoft']]) {
      assert.ok(contrast(c[foreground], c[background]) >= 4.5, `${mode} ${foreground}/${background}`);
    }
  });
}

test('胶囊按钮、导航与会话 Tab 保留至少 44 点触控区', () => {
  const l = workspaceTheme.layout;
  assert.ok(l.controlSize >= 44 && l.smallControl >= 44);
  assert.ok(l.sessionTabsHeight - l.sessionTabInset * 2 >= 44);
  assert.equal(l.navigationHeight, 66, '四个主页面共用导航高度');
  assert.equal('chatNavigationHeight' in l, false, '不为聊天页保留独立导航高度');
  assert.ok(l.composerHeight >= l.smallControl + l.composerPadding * 2);
});
