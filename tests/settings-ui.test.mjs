import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('连接页保留测试与保存分离、换址确认及迟到响应守卫', () => {
  const source = read('src/workspace/ConnectionPanel.tsx');
  assert.doesNotMatch(source, /YOUR OWN SPACE|连接你的 Pi Muse/);
  assert.match(source, /测试通过，尚未保存/);
  assert.match(source, /const saveEnabled = !!proof && !showConfirmStep && !isLocked/);
  assert.match(source, /const showConfirmStep = isDifferentUrl && !confirmChange/);
  assert.match(source, /清除本地业务数据与旧凭据，但不会删除远端数据/);
  assert.match(source, /当前使用 http 明文传输，访问密钥与业务数据可被网络中间设备读取/);
  assert.match(source, /密钥仅保存在本次表单内存中，关闭面板后清空，不写入设备存储/);
  assert.match(source, /await manager\.testConnection\(url, key\)/);
  assert.match(source, /if \(useSaveServer\) await manager\.saveServer\(url, key, proof\)/);
  assert.match(source, /else await manager\.connect\(url, key, proof\)/);
  assert.match(source, /await manager\.saveServer\(url, ''\)/);
  assert.match(source, /if \(unmountedRef\.current \|\| id !== draftIdRef\.current\) return/);
  assert.match(source, /manager\.cancelTest\(\)/);
  assert.match(source, /const handleCancelChange = useCallback\(\(\) => \{/);
  assert.match(source, /manager\.cancelTest\(\);\s*setUrl\(snapshot\.serverUrl \?\? ''\);\s*setKey\(''\);/);
  assert.match(source, /setProof\(undefined\);\s*setError\(undefined\);\s*setConfirmChange\(false\);/);
  assert.match(source, /onPress=\{handleCancelChange\}/);
  assert.doesNotMatch(source, /onPress=\{\(\) => setConfirmChange\(false\)\}/);
  for (const id of ['confirm', 'confirm-cancel', 'confirm-accept', 'test', 'save', 'retry', 'retry-reset', 'reload']) {
    assert.ok(source.includes(`workspace-connection-${id}`), id);
  }
  assert.match(source, /flexWrap: 'wrap'/);
  assert.match(source, /<Text style=\{styles\.statusUrl\}>/);
});

test('主题由注册表生成单组单选项并保留本机状态提示', () => {
  const source = read('src/theme/ThemePicker.tsx');
  assert.match(source, /availableThemes\.map\(/);
  assert.match(source, /accessibilityRole="radiogroup"/);
  assert.match(source, /accessibilityRole="radio"/);
  assert.match(source, /accessibilityState=\{\{ checked \}\}/);
  assert.match(source, /themeId === theme\.id/);
  assert.match(source, /selectTheme\(theme\.id\)/);
  assert.match(source, /theme\.colors\.canvas/);
  assert.match(source, /theme\.colors\.surface/);
  assert.match(source, /theme\.colors\.blue/);
  assert.match(source, /loading \? '正在恢复本机主题偏好/);
  assert.match(source, /saving \? '正在保存主题偏好/);
  assert.match(source, /error \?\? /);
  assert.match(source, /choices: \{ borderRadius: themeTokens\.radius\.card, backgroundColor: c\.surface/);
  assert.match(source, /radio: \{[^}]*borderRadius: themeTokens\.radius\.round, backgroundColor: c\.surface, overflow: 'hidden'[^}]*\},\s*radioChecked: \{ borderRadius: themeTokens\.radius\.round, backgroundColor: c\.blue \}/);
});

test('更新 Sheet 的全部状态、原动作与取消例外可见', () => {
  const source = read('src/update/UpdateSheet.tsx');
  const actions = source.slice(source.indexOf('function Actions('), source.indexOf('function buildSubtitle('));
  for (const status of ['unsupported', 'idle', 'checking', 'current', 'downloading', 'ready', 'installing', 'cancelled', 'error']) {
    assert.ok(source.includes(`case '${status}':`), status);
  }
  assert.match(actions, /case 'unsupported':[\s\S]*?return null;/);
  assert.match(source, /snapshot\.status !== 'unsupported' && \(/);
  assert.match(actions, /case 'checking':[\s\S]*?<Button onPress=\{onCancel\}>/);
  assert.match(actions, /case 'downloading':[\s\S]*?<Button onPress=\{onCancel\}>/);
  assert.match(actions, /case 'ready':[\s\S]*?onPress=\{onInstall\}[\s\S]*?onPress=\{onOpenSettings\}[\s\S]*?onPress=\{onRetryDownload\}[\s\S]*?onPress=\{onCheck\}/);
  assert.match(actions, /const lock = snapshot\.busy/);
  assert.match(actions, /case 'error':[\s\S]*?case 'check':[\s\S]*?onPress=\{onCheck\}[\s\S]*?case 'download':[\s\S]*?onPress=\{onRetryDownload\}[\s\S]*?case 'install':[\s\S]*?onPress=\{onInstall\}/);
  assert.match(source, /accessibilityRole="progressbar" accessibilityLabel="安装包下载进度"/);
  assert.match(source, /snapshot\.message/);
  assert.match(source, /自动下载会使用当前网络/);
});
