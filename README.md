# pi-muse-mobile

Pi Muse 的官方移动客户端（iOS / Android / 平板）。Expo + React Native + TypeScript，UI 参考 OpenMuse，代码全自研。

## 离线体验界面

只运行 `npm run web`，在登录页点击 **体验演示工作区**，即可在不启动服务端的情况下体验四个页面。已连接服务时，也可从会话菜单进入演示。

- 顶部常驻「演示数据 · 不执行真实操作」，点击「管理演示」可重置为示例/空工作区，或退出。
- 聊天输入区上方的「尝试一个演示场景」提供搜索、天气、记忆、任务、监控、预览、审批、慢流和失败恢复。
- 所有演示修改仅存在内存，重置、退出或刷新后消失；演示不写服务凭证、不覆盖已有真实登录、不发真实业务 API 请求。演示任务详情可手动推进排队/运行/完成，审批不会写真实文件；独立的应用更新模块仍可匿名检查官方 GitHub 版本。
- 会话重命名/归档、完整演示审批记录与结构化天气目前仅在演示模式提供；真实模式仍以服务端已有接口为准，不伪造保存结果。

## 连接服务（运行时配置）

服务器地址与 Key 在登录页表单填写，运行时保存；**不再有编译期默认地址或多个 profile**。**旧环境变量 `EXPO_PUBLIC_API_BASE_URL` 已不再用于连接配置，开发地址须在 UI 手填。**

- **唯一当前服务器 URL**：从登录页表单输入，原生走 `expo-secure-store`，Web 调试走 `localStorage`。
- **可选 Key**：表单内存（不写入存储），随当前 URL 一起提交 `POST /api/session`。
- **持久化字段**：单条 `{serverUrl, token?, resetPending?}`，**地址与 Token 绑定保存在同一记录**（键名 `pi-muse-connection`）。
- **Token 永久**：客户端不解析 `exp`、不计时过期、不主动续期；服务端稍后同步永久 Token 模型，前端不再以 24h 文档作为阻塞。
- **错误重试**：网络、超时、5xx 保留当前 token 和工作区草稿，只在原地址原址重试；明确 401 仅清凭据并回到原址登录，不清业务数据。
- **更改服务器**：进入独立"更改服务器"页，测试或取消不保存。规范化后若与旧地址不同，保存前二次确认"清本地业务数据与旧凭据"；允许离线保存新地址，不沿用旧 Token。实际清理函数预留 `src/connection/cache-reset.ts` 的 `clearLocalWorkspaceData`（async 空实现），先写 `resetPending` journal，清理成功再放行，失败可重启恢复。
- **联调示例（手填）**：
  - Web：手填 `http://localhost:8791`（本仓库自带代理 8791→8788 注入 CORS 头）
  - Android 模拟器：手填 `http://10.0.2.2:8788`
  - iOS 模拟器：手填 `http://127.0.0.1:8788`
  - 真机：手填设备可访问的 URL

联调时如需启动服务端 mock 与本地代理：

```sh
# 1. 启动服务端 mock（另一个仓库，只读使用；mock 数据隔离在 .pi-muse/mock，端口 8788）
cd ~/Desktop/code/pi-muse && pnpm dev:mock

# 2. 启动本地 Web 联调代理（8791 → 127.0.0.1:8788，并注入 CORS 响应头）
cd ~/Desktop/code/pi-muse-mobile && npm run proxy

# 3. 启动 Expo Web（固定端口 8082，避开 OpenMuse 的 8081）
cd ~/Desktop/code/pi-muse-mobile && npm run web
```

启动原生调试运行 `npx expo start`，需要开发构建时再运行 `npx expo run:ios` 或 `npx expo run:android`。2026-10-17连接配置回归通过127项自动化测试、68条浏览器交互断言、Android API36 / Expo Go SDK57原生连接流程，以及三平台生产JS/Hermes导出；iOS运行、正式签名包/物理真机和实际后端永久Token同步尚未验收，详见 `docs/HANDOFF.md`。

## 代码组织

- `App.tsx` → `src/app/AppRoot.tsx`：启动与 Provider 组装；`AppShell.tsx` 仅编排 tab、顶栏和全局弹层。
- `src/api/`：客户端契约、网络类型、HTTP 实现、SSE 分帧与注入点；页面不直接依赖 HTTP 实现。
- `src/connection/`：唯一服务器配置、地址与凭据绑定存储、连接状态机、原址重试和显式改地址；`src/threads/`、`src/workspace/`、`src/approvals/` 分别持有会话列表、共享快照轮询和本次工作区内的审批决定。
- `src/chat/`：`useConversation` 管理历史/revision/流式运行；`chat-state` 做纯事件聚合；页面与输入区、消息气泡负责交互和展示。
- `src/activity/`、`src/goals/`、`src/apps/`：按功能就近放置页面、卡片和表单，页面只保留编排与跨组件操作状态。
- `src/ui/`：无业务枚举的 UI 原语与设计 token；`src/shared/`：跨业务展示与格式化。
- `src/update/`：官方 GitHub Release 检测、独立下载状态机与 Android 系统安装器；根级挂载，不依赖服务器连接或业务凭据。
- `src/demo/`：隔离的内存演示客户端、素材和场景入口；不扩展真实服务端契约，不接入凭证存储。
- `tests/`：Node 测试，统一预加载 TypeScript 源码转译和 Expo fetch 测试边界；包括 HTTP 契约、聊天聚合、演示隔离与状态转换。真实分支联调继续使用服务端隔离 mock。

依赖方向为应用组装 → 功能模块 → API 契约 / UI；API 与 UI 不依赖页面或 Shell。切 tab 时聊天常驻，切会话时通过 `key={threadId}` 卸载旧流；网络失败、原址认证、编辑取消与演示只暂停或隐藏真实工作区，确认不同服务器地址才替换工作区数据域。

## Android应用更新

本项目通过 GitHub Releases 提供 APK 形式的 Android 更新，详情由 `src/app/AppRoot.tsx` 根级独立更新模块负责，与服务端 Token / Key 完全解耦。检测源固定为公开仓库 `yaotutu/pi-muse-mobile` 的 `releases/latest`，仅识别其中稳定 `app-release.apk`。

行为边界：

- 检测仅限 Android 独立包：冷启动及前台按一小时间隔检查，回到前台超过间隔也会检查；发现新版自动下载，完成后自动唤起系统安装器，不提供额外下载 / 校验确认页。
- 下载 / 校验：依赖 OS 与系统签名；不做应用层 checksum；失败可重试、下载可取消，进度可收起。
- 安装交互：系统签名校验、未知来源授权、最终安装确认必须保留用户确认（不静默安装）。
- 本次会话取消安装后保留已下载包，继续安装不重复下载；系统可能清理缓存，届时需重新下载。
- 流量与进程：下载会消耗用户网络流量，OS 杀后台后不保证继续；只有前台唤起安装才会启动系统安装器。
- 首次使用更新能力需要用户手动安装含更新模块的版本；之后版本才走自动检测。
- 应用页「应用更新」、连接页「检查应用更新」可手动触发检查。
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
