# 新接口对接交接：会话信息区、全局 SSE 与审批

更新时间：2026-10-19（本机）。本文是本轮工作的接手入口；旧 UI 历史与验收记录见 `docs/HANDOFF.md`。

> **后续进展（2026-10-19）**：已定位实际服务 `/docs` 与 `/openapi.json` 的新契约，用户决定分模块适配；会话与聊天数据层、299项回归和19项隔离HTTP联调已通过，新全局 SSE／审批尚未接入。详见 `HANDOFF.md` 文首。下文“修订正文未定位”及对应 Git 状态为早先交接快照，不再是当前阻塞。mock启动的旧审批数据问题已按用户明确授权，仅重置该测试审批文件且不备份，17891已恢复；未改实际服务数据。

## 0. 接手结论

**新版 UI 已获用户认可并成为唯一默认界面；截至 2026-10-19 文档整理，仍未实现新全局 SSE／审批协议的客户端接入。**

本轮原本要做的是：同步服务端修订后的协议文档，确认契约后，把真实的当前执行状态和完整审批接到现有新版 UI。不要重新设计界面，不要恢复旧工作区，也不要转去修改服务端。

用户已说明：此前客户端提出的七项技术问题已交服务端处理，更新文档在“原来的分支”。当前 Agent 没有可靠定位到这份修订正文，任务停在**文档定位／版本核对**，不能说新协议已对接，也不能断言服务端没有更新。

用户最后要求生成 handoff，由其他 Agent 接手。本次只写交接，不实施业务改动、不提交、不推送。

## 1. 用户已确认的产品与术语

以 `AGENTS.md` 为约束，尤其：

- **会话信息区**：聊天页顶部中间，头像、名称、当前状态组成的整块可点击区域；不只是头像图片。
- **会话面板**：点击会话信息区打开的全屏当前会话页面，内部动态／审批／工作区／历史四个胶囊 Tab 平级切换。
- **顶栏**：整个聊天页顶部，包含左侧会话切换按钮、中间会话信息区和右侧按钮。

UI 基线已获用户明确认可，亮暗主题均须保留：

- 左侧是揭示式会话栏：聊天前景整体右移并出现大圆角，不是底部 Sheet，也不是盖在静止聊天上的菜单。
- 左侧只承担切换／新建会话，不加入任务、目标、记忆、服务器等综合导航。
- 会话信息区打开根层全屏会话面板，不用底部 Sheet、居中小卡片或“列表→子页→返回”的树形导航。
- 会话面板只展示当前会话相关内容；全局 SSE 指订阅覆盖所有会话，不代表当前会话页面混入其他会话数据。
- 用户已明确删除旧默认工作区，只保留新版；不要再提供旁路预览或返回旧 UI 的入口。

## 2. 当前客户端事实（交接时已重新核对）

### Git 与运行状态

- 工作区：`/Users/yaotutu/Desktop/code/pagent-mobile`。
- 当前 Git 分支：`feat/ui-preview-themes`。
- 当前 HEAD：`25a14fc refactor: 仅保留新版工作区并清理旧界面`。
- 前一个 UI 提交：`86f4144 feat: 还原会话 UI 预览并支持亮暗主题`。
- 本轮没有创建新接口提交，也没有执行分支删除。
- 用户曾说“删除当前分支”，但随即明确“停止一下”，询问本轮是否在做新接口。**不要据此删除 Git 分支、丢弃未提交文件或删除 UI。**
- Expo 服务在交接时仍监听 `8082`，PID `52551`。地址：`http://127.0.0.1:8082/`。接手时应重新验证，不因本记录擅自重启。

### 入口与文件

- `src/app/AppRoot.tsx` 只挂载安全区、异常边界、独立 `UpdateProvider` 和 `WorkspaceScreen`。
- `src/workspace/WorkspaceScreen.tsx`：新版聊天、侧栏、四个主 Tab。
- `src/workspace/SessionPanel.tsx`：当前会话全屏面板。
- `src/workspace/WorkspaceTheme.tsx`、`src/ui/tokens.ts`：亮暗主题，当前默认亮色，仅内存持有。
- `src/workspace/sample-state.ts`：当前运行使用的假会话、消息、活动、审批、文件和历史 reducer。
- 运行界面仍明确显示“示例数据 · 尚未连接服务端”，不发业务 API、不持久化假数据；真实连接、历史恢复、快照轮询均未在新根入口挂载。
- `src/preview/`、旧 `AppShell`、旧会话 Sheet 和旧产品演示入口已删除。旧演示 API 位于 `tests/helpers/`，仅作测试夹具。
- `assets/sample/` 是用户截图裁剪的临时参考素材，不是已确认可正式分发的品牌资产。

### 保留的数据层不等于已接通

- `src/api/{contracts,types,http-client,sse}.ts`：旧 HTTP／聊天 SSE 契约与实现。
- `src/connection/`：连接状态机、地址／凭据绑定存储、安全逻辑。
- `src/threads/`：会话 store、Provider 与 hooks。
- `src/chat/{useConversation,chat-state,tool-presentation,file-scope}.ts`：历史、流式聚合及纯展示逻辑。
- `src/workspace/useWorkspaceSnapshot.ts`：保留但不挂载。
- `src/update/`：与业务凭据隔离的 Android 更新，保持原有签名、授权和安装确认边界。

## 3. 当前任务的准确范围

1. 找到用户所指原分支的**修订协议正文／契约源**，先辨明是 Git 分支、worktree，还是对话分支；不要自行假定。
2. 核对之前七项技术问题是否已在正文中定义，已解决的不要重新要求用户决策或重复汇报。
3. 根据最终契约做客户端接入设计／实现；接口事实来源为服务端 `/docs` 和 `/openapi.json`，草案与部署能力要分开。
4. 主要服务于：会话信息区短状态、当前执行展示、会话面板待审批完整预览及独立 HTTP 决定。

不在本轮范围：重新做 UI、删除 Git 分支、服务端实现、重做活动历史模型、系统锁屏推送、全面对接目标／记忆／文件管理等其他领域。活动列表／详情由另一服务端 Agent 负责，本客户端只消费其最终契约。

## 4. 已收到的 SSE 草案（不是已实现能力）

用户提供的原稿明确写着：用于双方确认，服务端尚未按此版实现，线上旧协议仍是空对象通知。

拟定端点：`GET /api/events`，Bearer token，`text/event-stream`，全局单向推送，不替代聊天文字流、不发送内部思维、不通过 SSE 接收用户决定。

| 事件 | 原草案载荷／语义 |
| --- | --- |
| `ready` | `{serverTime, agentStatuses, pendingApprovals}`；每条连接首帧，当前完整集合，重连替换，空数组清空，不含历史或7天过滤 |
| `agent_status_updated` | 对应 `threadId + runId` 的完整执行对象，含活动关联、来源、标题、状态、阶段、短说明、工具、子代理、待审批ID与时间 |
| `approval_pending` | 完整待审批：ID、会话／运行、kind、title、preview.path/before/after、创建／过期时间 |
| `approval_updated` | 审批ID、会话／运行、approved/denied/expired/cancelled 与处理时间，不重复正文 |

原草案执行 `status` 为 `running/succeeded/failed/cancelled`；`phase` 为 `preparing/waiting_model/responding/executing_tool/waiting_subagents/waiting_approval/finalizing/null`。这些仍待与执行／活动负责方最终模型统一，**不要把“一轮正常结束”自动映射为“整项活动完成”**。

其他原稿约定：

- 审批决定候选路径 `POST /api/approvals/{id}/decision`，body 为 `{decision: "approve" | "deny"}`；最终响应与错误规则须看修订文档。
- approved 只代表授权，不等于文件提交成功。
- 命名事件读取 `event:`，标准 SSE 空行分帧、多条 `data:` 拼接；30秒注释心跳。
- 无 SSE 事件 ID、无历史重放；断开此全局连接不取消 Agent。
- 当前集合恢复与历史查询分开；不能从 ready 中某项消失推断它成功或获批。

## 5. 此前七项技术确认清单

**用户表示已让服务端处理；本表只供核对修订正文，不是要求用户重新讨论，也不是客户端自行拍板的字段。**

1. **ready 一致性与版本**：快照生成期间不漏更新；执行／审批对象 revision；HTTP 与 SSE 同版本规则；服务重启的版本作用域／重同步。
2. **执行模型**：chat/job 来源覆盖、activityId 与活动记录关联、同会话并行运行规则、queued 子代理字段、父运行终态后的工具／审批收尾。
3. **来源关联**：审批与 toolCallId/subagentId；顶层 tools 是否含子代理工具及其归属。
4. **授权绑定**：同审批ID的操作和完整预览不可变、实际提交前版本校验、私有／shared作用域、file_write新建与覆盖空文件区分。
5. **审批 HTTP**：最终路径／响应、权威终态版本、同决定重复提交、相反决定／过期／撤销、权限／不存在、超时结果查询、decidedAt与resolvedAt语义。
6. **体积边界**：单条审批／事件 UTF-8字节上限、ready总载荷／待审批数量、超限处理；不能静默截断后仍可批准。
7. **无重放恢复**：执行和审批终态的查询方式、ID／状态与SSE一致；重连集合消失不代表具体结果。

## 6. 文档定位现状：事实与不确定性

### 已知位置

- 服务端实际目录：`/Users/yaotutu/Desktop/code/personal-bot`。旧文档中的 `~/Desktop/code/pi-muse` 本机未找到。
- 活动实现 worktree：`/Users/yaotutu/Desktop/code/pi-muse-activity`，已知分支 `feat/activity-records`；只读对接，不擅自操作服务端 Git／worktree。
- 用户指定服务：`http://192.168.55.201:17890/`。
- 文档入口：`/docs`、`/openapi.json`，README 明确生成文档优先于手写说明。
- 相关本地材料：
  - `personal-bot/docs/discussions/approvals.md`
  - `personal-bot/docs/discussions/activity.md`
  - `personal-bot/src/http/contracts/workspace-events.ts`
  - `pi-muse-activity/src/http/contracts/activities.ts`

### 本轮看到的版本

此前只读访问部署 OpenAPI 时，标识为 `0.1.0+a8ed838da9ee`、commit `e6b3639b42fac0e27618fb2d61caec6887100948`，当时 `/api/events` 仍是 `ready/workspace_updated/actions_updated`、`data: {}`，要求随后查询。

本地已查看的 `workspace-events.ts` 也仍定义旧空通知协议；审批讨论文档当时仍把具体请求／响应等列为未定稿。活动 worktree 中已出现活动实现／查询契约，但这不证明新全局SSE已实现。

**这些只能证明所查看版本的状态，不足以证明修订文档不存在。** 用户已强调文档在原来的分支；交接时没有可靠定位到该分支上的新正文。上一 Agent 曾断言“服务端答应却没写”，该结论过度，应撤回为“尚未在已检查的版本中定位到修订文档”。接手不要把这句断言当事实继续质疑用户。

## 7. 客户端接入的已知技术边界

- `src/api/sse.ts` 现有 `parseSseFrames` 是聊天 AG-UI 解析器：按 `data: ` 行独立解析 JSON，忽略 `event:`，不能直接用于新全局命名SSE；新增解析器或隔离升级，保留原聊天契约与测试。
- 旧审批读取为 `GET /api/actions/pending`，决定为 `POST /api/actions/{id}/decide`，返回旧 `ApprovalNotification`；不能认为它等同于草案 `/api/approvals/{id}/decision`。
- 全局状态按 `threadId/runId` 归属保存；切会话不应串状态。会话信息区只取当前会话，不取全局第一条。
- 认证与流生命周期继续遵守地址／Token绑定、401单独处理、请求代次与abort、回前台重同步等安全边界；不能把 token 放URL。
- 新版没有真实连接入口／Provider挂载。接入时需要明确恢复其生命周期，但不能为此恢复旧UI或重新引入双界面。
- 不用旧 TaskKind（job/task）猜新 source，不恢复已下线的后台 worker／delegate_task。

## 8. Git 工作区保护

交接时共有二十余项未提交／未跟踪条目（含本文）；数量会随其他 Agent 的工作变化，以实时 `git status` 为准。它们混有更早的会话／API适配，不全属于本轮，不要 `reset --hard`、`clean`、`stash` 或 `git add -A`。

已修改：

```text
AGENTS.md
docs/HANDOFF.md
docs/notes.md
src/api/contracts.ts
src/api/http-client.ts
src/api/types.ts
src/chat/useConversation.ts
src/threads/useThreads.ts
tests/demo-api.test.mjs
tests/helpers/demo-api-client.ts
tests/helpers/demo-fixtures.ts
tests/http-api.test.mjs
```

未跟踪：

```text
.idea/
docs/HANDOFF-SSE-APPROVALS.md
src/activity/task-source.ts
src/chat/file-scope.ts
src/threads/ThreadSessionProvider.tsx
src/threads/thread-session-store.ts
tests/file-scope.test.mjs
tests/helpers/demo-thread-settings.ts
tests/task-source.test.mjs
tests/thread-session-store.test.mjs
```

本文及 `docs/HANDOFF.md` 入口指针是本次交接新增内容，生成后未重新提交。接手以实时 `git status` 为准；`.idea/` 不纳入业务提交。

旧UI清理前的源码与diff备份：`/Users/yaotutu/.zcode/cli/backups/pi-muse-mobile-ui-retirement-20261018-223434/`。不是要恢复旧UI，仅供必要时找回被清理页面中的未提交逻辑。

## 9. 已有验证与本轮未做项

- 唯一新版UI清理阶段曾通过完整工作区284项测试、lint、typecheck及三平台导出，产物 `/tmp/pi-muse-single-workspace-final/`；当时UI清理独立提交快照223项测试通过，范围不同。
- 这些是历史验收，不等于新SSE已通过。本轮没有新增全局SSE consumer、标准命名事件解析、重连store或真实审批展示。
- 没有对真实服务发送聊天、批准、拒绝、写文件等业务操作；没有本轮模型调用／原生运行验收。
- 生成 handoff 时仅更新 Markdown，文档格式／引用检查、lint、typecheck 通过；当时未重新运行工程全量测试。这些是生成交接时的检查结果，不代表业务代码或新协议已通过验证。
- 2026-10-19 整理提交前，主 Agent 重新运行 `npm run lint`、`npm run typecheck` 和 `npm test`，全部通过（284/284 测试）；文档整理子任务本身仅校对 Markdown，未单独运行这些命令。本次仅整理交接表述、本机 IDE 忽略项与测试夹具文件结尾，未新增业务实现；新全局 SSE／审批对接仍停在修订契约定位，上述结果不是新协议验收。

后续代码修改完成后至少运行：`npm run lint`、`npm run typecheck`、`npm test`；SSE还应补跨chunk、命名事件、多行data、心跳、ready替换、重连、迟到响应、审批归属与重复决定测试。真实联调前确认版本和安全数据边界。

## 10. 不要重演的工具问题

上一 Agent 在 `ReadSessionContext` 中带了 `attachment` 却使用 `strategy: relevant`，被校验拒绝后反复只改查询文字，造成大量无效调用；还曾口头说已去掉参数但实际没有。**错误发生在检索工具，不是用户文档或服务端故障。**

若确实需要读取用户明确引用的原会话，仅传必要字段，例如：

```json
{
  "sessionId": "sess_6ac9028a-f821-4ebf-a77b-855a06d6a1d0",
  "strategy": "relevant",
  "query": "定位修订版全局 SSE 与审批协议文档的明确路径或分支",
  "maxTokens": 4000
}
```

不要填 `attachment` 或不需要的 `cursor`。附件仅用于已归档话题附件且必须使用相应topic流程；不能拿普通消息ID假装附件。相同参数错误出现一次就修正，仍失败则停下，不循环。不要通过shell扫描ZCode日志／数据库去读取别的会话；原会话提取结果也只是背景，不能用助手旧结论推翻用户最新陈述。

## 11. 建议接手顺序

1. 读 `AGENTS.md`、本文，核对实时Git状态。保持用户已确认UI原样。
2. 只围绕修订协议做一次有界定位；若仍无法确定“原分支”，只问一个具体的分支名／路径问题，不再把七项技术问题全发给用户，也不要求用户先把接口上线。
3. 找到正文后按第5节核对，记录最终路径、版本、字段及哪些是草案／实现；只反馈真正剩余的阻塞。
4. 契约可用且用户授权进入实现时，接入客户端数据层和新版UI，不修改服务端，不把假数据与真实响应混用。

**用户不希望再听已确认正确的部分反复汇报。聚焦实际工作和仍未解决的阻塞；不猜测、不无限搜索、不新增无关功能。**
