# 接口问题记录

遇到不合理/不顺手的服务端接口：先在此登记（现状 / 期望形状 / 理由），然后**停下来报告用户**，由用户介入协调服务端 agent 修改。服务端契约更新后再继续。

| 日期 | 接口 | 现状 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| 2026-10-15 | GET /api/threads（及线程域整体） | 线程无标题字段（仅 `{id, updatedAt}`），且无重命名/删除端点；HANDOFF 会话 Sheet 规格含「重命名」，按现 API 无法实现，列表只能展示 threadId 原文 | 服务端补线程标题字段 + 重命名（可再加删除）端点；或确认移动端去掉重命名、直接展示 threadId | 部分解除：2026-10-18 已实测 DELETE；标题与重命名仍未提供，本轮按 ID 展示 |
| 2026-10-15 | notifications.payload（GET /api/agent） | 类型为 `Record<string, string>`，键名未定义。审批卡需要知道键名（如 file_write→content、file_edit→before/after）才能友好渲染写入预览 | 文档明确各 kind 的 payload 键名枚举 | 待澄清；过渡期从 pi-muse 源码只读提取实际键名 |
| 2026-10-15 | tasks.plan / tasks.evidence（GET /api/agent、任务详情） | 元素结构未定义（`items: {}`），无法类型安全渲染 | 文档给出元素结构 | 低优先：任务详情已有 events 时间线（结构完整）可渲染，plan/evidence 可通用展示或不渲染 |
| 2026-10-15 | 全端点 CORS | OPTIONS 预检返回 204 并回 allow-methods/allow-headers，但**任何响应都不带 `Access-Control-Allow-Origin`**，浏览器跨域全被拦（原生 App 不受影响） | 跨域响应补 `Access-Control-Allow-Origin`（如回显 Origin 白名单） | 已告知用户；过渡期本仓库自带本地代理（tools/dev-proxy.mjs，8791→8788 注入 CORS 头）供 Web 调试，服务端修复后退役 |
| 2026-10-18 | GET /api/agent & /api/events（工作区状态同步） | 保留的数据层仍以 5 秒盲轮询全量快照（新版根入口当前未挂载），高耗电且切后台感知不及时 | 提供全局轻量 SSE（/api/events）+ 默认 7 天活跃快照与 Cursor 分页 + 远程推送唤醒，详见 docs/backlog.md | 方案已定，待服务端协同；据交接说明 `/api/events` 已由服务端提交 `473213f` 交付，但本仓库尚未定位修订正文，客户端未接入 |

## 会话与隔离工作区接口验收（2026-10-18）

### 结论与范围

- 核对用户指定的 `~/Desktop/code/personal-bot/docs/frontend-session-workspace-adaptation.md`、对应请求/响应 schema 与路由；服务端目录严格只读，未修改源码、配置或执行 Git 操作。
- 当时正式实例 `http://127.0.0.1:17890`；仓库提供的 `pnpm dev:mock` 固定为 `http://127.0.0.1:17891`，与移动端旧联调说明的 8788/8790 不同。mock 使用本地 fake model 和 `.pi-muse/mock` 隔离数据，不调用真实供应商。
- 正式实例完成 5 个新增方法的保存、回读与删除 smoke（10 条断言）；只操作本轮自建的配置会话，不调用正式模型/任务/监控。最终正式列表仅 `local-main`，无任务、监控或待审批遗留。
- mock 的最终有效检查为：基础接口 57 条、生命周期 44 条、精确停止/路径边界 7 条，均通过。首轮生命周期脚本有两项测试预期错误（定时结果带 `[定时任务]`；freeze 触发词需全等），修正测试后完整重跑通过，不能算作服务端故障。
- 另外两次独立复现了下述显式来源误投问题，因此当前结论为「核心接口可用，仍需后端修正/明确归属契约」，不是全部验收通过。
- 原始请求结果和脚本保存在 `/tmp/pi-muse-mobile-api-qa-zpdfTA/`，Token 未写入证据。已清理自建普通会话、定时任务、监控和待审批，mock 仅保留终态后台任务/审批历史，符合删除契约；未手工删服务端文件。

### 需要后端协调

| 优先级 | 接口/行为 | 证据与现状 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| P1 | `POST /api/agent/tasks` 的显式 `originThreadId` | 来源是合法但尚未聊天/保存设置的新 ID 时，创建返回 200、任务 succeeded，结果通知却进 `local-main`，指定会话历史仍是 `empty`。在 17891 两次独立复现；已有聊天或仅保存设置的会话均正确。源码 `src/features/tasks/task-worker.ts:51-57` 对 `hasThread=false` 静默回退主会话；监控投递初始化也有同类回退，监控实际命中场景尚未动态验证。 | 显式来源不得静默改投主会话。推荐接受合法新 ID 时建立/保留来源并投递该来源；若只允许持久化来源，应在创建时返回明确 4xx，且不得已排队。来源删除后的策略也应明确，不能误投或复活旧会话。 | 待用户协调服务端 |
| P1 | `GET /api/conversation?threadId=` 的只读副作用 | 移动端真实 HttpApiClient + ThreadSessionStore 集成验收中，DELETE 后列表已无旧 ID；随后 GET 同 ID 历史返回 `{revision:"empty",messages:[]}`，再 GET 列表该 ID 又出现。请求证据 `/tmp/pi-muse-mobile-session-qa-WjsIHE/http-store-results.json`。 | 读取缺失/已删会话历史不能重新建立目录或列表项；首次显式 run/保存设置再创建。客户端已在删除开始取消历史读、成功切主会话并屏蔽迟到结果，但跨端迟到 GET 仍需服务端保证只读。 | 新增待协调 |
| P2 | 文件工具错误信息 | 读取不存在的 `draft.md` / `shared/...` 时，HTTP 权威历史与 SSE 回复可见服务端完整绝对路径（含本机用户名、数据根和线程目录），而不是逻辑路径；不影响越界拒绝本身。 | 保留明确 not-found/denied 信息，但在工具结果与上层回复前统一净化本机绝对路径，只回逻辑路径和稳定错误信息。无需前端反向解析/掩盖。 | 待服务端评估 |
| P2 | OpenAPI 来源说明与部署标识 | 当前任务/监控端点 hint 仍写「进主聊天流」，与已有来源正确投递的实际行为不符；`info.version` 固定 `1.0.0`，health 无 build/capabilities，无法从运行实例确认交接提交 `e37e544`；本次正式服务期间曾自行重启，未对其做控制。 | 更新端点提示为「显式来源/缺省主会话」；提供可核验 build/commit 或能力版本，区分本交接与并行 `/api/events` 交付。 | 待服务端评估 |

### 声称修复后的独立复验（2026-10-18）

- 用户提供的实际地址为 `http://192.168.55.201:17890/`。本次重新取得会话、使用 no-cache 请求读取 health/OpenAPI/list，并只用专用验收 ID 进行规则保存、删除和历史回读。**当前该实例仍复现 GET 历史创建空会话及删除后重建列表项**，因此没有把修复状态标为完成。
- 该实例对尚不存在的显式 `originThreadId` 仍返回 200/queued，未建立来源会话；立即取消本轮任务成功（终态 cancelled）。没有等待真实供应商完成，**不声称本次已在正式实例复现最终通知误投**。任务记录按契约保留；最终列表仅 local-main，无活跃任务、监控、pending。
- 从当前 `~/Desktop/code/personal-bot` 源码运行其官方 `pnpm dev:mock`，独立复验 12 条观察：4 条控制/清理检查通过，8 条预期检查未通过。仍见未持久化来源任务结果进入主会话、监控接受悬空来源、已删来源任务仍被接受、历史 GET 重建、文件 not-found 绝对路径泄漏、OpenAPI 旧来源文案及缺少部署标识。已有来源任务仍正常执行并投递来源。
- 只读源码定位仍保留上述路径：`task-worker.ts:51-57`、`create-service.ts:185` 的缺失来源回退；`routes/conversation.ts:11-21` 经 hub 初始化历史；`session-history.ts:27-33` mkdir；`path-guard.ts:37-40` 缺失文件异常未净化；health/OpenAPI 的版本与 hint 未变。未读取或修改服务端配置/密钥，未对服务端做 Git 或重启操作。
- 据交接说明，`/api/events` 由独立提交 `473213f` 交付；这是文档范围的更新，**不代表上述四项已在当前源码/部署修复**。本仓库尚未定位该修订正文，移动端也未接入通知流或解除来源保护。
- 证据 `/tmp/pi-muse-fix-recheck-5uOBnJ/`（`deployed-recheck.json`、`deployed-origin-recheck.json`、`latest-mock-results.json`、`final-cleanup-state.json`），Token 均已遮蔽。自建普通会话和监控已清理，mock 仅保留终态任务及复现通知；本轮不修改产品代码或撤掉保护。

### 移动端已完成与临时边界

- 以下为保留数据层与测试层面的已完成项；新版根入口当前仍未挂载真实连接，因此不等于已在新版 UI 生效。
- 已接五个会话方法、规则编辑/清空、二态技能与恢复默认、诊断、危险删除、连接内分会话草稿和迟到请求保护；不持久化业务正文，改服务器随工作区销毁。
- 后台任务页面显式传来源，`local-main` 也传；只列服务端已确认的普通会话。本地未保存会话明确提示不可作来源，不偷偷保存空规则或发消息。来源若被其他端删除，仍需要后端在创建时校验，客户端不能提供强一致保证。
- 文件工具标明私有/shared；审批继续全局可见，展示服务端 threadId/runId，保留完整 payload；不通过路径猜工具卡决定。增加 instructions 中文卡与下一轮提示，不从摘要推断规则正文。
- 回到聊天 tab、手动刷新工作区、回前台时重新读取当前权威历史；运行中不覆盖流式视图。保留数据层的五秒快照轮询不改为未交付的通知流，不承诺自动实时聊天推送。

### 可接受的当前限制（不要求本轮后端扩展）

- 规则无专用 revision/ETag：本轮采用显式保存、每次打开回读、保留未保存草稿；不宣称多端 CAS。需要可靠冲突控制时再补契约。
- 技能响应不返回原始 overrides：只能准确做二态生效开关加「恢复全部默认」。若做逐项继承三态，再要求返回 overrides/isOverridden；不靠 enabled 等于 defaultEnabled 猜测。
- `TaskDto` 无来源字段：本轮全局列表不做来源徽标/跳转/会话筛选；`MonitorDto` 有可选来源可展示。
- 未提供文件 REST、重命名与技能安装管理，均不虚构能力；`/api/events` 虽出现在当前 OpenAPI，本次未接入或验收，按独立交付处理。
- 本次动态验证覆盖私有写/读/编辑、跨会话隔离和越界拒绝、shared 路径解析及越界拒绝；未完成 shared 写入互通、链接拒绝、网页监控实际命中通知、规则 system 注入与 web 技能工具目录裁剪的端到端验证。默认工具投影为 hidden，没有据此判定 SSE 工具事件缺失故障。

## 本轮核对（2026-10-15）

- 已实际读取 `http://127.0.0.1:8790/openapi.json`：文档接口可用，会话仍只有 `id/updatedAt`，没有重命名端点；重命名继续等待协调。该文档实例与隔离 mock 8788 不同，不能据此宣称 mock 或真实模型已验收。
- **聊天卡审批关联待协调**：当前审批通知可含 threadId/runId，但没有 toolCallId；同一轮可能多次写同一路径，仅按路径或时间匹配会串错审批。期望通知增加 toolCallId，或 SSE 提供 notificationId 关联。客户端保留审批列表的准确状态，并增加聊天卡“查看审批”入口；不猜测每张工具卡的批准/拒绝状态。
- **结构化天气待协调**：`get_weather` 当前通过 SSE 只投影格式化文本，无法稳定取得温度、湿度、观测时间等结构化字段。期望在工具结果契约提供带版本的结构化数据；客户端暂提供天气专用文本卡，不用正则反向解析展示文案。

## 真实 mock 联调补充（2026-10-15）

- **已修复客户端旧契约适配**：以当前 8788/8790 OpenAPI 为准，聊天改为 `POST /api/conversation/run` 的 `{threadId,runId,expectedRevision,message}` 增量请求；历史保留 `{revision,messages}`；停止改为 `POST /api/conversation/stop` 并同时匹配两个 ID。任务 kind/target 使用 `job|task`，详情读取 `{task,events}`。`GET /api/agent` 不再含审批正文，由客户端并行读取 `/api/actions/pending` 后合成展示状态。本次登录中实际提交的最近决定只在客户端内存保留。
- **工具投影缺失，待服务端协调**：在隔离 mock 8788 新建会话 `mobile-tools-smoke-1792053047670`，发送「写入工具投影验收」，确认 `/api/actions/pending` 出现该会话的写入审批并通过决定端点拒绝（200）。实际 SSE 仅有 `RUN_STARTED/TEXT_MESSAGE_*/RUN_FINISHED`，没有 `TOOL_CALL_*`；随后权威历史也只有 user 与 assistant 文本，没有 toolCalls/tool 消息。浏览器批准与拒绝流程同样能执行，但聊天专用工具卡缺少可消费的事件与历史。期望工具执行时发出 AG-UI 工具事件，历史保留调用与结果投影。移动端不猜测助手回复来还原工具调用；前一轮固定数据卡片验收继续有效，真实工具卡全链路保持阻塞。本仓库未修改服务端。

## Android APK 更新的原生边界（2026-10-17）

- 应用更新来自官方公开 GitHub Release，与用户服务端接口及凭据隔离；不新增服务端接口，不改CI发布流程，也不接Expo OTA。首次需手动安装含更新模块的APK，之后自动检查/下载/唤起系统安装器；系统授权、签名与安装确认不可绕过。
- 原生正式包验收发现HTTP内网地址被Android默认明文策略阻止，Expo Go smoke不能发现该问题。已通过SDK57的expo-build-properties显式允许用户选择的HTTP服务地址；UI明文风险提示保留，APK更新入口仍只接受官方HTTPS。
- 服务端快照不可达不应阻止应用自更新；更新/连接入口已脱离快照门控，服务器偏好编辑器仍需真实数据后展示，避免空值误写。
- 最终188项测试、13条浏览器断言与API36独立测试APK的系统覆盖安装流程通过；临时同测试签名验证不代表生产keystore或物理真机已重验，详见HANDOFF文首。未修改服务端源码或CI，主仓库版本字段最终与HEAD一致，未提交/推送。

## 运行时连接配置（2026-10-17）

实现与本机可执行的验收已完成：127项仓库测试、68条浏览器断言与Android原生连接流程通过；三平台JS/Hermes导出通过，不等于iOS运行或正式包验收，细节见HANDOFF文首。

- 单服务器运行时配置：登录页表单输入 URL + 可选 Key，运行时保存；没有编译期默认地址或多 profile。
- 持久化字段 `{serverUrl, token?, resetPending?}`，**地址与 Token 绑定保存在同一 JSON**。**Key 仅表单内存**，不写入存储。
- Token 模型变更：用户已明确后端永久 Token 模型稍后同步，前端不再以旧 24h 文档为阻塞；客户端不解析 `exp`、不计时过期、不主动续期。
- 错误语义：网络/超时/5xx 保留 token 与草稿，仅原址重试；401 仅清凭据原址重登，不清业务数据。"更改服务器"页允许离线保存新地址，不沿用旧 Token；规范化后与旧地址不同保存前二次确认清本地业务数据与旧凭据（不删远端）。
- 存储契约：使用 `pi-muse-connection` 单条记录，不保留任何旧键兼容逻辑。
- 预留 `src/connection/cache-reset.ts` 的 `clearLocalWorkspaceData()`（async 空实现）：先写 `resetPending` journal，清理成功再放行，失败可重启恢复。
- 联调示例：Web `http://localhost:8791`（8791→8788 代理带 CORS 头）；Android 模拟器 `http://10.0.2.2:8788`；iOS 模拟器 `http://127.0.0.1:8788`；真机手填设备可达 URL。
- 旧环境变量 `EXPO_PUBLIC_API_BASE_URL` 已不再用于连接配置，开发地址须在 UI 手填。
- 本仓库未修改服务端源码、CI 或版本字段。

## 全量回归的联调边界（2026-10-16）

- **监控 HTTP 全链路缺可控 fixture**：本轮隔离 mock 工作区没有监控条目，`tests/support/fake-model.ts` 提供了 schedule/memory/write 等固定触发分支，但没有 monitor 触发分支；不能仅发送监控文案就宣称已创建并验收。客户端演示模式的创建、暂停、恢复、停止与超过三条折叠已实测，HTTP 控制请求契约已有自动化测试；真实 HTTP 监控控制仍需服务端提供可控监控 fixture 或在授权真实模型环境联调，不是控制端点已确认失败。
- 工具投影、天气结构化与会话标题等历史协调项没有因演示通过而解除；本轮没有调用真实远程模型，也没有修改服务端源码或配置。
