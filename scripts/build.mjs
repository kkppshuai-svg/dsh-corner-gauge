/**
 * 构建脚本
 * ------------------------------------------------------------------
 * 把 src/ 下的模块按文件名顺序拼成一个浏览器可直接加载的 classic script，
 * 并把字体与标志以 base64 内嵌进去（插件零外部请求）。
 *
 *   node scripts/build.mjs
 *
 * 输出：lib/client.js
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'lib', 'client.js');

const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const read = (name) => readFileSync(join(ROOT, 'assets', name)).toString('base64');

const FONT_B64 = read('rajdhani-700.woff2');
const LOGO_B64 = read('bmw-m.svg');
const CAR_B64 = read('car.webp');
const ENGINE_B64 = read('engine.mp3');

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.js'))
  .sort();

if (files.length === 0) throw new Error('src/ 下没有找到模块');

const body = files
  .map((f) => `/* ---- ${f} ---- */\n${readFileSync(join(SRC, f), 'utf8')}`)
  .join('\n\n')
  .replaceAll('__FONT_B64__', FONT_B64)
  .replaceAll('__LOGO_B64__', LOGO_B64)
  .replaceAll('__CAR_B64__', CAR_B64)
  .replaceAll('__ENGINE_B64__', ENGINE_B64);

const banner = `/**
 * ${PKG.name} v${PKG.version} — 由 scripts/build.mjs 生成，请勿直接编辑。
 * 改源码请编辑 src/，然后 npm run build。
 */
`;

const output = `${banner}window.__ModuleLoader__.load({
	id: ${JSON.stringify(PKG.name)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

${body
  .split('\n')
  .map((line) => (line ? `\t\t${line}` : ''))
  .join('\n')}

		exports.apply = BADGE.apply;
		exports.inject = BADGE.inject;
		return module.exports;
	},
});
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, output, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`已生成 ${OUT}`);
console.log(`  模块 ${files.length} 个：${files.join(', ')}`);
console.log(`  字体 ${kb(FONT_B64.length)} · 标志 ${kb(LOGO_B64.length)} · 跑车 ${kb(CAR_B64.length)} · 声浪 ${kb(ENGINE_B64.length)}（base64）`);
console.log(`  产物体积 ${kb(Buffer.byteLength(output))}`);
