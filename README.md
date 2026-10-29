# dsh-corner-gauge

[![CI](https://github.com/kkppshuai-svg/dsh-corner-gauge/actions/workflows/ci.yml/badge.svg)](https://github.com/kkppshuai-svg/dsh-corner-gauge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的角落悬浮面板：**显示账户余额**。

外形是一块斜切底板，右侧是金属质感的数字。
**边框是模板（skin），面板里显示什么由元素（elements）决定**——换壳、加减元素都不必动另一层。

![预览](docs/screenshot.png)

---

## 目录

- [特性](#特性)
- [安装](#安装)
- [配置](#配置)
- [自定义边框模板](#自定义边框模板)
- [自定义面板元素](#自定义面板元素)
- [数据快照](#数据快照)
- [开发](#开发)
- [已知限制](#已知限制)
- [项目](#项目)

---

## 特性

- **边框可换**：内置 `bmw-m`（斜切 + M 标志）与 `minimal`（极简圆角）
- **元素可插**：货币符号、金额、进度条各自独立，按 `config.elements` 顺序装配
- **零外部请求**：字体与标志全部 base64 内嵌，离线可用（CI 会校验）
- **可拖动**：位置写入 localStorage，窗口缩放自动钳制回视口
- **不崩界面**：取数失败按指数退避重试；未登录 / 不可用时显示 `--`，不会静默消失
- **彩蛋**：单击面板，一辆 M 跑车从右向左开过一次（期间只显示跑车），
  配 WebAudio 实时合成的直列六缸声浪（带转速扫升与过车声像），右上角喇叭按钮可开关声音

---

## 安装

### 1. 放进 profile

```bash
# 把仓库复制进 profile 的 node_modules
# Windows 示例
xcopy /E /I dsh-corner-gauge "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-corner-gauge"
```

### 2. 登记到 profile

`~/.dsh/profiles/<profile>/package.json`：

```json
{
  "dependencies": {
    "dsh-corner-gauge": "^2.0.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-corner-gauge"
      ]
    }
  }
}
```

### 3. 重启 App

客户端插件的 bundle 在启动时构建，**改完必须重启**（刷新页面不够）。

> 启动后插件没出现，先检查 `dsh.profile.bundles` 里是否还留着它——
> DSH 在 profile 组合失败时会重置配置。

---

## 配置

运行时覆盖，在插件加载前塞一个全局对象：

```js
window.__DSH_BADGE_CONFIG__ = {
  skin: 'bmw-m',
  elements: ['currency', 'amount', 'progress'],
  position: { right: 22, bottom: 96 },
  size: { width: 322, height: 70 },
  currency: 'auto',          // 'auto' | 'CNY' | 'USD'
  pollMs: 60000,
};
```

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `skin` | `string` | `'bmw-m'` | 边框模板名 |
| `elements` | `string[]` | `['currency','amount','progress']` | 面板元素顺序 |
| `position` | `{right,bottom}` | `{22,96}` | 默认停靠位置 |
| `size` | `{width,height}` | `{322,70}` | 面板尺寸（px） |
| `currency` | `string` | `'auto'` | 币种，`auto` 跟随账户 |
| `pollMs` | `number` | `60000` | 轮询间隔（毫秒） |
| `drive.enabled` | `boolean` | `true` | 是否启用点击跑车彩蛋 |
| `drive.sound` | `boolean` | `true` | 声浪默认开关（用户切过以用户为准） |
| `drive.durationMs` | `number` | `1500` | 跑车穿过面板的时长 |
| `drive.fx` | `boolean` | `false` | 是否叠加速度线与拖尾特效 |
| `drive.car` | `string` | `'auto'` | `'auto'` 每次点击换下一辆；也可填固定车辆 id |

---

## 素材库

所有车辆都在 `assets/manifest.json` 里声明，**构建时整体内嵌进产物**（仍是零外部请求）。

```json
{
  "cars": [
    { "id": "m4-silver",    "name": "M4 Competition · 银", "kind": "cutout", "file": "cars/m4-silver.webp",    "sound": "engine-m4" },
    { "id": "m4-gt3-blue",  "name": "M4 GT3 · CHINA GT 蓝", "kind": "plate",  "file": "cars/m4-gt3-blue.webp",  "sound": "engine-m4" }
  ],
  "sounds": [
    { "id": "engine-m4", "name": "M4 直六 · 原地轰油", "file": "sounds/engine-m4.mp3" }
  ]
}
```

`kind` 决定在面板上怎么融进深色刀锋：

| kind | 含义 | 渲染方式 |
|---|---|---|
| `cutout` | 透明底（或黑底可被过滤）的抠图 | `mix-blend-mode: screen`，黑底自动消失 |
| `plate` | 带柔化透明边的场景照片 | 正常混合，边缘自己淡出 |

**加一辆车**：把图片丢进 `assets/cars/`，在清单里加一条，`npm run build` 即可 —— 不用改 JS。
**调声浪**：声浪不是录音而是实时合成，参数在 `src/35-drive.js` 的 `BADGE.RPM_CURVE`（转速曲线）\n与 `playEngine` 里的谐波表。车辆可在清单里用 `engine.revScale` / `engine.roar` 微调嗓门。

`drive.car` 默认 `'auto'`：点一次换一辆，把车库轮着开一遍。

---

## 彩蛋：跑车

**单击面板**（不拖动），一辆 M 跑车从右向左开过一次：

- 车辆来自上面的素材库，默认按 `auto` 轮换
- 跑动期间面板元素、边框标志、进度线、斜向流动纹全部隐藏，只留跑车本体
- **右上角喇叭按钮**开关声音，状态写进 `localStorage`，下次启动保持
- 拖动与单击互斥：指针位移 < 6px 且短于 400ms 判定为单击；点喇叭不会误触发跑车

```js
window.__DSH_BADGE_CONFIG__ = {
  drive: { enabled: true, sound: true, durationMs: 1500, fx: false, car: 'auto' },
};
```

![跑车三帧](docs/drive-frames.png)

---

## 自定义边框模板

模板只负责**外壳**：形状、底色、装饰、标志。它不关心面板里显示什么。

```js
BADGE.skins['my-skin'] = {
  // 样式：id 是面板根节点 id
  css(id) {
    return `
#${id} .g-blade {
  position: absolute; inset: 0;
  clip-path: polygon(0 20%, 6% 0, 100% 0, 100% 100%, 0 100%);
  background: linear-gradient(180deg, #1a1c22, #060709);
}`;
  },

  // 装饰节点（可选）：往外壳里塞 DOM
  build(blade) {
    const dot = document.createElement('div');
    dot.className = 'g-dot';
    blade.appendChild(dot);
  },
};
```

然后 `config.skin = 'my-skin'`。

| 内置模板 | 说明 |
|---|---|
| `bmw-m` | 斜切底板 + M 标志 + 顶部红条 + 斜向速度线 |
| `minimal` | 极简圆角底板，无装饰 |

---

## 自定义面板元素

元素只负责**显示什么**。

```js
BADGE.elements.delta = {
  css(id) {
    return `#${id} .g-delta { font-size: 13px; color: #4ade80; }`;
  },

  // 挂载：返回自己的节点。parts = { root, blade, content }
  mount(parts) {
    const el = document.createElement('span');
    el.className = 'g-delta';
    parts.content.appendChild(el);
    return el;
  },

  // 数据变化时刷新
  update(el, view) {
    el.textContent = view.state === 'ready' ? '▲' : '';
  },
};
```

写进配置：`elements: ['currency', 'amount', 'delta', 'progress']`。

| 内置元素 | 说明 | 默认 |
|---|---|---|
| `currency` | 币种符号（¥ / $） | 开 |
| `amount` | 金额数字（金属渐变） | 开 |
| `progress` | 底部进度条，按量程自动缩放 | 开 |

---

## 数据快照

`update(el, view)` 里的 `view`：

```js
{
  state: 'loading' | 'ready' | 'guest' | 'error',
  total: 168.5,        // 充值余额 + 同币种赠金
  currency: 'CNY',
  scaleMax: 200,       // 进度条量程
}
```

余额来自 `ctx.remote.account.getBalance(metadata)`，`metadata` 需要
`{ version, locale, timezoneOffsetSeconds }`，版本号必须与运行时一致。

---

## 开发

只需要 Node.js ≥ 18，**没有任何第三方依赖**。

```bash
npm run build      # src/ + assets/ → lib/client.js（base64 内嵌）
npm run lint       # 语法、命名约定、占位符残留、命名空间引用
npm run verify     # 重新构建并与仓库产物逐字节比对
npm test           # lint + verify
```

双击 `preview.html` 即可查看效果——它用假的 `ctx.remote` 喂数据，
与装进 App 后运行的是同一份渲染代码。

### 目录结构

```
src/
  00-config.js     配置、常量、view 快照
  10-data.js       取数、格式化、诊断遥测
  20-drag.js       拖动与位置记忆
  30-skins.js      边框模板注册表（外壳）
  40-elements.js   面板元素注册表（内容）
  50-render.js     装配：样式汇总、建 DOM、绘制、重试
  60-client.js     插件入口 apply()
assets/
  manifest.json    素材库清单（车辆）
  cars/            车辆图片（cutout 或 plate）
  （声浪为 WebAudio 实时合成，无音频文件）
  bmw-m.svg        标志（构建时 base64 内嵌）
  rajdhani-700.woff2  字体（构建时 base64 内嵌）
scripts/           build / verify / lint
lib/               构建产物：index.js（宿主半边）+ client.js（浏览器半边）
```

> `lib/client.js` 由构建生成，**不要手改**——CI 会校验产物与源码是否一致。

---

## 已知限制

- 客户端插件在 DSH 启动时装配，改完必须重启，热更新不生效
- 余额依赖 `ctx.remote.account.getBalance`，需要先在 DSH 里登录账户；
  纯 API Key 模式拿不到余额，面板会一直显示 `--`
- 配色与字号写在 `src/40-elements.js` 的 CSS 里，换主题请改源码后重新构建

---

## 项目

| 文档 | 说明 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发流程、提交规范、PR 要求 |
| [SECURITY.md](SECURITY.md) | 安全边界与漏洞报告方式 |

## 许可

MIT。内置的 M 标志来自 [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:BMW_M_logo.svg)，
相关商标归 BMW AG 所有，仅作为个人主题资源使用，本项目与 BMW 无关联。
字体 [Rajdhani](https://fonts.google.com/specimen/Rajdhani) 采用 SIL OFL 1.1。
