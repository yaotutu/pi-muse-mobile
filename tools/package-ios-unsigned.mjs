#!/usr/bin/env node
/**
 * 将 xcodebuild 生成的未签名 .app 打包成 GitHub Release 使用的固定名称 IPA。
 *
 * 边界：只负责校验和包装，不执行构建，也不接受任何证书或描述文件。
 * 该 IPA 不能直接安装；使用者必须先用自己的 iOS 签名资格完成重签。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const REQUIRED_OUTPUT_NAME = 'app-release-unsigned.ipa';
const REQUIRED_INFO_KEYS = [
  'CFBundleIdentifier',
  'CFBundleExecutable',
  'CFBundleShortVersionString',
  'CFBundleVersion',
  'CFBundlePackageType',
];
const TOOLS = {
  plutil: '/usr/bin/plutil',
  lipo: '/usr/bin/lipo',
  codesign: '/usr/bin/codesign',
  zip: '/usr/bin/zip',
  unzip: '/usr/bin/unzip',
};

export function parseArguments(argv) {
  const parsed = { app: '', output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key !== '--app' && key !== '--output') {
      throw new Error(`未知参数：${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${key} 需要一个路径参数`);
    }
    parsed[key.slice(2)] = value;
    index += 1;
  }
  if (!parsed.app || !parsed.output) {
    throw new Error('必须提供 --app 与 --output');
  }
  if (path.basename(parsed.output) !== REQUIRED_OUTPUT_NAME) {
    throw new Error(`输出文件名必须是 ${REQUIRED_OUTPUT_NAME}`);
  }
  return parsed;
}

export function validateInfoPlist(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) {
    throw new Error('Info.plist 内容无效');
  }
  for (const key of REQUIRED_INFO_KEYS) {
    const value = info[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Info.plist 缺少有效 ${key}`);
    }
  }
  if (info.CFBundleExecutable.includes('/') || info.CFBundleExecutable === '.' || info.CFBundleExecutable === '..') {
    throw new Error('CFBundleExecutable 必须是文件名，不能包含路径');
  }
  if (info.CFBundlePackageType !== 'APPL') {
    throw new Error('CFBundlePackageType 必须是 APPL');
  }
  // arm64 也存在于模拟器产物；设备 IPA 必须有任一 iPhoneOS 平台证据。
  const supportedPlatforms = info.CFBundleSupportedPlatforms;
  const supportsDevice = (Array.isArray(supportedPlatforms) && supportedPlatforms.includes('iPhoneOS')) ||
    info.DTPlatformName === 'iphoneos';
  if (!supportsDevice) {
    throw new Error('Info.plist 未标明 iPhoneOS 设备平台');
  }
  return true;
}

export function hasArm64Architecture(output) {
  const architectures = new Set(output.trim().split(/\s+/).filter(Boolean));
  return architectures.has('arm64');
}

export function isExplicitUnsignedEvidence(status, output) {
  // codesign 的普通失败可能来自损坏包；只有这句明确证据才允许继续。
  return status !== 0 && /code object is not signed at all/i.test(output);
}

export function validateZipLayout(entries, appName) {
  const normalized = entries.map((entry) => entry.replace(/\r$/, '')).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error('IPA ZIP 没有内容');
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('IPA ZIP 存在重复条目');
  }

  const appRoot = `Payload/${appName}`;
  const appPrefix = `${appRoot}/`;
  let hasInfoPlist = false;
  for (const entry of normalized) {
    const parts = entry.replace(/\/$/, '').split('/');
    if (entry.startsWith('/') || parts.includes('..') || entry.includes('\\')) {
      throw new Error(`IPA ZIP 条目路径不安全：${entry}`);
    }
    const isPayloadDirectory = entry === 'Payload/';
    const isAppDirectory = entry === appRoot || entry === `${appRoot}/`;
    const isAppFile = entry.startsWith(appPrefix);
    if (!isPayloadDirectory && !isAppDirectory && !isAppFile) {
      throw new Error(`IPA ZIP 含有 Payload 之外或额外应用根目录：${entry}`);
    }
    if (entry === `${appRoot}/Info.plist`) hasInfoPlist = true;
  }
  if (!hasInfoPlist) {
    throw new Error('IPA ZIP 缺少应用 Info.plist');
  }
  return true;
}

function runTool(command, args, options = {}) {
  const result = { status: 0, stdout: '', stderr: '' };
  try {
    result.stdout = execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    result.status = error.status ?? 1;
    result.stdout = error.stdout ?? '';
    result.stderr = error.stderr ?? String(error.message ?? error);
  }
  return result;
}

function requireTool(command) {
  try {
    fs.accessSync(command, fs.constants.X_OK);
  } catch {
    throw new Error(`缺少 macOS 原生工具：${command}`);
  }
}

function readInfoPlist(appPath) {
  const result = runTool(TOOLS.plutil, [
    '-convert',
    'json',
    '-o',
    '-',
    path.join(appPath, 'Info.plist'),
  ]);
  if (result.status !== 0) throw new Error(`plutil 校验 Info.plist 失败：${result.stderr.trim()}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('plutil 输出不是有效 JSON');
  }
}

function verifyUnsigned(appPath) {
  const result = runTool(TOOLS.codesign, ['--verify', '--verbose=2', appPath]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) {
    throw new Error('应用已经带有代码签名；发布产物必须是未签名 IPA');
  }
  if (!isExplicitUnsignedEvidence(result.status, output)) {
    throw new Error(`codesign 未给出明确的未签名证据：${output.trim()}`);
  }
}

export async function packageUnsignedIpa(appInput, outputInput) {
  const appPath = path.resolve(appInput);
  const outputPath = path.resolve(outputInput);
  const appName = path.basename(appPath);

  if (!appName.endsWith('.app')) {
    throw new Error('--app 必须指向 .app 目录');
  }
  if (!fs.statSync(appPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`应用目录不存在：${appPath}`);
  }
  if (fs.existsSync(outputPath)) {
    throw new Error(`输出文件已存在，拒绝覆盖：${outputPath}`);
  }
  for (const tool of Object.values(TOOLS)) requireTool(tool);

  const info = readInfoPlist(appPath);
  validateInfoPlist(info);
  const executablePath = path.join(appPath, info.CFBundleExecutable);
  if (!fs.statSync(executablePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`应用主程序不存在：${info.CFBundleExecutable}`);
  }
  try {
    fs.accessSync(executablePath, fs.constants.X_OK);
  } catch {
    throw new Error('应用主程序缺少可执行权限');
  }

  const architectures = runTool(TOOLS.lipo, ['-archs', executablePath]);
  if (architectures.status !== 0 || !hasArm64Architecture(architectures.stdout)) {
    throw new Error(`lipo 未确认 arm64：${architectures.stderr.trim() || architectures.stdout.trim()}`);
  }
  verifyUnsigned(appPath);

  const outputDirectory = path.dirname(outputPath);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const stagingDirectory = fs.mkdtempSync(path.join(outputDirectory, '.ipa-stage-'));
  const temporaryZip = path.join(stagingDirectory, REQUIRED_OUTPUT_NAME);
  try {
    const payloadDirectory = path.join(stagingDirectory, 'Payload');
    fs.mkdirSync(payloadDirectory);
    fs.cpSync(appPath, path.join(payloadDirectory, appName), { recursive: true, verbatimSymlinks: true });

    const zipResult = runTool(TOOLS.zip, ['-q', '-r', '-y', temporaryZip, 'Payload'], {
      cwd: stagingDirectory,
    });
    if (zipResult.status !== 0) {
      throw new Error(`ZIP 打包失败：${zipResult.stderr.trim()}`);
    }

    // macOS zip -Z1 是压缩方法参数；目录检查必须用 unzip 的 zipinfo 模式。
    const zipList = runTool(TOOLS.unzip, ['-Z1', temporaryZip]);
    if (zipList.status !== 0) {
      throw new Error(`读取 IPA ZIP 目录失败：${zipList.stderr.trim()}`);
    }
    validateZipLayout(zipList.stdout.split('\n'), appName);
    fs.renameSync(temporaryZip, outputPath);
    return outputPath;
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const output = await packageUnsignedIpa(args.app, args.output);
  console.log(`package-ios-unsigned: ${output}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`package-ios-unsigned: ${error.message}`);
    process.exitCode = 1;
  });
}
