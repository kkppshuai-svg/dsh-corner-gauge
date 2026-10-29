# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 点击彩蛋：M 跑车从右向左穿过面板，期间只显示跑车与速度线
- 真实录制的 M 声浪（构建时内嵌），右上角喇叭按钮开关，状态持久化
- 新增配置 `drive.{enabled,sound,durationMs}`
- `docs/drive-frames.png` 展示跑车经过的三帧
- 一键部署脚本 `scripts/deploy.ps1`（构建 → 备份 → 同步到 DSH profile）与 `部署.bat` 双击入口
- **素材库**：`assets/manifest.json` 声明车辆与声浪，构建时整体内嵌；
  新增车辆只需放图 + 清单加一条，无需改 JS。支持 `cutout`（透明抠图）与
  `plate`（柔边场景图）两种素材类型，各自匹配不同的混合方式
- 第二辆车：蓝色 BMW M4 GT3（CHINA GT / FIST_Auto 素材，柔边场景版）
- `drive.car`：`'auto'` 每次点击轮换车库，或填车辆 id 固定
- 每辆车可在清单里指定自己的声浪（`sound` 字段）

### Changed

- 跑车期间默认只显示跑车本体：常驻斜向流动纹、速度线、拖尾全部压掉，
  避免车上再叠一层"流动边条"；速度线与拖尾改为可选特效 `drive.fx`（默认 `false`）

## [2.0.0] - 2026-10-29

### Added

- **可换边框模板（skin）**：`bmw-m`（斜切刀锋 + M 标志）与 `minimal`（极简圆角）
- **可组合面板元素（element）**：`currency`（货币符号）、`amount`（金额）、`progress`（进度条）
- 运行时配置 `window.__DSH_BADGE_CONFIG__`：皮肤、元素、位置、尺寸、币种、轮询间隔
- 构建脚本 `scripts/build.mjs`：把 `src/` 与资源打包成单文件产物，字体与标志 base64 内嵌
- 产物校验 `scripts/verify.mjs`：重新构建并与仓库产物逐字节比对
- 轻量静态检查 `scripts/lint.mjs`：语法、命名约定、占位符残留、命名空间引用
- 免安装预览页 `preview.html`
- CI（构建 + 校验，Node 18/20/22）与 Release 工作流
- 指数退避重试：插件启动时账户服务尚未就绪也不会永久显示 `--`

### Changed

- 拆分为 `config / data / drag / skins / elements / render / client` 七个模块，
  边框与内容彻底分离
- 金额改为金属质感渐变填充（`background-clip: text`）
- 遮罩阴影由 `text-shadow` 改为 `filter: drop-shadow`，修正透明填充下字形被压暗的问题

### Fixed

- 插件因多余导出（`name` / `inject` / `default`）导致 cordis 不识别、整体不加载
- `apply` 时 `document.body` 尚未就绪导致的静默失败
- 字体与标志的构建占位符写错，产物语法错误
