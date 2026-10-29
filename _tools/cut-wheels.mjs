/**
 * 按标定坐标切车轮圆片
 *   node cut-wheels.mjs <id> "<fX,fY,rX,rY,tireD>" [<id> "<...>" ...]
 * 只切内圈轮辋（轮胎直径的 85%），外圈轮胎留在车身图上不动。
 * 输出 assets/cars/<id>-wheel0.webp / -wheel1.webp，并打印 manifest 需要的百分比。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const FF = 'C:/Users/22491/.dsh/tools/ffmpeg/bin/ffmpeg.exe';
const CARS = 'C:/Users/22491/Desktop/建模/dsh-corner-gauge/assets/cars/';
const TMP = 'C:/Users/22491/.dsh/gauge-plugin/_f1grid/wheels';
mkdirSync(TMP, { recursive: true });

const RIM_RATIO = 0.85;

function sizeOf(file) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = ((r.stderr || '') + (r.stdout || '')).match(/Video:.*?(\d+)x(\d+)/);
  return [Number(m[1]), Number(m[2])];
}

function rgba(file, w, h) {
  return execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 29 });
}

const args = process.argv.slice(2);
const out = [];

for (let i = 0; i < args.length; i += 2) {
  const id = args[i];
  const [fX, fY, rX, rY, tireD] = args[i + 1].split(',').map(Number);

  const file = CARS + id + '.webp';
  const [W, H] = sizeOf(file);
  const buf = rgba(file, W, H);

  /* 轮胎半径（像素）与轮辋半径 */
  const tireR = ((tireD / 100) * W) / 2;
  const rimR = Math.round(tireR * RIM_RATIO);
  const d = rimR * 2;

  const wheels = [
    { cx: Math.round((fX / 100) * W), cy: Math.round((fY / 100) * H) },
    { cx: Math.round((rX / 100) * W), cy: Math.round((rY / 100) * H) },
  ];

  const entries = [];
  wheels.forEach((w, idx) => {
    const sprite = Buffer.alloc(d * d * 4);
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < d; x++) {
        const dx = x - rimR + 0.5;
        const dy = y - rimR + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > rimR - 1) continue;
        const sx = w.cx - rimR + x;
        const sy = w.cy - rimR + y;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const so = (sy * W + sx) * 4;
        const o = (y * d + x) * 4;
        sprite[o] = buf[so];
        sprite[o + 1] = buf[so + 1];
        sprite[o + 2] = buf[so + 2];
        sprite[o + 3] = Math.round(buf[so + 3] * Math.min(1, (rimR - dist) * 2));
      }
    }
    const png = `${TMP}/${id}-wheel${idx}.png`;
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${d}x${d}`, '-i', '-', png, '-y'], { input: sprite, stdio: ['pipe', 'ignore', 'pipe'] });
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', png, '-vf', 'scale=88:-1:flags=lanczos', '-c:v', 'libwebp', '-lossless', '0', '-q:v', '94', `${CARS}${id}-wheel${idx}.webp`, '-y'], { stdio: ['ignore', 'ignore', 'pipe'] });

    entries.push({
      file: `cars/${id}-wheel${idx}.webp`,
      x: +((w.cx / W) * 100).toFixed(2),
      y: +((w.cy / H) * 100).toFixed(2),
      d: +(((d / W) * 100)).toFixed(2),
      speed: 0.16,
    });
  });

  out.push({ id, W, H, rimR, d, entries });
  console.log(`${id} (${W}x${H}) 轮辋 r=${rimR}px  d%=${entries[0].d}`);
  for (const e of entries) console.log(`   ${e.file}  x=${e.x}% y=${e.y}% d=${e.d}%`);
}

writeFileSync(`${TMP}/result.json`, JSON.stringify(out, null, 2));
