/**
 * 车轮测量：对每辆车输出候选圆（轮胎黑块）
 *   node measure-wheels.mjs <id> [<id> ...]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FF = 'C:/Users/22491/.dsh/tools/ffmpeg/bin/ffmpeg.exe';
const CARS = 'C:/Users/22491/Desktop/建模/dsh-corner-gauge/assets/cars/';

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

  const y0 = Math.floor(H * 0.35);
  const dark = new Uint8Array(W * H);
  for (let y = y0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (buf[o + 3] < 200) continue;
      const luma = 0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2];
      if (luma < 60) dark[y * W + x] = 1;
    }
  }

  const seen = new Uint8Array(W * H);
  const blobs = [];
  const stack = [];
  for (let y = y0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = y * W + x;
      if (!dark[s] || seen[s]) continue;
      let area = 0, minX = x, maxX = x, minY = y, maxY = y, sx = 0, sy = 0;
      stack.length = 0; stack.push(s); seen[s] = 1;
      while (stack.length) {
        const i = stack.pop();
        const cx = i % W, cy = (i - cx) / W;
        area++; sx += cx; sy += cy;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        const nb = [cx + 1 < W ? i + 1 : -1, cx > 0 ? i - 1 : -1, cy + 1 < H ? i + W : -1, cy > 0 ? i - W : -1];
        for (const j of nb) { if (j < 0 || seen[j] || !dark[j]) continue; seen[j] = 1; stack.push(j); }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (area < W * H * 0.002) continue;
      blobs.push({
        cx: +(sx / area).toFixed(1), cy: +(sy / area).toFixed(1),
        bw, bh, area,
        xPct: +((sx / area / W) * 100).toFixed(2),
        yPct: +((sy / area / H) * 100).toFixed(2),
        dPct: +(((Math.max(bw, bh)) / W) * 100).toFixed(2),
      });
    }
  }
  blobs.sort((a, b) => b.area - a.area);
  console.log(`\n${id}  ${W}x${H}`);
  for (const b of blobs.slice(0, 6)) {
    console.log(`  中心 (${b.cx}, ${b.cy}) = ${b.xPct}%, ${b.yPct}%   尺寸 ${b.bw}x${b.bh} → d=${b.dPct}%   面积 ${b.area}`);
  }
}
