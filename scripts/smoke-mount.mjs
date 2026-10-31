#!/usr/bin/env node
/**
 * 挂载冒烟测试
 * ------------------------------------------------------------------
 * 用极简 DOM 桩把 lib/client.js 真正跑一遍：apply → build → paint。
 * 目的是抓「改了某个变量导致运行时 ReferenceError、面板整个不渲染」这类问题
 * —— 只做语法检查是发现不了的（历史事故：删死代码时漏了一行 txt.style...）。
 *
 *   node scripts/smoke-mount.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createDomSandbox, collectTexts } from './dom-stub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8');

const sandbox = createDomSandbox();
runInNewContext(BUNDLE, sandbox, { filename: 'lib/client.js' });

let failed = false;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failed = true; console.error(`  ✗ ${m}`); };

if (!sandbox.modules.length) {
  bad('插件没有向 __ModuleLoader__ 注册模块');
  process.exit(1);
}
ok('模块注册成功');

const ctx = {
  remote: {
    account: {
      async getBalance() {
        return { ok: true, value: { value: [{ currency: 'CNY', balance: '168.50' }], bonusWallets: [] } };
      },
    },
  },
  effect: (fn) => fn(),
  logger: console,
};

for (const factory of sandbox.modules) {
  const exported = factory({});
  try {
    if (exported && typeof exported.apply === 'function') await exported.apply(ctx);
    else if (typeof exported === 'function') await exported(ctx);
    else if (exported && typeof exported.default === 'function') await exported.default(ctx);
  } catch (error) {
    bad(`apply 抛异常：${error && error.message ? error.message : error}`);
  }
}

/* 等一轮异步取数 + 绘制 */
await new Promise((r) => setTimeout(r, 250));

const root = sandbox.document.getElementById('dsh-corner-gauge');
if (!root) bad('面板根节点没有挂到 document');
else if (root.children.length === 0) bad('面板根节点是空的（build 没跑或中途抛错）');
else ok(`面板挂载成功（根节点 ${root.children.length} 个子节点）`);

if (sandbox.document.getElementById('dsh-corner-gauge-style')) ok('样式表已注入');
else bad('样式表没有注入');

if (root) {
  const hasAmount = collectTexts(root).some((t) => t.includes('168.50'));
  if (hasAmount) ok('金额已渲染：168.50');
  else bad('面板里没有渲染出金额（build/paint 中途抛错？）');
}

if (process.env.DEBUG_TREE) {
  console.log('DIAG:', sandbox.localStorage.getItem('dsh-gauge-diag'));
}

if (failed) {
  console.error('挂载冒烟测试失败');
  process.exit(1);
}
ok('apply → build → paint 全程无异常');
/* 插件用 setInterval 轮询，显式退出 */
process.exit(0);
