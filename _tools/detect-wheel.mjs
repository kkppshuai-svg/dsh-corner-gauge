/**
 * 车轮圆检测 v2：利用「车停在轮胎上」的约束
 *   cy = (图底) - r，未知量只剩 cx 和 r
 *   node detect-wheel2.mjs <id> <roughX%> [rangePct]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FF = 'C:/Users/22491/.dsh/tools/ffmpeg/bin/ffmpeg.exe';
const ROOT = 'C:/Users/22491/Desktop/建模/dsh-corner-gauge/';

function sizeOf(file) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = ((r.stderr || '') + (r.stdout || '')).match(/Video:.*?(\d+)x(\d+)/);
  return [Number(m[1]), Number(m[2])];
}
function rgba(file) {
  const [w, h] = sizeOf(file);
  return { w, h, buf: execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 29 }) };
}

const MANIFEST = JSON.parse(readFileSync(ROOT + 'assets/manifest.json', 'utf8'));
const id = process.argv[2];
const roughX = Number(process.argv[3]);
const range = Number(process.argv[4] || 1.2);   /* 绝对百分比范围 */

const car = MANIFEST.cars.find((c) => c.id === id);
const img = rgba(ROOT + 'assets/' + car.file);
const W = img.w, H = img.h, buf = img.buf;

const luma = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return 255;
  const o = (y * W + x) * 4;
  if (buf[o + 3] < 40) return 255;
  return 0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2];
};

function score(cx, cy, r) {
  let ring = 0, outside = 0, n = 0;
  const steps = 60;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    /* 轮胎环：0.72~1.0 r 之间取暗度 */
    const l1 = luma(Math.round(cx + dx * r * 0.86), Math.round(cy + dy * r * 0.86));
    const l2 = luma(Math.round(cx + dx * r * 1.22), Math.round(cy + dy * r * 1.22));
    if (l1 < 80) ring++;
    if (l2 < 80) outside++;
    n++;
  }
  return (ring - outside * 1.3) / n;
}

let best = null;
for (let cxPct = roughX - range; cxPct <= roughX + range; cxPct += 0.1) {
  const cx = (cxPct / 100) * W;
  for (let rPx = W * 0.045; rPx <= W * 0.085; rPx += 0.5) {
    const cy = H - 1 - rPx;     /* 轮胎底边贴图底 */
    const s = score(cx, cy, rPx);
    if (!best || s > best.s) best = { s, cx, cy, r: rPx };
  }
}

console.log(
  `${id}: x=${((best.cx / W) * 100).toFixed(2)}%  y=${((best.cy / H) * 100).toFixed(2)}%  ` +
  `轮胎直径=${(((best.r * 2) / W) * 100).toFixed(2)}%  (得分 ${best.s.toFixed(2)})`,
);
