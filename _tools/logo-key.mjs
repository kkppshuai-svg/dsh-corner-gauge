/**
 * 徽标抠图：去掉透明棋盘格 / 白底
 *   node logo-key.mjs <in.jpg> <out.webp> [targetHeight]
 *
 * 棋盘格是浅灰与白交替的方格，两者都是「高明度 + 低饱和」，
 * 且与画面边界连通；从四边泛洪即可整体删除，标志内部的白色高光被深色轮廓包住，不会误删。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const FF = 'C:/Users/22491/.dsh/tools/ffmpeg/bin/ffmpeg.exe';
const [, , inFile, outFile, heightArg] = process.argv;
const targetH = Number(heightArg || 96);

function sizeOf(file) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = ((r.stderr || '') + (r.stdout || '')).match(/Video:.*?(\d+)x(\d+)/);
  if (!m) throw new Error('读不到尺寸');
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

const luma = (o) => 0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2];
const isBg = (o) => {
  const mx = Math.max(buf[o], buf[o + 1], buf[o + 2]);
  const mn = Math.min(buf[o], buf[o + 1], buf[o + 2]);
  return luma(o) >= 196 && mx - mn <= 16;
};

/* 从四边泛洪 */
const bg = new Uint8Array(W * H);
const queue = new Int32Array(W * H);
let head = 0, tail = 0;
const push = (i) => {
  if (bg[i]) return;
  if (!isBg(i * 4)) return;
  bg[i] = 1;
  queue[tail++] = i;
};
for (let x = 0; x < W; x++) {
  push(x);
  push((H - 1) * W + x);
}
for (let y = 0; y < H; y++) {
  push(y * W);
  push(y * W + W - 1);
}
while (head < tail) {
  const i = queue[head++];
  const x = i % W;
  const y = (i - x) / W;
  const nb = [x + 1 < W ? i + 1 : -1, x > 0 ? i - 1 : -1, y + 1 < H ? i + W : -1, y > 0 ? i - W : -1];
  for (const j of nb) {
    if (j < 0 || bg[j]) continue;
    if (!isBg(j * 4)) continue;
    bg[j] = 1;
    queue[tail++] = j;
  }
}

/* 应用 alpha + 边缘羽化 */
let removed = 0;
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  if (bg[i]) {
    buf[o + 3] = 0;
    removed++;
    continue;
  }
  /* 贴着背景的浅色像素给半透明，消除锯齿硬边 */
  const x = i % W;
  const y = (i - x) / W;
  const nearBg =
    (x + 1 < W && bg[i + 1]) || (x > 0 && bg[i - 1]) ||
    (y + 1 < H && bg[i + W]) || (y > 0 && bg[i - W]);
  if (nearBg && luma(o) > 175) {
    const f = Math.max(0, Math.min(1, (luma(o) - 175) / 60));
    buf[o + 3] = Math.round(buf[o + 3] * (1 - f * 0.9));
  }
}

/* 按 alpha 收紧 */
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

console.log(`${inFile.split(/[\\/]/).pop()} → ${outFile.split(/[\\/]/).pop()}  ${tw}×${th} → 高${targetH}（去背景 ${removed} 像素）`);
