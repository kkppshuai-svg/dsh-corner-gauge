/**
 * 合成 "Du du du du — Max Verstappen" 人浪合唱
 *   node chant.mjs <out.wav>
 *
 * 做法：
 *   - 每个音节 = 爆破辅音（短噪声）+ 元音（锯齿波过三个共振峰带通）
 *   - 叠加 6 个失谐声部模拟人群，再混一层体育馆底噪与混响
 *   - 4 个等长 "du" + 3 个下行音节 "Max / Ver / stap / pen"
 */
import { writeFileSync } from 'node:fs';

const SR = 32000;
const DURATION = 2.6;
const N = Math.floor(SR * DURATION);
const out = new Float32Array(N);

/* ---------- 基础工具 ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 一阶带通（状态变量滤波） */
function makeBP(freq, q = 6) {
  const w = (2 * Math.PI * freq) / SR;
  const f = 2 * Math.sin(w / 2);
  const damp = 1 / q;
  let low = 0, band = 0;
  return (x) => {
    low += f * band;
    const high = x - low - damp * band;
    band += f * high;
    return band;
  };
}

/* ---------- 单个音节的合成 ---------- */
/**
 * @param t0 起始时间（秒）
 * @param dur 时长（秒）
 * @param pitch 基频（Hz）
 * @param gain 音量
 * @param detune 失谐系数（人群声部）
 */
function singSyllable(t0, dur, pitch, gain, detune, seed) {
  const start = Math.floor(t0 * SR);
  const len = Math.floor(dur * SR);

  /* 元音 "u" 的三个共振峰 */
  const b1 = makeBP(320 * detune, 7);
  const b2 = makeBP(780 * detune, 9);
  const b3 = makeBP(2150 * detune, 12);

  let phase = 0;
  let noiseSeed = seed;

  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const u = i / len;

    /* 包络：起音快、尾巴缓 */
    const env = Math.pow(Math.min(1, u * 26), 1.2) * Math.exp(-u * 3.1);

    /* 轻微音高下滑，像人声 */
    const p = pitch * (1 - 0.035 * u);
    phase += (2 * Math.PI * p) / SR;
    const saw = ((phase / (2 * Math.PI)) % 1) * 2 - 1;

    /* 辅音 "d"：开头 25ms 的噪声 */
    noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
    const noise = (noiseSeed / 0x7fffffff) * 2 - 1;
    const consonant = t < 0.028 ? noise * 0.5 * (1 - t / 0.028) : 0;

    const vowel = b1(saw) * 1.0 + b2(saw) * 0.55 + b3(saw) * 0.22;
    out[idx] += (vowel + consonant) * env * gain;
  }
}

/* ---------- 音节序列 ---------- */
/* 四个 "du" 同音，然后 "Max-VER-stap-pen" 下行 */
const base = 196; // G3，人群合唱的舒适音区
const seq = [
  { t: 0.00, d: 0.30, p: base },
  { t: 0.34, d: 0.30, p: base },
  { t: 0.68, d: 0.30, p: base },
  { t: 1.02, d: 0.30, p: base },
  { t: 1.40, d: 0.34, p: base * 1.5 },   // Max
  { t: 1.78, d: 0.34, p: base * 1.335 }, // Ver-
  { t: 2.14, d: 0.40, p: base * 1.19 },  // -stap-
];

/* 6 个声部，模拟一群人 */
const voices = [
  { det: 0.985, gain: 0.20, seed: 11 },
  { det: 1.0, gain: 0.24, seed: 23 },
  { det: 1.012, gain: 0.21, seed: 37 },
  { det: 0.5, gain: 0.13, seed: 41 },   // 低八度
  { det: 1.5, gain: 0.08, seed: 53 },   // 高五度
  { det: 1.005, gain: 0.15, seed: 67 },
];

for (const v of voices) {
  for (const s of seq) singSyllable(s.t, s.d, s.p, v.gain, v.det, v.seed);
}

/* ---------- 体育馆底噪 ---------- */
let seed = 99;
let lp = 0;
for (let i = 0; i < N; i++) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  const n = (seed / 0x7fffffff) * 2 - 1;
  lp += (n - lp) * 0.025;
  const u = i / N;
  const swell = 0.02 + 0.05 * Math.sin(Math.PI * u);
  out[i] += lp * swell;
}

/* ---------- 简易混响（几个延迟抽头） ---------- */
const taps = [0.031, 0.047, 0.071, 0.093];
const rev = new Float32Array(N);
for (let i = 0; i < N; i++) {
  let acc = 0;
  for (const d of taps) {
    const j = i - Math.floor(d * SR);
    if (j >= 0) acc += out[j] * 0.32;
  }
  rev[i] = acc;
}
for (let i = 0; i < N; i++) out[i] = out[i] * 0.82 + rev[i] * 0.35;

/* ---------- 归一化 + 首尾淡变 ---------- */
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
const norm = 0.86 / (peak || 1);
for (let i = 0; i < N; i++) {
  let g = norm;
  const fadeIn = 0.012 * SR;
  const fadeOut = 0.35 * SR;
  if (i < fadeIn) g *= i / fadeIn;
  if (i > N - fadeOut) g *= (N - i) / fadeOut;
  out[i] *= g;
}

/* ---------- 写 16bit WAV ---------- */
const bytes = N * 2;
const buf = Buffer.alloc(44 + bytes);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + bytes, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(bytes, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(clamp(Math.round(out[i] * 32767), -32768, 32767), 44 + i * 2);
}

writeFileSync(process.argv[2], buf);
console.log(`✓ 合成完成：${DURATION}s → ${process.argv[2]}`);
