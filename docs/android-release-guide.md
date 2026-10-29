# Android 发布指南

本文负责 Pi Muse Mobile 的 Android APK 更新、版本脚本、构建、签名与 CI 入口。发布、push、版本写入、签名材料或 CI 变更都需要用户明确授权；日常开发不得为了验证而触发这些操作。本文不把 EAS 云构建或 Expo OTA 作为项目现行默认。

## 权威入口

- 应用配置：`app.json`。
- 版本脚本：`tools/bump-version.js`；`--check` 只计算输出，不带参数会写回版本字段。
- CI 门禁：`.github/workflows/ci.yml`；Android Release：`.github/workflows/release.yml`。
- Android 签名注入：`tools/android-signing.js`，只修改 CNG 生成的临时 `android/` 目录。
- 在线更新模块：`src/update/`，由 `src/app/AppRoot.tsx` 根级挂载，独立于业务服务鉴权。
- 修改以上文件前必须重新读取当前源码；本文只保留边界，不复制 workflow 步骤、历史版本或证书指纹。

## 版本与 CI

- `expo.version`、`expo.android.versionCode`、`expo.ios.buildNumber` 是受保护字段，开发者不得手工修改。发布流程通过 `tools/bump-version.js` 同步递增三位字段；未获版本写入授权时，本地只使用 `node tools/bump-version.js --check` 查看计算结果。
- CI 执行 npm 安装、typecheck、lint、test，并检查 `app.json` 三个版本字段没有被人工修改。若版本守卫失败由本人本任务改动引入，只整理该改动；疑似他人或既有修改时先报告，不指示回滚他人代码，也不重复 bump 或改 CI 绕过。
- Release workflow 在收到 main push 后由脚本写入新版本，创建 `[skip ci]` 版本提交，执行 Android CNG prebuild、注入签名、Gradle release 构建并上传正式 APK 到 GitHub Release。实际步骤、依赖版本和权限以当前 workflow 为准。
- workflow 期望从 GitHub secrets 获取 Android keystore 与密码材料；不在日志、交付、文档或命令输出中展示值，不假设账户配置状态，不把本机 `.keystore/`、`*.keystore` 或生成的 `android/key.properties` 加入 Git。

## CNG 与签名

- `android/` 与 `ios/` 是生成目录且被忽略；不要手工编辑或提交。原生配置修改 `app.json` 与 Expo config plugin，再通过 prebuild 验证生成结果。
- `tools/android-signing.js` 必须在 Android prebuild 后、Gradle release 构建前运行；它把受控环境变量解码为临时 keystore、key properties，并调整临时 `build.gradle` 的 release 签名。
- 版本写入、正式签名、上传/发布、修改 CI 或 push 前，先向用户说明影响并取得明确授权。未获授权时不运行版本写入脚本、不配置正式签名、不触发 workflow、不执行发布操作；派单范围内的产品代码开发、静态核对与 Android 隔离验收仍按根规则执行。
- 签名密钥、密码、生成的 `key.properties` 和 keystore 是敏感材料；缺失或归属不明时停止并报告，不得用 debug 签名冒充正式包。

## APK 在线更新

- 更新模块只检查公开 GitHub Release 的稳定 `app-release.apk`，不包含预发布、draft 或其他 asset；检查失败时提供官方地址与手动下载入口，不用缓存或猜测数据冒充新版本。
- 下载完成后唤起 Android 系统安装器；未知来源授权、系统签名校验和最终安装确认必须保留，不静默安装。取消后可按系统保留的缓存继续安装，系统清理后需重新下载。
- 该更新是 Android 独立 APK 更新，不是 Expo OTA；Expo Go、Web 和 iOS 不支持此安装路径。模块不读取、缓存或上报业务服务地址与凭据。
- 修改更新策略、Release asset 命名或安装流程时，必须同时核对当前模块、workflow 产物和 README 双语说明，并完成 Android 原生下载/安装链路验收；不能用接口检查或 Web 演示替代。

## 发布验收边界

- Android 是默认发布与原生验收平台；iOS 构建和商店分发不是默认任务。旧 LAN 或专门部署不作为默认验收环境，当前源码本地真实后端才是功能收口口径。
- 发布前确认本地 lint、typecheck、test，当前契约与真实模型链路，Android 原生关键路径，以及用户可见文档。历史 release 不能替代本次验证。
- push、创建 Release、更换签名或迁移密钥都属于高风险操作；执行前确认目标仓库、版本、数据影响、回退方式和用户授权。派单范围内的隔离验收可按根规则安装测试包或正式 APK，无需为此额外申请发布授权，也不能据此声称已发布。发布后记录实际版本、产物来源、验证范围与未验证项，不宣称未运行的 iOS、OTA 或商店流程通过。
