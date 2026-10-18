# 接口问题记录

遇到不合理/不顺手的服务端接口：先在此登记（现状 / 期望形状 / 理由），然后**停下来报告用户**，由用户介入协调服务端 agent 修改。服务端契约更新后再继续。

| 日期 | 接口 | 现状 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| 2026-10-15 | GET /api/threads（及线程域整体） | 线程无标题字段（仅 `{id, updatedAt}`），且无重命名/删除端点；HANDOFF 会话 Sheet 规格含「重命名」，按现 API 无法实现，列表只能展示 threadId 原文 | 服务端补线程标题字段 + 重命名（可再加删除）端点；或确认移动端去掉重命名、直接展示 threadId | 待用户裁决 |
| 2026-10-15 | notifications.payload（GET /api/agent） | 类型为 `Record<string, string>`，键名未定义。审批卡需要知道键名（如 file_write→content、file_edit→before/after）才能友好渲染写入预览 | 文档明确各 kind 的 payload 键名枚举 | 待澄清；过渡期从 personal-bot 源码只读提取实际键名 |
| 2026-10-15 | tasks.plan / tasks.evidence（GET /api/agent、任务详情） | 元素结构未定义（`items: {}`），无法类型安全渲染 | 文档给出元素结构 | 低优先：任务详情已有 events 时间线（结构完整）可渲染，plan/evidence 可通用展示或不渲染 |
| 2026-10-15 | 全端点 CORS | OPTIONS 预检返回 204 并回 allow-methods/allow-headers，但**任何响应都不带 `Access-Control-Allow-Origin`**，浏览器跨域全被拦（原生 App 不受影响） | 跨域响应补 `Access-Control-Allow-Origin`（如回显 Origin 白名单） | 已告知用户；过渡期本仓库自带本地代理（tools/dev-proxy.mjs，8791→8788 注入 CORS 头）供 Web 调试，服务端修复后退役 |
| 2026-10-18 | GET /api/agent & /api/events（工作区状态同步） | 客户端目前每 5 秒盲轮询全量快照，高耗电且切后台感知不及时 | 提供全局轻量 SSE（/api/events）+ 默认 7 天活跃快照与 Cursor 分页 + 远程推送唤醒，详见 docs/backlog.md | 方案已定，待服务端协同 |

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
