# 安全说明

## 报告问题

如果你发现安全问题，请**不要**直接开公开 issue。
使用 GitHub 的私密报告：仓库页 `Security` → `Report a vulnerability`，
或邮件联系仓库维护者。

请在报告里包含：影响范围、复现步骤、可能的修复方向。

## 安全设计

这个插件只做两件事：读余额、画 DOM。

- **不发起任何外部网络请求**：字体与标志以 base64 内嵌在产物里（CI 会校验）
- **不读取凭据**：余额通过 DSH 的 `ctx.remote.account.getBalance` 获取，
  插件本身不接触 token / API Key
- **不上报数据**：唯一的本地写入是 localStorage 里的面板位置和一条诊断状态
- **不注入远程脚本**：产物是单文件 classic script，注册到 `window.__ModuleLoader__`

## 已知边界

- 面板会被注入到页面 `document.body`，属于宿主页面的可信上下文；
  若 DSH 页面启用严格 CSP，`<style>` 注入可能被拦截
- 诊断遥测写在 `localStorage['dsh-gauge-diag']`，内容为时间、状态码和错误摘要，
  不含余额数值之外的账户信息
