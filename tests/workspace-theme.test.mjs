import assert from 'node:assert/strict';
import test from 'node:test';
import { workspacePalettes, workspaceTheme } from '../src/ui/tokens.ts';

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

test('工作区两种主题拥有相同颜色语义，不修改几何或正式主题', () => {
  assert.deepEqual(Object.keys(workspacePalettes.light).sort(), Object.keys(workspacePalettes.dark).sort());
  assert.equal(workspacePalettes.dark, workspaceTheme.colors);
  assert.notEqual(workspacePalettes.light.canvas, workspacePalettes.dark.canvas);
});

test('真实聊天正文避开会话信息区，头像图标在两种主题均清晰', () => {
  assert.ok(workspaceTheme.layout.chatContentTop >= workspaceTheme.layout.headerHeight);
  for (const mode of ['light', 'dark']) {
    const c = workspacePalettes[mode];
    assert.ok(contrast(c.ink, c.avatar) >= 4.5, `${mode} avatar icon`);
  }
});

for (const mode of ['light', 'dark']) {
  test(`${mode} 普通文字与表面保持可读对比`, () => {
    const c = workspacePalettes[mode];
    for (const foreground of ['ink', 'muted', 'faint']) {
      for (const background of ['canvas', 'surface']) {
        assert.ok(contrast(c[foreground], c[background]) >= 3.5, `${mode} ${foreground}/${background}`);
      }
    }
  });
  test(`${mode} 蓝色消息气泡使用独立白色前景`, () => {
    const c = workspacePalettes[mode];
    assert.equal(c.onAccent, '#FFFFFF');
    assert.ok(contrast(c.onAccent, c.blue) >= 4);
    assert.notEqual(c.selected, c.surface);
  });
}
