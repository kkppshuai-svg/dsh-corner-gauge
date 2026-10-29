/**
 * 产物校验
 * ------------------------------------------------------------------
 * 在临时目录重新构建一次，和仓库里的 lib/client.js 对比。
 * 用来防止「改了 src 忘了重新构建」把坏产物推上去。
 *
 *   node scripts/verify.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, copyFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'dsh-badge-verify-'));

let failed = false;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  failed = true;
  console.error(`  ✗ ${msg}`);
};

try {
  /* 1. 在临时副本里重新构建 */
  for (const dir of ['src', 'assets', 'scripts']) {
    cpSync(join(ROOT, dir), join(TMP, dir), { recursive: true });
  }
  mkdirSync(join(TMP, 'lib'), { recursive: true });
  for (const file of ['package.json', 'cordis.patch.yml']) {
    copyFileSync(join(ROOT, file), join(TMP, file));
  }

  execFileSync(process.execPath, [join(TMP, 'scripts', 'build.mjs')], { stdio: 'pipe' });

  const fresh = readFileSync(join(TMP, 'lib', 'client.js'), 'utf8');
  const committed = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');

  if (fresh === committed) ok('lib/client.js 与 src/ 一致');
  else bad('lib/client.js 已过期 —— 运行 npm run build 后重新提交');

  /* 2. 产物语法 */
  for (const file of ['lib/client.js', 'lib/index.js']) {
    try {
      execFileSync(process.execPath, ['--check', join(ROOT, file)], { stdio: 'pipe' });
      ok(`${file} 语法通过`);
    } catch {
      bad(`${file} 语法错误`);
    }
  }

  /* 3. 零外部请求：产物里不该有 http(s) 的加载地址 */
  const remoteRefs = committed.match(/https?:\/\/[^\s'"`)]+/g) || [];
  const loading = remoteRefs.filter((url) => !/w3\.org|inkscape|purl\.org|creativecommons/.test(url));
  if (loading.length === 0) ok('产物无外部网络依赖');
  else bad(`产物含外部地址：${loading.slice(0, 3).join(', ')}`);

  /* 4. 关键资源已内嵌 */
  if (committed.includes('data:font/woff2;base64,')) ok('字体已内嵌');
  else bad('缺少内嵌字体');

  if (committed.includes('data:image/svg+xml;base64,')) ok('标志已内嵌');
  else bad('缺少内嵌标志');
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

if (failed) {
  console.error('\n校验失败');
  process.exit(1);
}
console.log('\n校验通过');
