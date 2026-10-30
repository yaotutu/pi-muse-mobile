# AGENTS.md — pi-muse 移动端开发入口

Pi Muse 官方移动客户端，当前源码使用 Expo 58、React Native 0.88、TypeScript 与 npm。Android 是默认原生验收平台；iOS 只作源码开发目标，Expo Web 只是开发预览，不是独立产品或验收替代。

所有开发工作先读[根规则](../AGENTS.md)、[Agent 协作指南](../pi-muse-server/docs/agent-workflow-guide.md)和[移动开发指南](docs/mobile-development-guide.md)，再按下表读取专项入口；涉及版本、签名、构建或发布时必读[Android 发布指南](docs/android-release-guide.md)。

## 按任务必读

| 任务 | 必读入口 |
| --- | --- |
| 接手项目、确认状态 | [README](README.md)、当前源码、`git status`；全局状态见[项目地图](../project-map.md) |
| 修改界面、导航、状态、HTTP/SSE 或任一业务域 | [移动开发指南](docs/mobile-development-guide.md)与对应 `src/` 源码、测试 |
| 修改颜色、主题、 tokens 或共享控件外观 | [主题维护](docs/themes.md) |
| 修改 Android 更新、版本字段、构建、签名、CI 或发布 | [Android 发布指南](docs/android-release-guide.md) |
| 编写文档或修改用户可见行为 | [Agent 文档编写指南](../pi-muse-server/docs/agent-documentation-guide.md) |
| 制作或修改吉祥物、默认角色、图标及其派生素材 | [项目级品牌资产基准](../pi-muse-server/docs/assets/brand/README.md)，移动端不另立形象母版 |

## 硬边界

- 服务端位于兄弟仓库 `../pi-muse-server/`，由主 Agent 统一协调。移动端执行者默认只修改本仓库派单范围；需要跨仓库调整时先返回主 Agent 确定契约、依赖与任务，不自行修改服务端源码或配置。
- HTTP/SSE 契约唯一事实来源是当前服务端运行实例的 `/docs`、`/openapi.json` 与 `pi-muse-server/src/http/contracts/`。开工前核对相关真实接口链路与 health 版本；预验不能替代收口验收。
- 客户端不持久化明文 AccessKey，只保存服务地址与鉴权交换得到的 Session Token；任何模型 API Key、服务端凭据或签名材料不得进入客户端、日志或文档。
- `app.json` 中 `expo.version`、`expo.android.versionCode`、`expo.ios.buildNumber` 三个字段禁止手工修改，只能由发布流程中的 `tools/bump-version.js` 写入。未经用户明确授权，不 bump 版本、发布、push、修改签名或 CI。
- 所有模块测试遵守根规则：真实连接当前后端并真实调用外部大模型；mock、fixture、拦截响应、内存演示或 Expo Web 不能替代最终验收。功能收口前完成 Android 模拟器或真机的相关原生链路验收。
- 使用真实隔离测试数据，不删除或覆盖用户已有数据，不绕过鉴权、人工审批和系统安装确认。服务不可用或缺少凭据时保持“待真实接口验收”，不用替身宣称完成。
- 遵守根规则命名红线与中文注释要求；移动优先，避免为理论罕见场景增加复杂状态机或兜底。

## 最低完成标准

- 代码改动完成 `npm run lint`、`npm run typecheck`、`npm test`，并按实际改动补测试；失败、阻塞和未运行项如实报告。
- 按本轮功能完成真实 HTTP/SSE、界面消费、异常/恢复与 Android 原生链路验收；涉及写入、流式、停止、重连或恢复时必须覆盖对应场景，未覆盖场景明确列出。
- 修改用户可见行为或文档时，按文档指南同步中英文产品文档；文档-only 变更只检查差异、引用、命名与规则一致性。
