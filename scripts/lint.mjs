/**
 * 轻量静态检查（不依赖任何第三方包）
 * ------------------------------------------------------------------
 *   node scripts/lint.mjs
 *
 * 检查项：
 *   1. src/ 下所有模块可被 Node 解析（语法）
 *   2. 模块文件名符合 NN-name.js 的排序约定
 *   3. 没有残留的未替换占位符
 *   4. 产物不引用未定义的全局（粗查 BADGE.xxx 是否在 src 里注册过）
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

let failed = false;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  failed = true;
  console.error(`  ✗ ${msg}`);
};

const files = readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();

/* 1. 语法 */
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', join(SRC, file)], { stdio: 'pipe' });
    ok(`${file} 语法通过`);
  } catch {
    bad(`${file} 语法错误`);
  }
}

/* 2. 命名约定 */
for (const file of files) {
  if (!/^\d{2}-[a-z0-9-]+\.js$/.test(file)) bad(`${file} 不符合 NN-name.js 命名约定`);
}
if (files.every((f) => /^\d{2}-[a-z0-9-]+\.js$/.test(f))) ok('模块命名与排序约定符合');

/* 3. 占位符 */
const bundle = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
if (/__[A-Z_]+_B64__/.test(bundle)) bad('产物里还残留未替换的占位符');
else ok('产物无残留占位符');

/* 4. BADGE 命名空间引用检查（粗查） */
const all = files.map((f) => readFileSync(join(SRC, f), 'utf8')).join('\n');
const defined = new Set();
for (const m of all.matchAll(/BADGE\.([A-Za-z0-9_]+)\s*=/g)) defined.add(m[1]);
for (const m of all.matchAll(/BADGE\.(elements|skins)\[['"]([A-Za-z0-9_-]+)['"]\]\s*=/g)) {
  defined.add(`${m[1]}:${m[2]}`);
}

/* 构建时由 assets/manifest.json 注入的成员，不在 src/ 里定义 */
const GENERATED = new Set(['CARS', 'SOUNDS', 'BRANDS', 'findCar']);

const used = new Set();
for (const m of all.matchAll(/BADGE\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
const missing = [...used].filter((name) => !defined.has(name) && !GENERATED.has(name));
if (missing.length === 0) ok('BADGE 命名空间引用完整');
else bad(`引用了未定义成员：${missing.join(', ')}`);

if (failed) {
  console.error('\n检查失败');
  process.exit(1);
}
console.log('\n检查通过');
