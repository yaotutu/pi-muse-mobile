# pi-muse-mobile — Pi Muse 移动客户端

pi-muse 的官方移动客户端（iOS / Android / 平板，Expo + React Native + TypeScript）。UI 参考 OpenMuse（`~/Desktop/code/openmuse/apps/mobile`），**代码全自研**：不 fork、不用 CopilotKit SDK。产品后续会有一期纯 Web 客户端（pi-muse-web），以本项目 UI 定稿为参照，本仓库不做 Web 版。

## Subagent 委派与成本控制

- 统一遵守 [根规则](../AGENTS.md) 的主/子 Agent 分工、任务单、模型选择、并发与验收流程，不在本文件维护另一套调度规则；工程全貌见 [项目地图](../project-map.md)。
- 主 Agent 保留产品、架构、安全与协议决策、拆分、审查和集成验收；子 Agent 负责明确范围的调查、实现与回归测试。顺手小事可直接完成，不先实现再让子 Agent 重做。
- 所有执行者遵守本文件的中文注释、技术决策、真实接口及原生验收、CI 与版本保护边界。视觉检查使用支持图像输入的可用模型；不得因委派降低验收要求。

## 协同红线（先读这个，再读下面的 Expo 指南）

- **统一协调、按任务授权**：服务端位于兄弟目录 `../pi-muse-server/`，不再由另一 Agent 独占维护。移动端执行者默认仅修改派单范围；跨端问题先回主 Agent 确定契约、依赖与服务端任务，不自行修改另一仓库。Git 操作在各自子仓库执行；模块完成后由主 Agent 按 [根规则](../AGENTS.md#15-模块收尾与提交) 整理、验收并本地提交，不自动推送。
- **接口事实来源 = 服务端提供的 swagger 式 API 文档页面**。文档就绪前，从 pi-muse 源码只读提取：`src/http/app.ts`、`src/http/workspace-routes.ts`、`src/http/contracts/rest.ts`，以及 `web/src/lib/api.ts`（已验证的消费端实现，SSE 解析直接翻译它）。
- **遇到不合理的接口**：携契约和实现证据返回主 Agent，由其统一协调；产品取舍、安全边界或超出授权才要求用户决策。不迁就错误契约硬写，不发送不合法载荷、不把未验场景写成通过。问题仍记入 `docs/notes.md`，非阻塞项集中汇报。
- **积极重构、不做向后兼容**：遵守 [根规则](../AGENTS.md#16-积极重构与不向后兼容)，不为最小 diff 堆兼容分支或保留不合理结构；主 Agent 协调同步更新当前消费端、契约和测试，已有兼容入口的描述不构成长期保留义务，真实数据与安全边界不变。
- **个人自用、简单优先**：遵守 [根规则](../AGENTS.md#17-个人自用简单优先)，接受低概率非关键错误，不为罕见场景堆状态与兜底；规则编辑保持最后一次成功保存生效，不增加冲突检查、自动合并或额外确认。
- 服务端 `web/` 是联调测试页面，不是移动端产品；只在涉及契约或对应 renderer 的任务中按范围核对，不擅自维护或重构。
- 隔离联调可使用服务端官方 `pnpm dev:mock`（17891）；`.pi-muse/mock` 不是自动化测试临时目录，mock 不替代真实接口验收。开发服务启停与重启遵守 [根规则的长期授权](../AGENTS.md#14-开发服务进程授权)，无需逐次请示；不得借此擅自修改配置/底层数据或操作生产实例。
- **文件与目录命名红线（强制）**：任何情况下，所有新建、重命名、移动、临时生成或引导用户创建的文件和文件夹名称，严禁包含任何特殊字符，尤其绝对不能包含空格。仅允许英文字母、数字、`-`、`_` 和 `.`，多词组合统一使用 kebab-case（如 `ui-references/`），绝不使用空格分隔。
- 添加详细中文注释，重点解释职责边界、协议契约和安全约束，不逐行复述代码。

## 测试与最终验收（强约束）

- **逐模块开工门禁**：按模块串行推进，不同时展开多个新领域。每个模块开始实现前，必须重新核对当前真实部署的 `/docs`、`/openapi.json`、health 版本标识，并用实际客户端重跑该模块涉及的真实接口与安全业务链路；历史通过记录、文档存在或空列表成功不能替代本次预验。缺少契约、凭据或合法验收场景时，先列明问题与未验证范围，协调清楚后再开工；本模块实现与验收未收口前，不进入下一个新模块。开工预验不替代完成后的真实接口与原生端到端验收。
- **所有模块与功能的最终验收必须对接用户确认的真实服务接口**，由实际客户端实现消费真实 HTTP／SSE，并验证本轮改动的业务链路；模型调用同样必须真实。现存 mock、fixture 或纯内存测试的结果不满足此要求，不能据此宣布模块完成。
- 所有测试必须遵守根规则：真实连接后端，并真实调用外部大模型接口，不能用 mock、拦截响应或本地假模型替代。用户已长期授权本项目所有开发测试的真实模型费用，不需要担心费用，无需逐次请示，不以费用为由跳过；现存模拟测试不作为满足本规则或模块完成的证据。
- 当前用户确认的实际服务为 `http://192.168.55.201:17890/`；验收前核对部署的 `/docs`、`/openapi.json` 与版本标识。17891 mock、内存演示和拦截返回值不属于真实服务验收；该地址仅作联调事实，不硬编码成产品默认值。
- 最终验证须覆盖本轮涉及的真实请求、响应及界面消费；涉及写入、流式、停止、重连或恢复时，必须验证相应真实链路。仅打开文档、读取 health 或执行少量只读探测，不代表整个功能验收通过；未覆盖的场景须明确列出。
- 在真实服务中使用本轮专用验收会话／数据，测试后通过接口清理本轮创建的内容；不删除或覆盖用户已有数据，不修改服务端源码、配置或底层存储，不绕过真实鉴权、审批及系统确认。需要超出这些边界的操作时先取得用户明确授权。
- 真实服务不可用、缺少凭据或场景无法验证时，先报告具体阻塞，状态保持“待真实接口验收”；不得退回 mock 后仍宣称完成。交接与最终汇报须分别写明本地自动化、mock 联调、真实接口联调及原生运行的结果。

## 界面术语（统一命名）

- **会话信息区**：聊天页顶部正中间，由头像、名称和当前状态组成的整块可点击区域，不只是头像图片。描述整块区域时统一使用此名称；仅指图片本身时才称为「头像」。
- **会话面板**：点击「会话信息区」后打开的全屏当前会话页面，内部通过胶囊 Tab 平级切换内容。它不是会话信息区本身，也不是底部 Sheet。
- **顶栏**：聊天页整个顶部区域，包含左侧会话切换按钮、中间会话信息区和右侧按钮。

后续需求讨论、文档与代码注释统一使用以上名称，避免混淆区域、入口和打开后的页面。

## 技术决策（定稿，勿偏离）

- **无导航库**：4 个主 tab 状态机；左侧会话栏揭示并推动聊天前景右移；点击会话信息区打开根层全屏会话面板，内部胶囊 Tab 平级切换。旧工作区及旁路预览入口已删除，以用户确认截图和 `src/workspace/` 为准。
- **SSE 消费**：`expo/fetch`（原生流式支持）+ 自研 AG-UI 事件解析/聚合，翻译 pi-muse 的 `web/src/lib/api.ts`（分帧）与 `web/src/chat/chat-state.ts`（StreamAggregator）。
- **工具卡与 markdown**：真实消费 UI 已随旧工作区删除；HTTP/SSE、工具展示纯逻辑与回归测试保留，后续接入新版时继续使用自研渲染，不引 CopilotKit SDK。链接仍须限制 http/https。
- **状态管理**：useState/Context + 连接内存store；新版挂载真实连接、会话恢复、聊天、运行状态（`src/runtime/`）、审批（`src/approvals/`）、只读活动历史（`src/activities/`）及全局长期记忆（`src/memories/`）。运行／审批／活动共用唯一通知流；活动消费完整 `ready.activities` 与 `activity_updated`，没有活动revision，不用时间排序，过程进展／步骤按需回读。记忆没有SSE，按打开／前台／成功写入／手动刷新回读；写入结果未明保留草稿并锁定重提，必须完整读取及用户明确核对，不自动重试。不恢复旧 `getSnapshot`／五秒轮询。活动只覆盖模型登记的工作，不冒充全部聊天run的持久历史；其余未接领域明确标“尚未接入”，不得混入示例数据冒充服务端数据。
- **视觉与主题**：主题功能独立在 `src/theme/`；三套 preset（经典蓝白／晨光白／深夜黑）及注册表是配色唯一来源，组件通过 `useTheme()` 消费语义颜色，不固定引用某套配色。圆角／字号／布局／间距的实现集中 `src/theme/tokens.ts`，既有组件统一从 `src/ui/tokens.ts` 兼容入口取；禁止组件里散写魔法值。使用共享 `ThemePicker`／`ThemeToggle`／`ThemeStatusBar`，不在业务页复制主题分支。默认经典蓝白，独立本机偏好键保存选择；不得携带服务地址或凭据，不以主题为 key 重建业务。维护说明见 `docs/themes.md`。
- **定时任务**：`src/jobs/` 通过独立 `/api/jobs` 管理资源，任务页同层切换活动历史／定时任务／网页监控；创建仍走聊天调度工具。每日 `at=HH:mm` 按匿名 health 的权威 `timeZone` 原样发送，不转 UTC；一次性发送含偏移的完整 ISO，`nextRunAt` 按手机本地时间展示。没有专属 Jobs SSE，复用运行事件作失效提示并按需回读，不轮询；写入未明锁定重提，完整回读及用户明确核对才解锁。运行中／排队中不把调度控制冒充精确 Stop。
- **网页监控**：`src/monitors/` 通过独立 `/api/monitors` 读取列表、控制及确认删除，创建走聊天 `monitor` 工具，不提供创建或编辑表单。按打开／前台／成功写入／手动刷新回读，无专属 SSE 或轮询；读取失败保留旧列表，写入未明须完整回读及用户明确核对后解锁，不自动重发。停止是不可恢复终态；只展示累计检查与最近检查／通知，不虚构逐次检查历史。
- Expo Web dev 端口固定 **8082**（避开 openmuse 的 8081）。

进度、阶段计划与页面规格见 `docs/HANDOFF.md`。

## CI/CD 与版本号管理（开发阶段）

本仓库已接 GitHub Actions（`.github/workflows/ci.yml` + `release.yml`），CI/CD 已跑通（首个成功 release：v1.0.5，正式 keystore 签名）。

### 版本号规则（强约束）

- 三位字段同步 +1：`expo.version` patch +1（1.0.0 → 1.0.1）、`expo.android.versionCode` +1、`expo.ios.buildNumber` +1。开发阶段不引入 semver。
- **任何 agent / 开发者不得手动修改这三个字段**。`app.json` 其他字段随便改。
- 版本号只能由 `tools/bump-version.js` 写入；跑过一次就 +1，不做"上次 bump 没"的判断。

### bump 脚本

```sh
node tools/bump-version.js           # 写回 app.json
node tools/bump-version.js --check   # 只算不算，CI 守门用
```

stdout 输出 `version=X.Y.Z` / `versionCode=N` / `buildNumber=N`，CI 里 `>> "$GITHUB_OUTPUT"` 捕获。

### CI workflow（push / PR 触发）

- `npx tsc --noEmit` + `npx expo lint` + `npm test` 守住质量门槛（测试数量以当前运行结果为准）
- **Version-field 守卫**（核心）：检测 `app.json` 的 `expo.version` / `expo.android.versionCode` / `expo.ios.buildNumber` 三字段在 PR / push 的 diff 里被改 → fail。这是版本号规则不被打破的唯一手段，**任何 agent 接手都不能跳过这个守卫**

### Release workflow（push to main 触发）

流水线：

1. `node tools/bump-version.js` 自增三个版本字段
2. `[skip ci]` 提交回 main（避免循环触发）
3. `npx expo prebuild --platform android --no-install --clean`（CNG：每次重新生成 android/）
4. `node tools/android-signing.js`（从 gh secrets 注入 4 个 `ANDROID_KEYSTORE_*` 环境变量；写入 `android/app/release.keystore` + `android/key.properties` + 改 `android/app/build.gradle` 让 `signingConfigs.release` 指向我们 keystore；幂等）
5. JDK 17 + Android SDK 36（`android-actions/setup-android@v4` + `packages:` 显式装，绕开 v3 的 deprecated `tools` 包 bug）
6. `./gradlew :app:assembleRelease` 出正式签名 APK
7. `softprops/action-gh-release@v3` 创建 `vX.Y.Z` published Release，APK 作为 asset

### 已跑的 release（不要随便删除）

- `v1.0.5`：首个**正式签名**成功的 release。APK 75MB，签名证书 DN `CN=pagent-mobile, OU=Mobile, O=pagent, L=Shanghai, ST=Shanghai, C=CN`，SHA-256 `e3af25100910b7c58131e7ac527123e9497b184a5cabb6a84adf76732557273e`。验证工具：`/tmp/sdk/build-tools/34.0.0/apksigner verify --print-certs`
- v1.0.1 ~ v1.0.4 失败 run 自动 bump 的 commit 存在但**未发布 release**（CI 失败时 `softprops` 不创建 release），无需清理

### 仓库设置（Agent 不要改）

- 4 个 `ANDROID_KEYSTORE_*` secrets 已在仓库；**密钥文件本身**放在仓库内 `.keystore/release.keystore`（gitignored），主备份应放用户自己的密码管理器 / 1Password
- **Branch protection 未开**：当前 main 仍可直 push。如果要开用 `gh api repos/:owner/:repo/branches/main/protection` 强制 PR + CI 守门

### agent 改 `app.json` 的边界

- `expo.name` / `expo.slug` / `expo.icon` / `plugins` / `expo.web` / `expo.android` 下非 `versionCode` 字段 / `android.package`：随便改。
- `expo.version` / `expo.android.versionCode` / `expo.ios.buildNumber`：**禁止手动改**，跑 `tools/bump-version.js`。
- `android.package`：已切换为 `com.yaotutu.pimusemobile`。如后续发布至应用市场请保持固定。

### 当前不做

iOS 构建、OTA 自动更新、Play Store 自动上架。后期接 OTA 时再单独开规范。

### Android APK 更新边界（与 OTA 严格区分）

更新模块 `src/update/` 由 `src/app/AppRoot.tsx` 根级持有，独立于服务端鉴权与 `EXPO_PUBLIC_API_BASE_URL`，不读、不缓存、不上报用户服务地址。

- 检测源：公开 GitHub `yaotutu/pi-muse-mobile` 的 `releases/latest`，仅识别稳定正式 `app-release.apk`；预发布 / draft / 其它 asset 不纳入。
- 触发时机：冷启动及 Android 前台按一小时间隔检查，回到前台超过间隔也检查。手动入口：新版应用页「应用更新」；旧连接页已删除，不再作为入口。
- 下载 / 安装：发现新版自动下载，进度可收起继续使用应用，完成后自动唤起系统安装器；不提供额外下载确认 / 应用层 checksum / 校验页；系统签名校验、未知来源授权、最终安装确认必须保留（不静默安装）；本次会话取消安装后留包可继续安装，系统清理缓存后需重下；下载可取消、失败可重试。
- 进程与流量：OS 杀后台后下载不保证继续，仅前台唤起安装；下载消耗用户网络流量。
- 平台边界：仅 Android 独立包生效，Expo Go / Web / iOS 不支持 APK 安装，**不等同于 Expo OTA**。
- 首次接入：用户必须先手动安装一次含更新模块的版本，后续版本才走自动检测。
- 现行 release（v1.0.5 起为正式签名）已通过 GitHub Actions 流水线产出，详见 `README.md` 的更新章节与 CI/CD 章节；CI 强约束（版本号守卫 / Android 签名 / Release workflow）本节不调整。

---

以下为 Expo 官方工程指南（模板自带，仍然适用）：

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

代码变更完成前运行 lint、typecheck 和 test，并遵守前述真实接口与原生验收门禁；仅文档变更检查差异、引用、命名与规则一致性即可，不必为此运行代码检查或启动服务。

## Navigation & Routing

- **本项目不使用 Expo Router / react-navigation**：4 个主 tab 用状态机切换（`chat | activity | goals | apps`）；左侧会话入口只负责切换/新建，以揭示式侧栏推动聊天前景右移。点击会话信息区打开全屏当前会话面板，内部动态/审批/工作区/历史 Tab 同层切换，不用底部 Sheet 或树形导航。
- `src/app/` 只组装 Provider 与唯一 `WorkspaceScreen`；新版页面、主题和示例数据在 `src/workspace/`。旧 `AppShell`、旧 Screen/Sheet 与产品演示分支已删除，禁止再恢复双界面入口。`ui/Sheet` 当前仅供独立应用更新使用。

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
