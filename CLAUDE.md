# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## 开发命令

在本仓库目录执行。使用 npm；Expo / React Native / TypeScript 配套版本以 `package.json`、`package-lock.json` 为准。与服务端一起开发时使用满足两端 engines 的 Node.js 24.x。

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm start` | Expo/Metro 开发服务 |
| `npm run android` | 启动 Expo 并打开 Android 设备或模拟器 |
| `npm run ios` | iOS 源码开发，不是默认验收平台 |
| `npm run web` | 8082 端口的 Expo Web 预览，不能替代原生验收 |
| `npm run lint` | Expo / ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Node 协议/状态/源码回归，包含 fixture，不是真实模型验收 |

单文件与单用例：

```sh
node --import ./tests/register-source.mjs --test tests/news-api.test.mjs
node --import ./tests/register-source.mjs --test --test-name-pattern="新闻源 URL" tests/news-api.test.mjs
```

`register-source.mjs` 是测试加载 TypeScript 源码的入口，不省略。原生专项位于 `tools/e2e-*.mjs`，对应 `package.json` 的 `test:e2e:*`；运行前查看该脚本实际支持的参数和场景，历史脚本可能针对旧导航，不能当成新界面验收。项目没有通用 `npm run build`；原生构建和受保护版本/签名流程见 [发布指南](docs/android-release-guide.md)。

## 架构与状态所有权

客户端不执行模型、不保存服务端业务事实的第二份权威副本。模型、Agent、文件和调度均归后端，当前服务端契约是接入依据。

- **根与连接**：`src/app/AppRoot.tsx` 组装安全区、主题、错误边界和独立更新。`WorkspaceScreen.tsx` 内的 ConnectedWorkspace 按 `workspaceKey` 创建 ApiProvider/业务 Provider；换服务器销毁整个连接子树。不要按主题或当前页面重建它。
- **导航与聊天持有者**：页面由工作区状态切换，没有 Expo Router/react-navigation。一级只有「消息 / 新闻 / 设置」三项，仅根页显示 PrimaryTabBar 底栏，键盘可见或处于二级时隐藏；冷启动进入「消息」。顶部「消息」+「成员」按钮，头像单击进入二级独立私聊，不进设置、不长按。`ConversationHost` 保留访问过的私聊所有者，隐藏不卸载运行中的 SSE。设置检查对象与正在聊天的 Agent 分离。
- **协议层**：`src/api/` 提供 HTTP 与严格响应解析；`src/chat/` 聚合聊天 AG-UI SSE。`RuntimeProvider` 是连接内唯一通知流订阅者，领域 Store 消费通知失效并回读 REST，不各开第二条 SSE 或全局轮询。
- **Store 生命周期**：领域 Store 负责读取、写入、草稿、未明结果和迟到响应保护，组件订阅并展示。close/隐藏通常只停止读取，dispose 才释放连接状态；不要用页面局部 state 重复持有业务草稿。
- **群与来源讨论**：`src/group/` 持有独立群/通知讨论输入与流，不复用普通私聊上下文。显式 @、薄路由建议和待确认原文有各自发送资格；客户端接管提交后清空当前输入，完成不能清掉后来输入的新草稿。
- **新闻与短信**：`src/news/` 持有连接级阅读状态，`src/features/` 提供偏好和讨论承接，`src/information/` 的 SmsProvider 在连接层挂载。页面或 Agent 切换不重置这些所有者；专用 facade 不携带当前聊天 agentId。
- **外观与原生能力**：`src/theme/` 维护三主题与 tokens，`src/ui/` 是共享原生控件；业务页面消费语义颜色。浏览器使用原生 WebView 连接后端同一个 Chrome。Expo CNG 管理原生工程，`android/`、`ios/` 是生成目录，不手工维护。
- **恢复语义**：GET 失败保留旧值，写入结果未明保留草稿、先回读核对，不自动重发。前后台、重连、reset/delete 与换服需要不同生命周期，不能用一次“重新挂载”替代。

## 按任务读取

| 任务 | 指南 |
| --- | --- |
| 页面、状态、导航、领域逻辑 | [移动开发指南](docs/mobile-development-guide.md)及对应 Store/测试 |
| 主题、共享控件、动效 | [主题维护](docs/themes.md) |
| APK 更新、CNG、构建、版本、签名或发布 | [Android 与未签名 iOS 发布](docs/android-release-guide.md) |
| 待办 / 历史 | [backlog](docs/backlog.md) / [历史索引](docs/archive/README.md) |

在完整工作区还要读取父目录 `AGENTS.md` 和服务端 `docs/agent-workflow-guide.md`；涉及文档读取其 `docs/agent-documentation-guide.md`。用户手册在服务端 `docs/manual/`，中文与英文同任务同步，移动端不复制一套。独立 clone 时不要假设这些外部路径存在；报告缺失的跨端依赖，不从历史 HANDOFF 猜协议。

## 验证边界

代码变更跑 lint、typecheck、test，按实际改动做当前真实后端/外部模型与 Android 原生验收。新功能还需实际渲染后端 `/docs`；门禁与真实验收分别报告，不能把 fixture 或 Expo Web 记成原生通过。文档-only 不启动业务、模型或 Android；仅更新 README/工程文档时检查引用与差异，涉及服务端用户手册时在那里执行 `pnpm docs:build`。
