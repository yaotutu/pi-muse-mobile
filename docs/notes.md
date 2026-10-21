# 接口问题记录

遇到不合理/不顺手的服务端接口：先在此登记（现状 / 期望形状 / 理由），然后**停下来报告用户**，由用户介入协调服务端 agent 修改。服务端契约更新后再继续。

## 2026-10-21：主题最终验收环境中断，待稳定窗口

- 主题代码、本机偏好及永久 `test:e2e:themes` 已实现，本地405/405、typecheck、lint及三平台导出通过。当前不是主题接口缺失，也不是通过修改服务端来解决的问题。
- 实际17890＋Android已验证三套配色、草稿／当前空间／会话面板／筛选保留、真实连接Modal、一次原生实际聊天与HTTP／SSE终态、晨光白及深夜黑跨进程恢复；整轮尚未走完经典蓝白冷启动、320dp窄屏及最后的原生错误日志断言。
- 00:27左右模拟器ADB离线并消失，之后qemu进程与Metro8082均不在。验收部署sourceHash从 `b9ce61299f8c` 变为结束时 `16a0d846daf5`，随后只读健康检查又为 `6467aac7d5f1`。原生驱动和部署一致性断言均失败，严格保持待真实接口验收，不能拼接为通过。
- 79个客户端源码模块与本轮开始未变；专用空间经API删除、原有空间保留，未改服务端源码／配置／存储／Git或读取设备凭据。原始失败证据 `/var/folders/hl/dngy2s057pq4wyny6k87sj9w0000gn/T/pimuse-themes-e2e-run.2Fifyn/`，本地日志及抽离一致性证据 `/tmp/pimuse-themes-20261020-235959/`。
- 后续记忆／活动原生回归按前置门禁未启动。需先协调稳定部署并恢复模拟器、Metro，再从头验收；本轮不提交／推送，不用旧结果或mock替代。此前审批自然过期等独立未验项仍保留。

## 活动推送与长期记忆接口差异（2026-10-20）

- **核对部署**：实际17890的 docs／OpenAPI／health 均为 info.version `0.1.0+5711a4829036`，commit `59013f5af4529ee10fb33ded675e897d8115f61d`、sourceHash `5711a4829036132d58f05e7b68e709c9d7c1aa0980c4ab13957ed27da4803cfd`、dirty/source。本节是新一轮接入，不把下方旧部署结果当作本轮验收。
- **活动文档措辞滞后**：`/api/events` 明确声明必需的 `ready.activities` 和 `activity_updated`，真实首帧也包含数组；但活动查询说明仍残留“没有新增SSE”的旧说法。客户端以事件端点的完整契约为准，当前非终态集合整体替换，状态概览按接收顺序更新；步骤和过程进展仍查询，不增加第二条通知流或轮询。建议后端同步查询文案，避免其他消费端继续忽略活动事件。
- **记忆默认来源不一致**：新增记忆的 OpenAPI 将 `source` 默认值描述为 `Apps UI`，真实未传来源的原生新增实际返回 `Web UI`。首轮测试严格来源断言失败，未伪称整轮通过，专用条目已通过API删除且原有记忆未变。已向用户报告；建议后端统一默认值与文档。`source` 本身是可显式传入的自由文本字段，客户端现明确发送 `Mobile UI`，按契约使用该字段而不依赖不一致的默认值；编辑继续保留服务端来源。未改服务端源码、配置、存储或Git。
- **记忆写入边界**：没有记忆SSE、revision或幂等键，不以 `/api/agent` 大快照替代独立读取，不跨空间伪造隔离。成功后回读，网络／超时／取消／5xx结果未明时保留草稿并锁定重提，要求读取全部记忆和用户明确核对；不自动重试或用相同正文猜测成功。
- **本轮最终结果**：在上述同一部署，活动SSE／历史和记忆两个永久真实端到端测试最终均退出0；分别11组整轮＋14组Android检查、11组整轮＋8组Android检查通过，专用数据经API清理、原有内容保留。383/383本地测试、lint、typecheck及diff检查通过，未跑mock；67个`src/`模块在最终验收前后未变。证据 `/tmp/pimuse-mainline-20261020/acceptance.json`，详细真实与本地故障注入边界见 `HANDOFF.md` 文首。上述默认来源与旧SSE文案仍属后端文档差异，不因客户端显式传参或本轮通过而记为后端已修复。
- **原审批协调项独立保留**：本轮不复验自然过期，不据活动／记忆主线结果声称提前TIMEOUT／cancelled已修复。新一轮最终验收状态与未覆盖边界见 `HANDOFF.md` 文首。

## UI 重构的真实联调范围补充（2026-10-20）

- **本轮没有新增必须协调的接口阻塞**：实际17890、固定 sourceHash `af4338505f9890d54def781c1f1bb33b440a49b17cd98dafcf85547f0001fbfa`，活动历史、原生审批批准／拒绝、活跃运行关联跳转与Stop、同址连接测试、聊天流式与进程恢复、默认／可选重置均已分别完成真实客户端验收。详细范围、清理及未验边界见 `HANDOFF.md` 文首与 `/tmp/pimuse-ui-20261020/acceptance.json`。
- **通知边界不是接口缺陷**：`ready` 不保留已结束 run，不能要求漫长历史验收后“当前执行”仍持有某次终态。持久历史入口独立验证；明确的 run→activity 跳转已在真实待审批的活跃运行中原生验证，并经HTTP核对绑定后精确Stop。不修改 ready 整体替换规则，也不恢复旧快照或轮询来伪造当前执行。
- **自动过期仍是未复验项**：下方提前 TIMEOUT／cancelled 是此前部署的真实历史记录，本轮UI重构没有重新触发自然过期路径。新 sourceHash 的主流程通过不能证明过期路径已修复，也不能把旧复现写成在当前部署再次复现；该项继续保留待针对性复验，不新增虚假的后端修复结论。

## 修复后复验：重置计数已修复，审批自动过期仍待协调（2026-10-20）

- **重置计数已解除**：实际17890的新部署 sourceHash 为 `8e1dc7c935c630e34f2e169076ace246e78e95ef11cc52df37dde0f78d26bf7e`，commit 仍为 `59013f5af4529ee10fb33ded675e897d8115f61d`、dirty/source，docs/OpenAPI/health 一致。与上次快照逐项比较，端点及 schema 未变，无需前端再次改字段。新文档明确计数包含关闭活跃运行时撤销的审批；真实 pending 重置后 cancelled、空历史、新 session，回执已正确返回 `cancelledApprovals=1`。旧的0值记录仅保留为历史，不再标作当前阻塞。
- **空间迁移主链路通过**：修正下述工具投影测试假设后，最终 `E2E_NATIVE=1`、`scope=full` 整轮重跑通过，9组整体检查及4组Android原生交互通过；包括此前被截断的真实文件保留、新会话精确Stop、旧Stop无副作用和停止后继续。证据 `/tmp/pimuse-spaces-fixed-verified-20261020/`，前后部署和客户端源码哈希一致。349/349本地测试、lint、typecheck及diff检查通过；未跑mock。该结论不包含下述独立过期场景，也不补齐未运行的物理机／独立APK／iOS等边界。
- **独立遗留项仍复现**：space=`space-expiry-mvgihg32`、approval=`ad33c26a-5f60-4502-a69a-2208638785bc`。真实 `createdAt=2026-10-20T09:59:30.944Z`、`expiresAt=10:04:30.944Z`；`10:01:28.704Z` 已变 cancelled，decidedAt/execution=null；聊天明确收到 `RUN_ERROR`、code=`TIMEOUT`、message=`Model response timed out`。等待期间未提交决定或 Stop，也未更改服务端时限。这次在新部署重新复现，不能再仅称“旧部署尚未验证”。
- **需要后端说明／处理**：请明确审批等待与聊天运行超时的契约，提供能合法等待至 `expiresAt` 的真实场景，再验证 expired、晚到决定409和原生终态消费。运行超时后取消审批本身符合取消安全语义，但当前窗口使5分钟自动过期路径无法验通；不把 cancelled 改称 expired，不擅自改TTL或绕过审批。该项独立于已经修复的 reset 计数问题。
- **验收脚本修正**：首轮已越过原计数断言，但错误要求重置后历史必须含 `role=tool` 正文，因服务工具展示策略未投影而失败；不能据此断言文件丢失。脚本改为先验证新会话读取回复，再用另一条真实审批的固定 before 全文逐字对照原批准写入内容，严格核对归属／路径／beforeExists 后拒绝探测写入。这样证明实际文件存续，而不是放宽为只信模型回复或更改服务端展示策略。最终整轮复跑结果见 `HANDOFF.md` 文首；首轮失败证据保留在 `/tmp/pimuse-spaces-reset-fixed-attempt-20261020/`。
- **过期复验结果与清理**：`/tmp/pimuse-spaces-expiry-recheck-20261020/` 保存 pending／terminal、RUN_ERROR、真实SSE事件、前后部署、客户端源码哈希及复现脚本；`results.json` 明确 passed=false，未执行后续expired409或原生expired验收。专用空间与pending均通过API清理，用户原有空间保留；前后部署一致。没有修改服务端源码／配置／存储／Git，也不以本地测试或mock代替真实接口。

## 空间会话迁移：重置审批计数历史复现（2026-10-20，后续已修复）

本节保留首次迁移时的失败证据及当时状态；最新修复与复验以文首为准。

- **已确认的契约差异**：`POST /api/spaces/:spaceId/reset` 的 `cancelledApprovals` 在迁移文档和实际 OpenAPI 中定义为“重置时作废的待审批写操作数”。真实客户端在重置前通过详情接口确认唯一审批仍为 `pending`，重置后该项变为 `cancelled`、待审批集合为空、历史为空且 `sessionId` 已更换，但响应计数为 **0**，应为 **1**。不是“审批没有被撤销”的安全故障，而是本次重置的回执漏计。
- **独立复现**：实际17890、space=`spaces-e2e-mvgg5d7v`、approval=`741fad09-c848-4a83-aea2-3e8af9e90545`。`08:54:19.024Z` 的详情为 pending（expiresAt=`08:59:18.857Z`）；`08:54:19.058Z` 重置返回新 session，`cancelledApprovals=0`，同审批已 cancelled、decidedAt/execution 均为 null。上一轮专用空间同样返回0；不是等待超时或客户端先发 Stop 导致本次状态变化。
- **只读定位与期望**：服务端 `src/http/routes/spaces.ts` 先 `await closeCurrent()`，再 `actions.cancelBySpaceId()`，最终仅统计后者结果。关闭运行时已撤销的审批可能因此漏计；这属于源码顺序支持的根因推断，不修改服务端。请服务端统一计算整次 reset 作废的审批数，或由用户协调明确变更文档语义；移动端不自行补算、不把断言放宽为任意非负数来宣称全链路通过。
- **当前结果**：协议字段、空间设置和默认／可选重置已适配；Android真实发送、进程重启恢复、取消确认、两种重置选项与规则保留已通过。真实HTTP/SSE已验证新归属字段与真实文件批准执行，但完整 `test:e2e:spaces` 在上述计数断言明确失败，状态为 **待真实接口验收**。因此尚未执行后续“重置后实际读取保留文件／新会话精确Stop／继续聊天”场景，也未完成本轮新审批归属的原生决定流程，不引用旧部署验收补齐。
- **证据与边界**：`/tmp/pimuse-spaces-reset-contract-20261020/` 的 `active-reset-before.json`、`active-reset-after.json`、`results.json` 保存真实前后快照；原生重置证据在 `/tmp/pimuse-spaces-native-20261020/`。两轮前后 docs/OpenAPI/health 均一致且部署未变：commit `59013f5af4529ee10fb33ded675e897d8115f61d`、sourceHash `5b45cb9c246b1458fcf38dac04dad9dbb11884ef772b1f7604af93f445568267`、dirty/source。专用空间、文件、监控和 pending 已通过API清理，用户原有空间保留，终态审批按服务端契约保留；未修改服务端源码、配置、存储或 Git。未跑mock，未验非零jobs级联／重新投递、物理机、独立APK或iOS；原有自动过期问题仍独立待协调。

## 活动主线实现与验收结论（2026-10-20）

- **本轮没有新增必须协调的接口阻塞**。按用户确认的首期范围，真实只读列表／详情、关联run和步骤已接入；原先“历史范围／刷新信号”的问题采用下方已确认口径，不通过猜测全量run档案或添加轮询绕过契约。主任务页、会话面板历史及动态明确关联均能消费真实数据。
- **最终验证全部通过**：420/420本地测试、lint、typecheck和diff检查通过；永久 `npm run test:e2e:activity` 在实际17890上完成9组接口／环境检查及13组Android原生检查。覆盖模型登记、首轮未完成、明确继续追加原活动run、交付完成、非空分页／过滤／404、真实步骤顺序、前后台自动回读、手动刷新与亮暗主题。前后部署固定 `5b83d3b4cc58...`，docs/OpenAPI/health一致。证据 `/tmp/pimuse-activity-verified-20261020/`；先前驱动横向筛选失败的一轮未计通过，已修复后整轮重跑。
- **真实数据与边界**：专用会话及活动经真实API清理，原有会话保留，未读写服务端底层存储或凭据，Token仅内存。未跑mock；实际步骤动态覆盖execution/model/tool，其余步骤类型及故障组合有本地回归，不声称均已动态触发。没有物理机／独立APK／iOS或巨量历史性能验收。原有审批自动过期协调项仍独立保留，不属于本轮活动主线的已通过结论。未改版本号或CI，已在本地完整提交，未推送。

## 活动与执行历史接口预审（2026-10-20，历史决策依据）

用户随后确认开始实现：采用本节建议的已登记活动范围及保守回读口径，不以全部聊天run档案或严格逐步实时为首期目标。下方“待确认／仅预审”描述审阅当时的状态，后续实现与验收结果另记。

- **事实来源与范围**：重新读取实际17890的 docs/OpenAPI/health，部署仍为 `5b83d3b4cc58...`，版本标识一致。两个只读入口为 `GET /api/activities` 与 `GET /api/activities/{id}`；列表的会话／状态过滤、不透明游标、排序及详情字段基本齐全。活动由模型通过对话工具显式登记，普通聊天可以没有活动；完成一轮运行不等于活动完成，同一活动继续执行会追加runIds。步骤按服务端返回的真实顺序展示，不自行排序或推断完成。
- **待用户确认：历史范围**。建议首期只展示“已登记活动及其关联运行／步骤”，不是“每轮聊天的完整运行档案”。现有活动查询不覆盖activityId=null的普通运行；`GET /api/agent/status`需要已知runId且状态可以被清理，聊天历史也没有runId列表，不能冒充全量执行历史。如果首期需要全部聊天运行的持久历史，需要服务端另行提供明确契约；不由客户端猜测或伪造。
- **待服务端说明：更新后的刷新信号**。活动详情文档要求收到工作区通知后重新读取，但没有明确保证每次活动登记、状态／进展变化、步骤新增／结束均会触发哪一种现有通知，以及通知发出时是否已能读到对应最新投影。请补充此刷新契约，不预设必须增加新SSE事件。若无该保证，建议首期采用打开历史／回前台／聊天结束／手动刷新时查询，不宣称严格实时、不新增轮询。
- **不扩张首期范围**：列表和详情只读，不做客户端创建／完成活动、自动继续或重试。步骤字段没有独立approvalId/toolCallId，不凭标题或步骤ID格式推断具体审批；首期可展示审批与文件提交步骤的真实状态，不把“某一步精确跳转到审批”当成当前阻塞。步骤ID只承诺运行内稳定，应结合runId使用。
- **本次仅预审，不是功能验收**：实际只读探测验证了鉴权401、列表200、非法查询／游标400、缺失详情404，会话列表前后不变；当前真实活动列表为空，未验证非空详情、有效游标翻页或活动状态变化。没有调用模型、创建／修改／删除业务数据，也没有修改产品代码或做模拟器验收。证据 `/tmp/pimuse-activity-review.ve_npfn2/`。等待用户确认上述范围和刷新口径后再实现，先串主线，不提前堆控制功能。

## 稳定部署复验后的当前结论（2026-10-20，11:59起）

- **部署变更阻塞已解除**：用户确认服务稳定后，以实际 docs/OpenAPI/health 核对整轮均为 sourceHash `5b83d3b4cc5806d438a09d5fac5fcad9988ef8b49d9edc8398b20eaf2ac9434e`，commit仍为 `83f33c47ee5c2e40847cdcf8b8e92d1076e9583b`。审批四个HTTP接口及共享SSE全部已接，相关文档契约与上一轮最终快照一致，没有新增未接审批端点；下方多次部署变更记录仅为历史，不再作为当前主流程阻塞。
- **当前部署的主流程已重新通过**：真实客户端HTTP/SSE的批准成功、拒绝不执行、Stop撤销、通知重连、幂等／409、历史游标／过滤和404／400通过；Android模拟器实际二次确认批准／拒绝、成功回执、前后台恢复后旧确认失效、45行预览滚至LINE_45、聊天Stop及当前会话历史状态核对均通过。模拟器请求由真实API发起、决定和Stop由实际原生界面提交；不是复用上一部署结果。未发现需要本轮修改产品源码的客户端缺陷。
- **尚需服务端协调：自动过期仍被提前撤销**。独立会话审批 `a7da45b3-9960-476b-80b8-6349ac772902` 的createdAt=`04:01:23.410Z`、expiresAt=`04:06:23.410Z`，实际在 `04:03:21.148Z` 已cancelled且decidedAt/execution=null；聊天收到真实 `RUN_ERROR: Model response timed out`。长流握手后客户端未施加整轮超时，也未主动Stop或提交决定。期望有合法运行能等待至expiresAt，实际观测expired及晚到决定409，再完成原生expired状态验收；具体服务端时限和等待策略由用户协调，本仓库不修改服务端或硬写绕过。稳定部署消除了上一轮部署漂移，但没有消除本项实测阻塞，不能宣布整模块全项完成。
- **结果与边界**：证据 `/tmp/pimuse-approvals-stable.ke9alykw/`；protocol主流程与native两组结果通过，expiry结果明确失败。405项测试、lint、typecheck通过，未跑mock；三个专用会话和私有文件经API清理，无本轮pending，7条不可变终态历史保留，仅原 `local-main` 会话仍在。未改服务端、版本号或CI，未提交／推送。shared、多端并发、真实执行失败／版本冲突、MB级预览、物理机／独立APK／iOS等边界仍未动态验收。

## 本轮复验的协调阻塞（2026-10-20，第二轮）

- **需要固定部署窗口**：真实17890在本轮验证期间sourceHash先后为 `6fd5c53fade3...`、`9f6e391c95ea...`、`331dab79177f...`（完整标识及逐项契约比较见 `HANDOFF.md` 最新节、`/tmp/pimuse-approvals-recheck.7xpbTT/deployment-comparison.json`）。审批/通知/聊天文档未变不代表业务实现未变；旧版主流程结果不能当作最新版本的全链路验收。
- **实际已通过范围**：首轮实际HTTP/SSE与模拟器批准/拒绝、执行回执、前后台后旧确认失效、45行全文滚动到LINE_45和原生Stop均有实测证据；原生会话/状态过滤的可见列表另与真实HTTP核对通过。9f6e部署也补跑通过接口批准/拒绝/Stop/幂等/冲突/历史等主场景，但最后的过期触发未产出新审批，原始脚本并非全绿。
- **最新原生场景未通过**：审批 `3e7c11a8-4436-4e7e-87f9-f17d191e0518` 于 `02:50:49.861Z` 创建、到期为 `02:55:49.861Z`，却于 `02:51:26.933Z` 提前变cancelled，decidedAt/execution=null，界面随即禁止决定。同一验收窗口部署又变为331dab；不能把这次取消记作批准通过，也不在无内部日志时推断具体撤销原因。需要用户协调暂停服务端更新，固定一个部署后再完成最新版本的真实接口/模拟器验收；客户端不硬写兼容或改服务端。
- **自动过期仍待验**：首轮服务端RUN_ERROR在约120秒提示模型响应超时，早于审批5分钟有效期，审批先cancelled；最新补跑又未取得可持续等待的过期审批。需要能合法覆盖完整有效期的真实验收场景，不调整服务端配置、不注入假审批。原脚本失败与后续通过项分别保留，不能宣布整模块验收完成。
- 本轮405项测试、lint、typecheck通过，未跑mock；实际接口回读确认5个自建会话和本轮pending均清理，私有文件删除、不可变终态历史保留，用户已有数据不动。产品源码未因复验改动。证据根目录 `/tmp/pimuse-approvals-recheck.7xpbTT/`；下方仍为此前阶段记录。

## 审批接入与验收边界（2026-10-20）

- 实际17890部署的 `/docs`、`/openapi.json`、health 版本一致（`0.1.0`，commit `83f33c47ee5c2e40847cdcf8b8e92d1076e9583b`，dirty source，sourceHash `6fd5c53fade38850e345713275ec0722e0d0f117d91adbd2d8e7aa56ac00f87c`）。新 `/api/approvals` 领域提供完整固定预览、thread/run/toolCall/subagent/activity关联、revision、终态历史、执行回执与全局通知，不再将下方旧 payload/toolCallId 协调项视为当前审批接入阻塞。
- `src/approvals/` 与会话面板审批页已对接真实四个HTTP接口及共享SSE。实际模型私有写入批准并成功、编辑拒绝不执行、同决定幂等/反向409、精确Stop撤销、断线重连、历史游标/范围筛选均已验证；Android16/API36 Expo Go的真实批准/拒绝、字面全文预览、回执、历史、范围和亮暗主题已验。405项本地测试、lint、typecheck与diff检查通过；本轮没有跑mock，不以fixture或浏览器启动代替原生业务验收。
- **待真实接口验收：自动过期**。专用待审批的 `expiresAt` 为5分钟后，等待期间运行先被服务端撤销，审批返回 `cancelled`，不是 `expired`；本轮不判断这是服务端缺陷，也不改服务端时限来制造通过。expired 展示／按钮禁用／409解析有自动化，真实自动过期及晚到决定仍未验。协议证据 `/tmp/pimuse-approvals-real-1792461917831/results.json` 明确 `success=false`；通过的主流程与该未通过场景分别记录。
- Android证据 `/tmp/pimuse-approvals-native-1792462308026/`。专用会话与私有文件均经API清理，服务端终态审批历史按契约保留，未改用户原有数据、服务端或版本/CI。shared写入、多端并发决定、真实执行失败/版本冲突、巨型预览滚动、审批专属前后台恢复及物理机/独立APK/iOS仍未动态验收。更多实现与限制见 `HANDOFF.md` 文首。

下方为历史记录；原有“审批未接/关联缺失/通知流未接”不代表当前实现仍如此。

## Android 原生验收补充（2026-10-19）

- Android16/API36 x86_64模拟器（Expo Go57.0.9）直连实际17890服务，23组原生检查通过，包括真实工具/worker子代理、键盘、系统Back、前后台同运行恢复、精确Stop、强制结束进程恢复、规则技能保存与删除收尾。证据 `/tmp/pi-muse-native-real.KunPVf/acceptance.json`。
- 两个专用会话无残留，原主会话保留；2条本轮已撤销审批历史按服务端契约保留，`execution=null`，未批准或落盘。当前App进程fatal/JS错误0；369项回归、lint、typecheck与diff检查通过。没有物理手机连接，正式签名APK和iOS原生仍未验；下方原生未测描述属于早先阶段。

## 真实服务验收现状（2026-10-19）

- 实际服务 `http://192.168.55.201:17890` 的协议12项及真实界面链路已通过；真实工具、worker子代理、等待审批、Stop、刷新与设置保存均验证。全部7种运行phase已真实观测，HTTP与SSE终态revision一致；证据 `/tmp/pi-muse-real-ui.tcXUwD/acceptance.json` 与 `/tmp/pi-muse-real-apis.1792414793/work/real-apis-results.json`。
- 专用会话和运行已通过API清理，列表最终仅 `local-main`；保留1条已撤销审批历史，`execution=null`，未批准或落盘测试文件。没有覆盖用户原有数据，未修改服务端源码、配置、底层存储或Git；本轮真实测试确实调用了实际模型，Token仅内存。
- 369/369本地测试、lint、typecheck及diff检查通过。本次实测没有新增客户端缺陷；原生键盘／后台／真机未测，不以三平台导出代替。下方记录保留历史阶段含义。

| 日期 | 接口 | 现状 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| 2026-10-15 | GET /api/threads（及线程域整体） | 线程无标题字段（仅 `{id, updatedAt}`），且无重命名/删除端点；HANDOFF 会话 Sheet 规格含「重命名」，按现 API 无法实现，列表只能展示 threadId 原文 | 服务端补线程标题字段 + 重命名（可再加删除）端点；或确认移动端去掉重命名、直接展示 threadId | 部分解除：2026-10-18 已实测 DELETE；标题与重命名仍未提供，本轮按 ID 展示 |
| 2026-10-15 | notifications.payload（GET /api/agent） | 类型为 `Record<string, string>`，键名未定义。审批卡需要知道键名（如 file_write→content、file_edit→before/after）才能友好渲染写入预览 | 文档明确各 kind 的 payload 键名枚举 | 待澄清；过渡期从 pi-muse 源码只读提取实际键名 |
| 2026-10-15 | tasks.plan / tasks.evidence（GET /api/agent、任务详情） | 元素结构未定义（`items: {}`），无法类型安全渲染 | 文档给出元素结构 | 低优先：任务详情已有 events 时间线（结构完整）可渲染，plan/evidence 可通用展示或不渲染 |
| 2026-10-15 | 全端点 CORS | OPTIONS 预检返回 204 并回 allow-methods/allow-headers，但**任何响应都不带 `Access-Control-Allow-Origin`**，浏览器跨域全被拦（原生 App 不受影响） | 跨域响应补 `Access-Control-Allow-Origin`（如回显 Origin 白名单） | 已告知用户；过渡期本仓库自带本地代理（tools/dev-proxy.mjs，8791→8788 注入 CORS 头）供 Web 调试，服务端修复后退役 |
| 2026-10-18 | GET /api/agent & /api/events（工作区状态同步） | 保留的数据层仍以 5 秒盲轮询全量快照（新版根入口当前未挂载），高耗电且切后台感知不及时 | 提供全局轻量 SSE（/api/events）+ 默认 7 天活跃快照与 Cursor 分页 + 远程推送唤醒，详见 docs/backlog.md | 方案已定，待服务端协同；据交接说明 `/api/events` 已由服务端提交 `473213f` 交付，但本仓库尚未定位修订正文，客户端未接入 |

## 运行状态模块验收（2026-10-19）

- 最新在线 `GET /api/events` 与 `GET /api/agent/status` 已满足本轮实时短状态、工具／子代理明细、重连当前集合与已知运行终态查询，无需本轮协调服务端扩接口。状态通知与聊天文字流独立，普通聊天的 `activityId=null` 合法；完成运行不等于完成活动。
- 用户确认直接接通新版真实界面，在会话面板“动态”顶部放“当前执行”。连接入口仅应用页；未接审批、活动、文件、目标、记忆明确标注，不再加载示例数组。旧工作区快照／审批轮询未恢复。
- 369项自动化通过；隔离协议预检8项、最终实现7项联调通过，临时会话已清理。浏览器实际覆盖首次连接、空Key mock、真实聊天及状态、子代理等待／终态、精确Stop、会话面板、未接模块边界、删除收尾和冷刷新；未改实际服务业务数据。证据与限制见 `HANDOFF.md` 文首。
- 此处下方的旧“根入口仅示例／SSE未接／协议未定位”等内容均是历史阶段；审批操作、活动历史和其他领域仍须按模块单独讨论，不把本轮状态接入当成它们已完成。

## 会话与聊天适配核对（2026-10-19）

- 本轮只适配会话与聊天数据层，以在线 `/openapi.json` 为准；删除响应已移除 `removed.tasks` 要求，`THREAD_DELETING` 与普通 revision 冲突区别处理。配置保存保留草稿且不自动重试；测试夹具不再用历史 GET 重建会话。没有接入新全局 SSE／审批或恢复真实 UI 连接。
- 新在线契约已明确：不存在、已删除或正在删除的合法会话历史只读返回 `{revision:"empty",messages:[]}`；会话是否存在以列表为准。2026-10-18 下方的复现属于旧部署，不能继续当作当前服务仍有同样故障的证据；本轮未对正式会话做写入／删除复验。
- **隔离联调阻塞已解除**：首次 `pnpm dev:mock` 在读取旧审批数据时抛 `Invalid actions document`。只读定位确认 `.pi-muse/mock/actions.json` 共7条旧终态记录，缺少新版 `revision/resolvedAt` 与关联字段；不是17890实际服务未启动。用户明确授权直接重置且不备份后，仅重置该文件为空数组，未改服务端源码、配置或其他已有 mock 数据；官方 mock 成功恢复17891监听。
- **补做联调**：真实 `HttpApiClient + ThreadSessionStore` 对17891完成19项检查，全部通过；覆盖规则／技能、历史只读、聊天流、幂等／revision冲突、精确Stop、删除响应／当前轮收尾、迟到请求和同名新会话。临时会话经API全部清理，原会话列表保持不变，证据 `/tmp/pi-muse-session-live.r5o8kM/`（无Token）。17890健康检查正常，本轮未对其发送业务写入或调用真实模型。
- 本地 lint、typecheck、299/299 回归与 diff 检查通过；新版 UI 和原生运行仍未接入验收，其他模块的历史问题暂未在本轮重新验收。

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

## 定时任务（Jobs）独立资源迁移与快照调整（2026-10-21）

- **服务端接口调整核实**：
  - `GET /api/agent` 已彻底移除 `tasks` 字段，且 `monitors` 与 `memories` 已迁移至独立接口，快照响应体仅保证返回 `identity` 与 `goals`。客户端已移除对快照中 `tasks` 等字段的强制数组校验，避免 502。
  - 旧接口 `GET /api/agent/tasks/:id` 与 `POST /api/agent/tasks/:id/control` 服务端已返回 501 下线。
  - 新增独立资源 `/api/jobs`（列表查询支持 `spaceId`、`sort`、`order`）、`GET /api/jobs/:id`、`POST /api/jobs/:id/control`（已移除冗余 `target: "job"`）、`PATCH /api/jobs/:id`、`DELETE /api/jobs/:id`。
  - 字段变更：任务结果字段统一规范为 `lastResult`，客户端提供 `result` 别名平滑兼容。
- **客户端契约与实现落地**：
  - 更新 `src/api/types.ts`、`src/api/contracts.ts`、`src/api/http-client.ts`，新增 `listJobs`、`getJob`、`controlJob`、`updateJob`、`deleteJob` 标准接口，并保留 `getTask` 与 `controlTask` 作为无缝向前兼容封装。
  - 更新 `tests/http-api.test.mjs`，通过 411 项自动化测试及真实服务 `http://192.168.55.201:17890/` 联调验证。

## 长期记忆（Memories）独立资源迁移与端点调整（2026-10-21）

- **服务端接口调整核实**：
  - `GET /api/agent` 已彻底移除 `memories` 字段；客户端此前已支持可选读取，快照不依赖 `memories`。
  - 旧接口下线：`GET /api/agent/memories`、`POST /api/agent/memories/:id`、`POST /api/agent/memories/:id/forget` 服务端均返回 501。
  - 新独立端点就绪：
    - 列表与搜索：`GET /api/memories`，支持 `q`、`limit`、`sort`（`updatedAt` / `createdAt`）、`order`（`asc` / `desc`）。
    - 新增记忆：`POST /api/memories`，请求体 `{ text: string, source?: string }`。
    - 单条详情：`GET /api/memories/:id`，不存在返回 404。
    - 编辑文本：`PATCH /api/memories/:id`，请求体 `{ text: string }`，返回更新后的 `MemoryItem`。
    - 删除记忆：`DELETE /api/memories/:id`，无请求体，成功返回 `{ ok: true, id: string }`。
- **客户端契约与实现落地**：
  - 更新 `src/memories/types.ts`：扩展 `MemoryQuery` 支持 `sort` 与 `order`，在 `MemoryClient` 接口新增 `getMemory`。
  - 更新 `src/memories/contracts.ts`：增强 `parseMemoryRemoval` 严格校验返回的 `ok: true` 及 `id`。
  - 更新 `src/api/http-client.ts`：修改 `listMemories`、`addMemory`、`editMemory`、`forgetMemory` 指向新路由及对应 HTTP 动词（PATCH/DELETE），实现 `getMemory`。
  - 更新 `tests/http-api.test.mjs` 与 `tests/memory-api.test.mjs`：增加 `listMemories`、`getMemory` 测试用例，覆盖 PATCH/DELETE 及 query 参数。
  - 验证：414/414 单元测试、`npx tsc --noEmit`、`npx expo lint` 全绿，并在实际服务 `http://192.168.55.201:17890/` 上完成会话创建、增删改查全流程真实联调及清理。
