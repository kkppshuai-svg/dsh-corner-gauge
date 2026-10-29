/**
 * 彩蛋：点击面板，跑车从右向左开过一次
 * ------------------------------------------------------------------
 * - 跑动期间隐藏面板元素，只留跑车
 * - 车辆来自素材库 BADGE.CARS（assets/manifest.json → 构建时内嵌）
 *   kind: 'cutout' 透明底抠图 / 'plate' 带柔化边缘的场景图
 * - 声浪来自 BADGE.SOUNDS，车辆可在清单里各自指定 sound
 * - 声音可通过面板右上角的喇叭按钮开关，状态写进 localStorage
 *
 * config.drive：
 *   enabled  是否启用彩蛋
 *   sound    默认是否出声
 *   durationMs 跑车时长
 *   fx       是否叠加速度线/拖尾（默认关）
 *   car      指定车辆 id；默认 'auto' = 每次点击换下一辆
 */
BADGE.drive = {};

BADGE.SOUND_KEY = 'dsh-corner-gauge:sound';
BADGE.CAR_KEY = 'dsh-corner-gauge:car';

/** 用户在设置里选中的车；'auto' 表示每次点击轮换 */
BADGE.selectedCar = function selectedCar() {
  try {
    const saved = localStorage.getItem(BADGE.CAR_KEY);
    if (saved) return saved;
  } catch { /* 忽略 */ }
  return BADGE.config.drive.car || 'auto';
};

BADGE.setCar = function setCar(id) {
  try {
    localStorage.setItem(BADGE.CAR_KEY, id);
  } catch { /* 忽略 */ }
  BADGE.config.drive.car = id;
  const car = id === 'auto' ? (BADGE.CARS || [])[0] : BADGE.findCar && BADGE.findCar(id);
  if (car && BADGE.setBrand) BADGE.setBrand(car.brand);
  BADGE.buildCarLayers && BADGE.carWrap && car && BADGE.buildCarLayers(BADGE.carWrap, car);
  BADGE.syncGearUI && BADGE.syncGearUI(id);
};

/** 声音开关：默认取配置，用户在界面上切过则以用户为准。 */
BADGE.soundEnabled = function soundEnabled() {
  try {
    const saved = localStorage.getItem(BADGE.SOUND_KEY);
    if (saved === '0') return false;
    if (saved === '1') return true;
  } catch { /* 忽略 */ }
  return BADGE.config.drive.sound !== false;
};

BADGE.setSound = function setSound(on) {
  try {
    localStorage.setItem(BADGE.SOUND_KEY, on ? '1' : '0');
  } catch { /* 忽略 */ }
  const btn = document.querySelector(`#${BADGE.ROOT_ID} .g-sound`);
  if (btn) {
    btn.classList.toggle('g-muted', !on);
    btn.setAttribute('aria-label', on ? '关闭声浪' : '打开声浪');
  }
};

/* ------------------------------------------------------------------ */
/* 素材库取用                                                          */
/* ------------------------------------------------------------------ */
/** 当前车辆游标（'auto' 模式每次点击递进）。 */
BADGE.carIndex = 0;

/**
 * 取一辆车：
 *   config.drive.car 是具体 id → 固定那辆
 *   否则按 'auto' 轮换整个素材库（第一次是清单里的第一辆）
 */
BADGE.pickCar = function pickCar() {
  const cars = BADGE.CARS || [];
  if (!cars.length) return null;

  const want = BADGE.config.drive.car;
  if (want && want !== 'auto') {
    const fixed = BADGE.findCar ? BADGE.findCar(want) : cars.find((c) => c.id === want);
    if (fixed) return fixed;
  }

  const car = cars[BADGE.carIndex % cars.length];
  BADGE.carIndex = (BADGE.carIndex + 1) % cars.length;
  return car;
};

/* ------------------------------------------------------------------ */
/* 声浪：WebAudio 合成直列六缸                                         */
/* ------------------------------------------------------------------ */
/*
 * 为什么合成而不是放录音：素材库里那段是从参考视频抽的，里面主要是
 * 音乐节拍 + 风噪，没有干净的引擎声。合成版可控（转速、缸数、过车
 * 多普勒），体积也更小——不用再内嵌 15KB 音频。
 *
 * 物理依据：四冲程直列六缸，每转点火 3 次 → 点火频率 f = rpm / 20。
 *   怠速 1500rpm → 75Hz
 *   红线 7300rpm → 365Hz
 * 做法：点火频率的谐波堆叠（×0.5 / ×1 / ×2 / ×3 / ×4）+ 低通随转速
 * 扫动 + 噪声层做排气砂砾 + 收油回火脉冲 + 左右声像模拟掠过。
 */
BADGE.engineCtx = null;

/** 转速曲线：起步、拉高到红线、回落、再补一脚 */
BADGE.RPM_CURVE = [1500, 3300, 6500, 7300, 6100, 3500, 5300, 2300];

/** 把若干插值点铺成 n 个样本（供 setValueCurveAtTime 用） */
BADGE.sampleCurve = function sampleCurve(values, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const f = pos - lo;
    out[i] = values[lo] * (1 - f) + values[hi] * f;
  }
  return out;
};

/** 白噪声 buffer：排气/进气的砂砾层和回火都用它 */
BADGE.makeNoise = function makeNoise(ctx, seconds) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
};

/**
 * 播一次过车声浪。
 *   优先用素材库里的录音（BADGE.SOUNDS[car.sound]）；
 *   没有录音、或明显要求 synth 时，回退到实时合成。
 */
BADGE.audios = {};

BADGE.playSample = function playSample(car) {
  const sounds = BADGE.SOUNDS || {};
  const id = car && car.sound;
  const src = id ? sounds[id] : null;
  if (!src) return false;
  try {
    let audio = BADGE.audios[id];
    if (!audio) {
      audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = 0.9;
      BADGE.audios[id] = audio;
    }
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放被拦截，忽略 */ });
    return true;
  } catch {
    return false;
  }
};

BADGE.playEngine = function playEngine(car) {
  if (!BADGE.soundEnabled()) return;
  const mode = BADGE.config.drive.engine || 'auto';
  if (mode !== 'synth' && BADGE.playSample(car)) return;
  if (mode !== 'sample' && BADGE.playSynth) BADGE.playSynth(car);
};

/** 合成声浪（不依赖素材，作为回退） */
BADGE.playSynth = function playSynth(car) {
  if (!BADGE.soundEnabled()) return;
  try {
    if (!BADGE.engineCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      BADGE.engineCtx = new Ctx();
    }
    const ctx = BADGE.engineCtx;
    if (ctx.state === 'suspended') ctx.resume();

    /* 不同车可以有不同的嗓门：直六 vs 更凶的调校 */
    const tune = (car && car.engine) || {};
    const revScale = tune.revScale || 1;
    const roar = tune.roar === undefined ? 1 : tune.roar;

    const dur = 1.7;
    const t0 = ctx.currentTime + 0.02;
    const N = 96;

    const rpm = BADGE.RPM_CURVE.map((r) => r * revScale);
    const fire = BADGE.sampleCurve(rpm.map((r) => r / 20), N);
    const cutoff = BADGE.sampleCurve(rpm.map((r) => 420 + (r / 7300) * 2400), N);

    /* 总输出：左右掠过 + 音量包络 */
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.5 * roar, t0 + 0.10);
    master.gain.setValueAtTime(0.5 * roar, t0 + dur * 0.72);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let out = master;
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(0.85, t0);
      panner.pan.linearRampToValueAtTime(-0.85, t0 + dur);
      master.connect(panner);
      panner.connect(ctx.destination);
      out = panner;
    } else {
      master.connect(ctx.destination);
    }

    /* 低通：转速越高越开，带共振做出"吼"的质感 */
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 7;
    lp.frequency.setValueCurveAtTime(cutoff, t0, dur);
    lp.connect(master);

    /* 谐波堆叠：六缸的厚度靠这几层叠出来 */
    /* detune 是几音分的轻微失谐：让各层互相拍频，听感像多缸而不是合成器 */
    const voices = [
      { mult: 0.5, gain: 0.32, type: 'sawtooth', detune: -9 },
      { mult: 1, gain: 0.50, type: 'sawtooth', detune: 0 },
      { mult: 2, gain: 0.26, type: 'sawtooth', detune: 7 },
      { mult: 3, gain: 0.13, type: 'square', detune: -5 },
      { mult: 4, gain: 0.06, type: 'sawtooth', detune: 11 },
    ];

    for (const v of voices) {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      if (osc.detune) osc.detune.value = v.detune || 0;
      osc.frequency.setValueCurveAtTime(
        BADGE.sampleCurve(rpm.map((r) => (r / 20) * v.mult), N),
        t0,
        dur,
      );
      const g = ctx.createGain();
      g.gain.value = v.gain;
      osc.connect(g);
      g.connect(lp);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    /* 噪声层：排气砂砾 + 进气嘶声 */
    const noise = ctx.createBufferSource();
    noise.buffer = BADGE.makeNoise(ctx, dur + 0.2);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueCurveAtTime(
      BADGE.sampleCurve(rpm.map((r) => 600 + (r / 7300) * 2000), N),
      t0,
      dur,
    );
    noiseFilter.Q.value = 1.1;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.18 * roar, t0 + 0.12);
    noiseGain.gain.setValueAtTime(0.18 * roar, t0 + dur * 0.7);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(t0);
    noise.stop(t0 + dur + 0.05);

    /* 收油回火：几个极短的噪声脉冲，补上"啪"的颗粒感 */
    for (const at of [0.60, 0.67, 0.74]) {
      const pop = ctx.createBufferSource();
      pop.buffer = BADGE.makeNoise(ctx, 0.06);
      const popFilter = ctx.createBiquadFilter();
      popFilter.type = 'bandpass';
      popFilter.frequency.value = 900 + Math.random() * 300;
      popFilter.Q.value = 1.6;
      const popGain = ctx.createGain();
      popGain.gain.setValueAtTime(0.30 * roar, t0 + dur * at);
      popGain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * at + 0.09);
      pop.connect(popFilter);
      popFilter.connect(popGain);
      popGain.connect(master);
      pop.start(t0 + dur * at);
      pop.stop(t0 + dur * at + 0.1);
    }
  } catch {
    /* 音频不可用时静默，不影响动画 */
  }
};

/* ------------------------------------------------------------------ */
/* 跑一次                                                              */
/* ------------------------------------------------------------------ */
/** 跑一次：车从右进左出，期间只显示车。返回这次用的车辆（便于调试）。 */
BADGE.runDrive = function runDrive() {
  const root = document.getElementById(BADGE.ROOT_ID);
  if (!root || root.classList.contains('g-driving')) return null;

  const car = BADGE.pickCar();
  const wrap = root.querySelector('.g-car-wrap');
  if (wrap && car) BADGE.buildCarLayers(wrap, car);

  /* 单车可覆盖跑动时长（BGM 类声浪需要更长时间放完） */
  const ms = (car && car.durationMs) || BADGE.config.drive.durationMs || 1500;
  root.style.setProperty('--drive-ms', `${ms}ms`);
  root.classList.add('g-driving');

  if (BADGE.setBrand) BADGE.setBrand(car.brand);

  BADGE.playEngine(car);

  clearTimeout(BADGE.driveTimer);
  BADGE.driveTimer = setTimeout(() => {
    root.classList.remove('g-driving');
  }, ms + 120);

  return car;
};

/** 样式：跑车图层、速度线、声音按钮。 */
BADGE.driveCss = function driveCss(id) {
  return `
/* 跑车容器：整辆车的位移由它承担，车轮在里面自转 */
#${id} .g-car-wrap {
  position: absolute; bottom: 8px; left: 100%;
  height: 50px; width: max-content;
  opacity: 0; pointer-events: none;
  will-change: transform, opacity;
}
#${id} .g-car-wrap .g-car {
  display: block; height: 100%; width: auto;
}
/* 黑底抠图：screen 混合让黑底消失 */
#${id} .g-car-wrap .g-car.g-cutout {
  mix-blend-mode: screen;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,.9));
}
/* 真实透明通道：正常混合 */
#${id} .g-car-wrap .g-car.g-alpha {
  mix-blend-mode: normal;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,.85));
}
/* 场景素材：自带柔化透明边 */
#${id} .g-car-wrap .g-car.g-plate {
  mix-blend-mode: normal;
  filter: drop-shadow(0 3px 10px rgba(0,0,0,.65));
}
#${id} .g-car-wrap.g-plate-wrap { height: 62px; bottom: 4px; }
/* 车轮：绕自身圆心旋转，跑动时才转 */
#${id} .g-wheel {
  position: absolute; left: 0; top: 0;
  transform: translate(-50%, -50%);
  transform-origin: 50% 50%;
  border-radius: 50%;
  animation: g-wheel-spin linear infinite;
  animation-play-state: paused;
  pointer-events: none;
}
#${id}.g-driving .g-car-wrap {
  animation: g-car-run var(--drive-ms, 1500ms) cubic-bezier(.42,0,.58,1) forwards;
}
#${id}.g-driving .g-wheel { animation-play-state: running; }
/* 跑动时只留跑车：隐藏面板内容、标志、进度线 */
#${id}.g-driving .g-content { opacity: 0; }
#${id}.g-driving .g-logo { opacity: 0; }
#${id}.g-driving .g-bar { opacity: 0; }
/* 跑车期间把常驻的斜向流动纹也压掉，避免"车上又叠了一层流动边条" */
#${id}.g-driving .g-streaks { opacity: 0; }
/* 速度线、拖尾属于可选特效（config.drive.fx），默认关闭 */
#${id}.g-driving.g-fx .g-blade::before {
  content: ""; position: absolute; inset: 0;
  background: repeating-linear-gradient(90deg,
    rgba(255,255,255,.10) 0 2px, transparent 2px 26px);
  animation: g-speed 220ms linear infinite;
  pointer-events: none;
}
#${id} .g-car-trail {
  position: absolute; bottom: 22px; height: 2px; right: 0;
  width: 0; opacity: 0;
  background: linear-gradient(90deg, transparent, rgba(200,200,210,.55));
  border-radius: 1px;
}
#${id}.g-driving.g-fx .g-car-trail { animation: g-trail var(--drive-ms, 1500ms) linear forwards; }

#${id} .g-content, #${id} .g-logo, #${id} .g-bar, #${id} .g-streaks { transition: opacity 160ms ease; }

#${id} .g-sound {
  position: absolute; right: 6px; top: 5px;
  width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0; transition: opacity .18s ease;
  color: #8b96a3; font-size: 11px; line-height: 1;
  user-select: none;
}
#${id}:hover .g-sound { opacity: .85; }
#${id} .g-sound:hover { color: #d5dde6; }
#${id} .g-sound.g-muted { color: #5b6470; }
#${id} .g-gear {
  position: absolute; right: 24px; top: 5px;
  width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; opacity: 0; transition: opacity .18s ease;
  color: #8b96a3; font-size: 12px; line-height: 1;
  user-select: none;
}
#${id}:hover .g-gear { opacity: .85; }
#${id} .g-gear:hover { color: #d5dde6; }

/* 车辆选择菜单（挂在 root 上，不被 blade 的 clip-path 裁掉） */
#${id} .g-menu {
  position: absolute; right: 6px; bottom: calc(100% + 6px);
  min-width: 150px; padding: 4px;
  display: none; flex-direction: column; gap: 2px;
  background: #14161c; border: 1px solid #2a2f38; border-radius: 8px;
  box-shadow: 0 10px 24px rgba(0,0,0,.7);
  font-size: 11px; color: #b9c2cd;
  cursor: default;
}
#${id} .g-menu.g-menu-open { display: flex; }
#${id} .g-menu-item {
  padding: 5px 8px; border-radius: 5px; cursor: pointer; white-space: nowrap;
}
#${id} .g-menu-item:hover { background: #1d222b; color: #e6ecf3; }
#${id} .g-menu-item.g-active { color: var(--g-accent-2, #ff9d2e); }

#${id} .g-sound.g-muted::after {
  content: ""; position: absolute; width: 15px; height: 1px;
  background: currentColor; transform: rotate(-45deg);
}

@keyframes g-car-run {
  0% { left: 100%; opacity: 0; }
  8% { opacity: 1; }
  92% { opacity: 1; }
  100% { left: -24%; opacity: 0; }
}
@keyframes g-wheel-spin {
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
@keyframes g-speed {
  0% { background-position: 0 0; } 100% { background-position: -52px 0; }
}
@keyframes g-trail {
  0% { width: 0; opacity: 0; right: 8%; }
  30% { width: 45%; opacity: .5; }
  100% { width: 20%; opacity: 0; right: 96%; }
}
@media (prefers-reduced-motion: reduce) {
  #${id}.g-driving .g-car { animation-duration: 600ms; }
  #${id}.g-driving .g-blade::before, #${id}.g-driving .g-car-trail { animation: none; }
}`;
};

/**
 * 重建跑车图层：车身 + 可选车轮。
 * 车轮按车身尺寸的百分比定位（x/y 为中心点，d 为直径，均相对车身宽/高）。
 */
BADGE.buildCarLayers = function buildCarLayers(wrap, car) {
  wrap.innerHTML = '';
  wrap.classList.toggle('g-plate-wrap', car.kind === 'plate');

  const img = document.createElement('img');
  img.className = `g-car g-${car.kind || 'cutout'}`;
  img.alt = '';
  img.draggable = false;
  img.src = car.src;
  if (car.css) img.style.filter = car.css;
  else img.style.filter = '';
  img.dataset.car = car.id;
  wrap.appendChild(img);

  for (const w of car.wheels || []) {
    const wheel = document.createElement('img');
    wheel.className = 'g-wheel';
    wheel.alt = '';
    wheel.draggable = false;
    wheel.src = w.src;
    wheel.style.left = `${w.x}%`;
    wheel.style.top = `${w.y}%`;
    wheel.style.width = `${w.d}%`;
    wheel.style.animationDuration = `${w.speed || 0.16}s`;
    wrap.appendChild(wheel);
  }

  return img;
};

/** 挂载：跑车图层 + 声音按钮 + 点击检测（与拖动互斥）。 */
BADGE.mountDrive = function mountDrive(parts) {
  const { root, blade } = parts;
  if (!BADGE.config.drive || BADGE.config.drive.enabled === false) return;

  /* 可选特效（速度线 + 拖尾）：默认关闭，只留跑车本体 */
  if (BADGE.config.drive.fx) root.classList.add('g-fx');

  const wrap = document.createElement('div');
  wrap.className = 'g-car-wrap';
  blade.appendChild(wrap);
  BADGE.carWrap = wrap;
  const first = (BADGE.CARS || [])[0];
  if (first) BADGE.buildCarLayers(wrap, first);

  const trail = document.createElement('div');
  trail.className = 'g-car-trail';
  blade.appendChild(trail);

  /* ---- 设置：齿轮 → 选择开哪辆车 ---- */
  const gear = document.createElement('div');
  gear.className = 'g-gear';
  gear.textContent = '⚙';
  gear.setAttribute('role', 'button');
  gear.setAttribute('aria-label', '切换车辆');
  gear.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    BADGE.__soundClick = true;
    menu.classList.toggle('g-menu-open');
  });
  root.appendChild(gear);

  const menu = document.createElement('div');
  menu.className = 'g-menu';
  const options = [{ id: 'auto', label: '轮换' }]
    .concat((BADGE.CARS || []).map((c) => ({ id: c.id, label: c.name })));
  for (const opt of options) {
    const item = document.createElement('div');
    item.className = 'g-menu-item';
    item.dataset.car = opt.id;
    item.textContent = opt.label;
    item.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      BADGE.__soundClick = true;
      BADGE.setCar(opt.id);
      menu.classList.remove('g-menu-open');
    });
    menu.appendChild(item);
  }
  root.appendChild(menu);

  BADGE.syncGearUI = function syncGearUI(id) {
    const current = id || BADGE.selectedCar();
    menu.querySelectorAll('.g-menu-item').forEach((el) => {
      el.classList.toggle('g-active', el.dataset.car === current);
    });
  };
  BADGE.syncGearUI(BADGE.selectedCar());

  /* 点面板别处关掉菜单 */
  root.addEventListener('pointerdown', () => menu.classList.remove('g-menu-open'));

  const sound = document.createElement('div');
  sound.className = 'g-sound';
  sound.textContent = '🔊';
  sound.setAttribute('role', 'button');
  sound.setAttribute('aria-label', '关闭声浪');
  sound.addEventListener('pointerdown', (e) => {
    /* 音量按钮不该触发跑车：先吞掉这次点击 */
    BADGE.__soundClick = true;
    e.stopPropagation();
    BADGE.setSound(!BADGE.soundEnabled());
  });
  blade.appendChild(sound);
  BADGE.setSound(BADGE.soundEnabled());

  /* 点击（非拖动）触发跑车 */
  let downAt = 0;
  let downX = 0;
  let downY = 0;
  root.addEventListener('pointerdown', (e) => {
    downAt = Date.now();
    downX = e.clientX;
    downY = e.clientY;
  });
  root.addEventListener('pointerup', (e) => {
    const moved = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
    const isClick = moved < 6 && Date.now() - downAt < 400;
    if (BADGE.__soundClick) {
      BADGE.__soundClick = false;
      return;
    }
    if (isClick) BADGE.runDrive();
  });
};
