/**
 * 彩蛋：点击面板，M 跑车从右向左开过一次
 * ------------------------------------------------------------------
 * - 跑动期间隐藏面板元素，只留跑车
 * - 声浪来自 assets/engine.mp3（真实录音，构建时 base64 内嵌）
 * - 声音可通过面板右上角的喇叭按钮开关，状态写进 localStorage
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

/** 懒加载音频对象（首次点击时才创建）。 */
BADGE.audio = null;
BADGE.playEngine = function playEngine() {
  if (!BADGE.soundEnabled()) return;
  try {
    if (!BADGE.audio) {
      BADGE.audio = new Audio(`data:audio/mpeg;base64,__ENGINE_B64__`);
      BADGE.audio.preload = 'auto';
      BADGE.audio.volume = 0.85;
    }
    BADGE.audio.currentTime = 0;
    const p = BADGE.audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放被拦截，忽略 */ });
  } catch { /* 忽略 */ }
};

/** 跑一次：车从右进左出，期间只显示车。 */
BADGE.runDrive = function runDrive() {
  const root = document.getElementById(BADGE.ROOT_ID);
  if (!root || root.classList.contains('g-driving')) return;

  const ms = BADGE.config.drive.durationMs || 1500;
  root.style.setProperty('--drive-ms', `${ms}ms`);
  root.classList.add('g-driving');

  BADGE.playEngine();

  clearTimeout(BADGE.driveTimer);
  BADGE.driveTimer = setTimeout(() => {
    root.classList.remove('g-driving');
  }, ms + 120);
};

/** 样式：跑车图层、速度线、声音按钮。 */
BADGE.driveCss = function driveCss(id) {
  return `
#${id} .g-car {
  position: absolute; bottom: 9px; left: 100%;
  height: 50px; width: auto;
  opacity: 0; pointer-events: none;
  will-change: transform, opacity;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,.9));
  mix-blend-mode: screen;
}
#${id}.g-driving .g-car {
  animation: g-car-run var(--drive-ms, 1500ms) cubic-bezier(.42,0,.58,1) forwards;
}
/* 跑动时只留跑车：隐藏面板内容、标志、进度线 */
#${id}.g-driving .g-content { opacity: 0; }
#${id}.g-driving .g-logo { opacity: 0; }
#${id}.g-driving .g-bar { opacity: 0; }
#${id}.g-driving .g-blade::before {
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
#${id}.g-driving .g-car-trail { animation: g-trail var(--drive-ms, 1500ms) linear forwards; }

#${id} .g-content, #${id} .g-logo, #${id} .g-bar { transition: opacity 160ms ease; }

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

  const car = document.createElement('img');
  car.className = 'g-car';
  car.alt = '';
  car.src = `data:image/webp;base64,__CAR_B64__`;
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
    if (moved < 6 && Date.now() - downAt < 400) BADGE.runDrive();
  });
};
