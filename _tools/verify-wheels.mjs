/**
 * 离线校验车轮位置：按 manifest 的百分比把轮辋贴到车身上
 *   node verify-wheels.mjs <id> [<id> ...]
 * 输出 _f1grid/wheels/<id>-check.png（与浏览器渲染公式一致）
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const FF = 'C:/Users/22491/.dsh/tools/ffmpeg/bin/ffmpeg.exe';
const ROOT = 'C:/Users/22491/Desktop/建模/dsh-corner-gauge/';
const CARS = ROOT + 'assets/cars/';
const OUT = 'C:/Users/22491/.dsh/gauge-plugin/_f1grid/check';
mkdirSync(OUT, { recursive: true });

const MANIFEST = JSON.parse(readFileSync(ROOT + 'assets/manifest.json', 'utf8'));

function sizeOf(file) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = ((r.stderr || '') + (r.stdout || '')).match(/Video:.*?(\d+)x(\d+)/);
  return [Number(m[1]), Number(m[2])];
}

function rgba(file) {
  const [w, h] = sizeOf(file);
  return { w, h, buf: execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 29 }) };
}

for (const id of process.argv.slice(2)) {
  const car = MANIFEST.cars.find((c) => c.id === id);
  if (!car) { console.log('未找到 ' + id); continue; }

  const carImg = rgba(CARS + car.file.replace('cars/', ''));
  const W = carImg.w;
  const H = carImg.h;
  const dst = Buffer.from(carImg.buf);

  for (const w of car.wheels || []) {
    const wheelImg = rgba(CARS + w.file.replace('cars/', ''));
    const tw = Math.round((w.d / 100) * W);          /* 浏览器：width = d% × wrap 宽度 */
    const th = tw;                                    /* 精灵是正方形 */
    const cx = (w.x / 100) * W;
    const cy = (w.y / 100) * H;

    /* 画标记圈：半径 = 轮辋直径/2 */
    const r = tw / 2;
    for (let a = 0; a < 360; a += 1.5) {
      const rad = (a * Math.PI) / 180;
      for (const rr of [r, r - 1]) {
        const px = Math.round(cx + rr * Math.cos(rad));
        const py = Math.round(cy + rr * Math.sin(rad));
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const o = (py * W + px) * 4;
        dst[o] = 0; dst[o + 1] = 255; dst[o + 2] = 90; dst[o + 3] = 255;
      }
    }
    for (let d2 = -6; d2 <= 6; d2++) {
      for (const [px, py] of [[Math.round(cx) + d2, Math.round(cy)], [Math.round(cx), Math.round(cy) + d2]]) {
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const o = (py * W + px) * 4;
        dst[o] = 255; dst[o + 1] = 60; dst[o + 2] = 60; dst[o + 3] = 255;
      }
    }
  }

  /* 合成到深底 */
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const a = dst[o + 3] / 255;
    out[o] = Math.round(dst[o] * a + 13 * (1 - a));
    out[o + 1] = Math.round(dst[o + 1] * a + 14 * (1 - a));
    out[o + 2] = Math.round(dst[o + 2] * a + 18 * (1 - a));
    out[o + 3] = 255;
  }

  const dest = `${OUT}/${id}-check.png`;
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', dest, '-y'], { input: out, stdio: ['pipe', 'ignore', 'pipe'] });
  console.log(`${id}: ${W}x${H} → ${dest}`);
}
