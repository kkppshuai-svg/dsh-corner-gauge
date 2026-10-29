/**
 * 构建脚本
 * ------------------------------------------------------------------
 * 把 src/ 下的模块按文件名顺序拼成一个浏览器可直接加载的 classic script，
 * 并把「素材库」与字体、标志一起以 base64 内嵌进去（插件零外部请求）。
 *
 *   node scripts/build.mjs
 *
 * 素材库：
 *   assets/manifest.json 声明所有车辆与声浪，build 时整体内嵌成
 *   BADGE.CARS / BADGE.SOUNDS。新增一辆车 = 放一张图 + 清单加一条，
 *   不需要改任何 JS 代码。
 *
 * 输出：lib/client.js
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ASSETS = join(ROOT, 'assets');
const OUT = join(ROOT, 'lib', 'client.js');

const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** 读 assets 下的文件并转 base64（相对 assets/ 的路径）。 */
function dataUri(rel) {
  const p = join(ASSETS, rel);
  if (!existsSync(p)) throw new Error(`素材不存在：assets/${rel}`);
  const mime = MIME[extname(p).toLowerCase()];
  if (!mime) throw new Error(`未知素材类型：assets/${rel}`);
  return `data:${mime};base64,${readFileSync(p).toString('base64')}`;
}

const FONT_B64 = readFileSync(join(ASSETS, 'rajdhani-700.woff2')).toString('base64');
const LOGO_B64 = readFileSync(join(ASSETS, 'bmw-m.svg')).toString('base64');

/* ---------------- 素材库 ---------------- */
const MANIFEST = JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8'));

const sounds = (MANIFEST.sounds || []).map((s) => ({
  id: s.id,
  name: s.name || s.id,
  src: dataUri(s.file),
}));

const cars = (MANIFEST.cars || []).map((c) => ({
  id: c.id,
  name: c.name || c.id,
  kind: c.kind === 'plate' ? 'plate' : 'cutout',
  sound: c.sound || (sounds[0] && sounds[0].id) || null,
  src: dataUri(c.file),
}));

if (cars.length === 0) throw new Error('assets/manifest.json 里一辆车都没有');
for (const s of sounds) {
  if (!s.id || !s.src) throw new Error('sounds 条目缺少 id');
}

const assetsBlock = `
/* ---- 素材库（由 assets/manifest.json 生成，勿手改）---- */
BADGE.CARS = ${JSON.stringify(cars, null, 1)};

BADGE.SOUNDS = ${JSON.stringify(
  Object.fromEntries(sounds.map((s) => [s.id, s.src])),
  null,
  1,
)};

/** 按 id 找车；找不到返回全部清单（便于调试）。 */
BADGE.findCar = function findCar(id) {
  const list = BADGE.CARS || [];
  return list.find((c) => c.id === id) || null;
};
`;

const files = readdirSync(SRC)
  .filter((f) => f.endsWith('.js'))
  .sort();

if (files.length === 0) throw new Error('src/ 下没有找到模块');

const body = files
  .map((f) => `/* ---- ${f} ---- */\n${readFileSync(join(SRC, f), 'utf8')}`)
  .join('\n\n')
  .replaceAll('__FONT_B64__', FONT_B64)
  .replaceAll('__LOGO_B64__', LOGO_B64);

const banner = `/**
 * ${PKG.name} v${PKG.version} — 由 scripts/build.mjs 生成，请勿直接编辑。
 * 改源码请编辑 src/，素材改 assets/（清单 manifest.json），然后 npm run build。
 */
`;

const output = `${banner}window.__ModuleLoader__.load({
	id: ${JSON.stringify(PKG.name)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

${(body + '\n' + assetsBlock)
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
console.log(`  字体 ${kb(FONT_B64.length)} · 标志 ${kb(LOGO_B64.length)}（base64）`);
console.log(`  素材库：${cars.length} 辆车 [${cars.map((c) => `${c.id}/${c.kind}`).join(', ')}] · ${sounds.length} 段声浪`);
console.log(`  产物体积 ${kb(Buffer.byteLength(output))}`);
