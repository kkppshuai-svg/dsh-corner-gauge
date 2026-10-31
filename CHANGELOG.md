# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Fixed

- **数字时常变暗**：根因是「取数失败就把整块面板降到 45% 透明度」。
  现在失败时保留上一次的有效值（状态 stale），从来没取到过才显示 `--`，
  面板亮度不再随刷新结果变化
- 清理死代码时漏删的 `txt.style.display` 引用会在运行时抛错、导致面板整个不渲染；
  已修复，并新增 `scripts/smoke-mount.mjs` 挂载冒烟测试（纳入 npm test）防复发

### Changed

- 移除不再使用的 `.g-dim`、`.g-logo-text`、`BADGE.drive`、`BADGE.refreshSoft`
- `_tools/` 去掉重复工具（measure-wheels、wheel-overlay）

### Changed

- 面板 ⚙ 菜单只保留换车，移除了混进去的数据源切换项；
  数据源回归配置字段 `provider`（可选 dsh / codex / claude / doubao）

### Added

- **多数据源适配**：`provider` 可切 DSH 余额 / Codex / Claude Code / 豆包
- 本地用量桥接 `bridge/server.mjs`（只监听回环地址），
  采集 Codex 与 Claude Code 的会话 JSONL 统计 token 用量
- 面板 ⚙ 菜单增加数据源切换，选择持久化
- **豆包适配**：三级回退（火山引擎余额 API / 自建 HTTP / 约定文件），
  内置火山引擎 HMAC-SHA256 签名；面板按 `unit` 自动切换 `¥42.75` 与 `42.8M` 两种显示
- 非余额数据源改用紧凑数字格式（`112.8M`），并隐藏货币符号

### Added

- Red Bull 车辆改用维斯塔潘 BGM（荷兰国歌开头 2.5 秒，美国海军军乐团录音，公有领域）
- 车辆支持 `durationMs` 覆盖跑动时长，音乐类声浪可以完整放完
- **车辆 ↔ 品牌联动**：每辆车绑定 `brand`，跑车时标志与强调色跟着切换
- 迈凯伦声浪换成真实赛道实录（Wikimedia Commons，CC BY-SA 3.0 / Edvvc）
- 标志金属质感：单色标用「蒙版 + 镀铬渐变」渲染
- 车身/车轮/标志统一做**反预乘去白边**，深色面板上不再出现白边

### Added

- 第二辆车：迈凯伦 F1（白底泛洪抠图 + 真实透明通道，`kind: "alpha"`）
- **车轮滚动**：车辆可在清单里声明 `wheels`，跑动时按百分比定位圆形车轮图层并绕圆心旋转
- 边框标志从 BMW M 换成迈凯伦 speedmark（webp 内嵌），皮肤改名 `mclaren`（`bmw-m` 保留为别名）

### Changed

- 声浪改为 **录音优先、合成兜底**：内嵌参考录音，新增 `drive.engine`
  （`auto` / `sample` / `synth`）切换来源
- 移除第二辆车「M4 GT3 · CHINA GT 蓝」（观感不佳）
- 移除第三辆车「M4 · 夜行隧道」，只保留银色 M4 Competition（产物降到 106.5KB）
- 配置覆盖改为浅合并，只写 `drive.fx` 不会再冲掉其他默认值
- `verify` 增加「声浪录音已内嵌」检查

### Added

- 点击彩蛋：M 跑车从右向左穿过面板，期间只显示跑车与速度线
- 声浪改为 **WebAudio 实时合成**（直列六缸谐波堆叠 + 转速扫升 + 过车声像），\n  右上角喇叭按钮开关，状态持久化
- 新增配置 `drive.{enabled,sound,durationMs}`
- `docs/drive-frames.png` 展示跑车经过的三帧
- 一键部署脚本 `scripts/deploy.ps1`（构建 → 备份 → 同步到 DSH profile）与 `部署.bat` 双击入口
- **素材库**：`assets/manifest.json` 声明车辆与声浪，构建时整体内嵌；
  新增车辆只需放图 + 清单加一条，无需改 JS。支持 `cutout`（透明抠图）与
  `plate`（柔边场景图）两种素材类型，各自匹配不同的混合方式
- 第三辆车：银色 M4 · 夜行隧道（城市夜驾素材，车灯 + 隧道灯带柔边版）
- 新声浪素材 `sounds/engine-m4-night.mp3`：夜驾实录隧道段（12.95s–14.55s，
  1.6s，highpass 38Hz + 淡入淡出 + loudnorm −15 LUFS），设为两辆车默认声浪；
  旧参考录音保留为备选
- `drive.car`：`'auto'` 每次点击轮换车库，或填车辆 id 固定
- 每辆车可用 `engine.revScale` / `engine.roar` 微调自己的嗓门

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
