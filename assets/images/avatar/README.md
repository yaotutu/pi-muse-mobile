# B 企鹅内置默认八态

这八张 PNG 是与 Pi Muse 品牌图标同一角色的 B 企鹅，不是旧的毛绒企鹅 C。`builtin:penguin` 的选择 key 保持不变，替换的是整套图片，不改形象选择、缓存或状态机。

- 唯一角色母版：服务端仓库 `docs/assets/brand/previews/neutral-icon-master.png`。
- 正式状态资源与可复现脚本：服务端仓库 `docs/assets/brand/companion/`。
- `manifest.json` 是本包的来源与图片哈希副本，不是运行时 API 或凭据配置。构建时图片直接打包，不读取兄弟仓库或网络。
- idle 从原有 B 透明母版确定性缩放；另外七态来自已确认的静态动作原稿，经本地去底、边缘去色和统一画布处理。
- 图片均为 512×512 真 RGBA，保留透明边缘，不包含背景卡片或视频。
- 原 C 八态按原字节归档在服务端仓库 `docs/archive/visual-explorations/companion-c/`，不再参与客户端打包。
- 水管工仍是服务端安装的独立可选包；此处不会把它变成品牌或默认。

不手工拼凑单张新旧图。更新时从正式来源整包复制，并运行资源回归与 Android 显示检查。
