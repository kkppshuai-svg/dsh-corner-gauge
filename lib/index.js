/**
 * dsh-corner-gauge · 宿主侧（node half）
 *
 * 纯 UI 插件：宿主侧不需要任何行为，`apply` 只要存在即可让插件出现在
 * host 的 cordis 树里；浏览器半边通过 package.json 的 `dsh.client`
 * 声明 + exports["./client"] 被发现。
 *
 * 注意：只导出 apply，不要额外导出 name / inject / default。
 * 多出来的导出会让 cordis 认不出这是标准插件条目，连带浏览器半边也不加载。
 */
export function apply() {}
