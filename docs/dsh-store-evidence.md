# DSH STORE 审查证据

对应 DSH STORE issue #1633 提出的三项要求。所有证据都可以在本仓库里**复现**。

| 审查发现 | 处理 |
|---|---|
| GitHub 仓库许可元数据为 `NOASSERTION` | `LICENSE` 改为**纯 MIT 全文**；第三方素材声明移到 `NOTICE.md`，不再干扰许可证识别 |
| 固定源许可证据需人工审核 | 见下文「许可证据」，三处标识一致：`LICENSE` / `package.json` / 分发包 |
| DSH 兼容性未明确声明 | `engines.node`、`engines.dsh`、`dsh.compat`、`peerDependencies` 四处在 `package.json` 声明 |
| 缺少一次性 Profile 的安装/启动/卸载证据 | `npm run verify:install` 一条命令跑完并输出全部证据 |

## 一、许可证据

### 文件

```
LICENSE     标准 MIT 全文（首行 "MIT License"，含 "Permission is hereby granted"）
NOTICE.md   第三方素材的授权与归属（车辆图片、车队徽标、音频、字体）
```

第三方素材**不改变代码授权**：代码整体为 MIT，素材的授权在其条目里单独说明
（其中 `assets/sounds/engine-f1.mp3` 为 CC BY-SA 3.0 衍生，`bgm-verstappen.mp3`
为所有者提供的录音、不在 MIT 范围内）。

### 元数据一致性

```jsonc
// package.json
{
  "license": "MIT",
  "engines": { "node": ">=18", "dsh": ">=0.2.1-rc.2 <0.3" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.5" },
  "dsh": {
    "compat": { "dsh": ">=0.2.1-rc.2 <0.3", "node": ">=18", "clientPlatform": "web" }
  }
}
```

`npm run verify` 会额外校验：`package.json` 的 `license` 必须是 `MIT`，
且 `LICENSE` 必须以标准 MIT 头开头——两者不一致时 CI 失败。

### 实际输出

```
$ node scripts/verify.mjs
  ✓ lib/client.js 与 src/ 一致
  ✓ package.json license = MIT，LICENSE 为标准 MIT 全文
  ...
```

## 二、兼容性声明

| 字段 | 值 | 含义 |
|---|---|---|
| `engines.node` | `>=18` | 构建脚本与桥接服务的 Node 版本下限 |
| `engines.dsh` | `>=0.2.1-rc.2 <0.3` | 已在 DSH 0.2.1-rc.2 上验证，0.3 前保持兼容 |
| `dsh.compat.clientPlatform` | `web` | 客户端插件运行在 web 渲染进程 |
| `dsh.client.inject` | `[]` | 不注入任何可选 UI 包，只依赖 `ctx.remote.account` |
| `peerDependencies` | `@deepseek-ai/cordis ^4.0.5` | 与 DSH 0.2.1-rc.2 内置版本一致 |

当前验证环境：Windows 11 + DSH `0.2.1-rc.2` + Node 24（构建）/ Node 18–22（CI）。

## 三、安装 / 启动 / 卸载证据

```bash
npm run verify:install
```

该脚本会在**临时目录**里建一个空 profile，完整走一遍分发流程：

```
✓ npm pack → dsh-corner-gauge-2.1.0.tgz（403 KB）
✓ 安装：解包到临时 profile 的 node_modules/dsh-corner-gauge
✓ package.json license = MIT
✓ LICENSE 是标准 MIT 全文
✓ NOTICE.md 含第三方素材声明
✓ engines 已声明（node >=18 / dsh >=0.2.1-rc.2 <0.3）
✓ dsh.compat 已声明（dsh >=0.2.1-rc.2 <0.3）
✓ 包含 lib/index.js
✓ 包含 lib/client.js
✓ 包含 cordis.patch.yml
✓ exports["."] → ./lib/index.js
✓ exports["./client"] → ./lib/client.js
✓ exports["./package.json"] → ./package.json
✓ 启动：模块加载 → apply → 面板挂载 → 金额渲染（12.34）→ 样式注入
✓ 卸载：删除目录后无残留

分发包验证通过：可安装 / 可启动 / 可卸载
```

说明：

- **安装**：`npm pack` 产出的是真正会被分发的 tarball（受 `package.json` 的 `files` 白名单约束），
  解包到 `profile/node_modules/dsh-corner-gauge` 等价于 DSH 的一次性安装。
- **启动**：用极简 DOM 桩加载安装后的 `lib/client.js`，走完整的
  `__ModuleLoader__.load → apply → build → paint`，并断言面板里渲染出了金额与样式表。
- **卸载**：删除插件目录后检查无残留文件。

该脚本只依赖 Node 与 npm，无网络请求，可在任意环境复现：
`npm run verify:install`。（CI 里接入需要仓库 token 具备 `workflow` 权限，
维护者可用自己的 token 在 `.github/workflows/ci.yml` 里加一个 `npm run verify:install` 步骤。）

## 复现方式

```bash
git clone https://github.com/kkppshuai-svg/dsh-corner-gauge.git
cd dsh-corner-gauge
npm run verify        # 产物一致性 + 许可标识一致
npm run smoke:mount   # 挂载冒烟
npm run verify:install # 安装 / 启动 / 卸载
```
