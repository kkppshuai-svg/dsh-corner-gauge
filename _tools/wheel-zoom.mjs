/**
 * 车轮放大校准：围绕当前中心裁一块，放大 4 倍，叠加像素网格与当前圆
 *   node wheel-zoom.mjs <id>
 * 输出 _f1grid/zoom/<id>-wheel<idx>.png（每格 10 精灵像素）
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const FF = 'C:/Users/22491/.dsh/tools/ffmpeg/bin/ffmpeg.exe';
const ROOT = 'C:/Users/22491/Desktop/建模/dsh-corner-gauge/';
const OUT = 'C:/Users/22491/.dsh/gauge-plugin/_f1grid/zoom';
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
  if (!car || !car.wheels) { console.log('无车轮: ' + id); continue; }
  const img = rgba(ROOT + 'assets/' + car.file);
  const W = img.w, H = img.h;

  car.wheels.forEach((w, idx) => {
    const cx = Math.round((w.x / 100) * W);
    const cy = Math.round((w.y / 100) * H);
    const r = Math.round(((w.d / 100) * W) / 2);
    const half = Math.max(30, r + 14);
    const scale = 4;
    const size = half * 2 * scale;

    const out = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = cx - half + Math.floor(x / scale);
        const sy = cy - half + Math.floor(y / scale);
        const o = (y * size + x) * 4;
        let r0 = 13, g0 = 14, b0 = 18;
        if (sx >= 0 && sy >= 0 && sx < W && sy < H) {
          const so = (sy * W + sx) * 4;
          const a = img.buf[so + 3] / 255;
          r0 = Math.round(img.buf[so] * a + 13 * (1 - a));
          g0 = Math.round(img.buf[so + 1] * a + 14 * (1 - a));
          b0 = Math.round(img.buf[so + 2] * a + 18 * (1 - a));
        }
        out[o] = r0; out[o + 1] = g0; out[o + 2] = b0; out[o + 3] = 255;
      }
    }

    const plot = (px, py, r2, g2, b2) => {
      if (px < 0 || py < 0 || px >= size || py >= size) return;
      const o = (py * size + px) * 4;
      out[o] = r2; out[o + 1] = g2; out[o + 2] = b2;
    };

    /* 每 10 精灵像素一条网格线（= 40 输出像素） */
    for (let gx = 0; gx < size; gx += 10 * scale) {
      for (let y = 0; y < size; y++) plot(gx, y, 70, 120, 90);
    }
    for (let gy = 0; gy < size; gy += 10 * scale) {
      for (let x = 0; x < size; x++) plot(x, gy, 70, 120, 90);
    }

    /* 当前圆（绿色）+ 中心十字（红） */
    const rc = r * scale;
    const ccx = half * scale;
    const ccy = half * scale;
    for (let a = 0; a < 360; a += 0.8) {
      const rad = (a * Math.PI) / 180;
      for (const rr of [rc, rc - 1]) {
        plot(Math.round(ccx + rr * Math.cos(rad)), Math.round(ccy + rr * Math.sin(rad)), 0, 255, 90);
      }
    }
    for (let d2 = -12; d2 <= 12; d2++) {
      plot(ccx + d2, ccy, 255, 60, 60);
      plot(ccx, ccy + d2, 255, 60, 60);
    }

    const png = `${OUT}/${id}-wheel${idx}.png`;
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${size}x${size}`, '-i', '-', png, '-y'], { input: out, stdio: ['pipe', 'ignore', 'pipe'] });
    console.log(`${id} wheel${idx}: 中心(${cx},${cy}) r=${r} → ${png}（网格 10px）`);
  });
}
