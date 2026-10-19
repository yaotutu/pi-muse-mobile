# pi-muse-mobile

Pi Muse 的官方移动客户端（iOS / Android / 平板）。Expo + React Native + TypeScript，UI 参考 OpenMuse，代码全自研。

## 运行当前界面

```sh
npm run web  # Expo 调试页面，固定端口 8082
```

打开 `http://localhost:8082/` 即进入唯一的新版工作区，刷新或重启也不会回到旧 UI。无需登录、寻找「新 UI 预览」入口或进入旧演示。

- 左上角打开会话侧栏，聊天前景整体右移；侧栏只负责切换／新建会话。
- 中央头像打开全屏当前会话面板，动态／审批／工作区／历史四个胶囊 Tab 原位切换。
- 右上角月亮／太阳按钮切换亮暗主题，默认亮色；切换不会重建会话或清空草稿。
- **当前仍使用本地示例数据，尚未对接真实服务。** 消息、审批、文件和历史不会访问业务网络或写盘；刷新恢复示例状态。任务／目标等页面仍为简易内容，不宣称原有真实业务功能已在新版接通。
- 附件／语音入口仅显示说明，不请求系统权限；分享、邀请、头像编辑等未实现能力不伪造。
- 旧 `AppShell`、会话底部 Sheet、旧功能页面及产品演示入口已删除。旧演示 API 实现仅保留在 `tests/helpers/` 作为回归夹具，不进入运行包。

## 后续真实服务对接边界

HTTP／SSE、连接状态机、地址与凭据绑定存储、会话状态和协议测试仍保留，供后续对接新版使用；**当前根入口不挂载这些业务机制，也不恢复服务器配置或自动请求业务接口**。

- 保留单服务器 URL 与永久 Token 绑定、Key 不落盘、401 与断网区分、改地址清理日志等安全契约。
- 本次替换 UI 不读取、清除或迁移设备已保存的服务器地址、凭据和远端数据。
- 不再使用旧登录／连接配置页面；真实数据接入需要单独实现新版连接体验，不能把此前旧 UI 的验收记录当成新版已通过。
- 服务端仓库保持只读。联调仍可使用 `npm run proxy`，但运行当前示例 UI 不需要服务端或代理。

原生调试运行 `npx expo start`。本仓库只用 Web 渲染辅助界面验收，不作为独立 Web 产品。

## 代码组织

- `App.tsx` → `src/app/AppRoot.tsx`：安全区、异常边界、独立更新模块与唯一新版工作区。
- `src/workspace/`：`WorkspaceScreen` 聊天与侧栏、`SessionPanel` 全屏会话、`WorkspaceTheme` 主题、`sample-state` 示例数据；`useWorkspaceSnapshot` 保留供未来真实对接，当前不挂载。
- `src/api/`：客户端契约、HTTP／SSE 解析、网络类型与注入点。
- `src/connection/`、`src/threads/`、`src/chat/`：保留连接与凭据安全机制、会话状态、聊天历史与流式聚合逻辑，不包含旧工作区页面。
- `src/activity/`、`src/approvals/`、`src/goals/`：保留有回归测试的纯业务逻辑，旧页面已移除。
- `src/ui/`：设计 token、异常边界和更新模块需要的 UI 原语；工作区使用 `workspaceTheme` 与 `workspacePalettes`。
- `src/update/`：官方 GitHub Release 检测、独立下载状态机与 Android 系统安装器，根级挂载，不依赖业务凭据。
- `tests/`：入口守卫、HTTP 契约、SSE／聊天聚合、连接隔离、状态与主题测试；旧演示内存 API 迁至 `tests/helpers/`。

依赖方向为应用组装 → 新版工作区 → 本地状态／主题；保留的数据层不反向引用页面。当前示例数据和主题只在内存，后续真实接入必须沿用原有鉴权、请求取消和会话隔离约束。

## Android应用更新

本项目通过 GitHub Releases 提供 APK 形式的 Android 更新，详情由 `src/app/AppRoot.tsx` 根级独立更新模块负责，与服务端 Token / Key 完全解耦。检测源固定为公开仓库 `yaotutu/pi-muse-mobile` 的 `releases/latest`，仅识别其中稳定 `app-release.apk`。

行为边界：

- 检测仅限 Android 独立包：冷启动及前台按一小时间隔检查，回到前台超过间隔也会检查；发现新版自动下载，完成后自动唤起系统安装器，不提供额外下载 / 校验确认页。
- 下载 / 校验：依赖 OS 与系统签名；不做应用层 checksum；失败可重试、下载可取消，进度可收起。
- 安装交互：系统签名校验、未知来源授权、最终安装确认必须保留用户确认（不静默安装）。
- 本次会话取消安装后保留已下载包，继续安装不重复下载；系统可能清理缓存，届时需重新下载。
- 流量与进程：下载会消耗用户网络流量，OS 杀后台后不保证继续；只有前台唤起安装才会启动系统安装器。
- 首次使用更新能力需要用户手动安装含更新模块的版本；之后版本才走自动检测。
- 新版应用页「应用更新」可手动触发检查；旧连接页入口已随旧 UI 删除。
- Expo Go / Web / iOS 不支持 APK 安装；更新模块仅在 Android 独立包生效，不等同于 Expo OTA。

验收记录及环境限制见 `docs/HANDOFF.md`。

## 常用命令

```sh
npm run typecheck   # 类型检查
npm run lint        # lint
npm test            # 协议、聚合与工作区纯状态回归
npx expo install X   # 装依赖（总是用它，解析 SDK 兼容版本）
npx expo-doctor      # 依赖/配置诊断
```

## 文档

- `docs/HANDOFF.md` — 交接文档：进度、阶段计划、页面规格、验收方式
- `AGENTS.md` — 协同红线与技术决策定稿（agent 接手必读）
- `docs/notes.md` — 接口问题记录（遇到不合理接口先记录并停下报告用户）
