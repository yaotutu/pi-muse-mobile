import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('连接页只有测试和保存主流程，保留换址确认、取消和迟到响应守卫', () => {
  const source = read('src/workspace/ConnectionPanel.tsx');
  assert.doesNotMatch(source, /YOUR OWN SPACE|连接你的 Pi Muse/);
  assert.match(source, /连接正常/);
  assert.match(source, /保存后生效/);
  assert.match(source, /const saveState = connectionSaveAvailability\(/);
  assert.match(source, /const showConfirmStep = saveState\.requiresConfirmation && !confirmChange/);
  assert.match(source, /清除本地业务数据与旧凭据，但不会删除远端数据/);
  assert.match(source, /无法确认原有服务器配置/);
  assert.match(source, /当前使用 http 明文传输，访问密钥与业务数据可被网络中间设备读取/);
  assert.match(source, /密钥仅保存在本次表单内存中，关闭面板后清空，不写入设备存储/);
  assert.match(source, /await manager\.testConnection\(url, key\)/);
  assert.match(source, /await manager\.saveConnection\(url, key, \{ test: proof, confirmChange \}\)/);
  assert.doesNotMatch(source, /saveServer|manager\.connect\(|getPendingKey|onSaveOffline|useSaveServer|仅保存地址|稍后认证|留空沿用当前 Token/);
  assert.match(source, /onChangeText=\{changeKey\}/);
  assert.match(source, /invalidateDraft\(\);\s*setKey\(value\)/);
  assert.match(source, /if \(!ownsConnectionDraft\(id, draftIdRef\.current, unmountedRef\.current\)\) return/);
  assert.match(source, /if \(saved && ownsConnectionDraft\(id, draftIdRef\.current, unmountedRef\.current\)\)/);
  assert.match(source, /runConnectionOperation\(\s*operationRef, manager\.isCritical/);
  assert.match(source, /manager\.cancelTest\(\)/);
  assert.match(source, /const handleCancelChange = useCallback\(\(\) => \{\s*invalidateDraft\(\);\s*setUrl\(snapshot\.serverUrl \?\? ''\);\s*setKey\(''\);/);
  assert.match(source, /onPress=\{snapshot\.status === 'storage-error' \? handleClose : handleCancelChange\}/);
  assert.match(source, /onPress=\{\(\) => setConfirmChange\(true\)\}/);
  for (const id of ['confirm', 'confirm-cancel', 'confirm-accept', 'test', 'save', 'retry', 'retry-reset', 'reload']) {
    assert.ok(source.includes(`workspace-connection-${id}`), id);
  }
  assert.match(source, /label="测试连接"/);
  assert.match(source, /label="保存"/);
  assert.match(source, /text=\{busy \? '保存中' : '保存'\}/);
  assert.match(source, /flexWrap: 'wrap'/);
  assert.match(source, /onRequestClose=\{handleClose\}/);
  assert.match(source, /testID="workspace-connection-cancel-test"/);
});

test('连接与设置 UI 不暴露浏览器地址', () => {
  const panel = read('src/workspace/ConnectionPanel.tsx');
  const screen = read('src/workspace/WorkspaceScreen.tsx');
  assert.doesNotMatch(panel, /browserUrl|saveBrowserUrl|workspace-browser-address/);
  assert.doesNotMatch(screen, /browserUrl|真实浏览器|Linking\.openURL/);
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
  assert.match(actions, /case 'checking':[\s\S]*?<ActionButton label="取消检查" onPress=\{onCancel\}/);
  assert.match(actions, /case 'downloading':[\s\S]*?<ActionButton label="取消下载" onPress=\{onCancel\}/);
  assert.match(actions, /case 'ready':[\s\S]*?onPress=\{onInstall\}[\s\S]*?onPress=\{onOpenSettings\}[\s\S]*?onPress=\{onRetryDownload\}[\s\S]*?onPress=\{onCheck\}/);
  assert.match(actions, /const lock = snapshot\.busy/);
  assert.match(actions, /case 'error':[\s\S]*?case 'check':[\s\S]*?onPress=\{onCheck\}[\s\S]*?case 'download':[\s\S]*?onPress=\{onRetryDownload\}[\s\S]*?case 'install':[\s\S]*?onPress=\{onInstall\}/);
  assert.match(source, /accessibilityRole="progressbar" accessibilityLabel="安装包下载进度"/);
  assert.match(source, /snapshot\.message/);
  assert.match(source, /自动下载会使用当前网络/);
});

test('检查更新失败时保留原错误和重新检查，并提供官方 APK 手动下载入口', () => {
  const source = read('src/update/UpdateSheet.tsx');
  const actions = source.slice(source.indexOf('function Actions('), source.indexOf('function buildSubtitle('));
  const checkActions = actions.slice(actions.indexOf("case 'check':"), actions.indexOf("case 'download':"));
  const releases = read('src/update/releases.ts');

  assert.match(releases, /export const RELEASE_REPOSITORY = 'yaotutu\/pi-muse-mobile'/);
  assert.match(source, /import \{ RELEASE_REPOSITORY \} from '\.\/releases'/);
  assert.match(source, /https:\/\/github\.com\/\$\{RELEASE_REPOSITORY\}\/releases\/latest\/download\/app-release\.apk/);
  assert.match(source, /snapshot\.status === 'error' && snapshot\.errorStage === 'check'/);
  assert.match(source, /<ErrorNotice error=\{snapshot\.error\} \/>/);
  assert.match(source, /\{checkFailed && \([\s\S]*?<Text selectable style=\{styles\.manualUrl\}>\{MANUAL_APK_URL\}<\/Text>/);
  assert.match(checkActions, /label="手动下载 APK" onPress=\{onManualDownload\}[\s\S]*?label="重新检查" onPress=\{onCheck\}/);
  assert.doesNotMatch(checkActions, /onRetryDownload/);
  assert.match(source, /Linking\.openURL\(MANUAL_APK_URL\)\.catch\(\(\) => \{\s*Alert\.alert\('无法打开下载地址'/);
});
