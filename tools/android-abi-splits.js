#!/usr/bin/env node
/**
 * 注入 Android ABI 拆分（CNG 模式专用）。
 *
 * 跑在 `npx expo prebuild --platform android` 之后、`./gradlew assembleRelease` 之前，
 * 修改的是 prebuild 出的临时 android/ 目录（被 .gitignore 忽略，不进 git）。
 *
 * 效果：release 构建额外产出按 CPU 架构拆分的安装包：
 *   - app-armeabi-v7a-release.apk / app-arm64-v8a-release.apk / app-x86-release.apk / app-x86_64-release.apk
 *   - 通用全架构包（AGP 输出 app-universal-release.apk，CI 归一改名为 app-release.apk 上传）
 *
 * 客户端更新模块（src/update/releases.ts）按设备 ABI 选择拆分包，缺失时回退通用包。
 * 本工具只在 CI 注入；本地 prebuild 不运行，开发构建仍为单 APK，不受影响。
 *
 * 幂等：跑多次结果一致（已注入则跳过）。
 */

import fs from 'node:fs';
import path from 'node:path';

const BUILD_GRADLE = path.resolve('android/app/build.gradle');
const SIGNATURE = 'pi-muse-tools: abi splits';

function fail(msg) {
  console.error(`android-abi-splits: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(BUILD_GRADLE)) {
  fail('android/app/build.gradle 不存在，请先跑 `npx expo prebuild --platform android`');
}

let bg = fs.readFileSync(BUILD_GRADLE, 'utf-8');

if (bg.includes(SIGNATURE)) {
  console.log('android-abi-splits: splits 已注入，跳过');
  process.exit(0);
}

// Android 官方 ABI 拆分配置；universalApk 保留全架构通用包给旧版本更新器和手动下载兜底。
const splitsBlock = [
  `    // ${SIGNATURE}（由 tools/android-abi-splits.js 注入，勿手工编辑）`,
  '    splits {',
  '        abi {',
  '            enable true',
  '            reset()',
  '            include "armeabi-v7a", "arm64-v8a", "x86", "x86_64"',
  '            universalApk true',
  '        }',
  '    }',
].join('\n');

const androidOpen = bg.match(/^android\s*\{\s*$/m);
if (!androidOpen) {
  fail('build.gradle 里找不到 android { 块，结构不符合预期');
}

bg = bg.replace(androidOpen[0], `${androidOpen[0]}\n${splitsBlock}`);
fs.writeFileSync(BUILD_GRADLE, bg);
console.log('android-abi-splits: 已在 android {} 内注入 abi splits（4 架构 + universal）');
