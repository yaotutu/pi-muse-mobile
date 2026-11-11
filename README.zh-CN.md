<div align="center">

<img src="assets/icon.png" width="112" alt="Pi Muse Mobile">

# Pi Muse Mobile

[English](README.md) | [简体中文](README.zh-CN.md)

**把 [Pi Muse](https://github.com/yaotutu/pi-muse) 助手，放进原生手机界面**

聊一件事，读一篇值得讨论的文章，让计划继续推进——模型访问与助手数据仍由自己的服务端负责。

**[下载 Android APK](https://github.com/yaotutu/pi-muse-mobile/releases/latest/download/app-release.apk)** · [版本说明](https://github.com/yaotutu/pi-muse-mobile/releases/latest) · [部署服务端](https://github.com/yaotutu/pi-muse/blob/main/README.zh-CN.md#快速开始)

[使用体验](#使用体验) · [安装与连接](#安装与连接) · [源码开发](#源码开发) · [安全与限制](#安全与限制)

<img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/showcase.png" width="98%" alt="Pi Muse Android 客户端：主聊天、新闻与设置">

</div>

截图使用演示数据；展示的形象包为可替换示例。本文介绍当前源码能力，请核对所选 Release 的说明与实际产物，不要把这里的每项功能都当成最新发布 APK 已有。

查看单图：[主聊天](https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/screenshots/chat.png) · [新闻](https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/screenshots/news.png) · [设置](https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/screenshots/settings.png)

## 使用体验

Pi Muse Mobile 是自部署、个人自用 AI 助手的官方 Expo / React Native 客户端，助手基于 [pi](https://github.com/earendil-works/pi) 构建。它是原生界面，不是内嵌 Web 聊天，也不在本机独立运行模型；使用时需要可访问的 Pi Muse 服务端。

### 三个入口，一个主聊天

- **消息**直接打开永久 `main` 主聊天，不用选择会话。流式查看回复，阅读原生 Markdown 与可复制代码，添加图片或文本附件，为已保存消息留下反馈。切换 Tab 保留主聊天和草稿。服务端具备专题会话底座，但 App 目前不开放专题会话界面。
- **新闻**是全局 RSS 阅读与推荐流，提供文章详情、喜欢、不喜欢和收藏。**讨论**只向 main 既有草稿追加明确标记为不可信的可编辑文章引用，绝不自动发送；讨论后可以返回原文章。
- **设置**把管理操作从聊天记录里拿出来：助手身份、指令与技能、记忆与 Dream、目标、定时任务、网页监控、工作区文件、动态与审批、连接、外观和更新。

### 看得见状态，也换得了形象

透明人物与紧凑短状态一起悬浮在聊天之上，不放进大背景卡片。八种姿态配合短状态表达空闲、思考、回复、工作、等待审批、成功、失败和停止；有限次轻动效强化状态，不是形象视频，也尊重系统减弱动效设置。点击人物或状态，围绕同一个人物原位展开主聊天操作、执行、审批和历史，关闭时反向收起，不重建聊天。

内置企鹅始终作为兜底。在「设置 → 助手形象」选择服务端已安装的完整自定义包，App 下载齐八张状态图后才切换；同一服务端的完整缓存可离线使用。包缺失或不完整时，提示并回退企鹅。换服务器会清理旧包缓存与选择；换形象不会创建另一个助手，也不会重启聊天流。

<img src="https://raw.githubusercontent.com/yaotutu/pi-muse/main/docs/assets/screenshots/companions.png" width="360" alt="选择可替换的助手形象包">

界面还可选择**经典蓝白、晨光白、深夜黑**三套主题。主题和形象偏好只属于当前设备。

### 不只看回复，也能审阅和管理工作

- **文件审批。** 每次助手 `write` 或 `edit` 都完整展示修改前后内容，由人明确批准当时的文件版本。过期、取消、拒绝或文件已变化的审批不能提交。模型没有 Shell 工具；全部会话共用一个扁平工作区。
- **任务与目标。** 通过聊天创建一次性或每日任务，再到设置中管理。公网页面监控间隔最短五分钟。目标与里程碑由人显式跟进，App 不从聊天文字猜测完成情况。
- **记忆与工作方式。** 编辑助手和用户资料、主聊天指令与技能、长期记忆；查看可选的 Dream 整理，明确应用或忽略建议。
- **同一个真实浏览器。** 服务端浏览器部署可用时，通过 App 的 WebView 打开图形化 Chrome，助手与人工查看器共享浏览器和登录状态。Chrome／noVNC 是否可用及代理限制取决于[服务端配置](https://github.com/yaotutu/pi-muse/blob/main/docs/manual/browser-docker.md)。

## 安装与连接

### Android

1. [部署 Pi Muse](https://github.com/yaotutu/pi-muse/blob/main/README.zh-CN.md#快速开始)，设置强随机服务端 AccessKey，以及当前 pi provider 支持的模型接口。App 不需要模型 API key。
2. [下载最新稳定 `app-release.apk`](https://github.com/yaotutu/pi-muse-mobile/releases/latest/download/app-release.apk)，安装并打开。Android 可能要求先允许来自该来源的安装。
3. 未连接时打开首页「服务器连接」；已连接时进入「设置 → 服务器连接」。
4. 填写手机能访问的服务端根地址，例如 `http://192.168.1.100:12330`，以及配置中的 `server.accessKey`。不要附加 `/api` 或 `/docs`；真机上的 `localhost` 指向手机自己。
5. 点击「保存」，App 先验证地址和 AccessKey，通过后才保存。「测试连接」可选，不会保存配置。
6. 打开「消息」，发送第一条消息。模型在服务端运行，连接自己的部署不需要重新编译客户端。

直接支持 HTTP，不要求域名、证书或反向代理，但不会加密凭据、Token 和聊天内容。请优先使用可信网络，并妥善保护远程入口。网络设置与恢复见共用[快速上手指南](https://github.com/yaotutu/pi-muse/blob/main/docs/manual/getting-started.md)。

Android 独立安装包可检查稳定 GitHub Release 并下载 APK 更新，最后仍需 Android 系统确认安装；这不是 Expo OTA 更新。

### iOS 与 Web

只有所选 Release 实际附带 `app-release-unsigned.ipa`，且你有自己的有效 iOS 签名资格时，该产物才适用。它**不能直接安装**，需要自行重签后安装；本仓库不提供 App Store 或 TestFlight 分发。

iOS 也可从源码开发。Expo Web 只是开发预览，不是主要 Pi Muse 客户端，不能替代原生 Android 验证。

## 安全与限制

- **凭据职责分离。** 模型 Key 留在服务端。App 用服务端 AccessKey 换取 Session Token，只持久化服务地址与 Token，不保存明文 AccessKey。
- **换服务器需要确认。** 验证成功后，换服会清理旧连接的本机业务缓存、凭据与形象选择；不会删除旧服务器上的数据，本机主题保留。
- **自部署不等于离线 AI。** 配置的外部模型提供方会收到任务所需的提示词、附件和上下文。请保护服务端明文实例数据与备份。
- **权限不是展示效果。** 指令和技能不能绕过版本绑定的文件审批，也不能扩大服务端的文件、网络边界。文章内容不可信；消息链接只允许无凭据 HTTP(S)，Markdown 图片不会自动拉取。
- **Android 短信可选，默认关闭。** 需要系统权限和存活的应用进程才能接收短信。重要处理结果以通知出现在 main，不额外启动主聊天模型轮；它不是后台常驻服务。
- **交付能力有边界。** App 在前台重连 SSE；语音输入／转写与锁屏系统推送尚未实现。排期工作依赖服务端在线，停机错过的一次性任务不会补跑。
- **附件依赖模型能力。** 支持受支持的图片与 UTF-8 文本／代码，不支持 PDF、Office 和压缩包。图片理解要求服务端模型具备视觉能力，不会自动换模型。

## 源码开发

与服务端一起开发时，使用 **Node.js 24.x，最低 24.3.0**，以及 npm。应用使用 Expo、React Native 和 TypeScript，准确依赖版本以 `package.json`、`package-lock.json` 为准。

```sh
git clone https://github.com/yaotutu/pi-muse-mobile.git
cd pi-muse-mobile
npm ci
npm run android
```

Android 开发需要 Android SDK 和已连接的设备或模拟器。`npm start` 仅启动 Metro，不指定平台；`npm run ios` 需要 macOS 与 Xcode；`npm run web` 在 `8082` 端口启动开发预览。

代码变更运行：

```sh
npm run lint
npm run typecheck
npm test
```

这些是本地检查，包含协议与状态夹具，不代表真实模型或原生设备验收。相应要求见工程指南。原生目录由 Expo CNG 生成，发布产物的构建与签名按[发布指南](docs/android-release-guide.md)执行。

### 继续了解

- [共用用户手册](https://github.com/yaotutu/pi-muse/blob/main/docs/manual/index.md) — 日常使用、部署与配置
- [移动开发指南](docs/mobile-development-guide.md) — 导航、Store 与 HTTP/SSE 接入
- [主题维护](docs/themes.md) · [工程规则](AGENTS.md)
- 运行中服务端的 `/docs` 与 `/openapi.json` — 当前接口契约；聊天 AG-UI SSE 与共享 `/api/events` 通知流彼此独立

## 许可证

以 [MIT License](LICENSE) 发布。
