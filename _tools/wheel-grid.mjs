/**
 * 车轮标定辅助：在车图上叠加百分比网格
 *   node wheel-grid.mjs <id> [<id> ...]
 * 输出 _tools/out/<id>-grid.png（每 10% 一条线，并标出 20% 粗线）
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const FF = 'C:/Users/22491/.dsh/tools/ffmpeg/bin/ffmpeg.exe';
const CARS = 'C:/Users/22491/Desktop/建模/dsh-corner-gauge/assets/cars/';
const OUT = 'C:/Users/22491/.dsh/gauge-plugin/_f1grid/grid';
mkdirSync(OUT, { recursive: true });

function sizeOf(file) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = ((r.stderr || '') + (r.stdout || '')).match(/Video:.*?(\d+)x(\d+)/);
  return [Number(m[1]), Number(m[2])];
}

function rgba(file, w, h) {
  return execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 29 });
}

for (const id of process.argv.slice(2)) {
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

  const plot = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    bg[o] = r; bg[o + 1] = g; bg[o + 2] = b;
  };

  /* 竖线：每 10%，每 50% 加粗 */
  for (let p = 10; p < 100; p += 10) {
    const x = Math.round((p / 100) * W);
    const major = p % 50 === 0;
    for (let y = 0; y < H; y++) {
      plot(x, y, major ? 255 : 90, major ? 210 : 170, major ? 60 : 90);
      if (major) plot(x + 1, y, 255, 210, 60);
    }
  }
  /* 横线 */
  for (let p = 10; p < 100; p += 10) {
    const y = Math.round((p / 100) * H);
    const major = p % 50 === 0;
    for (let x = 0; x < W; x++) {
      plot(x, y, major ? 255 : 90, major ? 210 : 170, major ? 60 : 90);
      if (major) plot(x, y + 1, 255, 210, 60);
    }
  }

  const dest = `${OUT}/${id}-grid.png`;
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', dest, '-y'], { input: bg, stdio: ['pipe', 'ignore', 'pipe'] });
  console.log(`${id}: ${W}x${H} → ${dest}（黄线=50%，灰线=10%）`);
}
