# 贡献指南

感谢你愿意改进这个项目。它很小，所以流程也很轻。

## 开发环境

只需要 Node.js ≥ 18，没有任何第三方依赖：

```bash
node --version        # 需要 >= 18
npm run build         # src/ + assets/ → lib/client.js
npm test              # lint + verify
```

打开 `preview.html` 就能看到渲染效果——它用假的 `ctx.remote` 喂数据，
和装进 DSH 后跑的是同一份代码，不需要反复重启 App。

## 目录约定

| 目录 | 放什么 |
|---|---|
| `src/` | 全部源码，按 `NN-name.js` 命名，构建时按文件名排序拼接 |
| `assets/` | 字体、矢量标志等静态资源，构建时 base64 内嵌 |
| `scripts/` | 构建、校验、静态检查脚本 |
| `lib/` | 构建产物（`client.js` 浏览器半边、`index.js` 宿主半边） |

**不要直接编辑 `lib/client.js`** —— 它由 `npm run build` 生成，CI 会校验产物与源码是否一致。

## 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat: 新功能
fix: 修 bug
docs: 只改文档
style: 不影响行为的样式调整
refactor: 重构
chore: 构建、依赖、杂项
```

一次提交只做一件事。涉及边框模板或面板元素的改动，请同时在 `CHANGELOG.md` 的
`Unreleased` 段落下写一行。

## 新增边框模板 / 面板元素

1. 在 `src/30-skins.js` 或 `src/40-elements.js` 里注册
2. 在 `README.md` 的内置列表里补一行
3. 如果需要新资源，放进 `assets/` 并在构建脚本里内嵌
4. `npm test` 通过后提交

详细接口见 [README — 自定义边框模板](README.md#自定义边框模板)
与 [自定义面板元素](README.md#自定义面板元素)。

## Pull Request

- 分支从 `main` 切出，命名 `feat/xxx`、`fix/xxx`
- 描述里写清楚：改了什么、为什么、怎么验证
- 确保 `npm test` 通过、CI 绿
- 涉及视觉变化请附截图（`docs/screenshot.png` 是 README 用的主图）

## 行为准则

保持友善。技术分歧用数据和截图说话，不用情绪。
