# AGENTS.md — Pi Muse 移动端规则

本文对所有开发 Agent（Antigravity、Claude Code 等）生效；日常开发读[移动开发指南](docs/mobile-development-guide.md)。完整工作区同时遵守[父目录规则](../AGENTS.md)与[协作指南](../pi-muse-server/docs/agent-workflow-guide.md)；独立 clone 时不假设兄弟仓库存在，报告缺失的跨端依赖，不从历史 HANDOFF 猜协议。

## 开发命令

在本仓库目录执行。使用 npm；Expo / React Native / TypeScript 配套版本以 `package.json`、`package-lock.json` 为准。与服务端一起开发时使用满足两端 engines 的 Node.js 24.x。

本工作区是可丢弃的开发环境。默认直接用主工程原生 App、当前开发后端和实际开发数据联调，允许按任务写入/重置数据与重启本项目服务，不强制备用后端或独立测试包。调试包打开前先确保 Metro 可用，用户现场看 UI 时保持可运行，不把尚未启动的空包交给用户。

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm start` | Expo/Metro 开发服务 |
| `npm run android` | 编译并安装原生开发包到 Android 设备或模拟器，随后启动 Metro 调试 |
| `npm run ios` | iOS 原生开发构建，不是默认验收平台 |
| `npm run web` | 8082 端口的 Expo Web 预览，不能替代原生验收 |
| `npm run lint` | Expo / ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Node 协议/状态/源码回归，包含 fixture，不是真实模型验收 |

单文件与单用例：

```sh
node --import ./tests/register-source.mjs --test tests/news-api.test.mjs
node --import ./tests/register-source.mjs --test --test-name-pattern="新闻源 URL" tests/news-api.test.mjs
```

`register-source.mjs` 是测试加载 TypeScript 源码的入口，不省略。原生专项位于 `tools/e2e-*.mjs`，对应 `package.json` 的 `test:e2e:*`；运行前查看该脚本实际支持的参数和场景，历史脚本可能针对旧导航，不能当成新界面验收。项目没有通用 `npm run build`；原生构建和受保护版本/签名流程见[发布指南](docs/android-release-guide.md)。

## 架构与状态所有权

客户端不执行模型、不保存服务端业务事实的第二份权威副本。模型、会话、文件和调度均归后端；HTTP/SSE 权威来自当前服务端 `src/http/contracts/` 与匹配版本的 `/docs`、`/openapi.json`。核对 health 身份和相关真实接口，不从旧 HANDOFF 或客户端推测字段。本会话按用户任务范围直接处理两端，不维持“服务端属于其他 Agent、只能等待”的永久分工；若存在他人同时开发的文件，先核对写集，不覆盖或回滚。

- **根与连接**：`src/app/AppRoot.tsx` 组装安全区、主题、错误边界和独立更新。`WorkspaceScreen.tsx` 内的 ConnectedWorkspace 按 `workspaceKey` 创建 ApiProvider/业务 Provider；换服务器销毁整个连接子树。不要按主题或当前页面重建它。
- **导航与聊天持有者**：本地状态导航，无 Expo Router/react-navigation。一级仅「消息 / 新闻 / 设置」，冷启动的消息根页直接进入唯一 main 主聊天，不等待会话目录成功。正常主聊天保留底栏，文章、设置子页、键盘和覆盖层隐藏底栏。顶部透明人物与真实短状态组成同一入口，围绕持续挂载的同一人物原位展开/收起，保留重置、指令/技能、当前执行/审批/历史；专题会话 UI 暂缓，无列表、新建、切换、改名或删除入口。ConversationHost 切 Tab 隐藏不卸载 main SSE，重置 epoch 或换服仍按原生命周期释放。
- **协议层**：`src/api/` 提供 HTTP 与严格响应解析；`src/chat/` 聚合聊天 AG-UI SSE。`RuntimeProvider` 是连接内唯一通知流订阅者，领域 Store 消费通知失效并回读 REST，不各开第二条 SSE 或全局轮询。
- **Store 生命周期**：领域 Store 负责读取、写入、草稿、未明结果和迟到响应保护，组件订阅并展示。close/隐藏通常只停止读取，dispose 才释放连接状态；不要用页面局部 state 重复持有业务草稿。
- **会话所有权**：`src/sessions/session-store.ts` 持有权威目录与创建/改名状态，`chat-session-store.ts` 持有每会话草稿、附件、未确认提交、指令/技能与维护锁；公开 sessionId 与重置后变化的 piSessionId 严格区分。
- **新闻与短信**：`src/news/` 持有全局来源、偏好与阅读状态。讨论文章直接向 main 既有草稿追加可编辑的不可信外部引用，不自动发送；消息页可「返回文章」，Android Back 也返回原文章，点击消息 Tab 清理旧来源。`src/information/` 的 SmsProvider 在连接层挂载，短信设置在设置页。通知元数据由 `src/notifications/` 持有，通知续聊只接受 main 引用；非 main 明确提示暂不可用，不改投 main、不复活专题。
- **文件与记忆整理**：所有会话共用扁平工作区，文件 API 只传 path。Dream 是实例全局配置与状态，不按会话切换；待决项保留来源会话引用，不能重建已删会话。
- **外观与原生能力**：`src/theme/` 维护三主题与 tokens，`src/ui/` 是共享原生控件；业务页面消费语义颜色。浏览器使用原生 WebView 连接后端同一个 Chrome。Expo CNG 管理原生工程，`android/`、`ios/` 是生成目录，不手工维护或提交；原生行为改 `app.json` 与 config plugin。
- **助手形象包**：`src/companion/` 持有独立设备选择偏好与八状态原子缓存；内置 `builtin:penguin` 使用与品牌相同的 B 企鹅完整八态，来源和哈希在 `assets/images/avatar/manifest.json`，不混用旧 C 图。设置 → 助手形象读取服务端已安装完整包，鉴权下载成功后才替换；同服离线可用本地完整缓存，缺失/删除/不完整时提示回退内置，换服清理缓存与旧选择。形象 Provider 不以选择为 key，不重建 ConversationHost 或 SSE。
- **恢复语义**：GET 失败保留旧值，不伪装成空列表；写入结果未明保留草稿、先回读核对服务端实际状态，不自动重发。旧请求不污染新连接或新会话。前后台、重连、reset/delete 与换服需要不同生命周期，不能用一次“重新挂载”替代。

## 数据与发布保护

- 不持久化明文 AccessKey，仅保存服务地址和 Session Token；模型 Key、签名或服务端凭据不进入客户端、日志和文档。
- 本工作区是可丢弃的开发环境；开发实例、客户端缓存和业务数据允许按任务直接写入、重置或清空，无需额外确认。默认用当前后端和主工程原生 App 联调，不强制隔离数据、备用实例或另起测试包；产品模型文件审批、系统安装确认和路径/网络边界仍保留。
- `expo.version`、`expo.android.versionCode`、`expo.ios.buildNumber` 不手工修改，仅发布流程中的 `tools/bump-version.js` 可写。未经明确授权，不 bump、push、发布、修改签名或 CI。
- 已验收模块按长期授权本地 commit，先检查工作区和暂存区 diff，仅纳入本任务改动，不覆盖他人文件。本项目后端、Web、Expo/Metro 可随开发需要启动、停止、构建和重启，无需额外确认，不为保护开发服务连续性搭建旁路环境；直接运行当前代码，默认结束时保持后端和 UI 调试所需 Metro 可用。开发数据可丢弃，但凭据不得泄露，生产或非本项目资源不属于这项授权。
- 积极委派已获用户授权（2026-11-05），当前支持 Antigravity 与 Claude Code 双工具协同，日常主要使用 Antigravity：主会话负责派单、diff 审查与验收，调查实现优先交给原生子 Agent（Antigravity `invoke_subagent` 或 Claude Code sub agent，两者均支持直接读取截图进行视觉核对）；可用第三方模型统一经 Magpie 本地网关（`http://127.0.0.1:3425`）。执行者不 commit/push，产物经审查后由主会话提交；派单模板与模型路由见服务端[协作指南](../pi-muse-server/docs/agent-workflow-guide.md)。真实模型测试费用已长期授权，此授权不包含修改全局模型配置或发布。
- 新文件/目录只用 ASCII 字母、数字、`-`、`_`、扩展名点；用中文注释解释协议、安全与生命周期。个人自用、简单优先，内部重构同步调用方而不保留无需求的兼容层。

## 按任务必读

| 范围 | 指南 |
| --- | --- |
| 页面、导航、状态或协议消费 | [移动开发指南](docs/mobile-development-guide.md)及对应 Store/测试 |
| 主题、共享控件、动效 | [主题维护](docs/themes.md) |
| APK 更新、CNG、构建、版本、签名或发布 | [发布指南](docs/android-release-guide.md) |
| 文档或用户可见行为 | 服务端[文档指南](../pi-muse-server/docs/agent-documentation-guide.md)；共用服务端中英文手册，不复制一套 |
| 品牌图标或形象 | 服务端[品牌基准](../pi-muse-server/docs/assets/brand/README.md) |
| 待办 / 历史 | [backlog](docs/backlog.md) / [归档索引](docs/archive/README.md) |

## 完成要求

代码变更补本次回归，运行 lint、typecheck、test；本地 fixture 不替代当前真实后端、外部模型和 Android 原生验收。新功能还需本地当前后端与实际 `/docs` 页面证据；必要项缺失保持待验收，服务不可用时不用替身凑通过。写入、停止、流式、重连或恢复相关场景按实际改动覆盖，分别报告失败、跳过和未验范围。

用户可见行为变化同步中英文手册。文档-only 只检查引用、差异、命名与规则一致性，涉及手册时按其指南构建，不启动业务、模型或 Android。交付区分实现、验证、提交与发布。
