<div align="center">

<img src="assets/icon.png" width="112" alt="Pi Muse Mobile">

# Pi Muse Mobile

[English](README.md) | [简体中文](README.zh-CN.md)

**[Pi Muse](https://github.com/yaotutu/pi-muse) 官方 React Native 移动客户端。Pi Muse 是基于 [pi](https://github.com/earendil-works/pi) 的自部署 personal agent**

把对话、多空间、审批、定时任务、网页监控、目标、记忆和工作区文件放进手机，同时让模型凭据继续留在你自己的服务端。

[功能总览](#功能总览) · [快速开始](#快速开始) · [源码开发](#源码开发) · [安全与数据](#安全与数据) · [文档](#文档)

[![Pi Muse server](https://img.shields.io/badge/服务端-pi--muse-2563EB?style=flat-square)](https://github.com/yaotutu/pi-muse)
[![Android releases](https://img.shields.io/badge/Android-APK-3DDC84?style=flat-square)](https://github.com/yaotutu/pi-muse-mobile/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)](LICENSE)

<br/>

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/showcase.png" width="98%" alt="Pi Muse Mobile 产品总览">
</p>

</div>

---

Pi Muse Mobile 是原生移动界面，不是独立运行的助手。它通过 Pi Muse 的公开 HTTP/SSE API 连接服务端；Agent 执行、模型访问、空间、文件、排期、审批和持久状态都由服务端持有。

当前提供 Android 预编译安装包。iOS 是源码开发目标；Expo Web 输出只作为开发预览，不是独立的 Web 产品。

## 功能总览

### 智能对话与空间隔离

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/chat-preview.png" width="88%" alt="聊天 Markdown、工具卡与空间侧栏">
</p>

- **流式对话。** 消息进入服务端的 AG-UI SSE 执行流，由客户端原生消费。聊天文字流与运行状态使用的共享通知流彼此独立。
- **有边界的 Markdown 展示。** 助手消息用 React Native 原生组件渲染标题、强调、列表、引用、表格和可复制代码块。Markdown 图片不会加载，HTML 按字面文本展示，消息与搜索来源链接只允许无凭据 HTTP(S)。
- **透明的工具卡。** 工具活动只展示服务端实际返回的投影。客户端不推断隐藏细节，也不会因为工具返回就把结果说成已保存或已批准。
- **空间隔离。** 创建、搜索并切换工作、生活、学习等上下文。每个空间拥有独立会话、指令、技能和私有文件。
- **实用的附件。** 每条消息最多 4 个附件，支持 PNG、JPEG、GIF、WebP 图片和受支持的 UTF-8 文本／代码文件；附件合计最多 8 MiB，文本附件合计最多 100,000 字节。PDF、Office、压缩包等二进制格式不支持。图片理解要求服务端当前配置的模型具备视觉能力，客户端不会自动换模型。

### 任务、活动与网页监控

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/tasks-preview.png" width="88%" alt="活动历史、定时任务与网页监控">
</p>

- **模型登记的活动历史。** 筛选和查看已登记活动、状态与步骤，并支持手动刷新。界面只显示服务端返回的活动，不编造进展数据。
- **定时任务。** 通过聊天创建一次性或每日任务，再在任务页管理内容、时间和生命周期。支持二次确认的暂停、恢复、取消、失败重试和删除。这些操作管理任务排期，不等同于停止正在执行的对话。
- **网页监控。** 通过聊天创建监控，在任务页筛选、刷新、暂停、恢复、停止或删除。客户端展示累计检查以及最近检查、通知或抓取错误；服务端不提供逐次检查历史。
- **可选真实浏览器接管。** 「真实浏览器」设置会把已配置的 noVNC 地址交给系统浏览器打开。移动端不内嵌、不部署浏览器；请在 Pi Muse 服务端部署可选浏览器容器。

### 长期目标与里程碑

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/goals-preview.png" width="52%" alt="长期目标与里程碑追踪">
</p>

- **把计划拆成检查点。** 创建目标、组织里程碑，并查看 `1 / 3` 这类进度。
- **由人维护进度。** 目标状态和里程碑完成由你显式操作；应用不会从聊天内容猜测完成情况。
- **保持视图聚焦。** 按状态筛选、按创建或更新时间排序，并在不可恢复删除前再次确认。

### 会话面板、审批与工作区文件

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/session-preview.png" width="88%" alt="包含动态、审批、工作区规则和历史的会话面板">
</p>

- **一个全屏会话中心。** 点击聊天页顶部的会话信息区打开当前会话面板；动态、审批、工作区、历史四个 Tab 原位切换，聊天层继续挂载在面板后方。
- **当前执行与活动历史。** 查看当前运行、工具工作、模型登记的活动、进展、结果和关联步骤。活动不是隐藏的模型推理，也不会被包装成所有聊天运行的完整档案。
- **人工审批。** Agent 发起文件写入与修改时，必须查看完整前后内容并明确确认。审批过期后不能覆盖已经变化的新内容。
- **工作区文件管理。** 浏览当前空间私有文件与全部空间共享文件，完整读取文本、预览受支持图片，并可下载到 Android 上所选目录且不覆盖同名文件。手动保存文本前必须完整核对并确认。

### 设置、记忆、Dream 与主题

<p align="center">
  <img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/settings-preview.png" width="52%" alt="设置、资料、记忆、Dream 与主题">
</p>

- **服务连接管理。** 保存一个可访问的 Pi Muse 地址，用服务端 AccessKey 认证，并在设备上保留换回的 Session Token。客户端不持久化明文 AccessKey。
- **助手与用户资料。** 编辑助手称呼、语气，以及全局 SOUL 人设和 USER 用户资料。资料修改从后续对话开始生效。
- **全局长期记忆。** 搜索、新增、编辑和删除跨空间共享的记忆。页面打开、回前台、写入成功或手动刷新时回读。
- **Dream 记忆整理。** 查看全局与各空间 Dream 状态，核对待决建议，调整提示词和周期，手动整理，并明确应用或忽略建议。
- **三套完整主题。** 可选经典蓝白、晨光白、深夜黑。偏好保存在本机、重启后恢复，不携带服务端凭据。
- **Android 应用更新。** Android 独立包会检查公开 GitHub Release，下载稳定 APK，并交给系统安装器完成安装。这不是 Expo OTA，Expo Go、Web 和 iOS 构建不支持。
- **当前边界。** 语音输入／转写和锁屏系统推送未实现。客户端使用前台 SSE 重连，不宣称后台持续在线交付。

## 快速开始

### 1. 先部署 Pi Muse

Pi Muse Mobile 必须连接一个可访问的 Pi Muse 服务端，不能代替服务端保存模型提供方 Key。

请先阅读 [Pi Muse 服务端快速开始](https://github.com/yaotutu/pi-muse#quick-start)，完成部署、AccessKey 配置和 OpenAI 兼容模型接入。服务端运行时的 `/docs` 与 `/openapi.json` 提供 HTTP 与 SSE 契约。同一公开 API 也可以供终端等平台实现自己的客户端；那些客户端不属于本仓库。

### 2. Android 安装

1. 从 [Pi Muse Mobile Releases](https://github.com/yaotutu/pi-muse-mobile/releases/latest) 下载最新的稳定 `app-release.apk`。
2. 在 Android 手机或模拟器安装并打开。系统可能要求你先允许来自该来源的安装。
3. 打开 **设置 -> 服务器连接**。
4. 填写手机可访问的 HTTP 地址，例如 `http://192.168.1.100:17890` 或 `http://your-server.example:17890`，不要求域名、证书或 HTTPS 反向代理。
5. 输入服务端配置的 `server.accessKey`。
6. 点击 **测试连接**，通过后再点击 **连接服务器** 保存已验证的连接。

服务端会把 AccessKey 交换为 Session Token。移动端保存这个 Token 和服务地址，不持久化明文 AccessKey，也不保存任何模型 API Key。

直接支持 HTTP。HTTP 下访问密钥、Token 和聊天内容没有传输加密，优先在可信网络中使用；HTTPS 或安全虚拟组网是远程访问的可选保护，不是连接前提。

## 源码开发

应用使用 Expo 57、React Native 0.86 和 TypeScript。若在同一工作区同时开发移动端和基于 Node.js 的 Pi Muse 服务端，请使用 Node.js 24 及以上版本；移动端包本身没有声明更低的最低版本。

```sh
git clone https://github.com/yaotutu/pi-muse-mobile.git
cd pi-muse-mobile
npm ci
npm start
```

### 命令说明

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按 lockfile 可复现安装依赖。 |
| `npm start` | 启动 Expo/Metro 开发服务，不指定平台。 |
| `npm run android` | 启动 Expo 并打开已连接 Android 设备或模拟器上的应用。 |
| `npm run ios` | 在 macOS 与 Xcode 工具链可用时，启动 Expo 并打开 iOS 模拟器。 |
| `npm run web` | 在 8082 端口启动 Expo Web 开发预览。 |
| `npm run lint` | 运行 Expo/ESLint 检查。 |
| `npm run typecheck` | 以 `--noEmit` 运行 TypeScript。 |
| `npm test` | 运行本地 Node 协议、状态与契约回归测试。 |

Android 源码开发需要 Android SDK 和已连接的模拟器或设备。iOS 面向源码开发，本仓库没有预编译 iOS 包或 App Store 发布。Web 目标适合快速开发检查，不是独立的 Web 产品。

### 开发质量门禁

提交代码变更前运行：

```sh
npm run lint
npm run typecheck
npm test
```

这些是本地开发门禁。`npm test` 使用本地协议和状态夹具，不能替代真实 Pi Muse 服务、真实外部模型以及相关 Android 原生链路验收。功能验收要求见 [AGENTS.md](AGENTS.md)。

## 安全与数据

- **凭据职责分离。** 模型提供方 Key 和服务端 AccessKey 留在服务端部署中。移动端只在认证时发送 AccessKey，之后保留返回的 Session Token，不保存明文 Key。
- **切换服务器必须显式确认。** 替换服务器连接会清理旧服务端对应的本地业务数据与旧凭据，不会删除远端数据。
- **谨慎处理链接和投影。** 消息与搜索链接仅允许无凭据 HTTP(S)，不拉取 Markdown 图片；工具卡展示服务端投影，不虚构隐藏状态。
- **文件修改需审批。** Pi Muse 服务端策略不提供 Shell 工具。Agent 发起的文件写入与修改限定在工作区内，并要求完整差异的人工审批。
- **自部署不等于离线 AI。** 配置的模型提供方会收到当前任务所需的提示词和上下文。请同样保护好服务端配置、备份和任何对外入口。

## 架构要点

- 聊天、任务、目标、设置四个主 Tab 由应用内状态机切换；项目不使用 React Navigation 或 Expo Router。
- 聊天执行流通过 `expo/fetch` 消费 AG-UI SSE，分帧解析与事件聚合在客户端自研实现。
- 运行状态、审批、活动和任务失效提示共用服务端通知 SSE；空间、文件、记忆、目标、任务、监控、资料和 Dream 使用公开 REST 端点。
- 业务状态围绕 React Context 组织在职责清晰的 Provider 与 store 中。界面使用原生 React Native 组件渲染，而不是嵌入 Web 应用。
- 客户端源码为本项目专门编写，不是 CopilotKit SDK 外壳。

## 文档

- [Pi Muse 服务端](https://github.com/yaotutu/pi-muse) — 部署、配置、架构与 API 文档
- [项目交接文档](docs/HANDOFF.md) — 实现范围、当前状态与历史验收记录
- [主题维护](docs/themes.md) — 主题注册表、token 与验证说明
- [工程协作规范](AGENTS.md) — 开发边界、协议规则与发布策略
- [Release 下载](https://github.com/yaotutu/pi-muse-mobile/releases) — 公开 Android APK

## 许可证

以 [MIT License](LICENSE) 发布。
