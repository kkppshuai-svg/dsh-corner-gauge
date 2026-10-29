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
/* 声浪                                                                */
/* ------------------------------------------------------------------ */
/** 懒加载音频对象：按声浪 id 各缓存一个（首次点击时才创建）。 */
BADGE.audios = {};
BADGE.playEngine = function playEngine(car) {
  if (!BADGE.soundEnabled()) return;
  const sounds = BADGE.SOUNDS || {};
  const id = (car && car.sound) || Object.keys(sounds)[0];
  const src = id ? sounds[id] : null;
  if (!src) return;
  try {
    let audio = BADGE.audios[id];
    if (!audio) {
      audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = 0.85;
      BADGE.audios[id] = audio;
    }
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放被拦截，忽略 */ });
  } catch { /* 忽略 */ }
};

/* ------------------------------------------------------------------ */
/* 跑一次                                                              */
/* ------------------------------------------------------------------ */
/** 跑一次：车从右进左出，期间只显示车。返回这次用的车辆（便于调试）。 */
BADGE.runDrive = function runDrive() {
  const root = document.getElementById(BADGE.ROOT_ID);
  if (!root || root.classList.contains('g-driving')) return null;

  const car = BADGE.pickCar();
  const img = root.querySelector('.g-car');
  if (img && car) {
    if (img.getAttribute('src') !== car.src) img.src = car.src;
    img.className = `g-car g-${car.kind}`;
    img.dataset.car = car.id;
  }

  const ms = BADGE.config.drive.durationMs || 1500;
  root.style.setProperty('--drive-ms', `${ms}ms`);
  root.classList.add('g-driving');

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
#${id} .g-car {
  position: absolute; bottom: 8px; left: 100%;
  height: 50px; width: auto;
  opacity: 0; pointer-events: none;
  will-change: transform, opacity;
}
/* 抠图素材：黑底会被 screen 混合吃掉，只剩车身 */
#${id} .g-car.g-cutout {
  mix-blend-mode: screen;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,.9));
}
/* 场景素材：自带柔化透明边，正常混合即可融进深色面板 */
#${id} .g-car.g-plate {
  height: 62px; bottom: 4px;
  mix-blend-mode: normal;
  filter: drop-shadow(0 3px 10px rgba(0,0,0,.65));
}
#${id}.g-driving .g-car {
  animation: g-car-run var(--drive-ms, 1500ms) cubic-bezier(.42,0,.58,1) forwards;
}
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

/** 挂载：跑车图层 + 声音按钮 + 点击检测（与拖动互斥）。 */
BADGE.mountDrive = function mountDrive(parts) {
  const { root, blade } = parts;
  if (!BADGE.config.drive || BADGE.config.drive.enabled === false) return;

  /* 可选特效（速度线 + 拖尾）：默认关闭，只留跑车本体 */
  if (BADGE.config.drive.fx) root.classList.add('g-fx');

  const first = (BADGE.CARS || [])[0];

  const car = document.createElement('img');
  car.className = `g-car g-${(first && first.kind) || 'cutout'}`;
  car.alt = '';
  car.draggable = false;
  if (first && first.src) car.src = first.src;
  blade.appendChild(car);

  const trail = document.createElement('div');
  trail.className = 'g-car-trail';
  blade.appendChild(trail);

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
