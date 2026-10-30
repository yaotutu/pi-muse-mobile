import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  hasArm64Architecture,
  isExplicitUnsignedEvidence,
  parseArguments,
  validateInfoPlist,
  validateZipLayout,
} from '../tools/package-ios-unsigned.mjs';

const script = fs.readFileSync(new URL('../tools/package-ios-unsigned.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('打包脚本保留 macOS 原生校验与固定 IPA 名称', () => {
  assert.match(script, /\/usr\/bin\/plutil/);
  assert.match(script, /\/usr\/bin\/lipo/);
  assert.match(script, /\/usr\/bin\/codesign/);
  assert.match(script, /\/usr\/bin\/unzip/);
  assert.match(script, /Payload/);
  assert.equal(parseArguments(['--app', 'build/PiMuse.app', '--output', 'dist/app-release-unsigned.ipa']).app, 'build/PiMuse.app');
  assert.throws(() => parseArguments(['--app', 'build/PiMuse.app', '--output', 'dist/other.ipa']), /app-release-unsigned\.ipa/);
});

test('Info.plist 校验拒绝缺失主程序元数据', () => {
  const validInfo = {
    CFBundleIdentifier: 'com.example.app',
    CFBundleExecutable: 'App',
    CFBundleShortVersionString: '1.0.0',
    CFBundleVersion: '1',
    CFBundlePackageType: 'APPL',
    CFBundleSupportedPlatforms: ['iPhoneOS'],
  };
  assert.equal(validateInfoPlist(validInfo), true);
  assert.throws(() => validateInfoPlist({ ...validInfo, CFBundleVersion: '' }), /CFBundleVersion/);
  assert.throws(() => validateInfoPlist({ ...validInfo, CFBundleExecutable: '../App' }), /CFBundleExecutable/);
  assert.throws(() => validateInfoPlist({ ...validInfo, CFBundlePackageType: 'FMWK' }), /APPL/);
  assert.equal(validateInfoPlist({ ...validInfo, CFBundleSupportedPlatforms: undefined, DTPlatformName: 'iphoneos' }), true);
  assert.throws(() => validateInfoPlist({ ...validInfo, CFBundleSupportedPlatforms: ['iPhoneSimulator'] }), /iPhoneOS/);
});

test('架构与未签名证据必须明确', () => {
  assert.equal(hasArm64Architecture('arm64 x86_64'), true);
  assert.equal(hasArm64Architecture('x86_64'), false);
  assert.equal(isExplicitUnsignedEvidence(1, 'code object is not signed at all'), true);
  assert.equal(isExplicitUnsignedEvidence(0, 'satisfies its Designated Requirement'), false);
  assert.equal(isExplicitUnsignedEvidence(1, 'resource envelope is obsolete'), false);
});

test('IPA ZIP 只允许单一 Payload 应用布局', () => {
  const entries = [
    'Payload/',
    'Payload/PiMuse.app/',
    'Payload/PiMuse.app/Info.plist',
    'Payload/PiMuse.app/PiMuse',
  ];
  assert.equal(validateZipLayout(entries, 'PiMuse.app'), true);
  assert.throws(() => validateZipLayout(['Payload/PiMuse.app/Info.plist', 'Extra.file'], 'PiMuse.app'), /Payload/);
  assert.throws(() => validateZipLayout(['Payload/PiMuse.app/Info.plist', 'Payload/Other.app/Info.plist'], 'PiMuse.app'), /额外应用根目录/);
  assert.throws(() => validateZipLayout(['Payload/PiMuse.app/Footer'], 'PiMuse.app'), /Info\.plist/);
  assert.throws(() => validateZipLayout(['Payload/PiMuse.app/Info.plist', 'Payload/PiMuse.app/Info.plist'], 'PiMuse.app'), /重复/);
  assert.throws(() => validateZipLayout(['Payload/../PiMuse.app/Info.plist'], 'PiMuse.app'), /不安全/);
});

test('Release workflow 从同一源 SHA 构建两平台并等待完整产物', () => {
  assert.match(workflow, /needs: prepare/);
  assert.match(workflow, /ref: \$\{\{ needs\.prepare\.outputs\.sha \}\}/);
  assert.equal((workflow.match(/ref: \$\{\{ needs\.prepare\.outputs\.sha \}\}/g) ?? []).length, 3);
  assert.match(workflow, /npx expo prebuild --platform ios --no-install --clean/);
  assert.match(workflow, /test -f ios\/PiMuse\.xcworkspace\/contents\.xcworkspacedata/);
  assert.match(workflow, /-workspace ios\/PiMuse\.xcworkspace/);
  assert.doesNotMatch(workflow, /-project ios\/PiMuse\.xcodeproj/);
  assert.match(workflow, /-scheme PiMuse/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /CODE_SIGNING_REQUIRED=NO/);
  assert.match(workflow, /node tools\/package-ios-unsigned\.mjs/);
  assert.match(workflow, /app-release-unsigned\.ipa/);
  assert.match(workflow, /needs: \[prepare, android, ios\]/);
  assert.match(workflow, /app-release\.apk/);
  assert.match(workflow, /target_commitish: \$\{\{ needs\.prepare\.outputs\.sha \}\}/);
  assert.match(workflow, /not directly installable/);
  assert.match(workflow, /不能直接安装/);
  assert.match(workflow, /only downloads this stable APK asset/);
  assert.match(workflow, /只会下载这个稳定 APK asset/);
});

test('手动 Release workflow 只构建同 SHA 产物而不发布', () => {
  const prepareJob = workflow.split('  prepare:')[1].split('\n  android:')[0];
  const androidJob = workflow.split('  android:')[1].split('\n  ios:')[0];
  const iosJob = workflow.split('  ios:')[1].split('\n  release:')[0];
  const releaseJob = workflow.split('  release:')[1];

  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.equal((prepareJob.match(/if: github\.event_name == 'push'/g) ?? []).length, 5);
  const bumpStep = prepareJob.slice(
    prepareJob.indexOf('- name: Bump version'),
    prepareJob.indexOf('- name: Commit version bump'),
  );
  const commitStep = prepareJob.slice(
    prepareJob.indexOf('- name: Commit version bump'),
    prepareJob.indexOf('- name: Resolve build source'),
  );
  assert.match(bumpStep, /node tools\/bump-version\.js/);
  assert.match(bumpStep, /if: github\.event_name == 'push'/);
  assert.match(commitStep, /git push origin HEAD:main/);
  assert.match(commitStep, /if: github\.event_name == 'push'/);
  assert.match(prepareJob, /if \[ "\$\{GITHUB_EVENT_NAME\}" = "push" \]/);
  assert.match(prepareJob, /echo "sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"/);
  assert.match(prepareJob, /echo "sha=\$\{GITHUB_SHA\}" >> "\$GITHUB_OUTPUT"/);
  assert.match(androidJob, /ref: \$\{\{ needs\.prepare\.outputs\.sha \}\}/);
  assert.match(iosJob, /ref: \$\{\{ needs\.prepare\.outputs\.sha \}\}/);
  assert.match(releaseJob, /if: github\.event_name == 'push'/);
  assert.match(releaseJob, /Create GitHub Release/);
  assert.equal(/bump-version|git push|Create GitHub Release/.test(androidJob), false);
  assert.equal(/bump-version|git push|Create GitHub Release/.test(iosJob), false);
});

test('iOS 发布流程不使用 Apple 证书或签名 secrets', () => {
  const iosJob = workflow.split('  ios:')[1].split('\n  release:')[0];
  assert.equal(/APPLE_|IOS_CERT|PROVISIONING|KEYCHAIN|CODE_SIGN_IDENTITY/.test(iosJob), false);
});
