/**
 * 封闭区域内的棋盘格清理（用于三叉星这类"框内有洞"的标志）
 *   node logo-key2.mjs <in.jpg> <out.webp> <targetHeight>
 *
 * 思路：
 *   1. 先从四边泛洪删掉外部背景
 *   2. 再取棋盘格的两种色调（从剩余图片的角落统计出两个主色）
 *   3. 从「环内、避开星臂」的几个种子点出发，只沿这两种色调扩散
 */
import { execFileSync, spawnSync } from 'node:child_process';

const FF = 'C:/Users/22491/.dsh/tools/ffmpeg/bin/ffmpeg.exe';
const [, , inFile, outFile, heightArg] = process.argv;
const targetH = Number(heightArg || 128);

function sizeOf(file) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = ((r.stderr || '') + (r.stdout || '')).match(/Video:.*?(\d+)x(\d+)/);
  return [Number(m[1]), Number(m[2])];
}

function toRGBA(file, w, h) {
  return execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=lanczos`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 29 });
}

const [W0, H0] = sizeOf(inFile);
const scale = Math.min(1, 900 / Math.max(W0, H0));
const W = Math.round(W0 * scale);
const H = Math.round(H0 * scale);
const buf = toRGBA(inFile, W, H);

const px = (x, y) => {
  const o = (y * W + x) * 4;
  return [buf[o], buf[o + 1], buf[o + 2]];
};
const lumaOf = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const satOf = (c) => Math.max(...c) - Math.min(...c);

/* ---------- 1. 外部泛洪 ---------- */
const bg = new Uint8Array(W * H);
const queue = [];
const isOuterBg = (x, y) => {
  const c = px(x, y);
  return lumaOf(c) >= 190 && satOf(c) <= 18;
};
const pushIf = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = y * W + x;
  if (bg[i] || !isOuterBg(x, y)) return;
  bg[i] = 1;
  queue.push(i);
};
for (let x = 0; x < W; x++) { pushIf(x, 0); pushIf(x, H - 1); }
for (let y = 0; y < H; y++) { pushIf(0, y); pushIf(W - 1, y); }
for (let head = 0; head < queue.length; head++) {
  const i = queue[head];
  const x = i % W;
  const y = (i - x) / W;
  pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
}

/* ---------- 2. 统计棋盘格两色（取图片中心的浅色像素） ---------- */
const counts = new Map();
for (let y = Math.floor(H * 0.2); y < H * 0.8; y += 2) {
  for (let x = Math.floor(W * 0.2); x < W * 0.8; x += 2) {
    const i = y * W + x;
    if (bg[i]) continue;
    const c = px(x, y);
    if (lumaOf(c) < 200 || satOf(c) > 10) continue;
    const key = `${c[0] >> 3},${c[1] >> 3},${c[2] >> 3}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
}
const tones = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 2)
  .map(([k]) => k.split(',').map((v) => Number(v) * 8 + 4));

const nearTone = (c) => tones.some((t) => Math.abs(c[0] - t[0]) <= 12 && Math.abs(c[1] - t[1]) <= 12 && Math.abs(c[2] - t[2]) <= 12);

/* ---------- 3. 内部种子扩散 ---------- */
const inner = [];
const cx = W / 2;
const cy = H / 2;
const R = Math.min(W, H) / 2;
for (const deg of [30, 150, 270, 60, 120, 210, 330]) {
  const a = (deg * Math.PI) / 180;
  for (const rr of [0.55, 0.7, 0.82]) {
    const x = Math.round(cx + Math.cos(a) * R * rr);
    const y = Math.round(cy + Math.sin(a) * R * rr);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = y * W + x;
    if (bg[i]) continue;
    const c = px(x, y);
    if (!nearTone(c)) continue;
    bg[i] = 1;
    inner.push(i);
  }
}
for (let head = 0; head < inner.length; head++) {
  const i = inner[head];
  const x = i % W;
  const y = (i - x) / W;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = ny * W + nx;
    if (bg[j]) continue;
    if (!nearTone(px(nx, ny))) continue;
    bg[j] = 1;
    inner.push(j);
  }
}

/* ---------- 4. 应用 ---------- */
let removedOuter = 0, removedInner = 0;
for (let i = 0; i < W * H; i++) {
  if (!bg[i]) continue;
  buf[i * 4 + 3] = 0;
  if (inner.includes(i)) removedInner++;
  else removedOuter++;
}

/* ---------- 5. 收紧 + 输出 ---------- */
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (buf[(y * W + x) * 4 + 3] < 20) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
const tw = maxX - minX + 1;
const th = maxY - minY + 1;
const tight = Buffer.alloc(tw * th * 4);
for (let y = 0; y < th; y++) {
  buf.copy(tight, y * tw * 4, ((minY + y) * W + minX) * 4, ((minY + y) * W + minX + tw) * 4);
}

const tmp = outFile.replace(/\.webp$/, '') + '-tmp.png';
execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${tw}x${th}`, '-i', '-', tmp, '-y'], { input: tight, stdio: ['pipe', 'ignore', 'pipe'] });
execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', tmp, '-vf', `scale=-1:${targetH}:flags=lanczos`, '-c:v', 'libwebp', '-lossless', '0', '-q:v', '92', outFile, '-y'], { stdio: ['ignore', 'ignore', 'pipe'] });

console.log(`${outFile.split(/[\\/]/).pop()}: 外部 ${removedOuter} · 内部 ${removedInner} · ${tw}×${th} → 高${targetH}`);
