# dsh-corner-gauge

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的一块角落悬浮面板：**显示账户余额**。

外形是一块斜切刀锋底板，右侧是金属质感的数字，左侧边框可以换成任意模板。
**边框是模板（skin），面板里显示什么由元素（elements）决定**——想加图标、涨跌、标签，往注册表里丢一个就行。

![预览](docs/screenshot.png)

---

## 特性

- **边框可换**：内置 `bmw-m`（斜切刀锋 + M 标志）与 `minimal`（极简圆角）两套模板
- **元素可插**：货币符号、金额、进度条各自独立，按 `config.elements` 顺序装配
- **零外部请求**：字体与标志全部 base64 内嵌在产物里，离线可用
- **可拖动**：位置写进 localStorage，窗口缩放自动钳制回视口
- **不崩界面**：取数失败按指数退避重试；未登录 / 不可用时显示 `--`，不会静默消失

---

## 安装

### 1. 放进 profile

```bash
# 把仓库放到任意位置后，复制进 profile 的 node_modules
# Windows 示例
xcopy /E /I dsh-corner-gauge "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-corner-gauge"
```

### 2. 在 profile 的 package.json 里登记

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

客户端插件的 bundle 在启动时构建，改完必须重启（刷新页面不够）。

> 如果 App 启动后插件没出现，检查 `~/.dsh/profiles/<profile>/package.json` 的 `dsh.profile.bundles` 里是否还留着它——DSH 在组合失败时会重置 profile。

---

## 配置

运行时覆盖，在插件加载前塞一个全局对象即可：

```js
window.__DSH_BADGE_CONFIG__ = {
  skin: 'bmw-m',                 // 边框模板
  elements: ['currency', 'amount', 'progress'],
  position: { right: 22, bottom: 96 },
  size: { width: 322, height: 70 },
  currency: 'auto',              // 'auto' | 'CNY' | 'USD'
  pollMs: 60000,
};
```

| 键 | 说明 |
|---|---|
| `skin` | 边框模板名，见 `src/30-skins.js` |
| `elements` | 面板元素顺序，见 `src/40-elements.js` |
| `position` | 默认停靠位置（右下角偏移） |
| `size` | 面板尺寸（px） |
| `currency` | 币种，`auto` 跟随账户 |
| `pollMs` | 轮询间隔（毫秒） |

---

## 自定义边框模板

边框模板只负责**外壳**：形状、底色、装饰、标志。它不关心面板里显示什么。

在 `src/30-skins.js` 里注册：

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

  // 装饰节点：往外壳里塞 DOM（可选）
  build(blade) {
    const dot = document.createElement('div');
    dot.className = 'g-dot';
    blade.appendChild(dot);
  },
};
```

然后 `config.skin = 'my-skin'`。

内置模板：

| 名称 | 说明 |
|---|---|
| `bmw-m` | 斜切刀锋 + 官方 M 标志 + 顶部红条 + 斜向速度线 |
| `minimal` | 极简圆角底板，无装饰 |

---

## 自定义面板元素

元素只负责**显示什么**，不关心外壳。

```js
BADGE.elements.delta = {
  // 样式
  css(id) {
    return `
#${id} .g-delta { font-size: 13px; color: #4ade80; }`;
  },

  // 挂载：返回自己的节点
  mount(parts) {
    const el = document.createElement('span');
    el.className = 'g-delta';
    // parts 提供 { root, blade, content }
    parts.content.appendChild(el);
    return el;
  },

  // 数据变化时刷新
  update(el, view, root) {
    el.textContent = view.state === 'ready' ? '▲' : '';
  },
};
```

写进配置：`elements: ['currency', 'amount', 'delta', 'progress']`。

内置元素：

| 名称 | 说明 | 默认 |
|---|---|---|
| `currency` | 币种符号（¥ / $） | 开 |
| `amount` | 金额数字（金属渐变） | 开 |
| `progress` | 底部细进度条，按量程自动缩放 | 开 |

### 数据快照

`update(el, view)` 里的 `view` 结构：

```js
{
  state: 'loading' | 'ready' | 'guest' | 'error',
  total: 168.5,          // 充值余额 + 同币种赠金
  currency: 'CNY',
  scaleMax: 200,         // 进度条量程
}
```

---

## 开发

```bash
npm run build      # src/ + assets/ → lib/client.js（base64 内嵌）
```

构建产物 `lib/client.js` 是一个 classic script，调用
`window.__ModuleLoader__.load({ id, factory })` 自我注册。

直接双击 `preview.html` 也能看效果——它用一个假的 `ctx.remote` 喂数据，
和装进 App 后是同一份渲染代码。

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
assets/            字体与标志（构建时 base64 内嵌）
scripts/build.mjs  打包脚本
lib/               构建产物（index.js 宿主半边 + client.js 浏览器半边）
```

---

## 已知限制

- 客户端插件在 DSH 启动时装配，**改完必须重启**，热更新不生效
- 余额来自 `ctx.remote.account.getBalance`，需要先在 DSH 里登录账户；
  用纯 API Key 模式时拿不到余额，面板会一直显示 `--`
- 亮度、配色都写在 `src/40-elements.js` 的 CSS 里，换主题请改源码后重新构建

---

## 许可

MIT。内置的 M 标志来自 Wikimedia Commons，相关商标归 BMW AG 所有，
仅作为个人主题资源使用，本项目与 BMW 无关联。字体 Rajdhani 采用 SIL OFL 1.1。
