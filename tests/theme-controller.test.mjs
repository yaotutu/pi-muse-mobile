import assert from 'node:assert/strict';
import test from 'node:test';
import { isThemeId } from '../src/theme/registry.ts';
import { parseThemePreference, ThemeController } from '../src/theme/theme-controller.ts';

const encoded = (themeId, lastLightThemeId = 'classic') => JSON.stringify({ version: 1, themeId, lastLightThemeId });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(raw = null, extra = {}) {
  const written = [];
  const controller = new ThemeController({ read: async () => raw, write: async (value) => { written.push(value); }, ...extra });
  return { controller, written };
}

test('没有主题偏好时默认经典蓝白，不为默认值自动写盘', async () => {
  const { controller, written } = fixture();
  await controller.load();
  assert.deepEqual(controller.state.selection, { themeId: 'classic', lastLightThemeId: 'classic' });
  assert.equal(controller.state.loading, false);
  assert.deepEqual(written, []);
});

test('损坏、未知版本、旧主题和原型属性不能被当作合法主题', () => {
  for (const value of [null, '', 'bad', '[]', 'null', '"dark"', '{}', encoded('removed'), encoded('__proto__'), encoded('toString'), '{"version":2,"themeId":"dark"}']) {
    assert.equal(parseThemePreference(value).themeId, 'classic', String(value));
  }
  for (const value of [null, undefined, {}, '__proto__', 'constructor', 'toString']) assert.equal(isThemeId(value), false);
});

test('恢复深色时保留之前选择的浅色，无效浅色记忆安全回到经典', () => {
  assert.deepEqual(parseThemePreference(encoded('dark', 'light')), { themeId: 'dark', lastLightThemeId: 'light' });
  for (const value of ['dark', 'removed', '__proto__', null]) {
    assert.equal(parseThemePreference(encoded('dark', value)).lastLightThemeId, 'classic');
  }
  assert.equal(parseThemePreference(encoded('light', 'classic')).lastLightThemeId, 'light');
});

test('三套主题独立可选，主题切换立即生效且只保存白名单字段', async () => {
  const { controller, written } = fixture();
  await controller.load();
  for (const id of ['light', 'dark', 'classic']) {
    controller.selectTheme(id);
    assert.equal(controller.state.selection.themeId, id);
    await controller.whenSaved();
    assert.equal(controller.state.error, undefined);
  }
  assert.deepEqual(written.map(JSON.parse).map((v) => v.themeId), ['light', 'dark', 'classic']);
  for (const raw of written) assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['lastLightThemeId', 'themeId', 'version']);
});

test('亮暗快捷键返回经典蓝白，不会错误返回晨光白', async () => {
  const { controller } = fixture();
  await controller.load();
  controller.toggleAppearance();
  assert.equal(controller.state.selection.themeId, 'dark');
  controller.toggleAppearance();
  assert.equal(controller.state.selection.themeId, 'classic');
  await controller.whenSaved();
});

test('亮暗快捷键也记住晨光白，冷启动恢复后仍返回该主题', async () => {
  const { controller, written } = fixture();
  await controller.load();
  controller.selectTheme('light');
  controller.toggleAppearance();
  await controller.whenSaved();
  const restored = fixture(written.at(-1)).controller;
  await restored.load();
  assert.equal(restored.state.selection.themeId, 'dark');
  restored.toggleAppearance();
  assert.equal(restored.state.selection.themeId, 'light');
  await restored.whenSaved();
});

test('恢复中的迟到读取不能覆盖用户刚选的主题', async () => {
  const gate = deferred();
  const { controller, written } = fixture(null, { read: () => gate.promise });
  const loading = controller.load();
  controller.selectTheme('light');
  gate.resolve(encoded('dark'));
  await loading; await controller.whenSaved();
  assert.equal(controller.state.selection.themeId, 'light');
  assert.equal(controller.state.loading, false);
  assert.equal(JSON.parse(written.at(-1)).themeId, 'light');
});

test('恢复完成前明确选择默认经典主题同样使旧读取失效', async () => {
  const gate = deferred();
  const { controller } = fixture(null, { read: () => gate.promise });
  const loading = controller.load();
  controller.selectTheme('classic');
  gate.resolve(encoded('dark'));
  await loading; await controller.whenSaved();
  assert.equal(controller.state.selection.themeId, 'classic');
});

test('首次读取开始前已选择主题，也不会被存储旧值覆盖', async () => {
  const { controller } = fixture(encoded('dark'));
  controller.selectTheme('light');
  await controller.load(); await controller.whenSaved();
  assert.equal(controller.state.selection.themeId, 'light');
});

test('恢复中的迟到错误不显示成最新选择的错误', async () => {
  const gate = deferred();
  const { controller } = fixture(null, { read: () => gate.promise });
  const loading = controller.load();
  controller.selectTheme('light');
  gate.reject(new Error('late read'));
  await loading; await controller.whenSaved();
  assert.equal(controller.state.error, undefined);
});

test('快速连续选择按顺序保存，最终落盘与当前主题一致', async () => {
  const gate = deferred();
  const writes = [];
  const { controller } = fixture(null, { write: async (raw) => {
    writes.push(JSON.parse(raw).themeId);
    if (writes.length === 1) await gate.promise;
  } });
  await controller.load();
  controller.selectTheme('light'); controller.selectTheme('dark'); controller.selectTheme('classic');
  assert.equal(controller.state.selection.themeId, 'classic');
  await Promise.resolve();
  assert.deepEqual(writes, ['light']);
  gate.resolve(); await controller.whenSaved();
  assert.deepEqual(writes, ['light', 'dark', 'classic']);
  assert.equal(controller.state.saving, false);
});

test('旧写入失败不污染最新选择，队列仍保存新主题', async () => {
  const gate = deferred();
  const writes = [];
  const { controller } = fixture(null, { write: async (raw) => {
    writes.push(JSON.parse(raw).themeId);
    if (writes.length === 1) await gate.promise;
  } });
  await controller.load();
  controller.selectTheme('light'); controller.selectTheme('dark');
  await Promise.resolve(); gate.reject(new Error('old write'));
  await controller.whenSaved();
  assert.deepEqual(writes, ['light', 'dark']);
  assert.equal(controller.state.selection.themeId, 'dark');
  assert.equal(controller.state.error, undefined);
});

test('保存失败保留可用主题并明确提示，重新选择同主题可以重试', async () => {
  let attempts = 0;
  const { controller } = fixture(null, { write: async () => { if (++attempts === 1) throw new Error('storage unavailable'); } });
  await controller.load();
  controller.selectTheme('dark'); await controller.whenSaved();
  assert.equal(controller.state.selection.themeId, 'dark');
  assert.match(controller.state.error, /未能保存/);
  controller.selectTheme('dark'); await controller.whenSaved();
  assert.equal(attempts, 2);
  assert.equal(controller.state.error, undefined);
});

test('读取失败不影响使用或切换，用户选择可以恢复正常保存', async () => {
  const { controller } = fixture(null, { read: async () => { throw new Error('denied'); } });
  await controller.load();
  assert.equal(controller.state.selection.themeId, 'classic');
  assert.match(controller.state.error, /读取失败/);
  controller.selectTheme('light'); await controller.whenSaved();
  assert.equal(controller.state.error, undefined);
});

test('重复读取幂等，已保存的重复选择及无效主题不额外写盘', async () => {
  let reads = 0;
  const { controller, written } = fixture(null, { read: async () => { reads++; return null; } });
  const first = controller.load(); assert.equal(controller.load(), first); await first;
  controller.selectTheme('classic'); controller.selectTheme('__proto__');
  await controller.whenSaved();
  assert.equal(reads, 1);
  assert.deepEqual(written, []);
});

test('偏好恢复与保存的订阅可清理，不会在卸载后更新界面', async () => {
  const { controller } = fixture();
  let count = 0;
  const unsubscribe = controller.subscribe(() => { count++; });
  await controller.load();
  assert.equal(count, 1); unsubscribe();
  controller.selectTheme('dark'); await controller.whenSaved();
  assert.equal(count, 1);
});
