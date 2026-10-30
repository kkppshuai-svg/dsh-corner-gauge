# Codex 套餐用量悬浮窗（Windows）

这个适配器使用仓库中构建好的 `lib/client.js` 显示原版仪表，读取当前登录的 Codex 套餐短周期与周周期剩余百分比和重置时间。它使用本机 Codex app-server 的 `account/rateLimits/read`，无需输入或存储 API 密钥；读取失败时会显示提示。

需要 Windows、已登录的 Codex 桌面版、Python 3 和 Microsoft Edge。使用 `pythonw.exe standalone/codex_gauge.py` 启动；窗口置顶，可以拖动顶部区域，点击仪表可播放原版动画，选中窗口后按 Alt+F4 退出。窗口使用的本地服务只监听 127.0.0.1，页面不会发送聊天内容。

这是独立窗口，不会修改 Codex 桌面应用。Codex 的本机接口可能随版本变化，若遇到故障请检查 Codex 登录状态及版本。原项目中的 Token 用量桥接与这里的套餐剩余比例是不同的数据。
