import assert from 'node:assert/strict';
import test from 'node:test';
import { museAvatar, workspaceTheme } from '../src/ui/tokens.ts';
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

test('经典蓝白恢复原有白底、冷灰及深色文字，不复用暖白主题', () => {
  const c = themeRegistry.classic.colors;
  assert.equal(c.canvas, '#FFFFFF');
  assert.equal(c.surface, '#F2F3F5');
  assert.equal(c.control, '#E9EBEF');
  assert.equal(c.selected, '#DDE1E7');
  assert.equal(c.ink, '#172027');
  assert.equal(c.muted, '#606A74');
  assert.equal(c.line, '#E1E5EA');
  assert.equal(c.avatar, '#F6F4F7');
  assert.notEqual(c.canvas, themeRegistry.light.colors.canvas);
  assert.equal(themeRegistry.light.colors.canvas, '#FAFAF7');
  assert.equal(themeRegistry.dark.colors.canvas, '#080909');
});

test('会话信息区为头像、名称和状态独立留足空间，原创头像保持清晰', () => {
  const { layout: l, typography: t } = workspaceTheme;
  assert.ok(l.headerHeight >= l.headerAvatar + t.name.lineHeight + t.caption.lineHeight + l.contentTop);
  assert.ok(contrast(museAvatar.eye, museAvatar.face) >= 4.5);
});

for (const theme of availableThemes) {
  const mode = theme.id;
  test(`${mode} 普通文字与表面保持可读对比`, () => {
    const c = theme.colors;
    for (const foreground of ['ink', 'muted', 'faint']) {
      for (const background of ['canvas', 'surface']) {
        assert.ok(contrast(c[foreground], c[background]) >= 4.5, `${mode} ${foreground}/${background}`);
      }
    }
  });
  test(`${mode} 蓝色消息气泡使用独立白色前景`, () => {
    const c = theme.colors;
    assert.equal(c.onAccent, '#FFFFFF');
    assert.ok(contrast(c.onAccent, c.blue) >= 4.5);
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
  assert.ok(l.navigationHeight >= 44);
  assert.ok(l.composerHeight >= l.smallControl + l.composerPadding * 2);
});
