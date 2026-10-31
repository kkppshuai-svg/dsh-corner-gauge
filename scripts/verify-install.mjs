#!/usr/bin/env node
/**
 * 分发包安装 / 启动 / 卸载验证
 * ------------------------------------------------------------------
 * DSH STORE 要求提供「一次性 Profile 的安装、启动与卸载证据」。
 * 这个脚本在临时目录里完整走一遍并打印可引用的输出：
 *
 *   1. npm pack 出 tarball（= 实际分发的产物）
 *   2. 解包到一个全新的假 profile/node_modules/dsh-corner-gauge（= 安装）
 *   3. 校验 license / engines / dsh.compat / exports / 关键文件
 *   4. 用 DOM 桩加载 lib/client.js 并 apply，断言金额渲染（= 启动）
 *   5. 删除目录并确认无残留（= 卸载）
 *
 *   node scripts/verify-install.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createDomSandbox, collectTexts } from './dom-stub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const problems = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { problems.push(msg); console.error(`  ✗ ${msg}`); };

const work = mkdtempSync(join(tmpdir(), 'dsh-gauge-install-'));
let tarball = null;

/* ---------------- 1. 打包 ---------------- */
try {
  /* Windows 下 npm 是 .cmd，execFileSync 不能直连，用 shell + 固定字面量命令 */
  const pack = () => (process.platform === 'win32'
    ? execFileSync(`npm pack --silent --pack-destination "${work}"`, { cwd: ROOT, encoding: 'utf8', shell: true })
    : execFileSync('npm', ['pack', '--silent', '--pack-destination', work], { cwd: ROOT, encoding: 'utf8' }));

  const out = pack().trim().split('\n').pop().trim();
  tarball = join(work, out);
  if (!existsSync(tarball)) throw new Error(`npm pack 没有产出：${out}`);
  ok(`npm pack → ${out}（${(readFileSync(tarball).length / 1024).toFixed(0)} KB）`);
} catch (error) {
  bad(`npm pack 失败：${error.message}`);
  finish();
}

/* ---------------- 2. 安装到一个全新 profile ---------------- */
const installed = join(work, 'profile', 'node_modules', 'dsh-corner-gauge');
mkdirSync(installed, { recursive: true });
try {
  execFileSync('tar', ['-xzf', tarball, '-C', installed, '--strip-components=1'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  ok('安装：解包到临时 profile 的 node_modules/dsh-corner-gauge');
} catch (error) {
  bad(`解包失败：${error.message}`);
  finish();
}

/* ---------------- 3. 校验包元数据 ---------------- */
const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));

if (pkg.license === 'MIT') ok('package.json license = MIT');
else bad(`package.json license 不是 MIT：${pkg.license}`);

if (existsSync(join(installed, 'LICENSE'))) {
  const lic = readFileSync(join(installed, 'LICENSE'), 'utf8');
  if (lic.startsWith('MIT License') && lic.includes('Permission is hereby granted')) ok('LICENSE 是标准 MIT 全文');
  else bad('LICENSE 开头不是标准 MIT 文本');
} else bad('分发包里没有 LICENSE');

if (existsSync(join(installed, 'NOTICE.md'))) ok('NOTICE.md 含第三方素材声明');
else bad('分发包里没有 NOTICE.md');

if (pkg.engines && pkg.engines.node && pkg.engines.dsh) ok(`engines 已声明（node ${pkg.engines.node} / dsh ${pkg.engines.dsh}）`);
else bad('缺 engines.node 或 engines.dsh');

if (pkg.dsh && pkg.dsh.compat) ok(`dsh.compat 已声明（dsh ${pkg.dsh.compat.dsh}）`);
else bad('缺 dsh.compat');

for (const rel of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
  if (existsSync(join(installed, rel))) ok(`包含 ${rel}`);
  else bad(`分发包缺少 ${rel}`);
}

for (const [key, value] of Object.entries(pkg.exports || {})) {
  const target = typeof value === 'string' ? value : value.default;
  if (!target) { bad(`exports["${key}"] 没有 default`); continue; }
  if (existsSync(join(installed, target))) ok(`exports["${key}"] → ${target}`);
  else bad(`exports["${key}"] 指向不存在的文件：${target}`);
}

/* ---------------- 4. 启动 ---------------- */
try {
  const sandbox = createDomSandbox();
  runInNewContext(readFileSync(join(installed, 'lib', 'client.js'), 'utf8'), sandbox, { filename: 'client.js' });
  if (!sandbox.modules.length) throw new Error('没有注册客户端模块');

  const ctx = {
    remote: {
      account: {
        async getBalance() {
          return { ok: true, value: { value: [{ currency: 'CNY', balance: '12.34' }], bonusWallets: [] } };
        },
      },
    },
    effect: (fn) => fn(),
  };

  let applyError = null;
  for (const factory of sandbox.modules) {
    const exported = factory({});
    const fn = exported && typeof exported.apply === 'function' ? exported.apply
      : typeof exported === 'function' ? exported
        : exported && exported.default;
    try {
      await fn.call(exported, ctx);
    } catch (error) {
      applyError = error;
    }
  }
  await new Promise((r) => setTimeout(r, 250));
  if (applyError) throw applyError;

  const root = sandbox.document.getElementById('dsh-corner-gauge');
  if (!root) throw new Error('面板根节点没有挂载');
  if (!collectTexts(root).some((t) => t.includes('12.34'))) throw new Error('面板没有渲染出金额');
  if (!sandbox.document.getElementById('dsh-corner-gauge-style')) throw new Error('样式表没有注入');
  ok('启动：模块加载 → apply → 面板挂载 → 金额渲染（12.34）→ 样式注入');
} catch (error) {
  bad(`启动验证失败：${error.message}`);
}

/* ---------------- 5. 卸载 ---------------- */
try {
  rmSync(installed, { recursive: true, force: true });
  if (existsSync(installed)) bad('卸载后目录仍然存在');
  else ok('卸载：删除目录后无残留');
} catch (error) {
  bad(`卸载验证失败：${error.message}`);
}

finish();

function finish() {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* 忽略 */ }
  if (problems.length) {
    console.error(`\n分发包验证失败（${problems.length} 项）`);
    process.exit(1);
  }
  console.log('\n分发包验证通过：可安装 / 可启动 / 可卸载');
  process.exit(0);
}
