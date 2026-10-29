#!/usr/bin/env node
/**
 * 赛车入库流水线
 *
 * 用法：
 *   npm run import                       # 扫描 assets/incoming/ 下所有图片，逐张入库
 *   npm run import -- --wheels           # 额外检测车轮候选（会打印坐标，供确认）
 *
 * 单张处理：
 *   node scripts/import-car.mjs \
 *     --file assets/incoming/mclaren.png \
 *     --id mclaren-f1 --brand mclaren --sound engine-f1 \
 *     --wheels "22.29,71.47,86.29,72.39,12.24"
 *
 * 处理步骤（顺序很重要）：
 *   1. 自动裁到车身包围盒
 *   2. 白底泛洪抠图（只删与边界连通的白区，车身内部浅色不受影响）
 *   3. 反预乘去白边（C' = (C-(1-a)·255)/a）
 *   4. 边缘蚀刻（接触透明的像素 alpha 减半，收缩 1px）
 *   5. 底部反光压制（下半区 luma>190 的影棚反光淡出）
 *   6. 距离场轮廓压暗（3px 内的车身边缘压暗，消除亮边）
 *   7. 底部渐隐（最后 18% 高度平方曲线收尾，去掉地面倒影）
 *   8. 输出 webp + 可选车轮圆片，并写入 manifest
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const FF = process.env.FFMPEG || 'ffmpeg';
const ROOT = process.cwd();
const ASSETS = join(ROOT, 'assets');
const CARS_DIR = join(ASSETS, 'cars');
const INCOMING = join(ASSETS, 'incoming');
const MANIFEST = join(ASSETS, 'manifest.json');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const TARGET_WIDTH = Number(arg('width', 660));
const WEBP_QUALITY = Number(arg('quality', 92));

/* ---------------- 图像基础操作 ---------------- */
function probeSize(file) {
  const r = spawn(FF, ['-hide_banner', '-i', file]);
  const text = (r.stderr || '') + (r.stdout || '');
  const m = text.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/);
  if (!m) throw new Error(`读不到尺寸：${file}`);
  return [Number(m[1]), Number(m[2])];
}

function spawn(cmd, args) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 29 });
    return { code: 0, stdout: out.toString('binary'), stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString('binary') || '', stderr: e.stderr?.toString('binary') || '' };
  }
}

function toRGBA(file, w, h) {
  return execFileSync(
    FF,
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=${w}:${h}:flags=lanczos`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 1 << 29 },
  );
}

function fromRGBA(buf, w, h, dest) {
  execFileSync(
    FF,
    ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-', dest, '-y'],
    { input: buf, stdio: ['pipe', 'ignore', 'pipe'] },
  );
}

function toWebP(src, dest, width, quality) {
  execFileSync(
    FF,
    ['-hide_banner', '-loglevel', 'error', '-i', src, '-vf', `scale=${width}:-1:flags=lanczos`, '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(quality), dest, '-y'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

/* ---------------- 流水线各步 ---------------- */
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const minChannel = (r, g, b) => Math.min(r, Math.min(g, b));

function trimBounds(buf, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (buf[o + 3] > 8 && minChannel(buf[o], buf[o + 1], buf[o + 2]) < 244) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('整张图都是空白/纯白，无法裁出车身');
  const pad = 2;
  const left = Math.max(0, x0 - pad);
  const top = Math.max(0, y0 - pad);
  return {
    x: left,
    y: top,
    w: Math.min(w - 1, x1 + pad) - left + 1,
    h: Math.min(h - 1, y1 + pad) - top + 1,
  };
}

function keyWhite(buf, w, h, threshold = 240) {
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const mn = (i) => minChannel(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]);
  const push = (i) => { if (!bg[i]) { bg[i] = 1; queue[tail++] = i; } };

  for (let x = 0; x < w; x++) {
    if (mn(x) >= threshold) push(x);
    const b = (h - 1) * w + x;
    if (mn(b) >= threshold) push(b);
  }
  for (let y = 0; y < h; y++) {
    if (mn(y * w) >= threshold) push(y * w);
    const r = y * w + w - 1;
    if (mn(r) >= threshold) push(r);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    const nb = [x + 1 < w ? i + 1 : -1, x > 0 ? i - 1 : -1, y + 1 < h ? i + w : -1, y > 0 ? i - w : -1];
    for (const j of nb) {
      if (j < 0 || bg[j]) continue;
      if (mn(j) < threshold - 8) continue;
      bg[j] = 1;
      queue[tail++] = j;
    }
  }
  let removed = 0;
  for (let i = 0; i < w * h; i++) {
    if (bg[i]) {
      buf[i * 4 + 3] = 0;
      removed++;
      continue;
    }
    const m = mn(i);
    /* 贴近背景的浅色像素给半透明 */
    if (m > 218) buf[i * 4 + 3] = Math.max(0, 255 - (m - 218) * 10);
  }
  return removed;
}

function defringe(buf, w, h) {
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = buf[o + 3];
    if (a === 0 || a === 255) continue;
    const f = a / 255;
    for (let c = 0; c < 3; c++) {
      buf[o + c] = Math.max(0, Math.min(255, Math.round((buf[o + c] - (1 - f) * 255) / f)));
    }
  }
}

function erode(buf, w, h, passes = 2, factor = 0.4) {
  for (let p = 0; p < passes; p++) {
    const snap = Buffer.from(buf);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const a = snap[o + 3];
        if (!a) continue;
        const edge =
          (x > 0 && snap[(y * w + x - 1) * 4 + 3] === 0) ||
          (x < w - 1 && snap[(y * w + x + 1) * 4 + 3] === 0) ||
          (y > 0 && snap[((y - 1) * w + x) * 4 + 3] === 0) ||
          (y < h - 1 && snap[((y + 1) * w + x) * 4 + 3] === 0);
        if (edge) buf[o + 3] = Math.round(a * factor);
      }
    }
  }
}

function suppressReflection(buf, w, h, fromRatio = 0.6, lumaThreshold = 190, keep = 0.12) {
  const y0 = Math.floor(h * fromRatio);
  let n = 0;
  for (let y = y0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (!buf[o + 3]) continue;
      if (luma(buf[o], buf[o + 1], buf[o + 2]) > lumaThreshold) {
        buf[o + 3] = Math.round(buf[o + 3] * keep);
        n++;
      }
    }
  }
  return n;
}

function darkenRim(buf, w, h, depth = 3, scale = 0.35) {
  const dist = new Int32Array(w * h).fill(1e9);
  const queue = [];
  for (let i = 0; i < w * h; i++) {
    if (buf[i * 4 + 3] === 0) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    const nb = [x + 1 < w ? i + 1 : -1, x > 0 ? i - 1 : -1, y + 1 < h ? i + w : -1, y > 0 ? i - w : -1];
    for (const j of nb) {
      if (j < 0) continue;
      if (dist[j] > dist[i] + 1) {
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (buf[o + 3] === 0 || dist[i] > depth) continue;
    const f = scale + (1 - scale) * (dist[i] / depth);
    buf[o] = Math.round(buf[o] * f);
    buf[o + 1] = Math.round(buf[o + 1] * f);
    buf[o + 2] = Math.round(buf[o + 2] * f);
    n++;
  }
  return n;
}

function fadeBottom(buf, w, h, fromRatio = 0.82) {
  const y0 = Math.floor(h * fromRatio);
  for (let y = y0; y < h; y++) {
    const f = (h - y) / (h - y0);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      buf[o + 3] = Math.round(buf[o + 3] * f * f);
    }
  }
}

/* ---------------- 车轮候选（--wheels 时打印） ---------------- */
function detectWheels(buf, w, h) {
  const y0 = Math.floor(h * 0.45);
  const dark = new Uint8Array(w * h);
  for (let y = y0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (buf[o + 3] < 180) continue;
      if (luma(buf[o], buf[o + 1], buf[o + 2]) < 85) dark[y * w + x] = 1;
    }
  }
  const seen = new Uint8Array(w * h);
  const found = [];
  const stack = [];
  for (let y = y0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!dark[start] || seen[start]) continue;
      let area = 0, minX = x, maxX = x, minY = y, maxY = y, sumX = 0, sumY = 0;
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop();
        const cx = i % w;
        const cy = (i - cx) / w;
        area++;
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        const nb = [cx + 1 < w ? i + 1 : -1, cx > 0 ? i - 1 : -1, cy + 1 < h ? i + w : -1, cy > 0 ? i - w : -1];
        for (const j of nb) {
          if (j < 0 || seen[j] || !dark[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const ar = bw / bh;
      if (area > w * h * 0.003 && ar > 0.5 && ar < 2 && bw > w * 0.05) {
        found.push({
          x: +((sumX / area / w) * 100).toFixed(2),
          y: +((sumY / area / h) * 100).toFixed(2),
          d: +(((Math.max(bw, bh) / w) * 100)).toFixed(2),
          area,
        });
      }
    }
  }
  found.sort((a, b) => b.area - a.area);
  return found.slice(0, 4).sort((a, b) => a.x - b.x);
}

/* ---------------- 单张处理 ---------------- */
function processCar(file, opts = {}) {
  const id = opts.id || basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  mkdirSync(join(ROOT, '.import-tmp'), { recursive: true });
  const tmp = join(ROOT, '.import-tmp', `${id}.png`);

  const [W, H] = probeSize(file);
  const scaleW = Math.min(W, 1000);
  const scaleH = Math.round((H * scaleW) / W);
  const rgba = toRGBA(file, scaleW, scaleH);

  const box = trimBounds(rgba, scaleW, scaleH);
  const crop = Buffer.alloc(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    rgba.copy(crop, y * box.w * 4, ((box.y + y) * scaleW + box.x) * 4, ((box.y + y) * scaleW + box.x + box.w) * 4);
  }

  const removed = keyWhite(crop, box.w, box.h);
  defringe(crop, box.w, box.h);
  erode(crop, box.w, box.h, 2, 0.4);
  const refl = suppressReflection(crop, box.w, box.h);
  const rim = darkenRim(crop, box.w, box.h);
  fadeBottom(crop, box.w, box.h, opts.wheels ? 0.94 : 0.82);

  fromRGBA(crop, box.w, box.h, tmp);
  const outWebp = join(CARS_DIR, `${id}.webp`);
  toWebP(tmp, outWebp, Math.min(TARGET_WIDTH, box.w), WEBP_QUALITY);

  const wheels = [];
  if (opts.wheels) {
    const nums = opts.wheels.split(',').map(Number);
    /* "x1,y1,x2,y2,d" —— 中心百分比 + 直径（占车宽百分比） */
    const [x1, y1, x2, y2, dPct] = nums;
    const rPct = dPct / 2;
    for (const [idx, [cx, cy]] of [[0, [x1, y1]], [1, [x2, y2]]].map((v, i) => [i, [nums[i * 2], nums[i * 2 + 1]]])) {
      const r = Math.round((rPct / 100) * box.w);
      const px = Math.round((cx / 100) * box.w);
      const py = Math.round((cy / 100) * box.h);
      const dpx = r * 2;
      const sprite = Buffer.alloc(dpx * dpx * 4);
      for (let y = 0; y < dpx; y++) {
        for (let x = 0; x < dpx; x++) {
          const inside = (x - r) * (x - r) + (y - r) * (y - r) <= (r - 1) * (r - 1);
          if (!inside) continue;
          const sx = px - r + x;
          const sy = py - r + y;
          if (sx < 0 || sy < 0 || sx >= box.w || sy >= box.h) continue;
          const so = (sy * box.w + sx) * 4;
          const o = (y * dpx + x) * 4;
          sprite[o] = crop[so];
          sprite[o + 1] = crop[so + 1];
          sprite[o + 2] = crop[so + 2];
          sprite[o + 3] = crop[so + 3];
        }
      }
      const wtmp = join(ROOT, '.import-tmp', `${id}-wheel${idx}.png`);
      const wout = join(CARS_DIR, `${id}-wheel${idx}.webp`);
      fromRGBA(sprite, dpx, dpx, wtmp);
      toWebP(wtmp, wout, 84, 92);
      wheels.push({ file: `cars/${id}-wheel${idx}.webp`, x: cx, y: cy, d: dPct, speed: 0.15 });
    }
  }

  const candidates = flag('wheels') || opts.showWheels ? detectWheels(crop, box.w, box.h) : [];

  return {
    id,
    webp: outWebp,
    box,
    removed,
    refl,
    rim,
    wheels,
    candidates,
  };
}

/* ---------------- manifest 更新 ---------------- */
function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

function saveManifest(m) {
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

function upsertCar(manifest, car) {
  const idx = manifest.cars.findIndex((c) => c.id === car.id);
  const merged = { ...(idx >= 0 ? manifest.cars[idx] : {}), ...car };
  if (idx >= 0) manifest.cars[idx] = merged;
  else manifest.cars.push(merged);
}

/* ---------------- 主流程 ---------------- */
function main() {
  const single = arg('file');
  const jobs = [];

  if (single) {
    if (!existsSync(single)) throw new Error(`文件不存在：${single}`);
    jobs.push({
      file: single,
      id: arg('id'),
      brand: arg('brand', 'mclaren'),
      sound: arg('sound', 'engine-f1'),
      name: arg('name'),
      wheels: arg('wheels'),
    });
  } else {
    if (!existsSync(INCOMING)) {
      console.log(`把图片放进 ${INCOMING} 再运行；或用 --file 指定单张。`);
      return;
    }
    for (const name of readdirSync(INCOMING)) {
      if (!IMAGE_EXT.has(extname(name).toLowerCase())) continue;
      jobs.push({ file: join(INCOMING, name), brand: arg('brand', 'mclaren'), sound: arg('sound', 'engine-f1') });
    }
    if (!jobs.length) {
      console.log(`${INCOMING} 里没有图片。`);
      return;
    }
  }

  const manifest = loadManifest();
  mkdirSync(CARS_DIR, { recursive: true });

  for (const job of jobs) {
    const res = processCar(job.file, { id: job.id, wheels: job.wheels, showWheels: flag('wheels') });
    const entry = {
      id: res.id,
      name: job.name || arg('name', res.id.replace(/-/g, ' ').toUpperCase()),
      kind: 'alpha',
      file: `cars/${res.id}.webp`,
      sound: job.sound,
      engine: { revScale: 1, roar: 1 },
      brand: job.brand,
    };
    if (res.wheels.length) entry.wheels = res.wheels;
    upsertCar(manifest, entry);

    console.log(`\n✓ ${res.id}`);
    console.log(`  车身   ${res.box.w}×${res.box.h} → assets/cars/${res.id}.webp`);
    console.log(`  抠除   ${res.removed} 像素背景 · 反光压制 ${res.refl} · 轮廓压暗 ${res.rim}`);
    if (res.wheels.length) console.log(`  车轮   ${res.wheels.map((w) => `${w.x}%,${w.y}%`).join(' / ')}`);
    if (res.candidates.length) {
      console.log('  车轮候选（x%, y%, d%）：');
      for (const c of res.candidates) console.log(`    ${c.x}, ${c.y}, d=${c.d}`);
    }
  }

  saveManifest(manifest);
  console.log(`\nmanifest 已更新，共 ${manifest.cars.length} 辆车。`);
  console.log('下一步：npm run build && 重启 App 查看效果。');
}

main();
