/**
 * 在车图上画车轮候选圈，用于人工校准
 *   node overlay.mjs <id>:<x1>,<y1>,<x2>,<y2>,<d> ...
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const FF = 'C:/Users/22491/.dsh/tools/ffmpeg/bin/ffmpeg.exe';
const CARS = 'C:/Users/22491/Desktop/建模/dsh-corner-gauge/assets/cars/';
const OUT = 'C:/Users/22491/.dsh/gauge-plugin/_f1grid/overlay';

function sizeOf(file) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = ((r.stderr || '') + (r.stdout || '')).match(/Video:.*?(\d+)x(\d+)/);
  return [Number(m[1]), Number(m[2])];
}

function rgba(file, w, h) {
  return execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 29 });
}

for (const spec of process.argv.slice(2)) {
  const [id, nums] = spec.split(':');
  const [x1, y1, x2, y2, dPct] = nums.split(',').map(Number);
  const file = CARS + id + '.webp';
  const [W, H] = sizeOf(file);
  const buf = rgba(file, W, H);

  /* 合成到深底 */
  const bg = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const a = buf[o + 3] / 255;
    bg[o] = Math.round(buf[o] * a + 13 * (1 - a));
    bg[o + 1] = Math.round(buf[o + 1] * a + 14 * (1 - a));
    bg[o + 2] = Math.round(buf[o + 2] * a + 18 * (1 - a));
    bg[o + 3] = 255;
  }

  /* 画两个圈 */
  const r = Math.round((dPct / 100) * W / 2);
  for (const [cxPct, cyPct] of [[x1, y1], [x2, y2]]) {
    const cx = Math.round((cxPct / 100) * W);
    const cy = Math.round((cyPct / 100) * H);
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      for (const rr of [r, r - 1]) {
        const x = Math.round(cx + rr * Math.cos(rad));
        const y = Math.round(cy + rr * Math.sin(rad));
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = (y * W + x) * 4;
        bg[o] = 0; bg[o + 1] = 255; bg[o + 2] = 120;
      }
    }
    /* 十字线 */
    for (let dx = -6; dx <= 6; dx++) {
      const x = cx + dx;
      if (x >= 0 && x < W) {
        const o = (Math.round(cy) * W + x) * 4;
        bg[o] = 255; bg[o + 1] = 60; bg[o + 2] = 60;
      }
    }
  }

  const dest = `${OUT}/${id}-ov.png`;
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', dest, '-y'], { input: bg, stdio: ['pipe', 'ignore', 'pipe'] });
  console.log(`${id}: ${W}x${H} → ${dest}`);
}
