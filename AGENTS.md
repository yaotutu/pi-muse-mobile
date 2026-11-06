# AGENTS.md — Pi Muse 移动端约束

Claude Code 从 [CLAUDE.md](CLAUDE.md)读取命令和架构，日常开发读[移动开发指南](docs/mobile-development-guide.md)。完整工作区同时遵守[父目录规则](../AGENTS.md)与[协作指南](../pi-muse-server/docs/agent-workflow-guide.md)；独立 clone 时不假设兄弟仓库存在。

## 产品与契约

- Expo / React Native 原生客户端，使用 npm。Android 为默认原生验收平台，iOS 是源码/未签名产物目标，Expo Web 只是开发预览。
- HTTP/SSE 权威来自当前服务端 `src/http/contracts/` 与匹配版本的 `/docs`、`/openapi.json`。核对 health 身份和相关真实接口，不从旧 HANDOFF 或客户端推测字段。
- 本会话按用户任务范围直接处理两端，不维持“服务端属于其他 Agent、只能等待”的永久分工。若存在他人同时开发的文件，先核对写集，不覆盖或回滚。
- 结果未明的写入不自动重发；保留草稿并先核对服务端实际状态。读取失败不伪装成空列表，旧请求不污染新连接或新 Agent。

## 数据与发布保护

- 不持久化明文 AccessKey，仅保存服务地址和 Session Token；模型 Key、签名或服务端凭据不进入客户端、日志和文档。
- 使用隔离测试数据，不删除或覆盖用户已有数据，不绕过模型文件审批、系统安装确认、文件路径或网络边界。
- `expo.version`、`expo.android.versionCode`、`expo.ios.buildNumber` 不手工修改，仅发布流程中的 `tools/bump-version.js` 可写。未经明确授权，不 bump、push、发布、修改签名或 CI。
- CNG 的 `android/`、`ios/` 为生成目录，不手工维护或提交；原生行为改 `app.json` 与 config plugin。
- 已验收模块按长期授权本地 commit，先检查工作区和暂存区 diff，仅纳入本任务改动，不覆盖他人文件。供其他客户端调用的共享后端必须保持在线，未经用户针对本次中断明确同意不停止或重启。Expo/Metro 与专用隔离验收实例可核对归属后按原授权管理，不波及共享后端；生产或归属不明进程另行确认。
- 积极委派已获用户授权（2026-11-05）：客户端实现优先派给 codex（外部视觉执行者，本机实际模型以 codex 运行头部为准）或原生 sub agent（Claude 系，同样可读截图），主会话负责派单、diff 审查与验收。执行者不 commit/push，产物经审查后由主会话提交；派单模板与模型路由见服务端[协作指南](../pi-muse-server/docs/agent-workflow-guide.md)。真实模型测试费用已长期授权，此授权不包含修改全局模型配置或发布。
- 新文件/目录只用 ASCII 字母、数字、`-`、`_`、扩展名点；用中文注释解释协议、安全与生命周期。个人自用、简单优先，内部重构同步调用方而不保留无需求的兼容层。

## 专项入口

| 范围 | 指南 |
| --- | --- |
| 页面、导航、状态或协议消费 | [移动开发](docs/mobile-development-guide.md)及对应源码/测试 |
| 主题或共享控件 | [主题维护](docs/themes.md) |
| 更新、原生构建、版本、签名或发布 | [发布指南](docs/android-release-guide.md) |
| 文档或用户可见行为 | 服务端[文档指南](../pi-muse-server/docs/agent-documentation-guide.md)；共用服务端中英文手册，不复制一套 |
| 品牌图标或形象 | 服务端[品牌基准](../pi-muse-server/docs/assets/brand/README.md) |
| 待办 / 历史 | [backlog](docs/backlog.md) / [归档索引](docs/archive/README.md) |

## 完成要求

代码变更补本次回归，运行 lint、typecheck、test；本地 fixture 不替代当前真实后端、外部模型和 Android 原生验收。新功能还需本地当前后端与实际 `/docs` 页面证据；必要项缺失保持待验收，服务不可用时不用替身凑通过。写入、停止、流式、重连或恢复相关场景按实际改动覆盖，分别报告失败、跳过和未验范围。

用户可见行为变化同步中英文手册。文档-only 只检查引用、差异、命名与规则一致性，涉及手册时按其指南构建，不启动业务、模型或 Android。交付区分实现、验证、提交与发布。
