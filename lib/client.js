/**
 * dsh-corner-gauge v2.1.0 — 由 scripts/build.mjs 生成，请勿直接编辑。
 * 改源码请编辑 src/，素材改 assets/（清单 manifest.json），然后 npm run build。
 */
window.__ModuleLoader__.load({
	id: "dsh-corner-gauge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		/* ---- 00-config.js ---- */
		/**
		 * 配置与常量
		 * ------------------------------------------------------------------
		 * 面板的一切都是可配置的：边框用什么模板（skin）、显示哪些元素
		 * （elements）、放在哪、多大、多久刷新一次。
		 *
		 * 运行时也可以覆盖：在插件加载前设置 window.__DSH_BADGE_CONFIG__。
		 */
		const BADGE = {};

		BADGE.ROOT_ID = 'dsh-corner-gauge';
		BADGE.STYLE_ID = 'dsh-corner-gauge-style';
		BADGE.POS_KEY = 'dsh-corner-gauge:pos';

		/**
		 * 默认配置。
		 * @property skin      边框模板名（见 skins 注册表）
		 * @property elements  面板元素顺序（见 elements 注册表）
		 * @property position  默认停靠位置（右下角，带偏移）
		 * @property size      面板尺寸
		 * @property currency  'auto' 跟随账户，或写死 'CNY' / 'USD'
		 * @property pollMs    轮询间隔
		 */
		BADGE.DEFAULTS = {
		  skin: 'mclaren',
		  elements: ['currency', 'amount', 'progress'],
		  position: { right: 22, bottom: 96 },
		  size: { width: 322, height: 70 },
		  currency: 'auto',
		  pollMs: 60000,
		  /** 彩蛋：点击面板让 M 跑车开过一次（声浪可用右上角喇叭开关） */
		  drive: {
		    enabled: true,
		    sound: true,
		    durationMs: 1500,
		    /** 跑车期间的附加特效（速度线、拖尾）。默认关：只留跑车更干净。 */
		    fx: false,
		    /**
		     * 用素材库里的哪辆车：
		     *   'auto'（默认）= 每次点击换下一辆，把整个车库轮着展示一遍
		     *   或填车辆 id（见 assets/manifest.json，如 'm4-silver'）固定一辆
		     */
		    car: 'auto',
		    /**
		     * 声浪引擎：
		     *   'auto'（默认）= 优先播素材库里的录音，没有录音则回退到 WebAudio 合成
		     *   'sample'      = 只用录音
		     *   'synth'       = 只用实时合成
		     */
		    engine: 'auto',
		  },
		};

		/* 用户覆盖做一层浅合并：只写 drive.fx 之类不会把其他默认值冲掉 */
		{
		  const user = window.__DSH_BADGE_CONFIG__ || {};
		  BADGE.config = Object.assign({}, BADGE.DEFAULTS, user, {
		    drive: Object.assign({}, BADGE.DEFAULTS.drive, user.drive || {}),
		    position: Object.assign({}, BADGE.DEFAULTS.position, user.position || {}),
		    size: Object.assign({}, BADGE.DEFAULTS.size, user.size || {}),
		  });
		}

		/** 账户接口需要客户端元数据；版本号必须与运行时一致。 */
		BADGE.DSH_VERSION = '0.2.1-rc.2';

		/** 进度条的自动量程档位。 */
		BADGE.SCALE_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

		/** 币种符号。 */
		BADGE.SYMBOLS = { CNY: '¥', USD: '$' };

		/** 渲染数据：一次取数后的快照。 */
		BADGE.view = {
		  total: 0,
		  currency: 'CNY',
		  state: 'loading', // loading | ready | guest | error
		  scaleMax: 100,
		  timer: null,
		  attempts: 0,
		  retryTimer: null,
		};


		/* ---- 10-data.js ---- */
		/**
		 * 取数层
		 * ------------------------------------------------------------------
		 * 只负责「问账户要余额」并归一化成 view 快照，不碰 DOM。
		 */

		/** 客户端元数据：账户接口按严格 schema 校验。 */
		BADGE.metadata = function metadata() {
		  const locale = (typeof navigator !== 'undefined' && navigator.language) || 'zh-CN';
		  return {
		    version: BADGE.DSH_VERSION,
		    locale,
		    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
		  };
		};

		/** 进度条量程：带迟滞，避免数字在档位边界反复跳。 */
		BADGE.pickScale = function pickScale(total) {
		  const view = BADGE.view;
		  if (total <= view.scaleMax * 0.72 && total >= view.scaleMax * 0.18) return view.scaleMax;
		  const want = Math.max(10, total * 1.3);
		  for (const step of BADGE.SCALE_STEPS) if (step >= want) return step;
		  return BADGE.SCALE_STEPS[BADGE.SCALE_STEPS.length - 1];
		};

		/** 千分位 + 两位小数，不带币种符号。 */
		BADGE.formatAmount = function formatAmount(n) {
		  return n.toLocaleString('zh-CN', {
		    minimumFractionDigits: 2,
		    maximumFractionDigits: 2,
		  });
		};

		/**
		 * 从 getBalance 的返回里取出「充值余额 + 同币种赠金」。
		 * @param value getBalance 的 value 字段
		 * @returns {{total:number,currency:string}|null}
		 */
		BADGE.extractBalance = function extractBalance(value) {
		  if (!value || typeof value !== 'object') return null;

		  const wallets = Array.isArray(value.value) ? value.value : [];
		  const bonuses = Array.isArray(value.bonusWallets) ? value.bonusWallets : [];
		  const main = wallets.find((w) => w.currency === 'CNY') || wallets[0];
		  if (!main) return null;

		  const currency = main.currency || 'CNY';
		  const recharge = Number.parseFloat(main.balance) || 0;
		  const bonus = bonuses
		    .filter((w) => w.currency === currency)
		    .reduce((sum, w) => sum + (Number.parseFloat(w.balance) || 0), 0);

		  return { total: recharge + bonus, currency };
		};

		/**
		 * 取一次余额并更新 view。
		 * @returns {'ready'|'guest'|'error'}
		 */
		BADGE.fetchBalance = async function fetchBalance(ctx) {
		  const view = BADGE.view;
		  try {
		    const account = ctx.remote && ctx.remote.account;
		    if (!account || typeof account.getBalance !== 'function') {
		      BADGE.report('no-account', ctx.remote ? Object.keys(ctx.remote).join(',') : 'remote=undefined');
		      return 'error';
		    }

		    const result = await account.getBalance(BADGE.metadata());
		    if (!result || result.ok !== true) {
		      BADGE.report('not-ok', JSON.stringify(result).slice(0, 200));
		      return 'error';
		    }

		    if (result.value === null || result.value === undefined) {
		      view.total = 0;
		      BADGE.report('guest', 'value=null');
		      return 'guest';
		    }

		    const parsed = BADGE.extractBalance(result.value);
		    if (!parsed) {
		      view.total = 0;
		      BADGE.report('guest', 'no-wallet');
		      return 'guest';
		    }

		    const forced = BADGE.config.currency;
		    view.currency = forced !== 'auto' ? forced : parsed.currency;
		    view.total = parsed.total;
		    view.scaleMax = BADGE.pickScale(view.total);
		    BADGE.report('ready', `${view.total} ${view.currency}`);
		    return 'ready';
		  } catch (error) {
		    BADGE.report('error', error && error.message ? error.message : String(error));
		    return 'error';
		  }
		};

		/** 诊断遥测：写 localStorage，可从磁盘 LevelDB 读出来。 */
		BADGE.report = function report(status, detail) {
		  try {
		    localStorage.setItem('dsh-gauge-diag', JSON.stringify({
		      at: new Date().toISOString(),
		      status: String(status),
		      detail: String(detail === undefined ? '' : detail).slice(0, 240),
		    }));
		  } catch {
		    /* localStorage 不可用时静默 */
		  }
		};


		/* ---- 20-drag.js ---- */
		/**
		 * 拖动层
		 * ------------------------------------------------------------------
		 * 面板可自由拖动，位置写进 localStorage；窗口缩放时重新钳制到视口内。
		 */

		/** 把坐标钳制在视口内。 */
		BADGE.clampPos = function clampPos(left, top, el) {
		  const w = el ? el.offsetWidth : BADGE.config.size.width;
		  const h = el ? el.offsetHeight : BADGE.config.size.height;
		  const pad = 6;
		  return {
		    left: Math.min(Math.max(pad, left), Math.max(pad, window.innerWidth - w - pad)),
		    top: Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - h - pad)),
		  };
		};

		/** 写入位置（同时清掉默认的 right/bottom 锚点）。 */
		BADGE.setPos = function setPos(root, pos) {
		  const p = BADGE.clampPos(pos.left, pos.top, root);
		  root.style.left = `${p.left}px`;
		  root.style.top = `${p.top}px`;
		  root.style.right = 'auto';
		  root.style.bottom = 'auto';
		};

		/** 从 localStorage 恢复上次拖到的位置。 */
		BADGE.restorePos = function restorePos(root) {
		  try {
		    const raw = localStorage.getItem(BADGE.POS_KEY);
		    if (!raw) return;
		    const pos = JSON.parse(raw);
		    if (typeof pos.left === 'number' && typeof pos.top === 'number') {
		      BADGE.setPos(root, pos);
		    }
		  } catch {
		    /* 坏数据直接忽略 */
		  }
		};

		/** 绑定指针拖动。 */
		BADGE.attachDrag = function attachDrag(root) {
		  let dragging = false;
		  let pointerId = null;
		  let sx = 0;
		  let sy = 0;
		  let ox = 0;
		  let oy = 0;

		  root.addEventListener('pointerdown', (e) => {
		    if (e.button !== 0) return;
		    const r = root.getBoundingClientRect();
		    dragging = true;
		    pointerId = e.pointerId;
		    sx = e.clientX;
		    sy = e.clientY;
		    ox = r.left;
		    oy = r.top;
		    root.classList.add('g-dragging');
		    try { root.setPointerCapture(pointerId); } catch { /* 忽略 */ }
		    e.preventDefault();
		  });

		  root.addEventListener('pointermove', (e) => {
		    if (!dragging) return;
		    BADGE.setPos(root, { left: ox + (e.clientX - sx), top: oy + (e.clientY - sy) });
		  });

		  const finish = () => {
		    if (!dragging) return;
		    dragging = false;
		    root.classList.remove('g-dragging');
		    try { if (pointerId !== null) root.releasePointerCapture(pointerId); } catch { /* 忽略 */ }
		    pointerId = null;
		    const r = root.getBoundingClientRect();
		    try {
		      localStorage.setItem(BADGE.POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
		    } catch { /* 忽略 */ }
		  };

		  root.addEventListener('pointerup', finish);
		  root.addEventListener('pointercancel', finish);

		  window.addEventListener('resize', () => {
		    const r = root.getBoundingClientRect();
		    if (root.style.left) BADGE.setPos(root, { left: r.left, top: r.top });
		  });
		};


		/* ---- 30-skins.js ---- */
		/**
		 * 边框模板（skin）注册表
		 * ------------------------------------------------------------------
		 * 一个 skin 只负责「外壳」：形状、底色、装饰、标志。
		 * 它不关心面板里显示什么——那是 elements 的事。
		 *
		 * skin 结构：
		 *   css      : (id) => 这段模板的样式字符串
		 *   build    : (blade, id) => 往外壳里加装饰节点（可选）
		 */
		BADGE.skins = {};

		/**
		 * mclaren：斜切底板 + 迈凯伦 speedmark + 顶部红条 + 斜向速度线。
		 * 当前默认模板。
		 */
		BADGE.skins.mclaren = {
		  css(id) {
		    return `
		#${id} .g-blade {
		  position: absolute; inset: 0;
		  clip-path: polygon(0 38%, 7% 0, 100% 0, 100% 32%, 92% 100%, 2.5% 100%, 0 92%);
		  background: linear-gradient(180deg, #1a1c22 0%, #0d0e12 45%, #060709 100%);
		  overflow: hidden;
		}
		#${id} .g-blade::after {
		  content: ""; position: absolute; inset: 0; pointer-events: none;
		  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), inset 0 -2px 8px rgba(0,0,0,.9);
		}
		#${id} .g-stripe {
		  position: absolute; left: 0; right: 0; top: 0; height: 2px;
		  background: linear-gradient(90deg, #b00500, #c41200 42%, #c03018 68%, rgba(192,48,24,0));
		}
		#${id} .g-streaks {
		  position: absolute; inset: 0;
		  background: repeating-linear-gradient(106deg,
		    rgba(255,255,255,.045) 0 1px, transparent 1px 13px);
		  animation: g-streak 3.2s linear infinite;
		  opacity: .75;
		}
		#${id} .g-logo {
		  position: absolute; left: 20px; top: 50%;
		  height: 34px; width: auto;
		  transform: translateY(-50%);
		  filter: drop-shadow(0 1px 2px rgba(0,0,0,.8));
		  pointer-events: none;
		}
		@keyframes g-streak { 0% { background-position: 0 0; } 100% { background-position: 120px 0; } }
		@media (prefers-reduced-motion: reduce) {
		  #${id} .g-streaks { animation: none !important; }
		}`;
		  },

		  build(blade) {
		    const stripe = document.createElement('div');
		    stripe.className = 'g-stripe';
		    blade.appendChild(stripe);

		    const streaks = document.createElement('div');
		    streaks.className = 'g-streaks';
		    blade.appendChild(streaks);

		    const logo = document.createElement('img');
		    logo.className = 'g-logo';
		    logo.alt = '';
		    logo.src = 'data:image/webp;base64,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';
		    blade.appendChild(logo);
		  },
		};

		/**
		 * minimal：极简模板，无标志无装饰，只保留圆角底板。
		 * 用来演示「换皮肤」只需要换这一层。
		 */
		BADGE.skins.minimal = {
		  css(id) {
		    return `
		#${id} .g-blade {
		  position: absolute; inset: 0;
		  border-radius: 12px;
		  background: linear-gradient(180deg, #16181d 0%, #0b0c10 100%);
		  box-shadow: inset 0 1px 0 rgba(255,255,255,.10);
		  overflow: hidden;
		}`;
		  },

		  build() {
		    /* 极简模板没有任何装饰节点 */
		  },
		};

		/** 旧名字兼容：`bmw-m` 是同一套外壳，只是换了标志 */
		BADGE.skins['bmw-m'] = BADGE.skins.mclaren;

		/** 取当前配置对应的 skin，找不到就退回 minimal。 */
		BADGE.currentSkin = function currentSkin() {
		  return BADGE.skins[BADGE.config.skin] || BADGE.skins.minimal;
		};


		/* ---- 35-drive.js ---- */
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


		/* ---- 40-elements.js ---- */
		/**
		 * 面板元素（element）注册表
		 * ------------------------------------------------------------------
		 * 元素只负责「面板里显示什么」，不关心外壳长什么样。
		 * 想加新元素（图标、涨跌、标签…）就在这里注册一个，然后写进 config.elements。
		 *
		 * element 结构：
		 *   css     : (id) => 样式字符串
		 *   mount   : (parts) => HTMLElement   挂载并返回自己的节点
		 *   update  : (el, view) => void        数据变化时刷新
		 *   dim     : boolean                   无数据时是否整体变灰（默认 true）
		 */
		BADGE.elements = {};

		/** 拿到（必要时创建）数字组的倾斜容器。 */
		BADGE.numWrap = function numWrap(parts) {
		  let wrap = parts.content.querySelector('.g-num');
		  if (!wrap) {
		    wrap = document.createElement('div');
		    wrap.className = 'g-num';
		    parts.content.appendChild(wrap);
		  }
		  return wrap;
		};

		/* ------------------------------------------------------------------ */
		/* 货币符号                                                            */
		/* ------------------------------------------------------------------ */
		BADGE.elements.currency = {
		  css(id) {
		    return `
		#${id} .g-cur {
		  font-family: 'GaugeRacingCondensed', ui-sans-serif, system-ui, sans-serif;
		  font-style: normal; font-weight: 700;
		  font-size: 26px; line-height: 1;
		  color: #d8502e;
		  margin-right: 2px;
		  transform: translateY(-2px);
		  text-shadow: 0 1px 2px rgba(0,0,0,.75);
		}`;
		  },

		  mount(parts) {
		    const el = document.createElement('span');
		    el.className = 'g-cur';
		    el.textContent = '¥';
		    BADGE.numWrap(parts).appendChild(el);
		    return el;
		  },

		  update(el, view) {
		    if (view.state === 'ready') {
		      el.textContent = BADGE.SYMBOLS[view.currency] || '¥';
		      el.style.display = '';
		    } else {
		      el.style.display = 'none';
		    }
		  },
		};

		/* ------------------------------------------------------------------ */
		/* 金额数字（金属质感）                                                */
		/* ------------------------------------------------------------------ */
		BADGE.elements.amount = {
		  css(id) {
		    return `
		#${id} .g-val {
		  position: relative; display: inline-block;
		  font-family: 'GaugeRacingCondensed', ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif;
		  font-style: normal; font-weight: 700;
		  font-size: 48px; line-height: .86;
		  letter-spacing: -.2px;
		  padding-right: 4px;
		  background: linear-gradient(180deg,
		    #c8664a 0%, #ab3f28 20%, #98240e 42%,
		    #b14a2e 56%, #9a2810 78%, #7b1408 100%);
		  -webkit-background-clip: text;
		  background-clip: text;
		  color: #c20800;
		  -webkit-text-fill-color: transparent;
		  filter: drop-shadow(0 1.5px 1.5px rgba(0,0,0,.8));
		}
		#${id}.g-dim .g-val { opacity: .45; }`;
		  },

		  mount(parts) {
		    const el = document.createElement('span');
		    el.className = 'g-val';
		    el.textContent = '—';
		    BADGE.numWrap(parts).appendChild(el);
		    return el;
		  },

		  update(el, view) {
		    if (view.state === 'ready') el.textContent = BADGE.formatAmount(view.total);
		    else if (view.state === 'loading') el.textContent = '···';
		    else el.textContent = '--';
		  },
		};

		/* ------------------------------------------------------------------ */
		/* 底部进度条                                                          */
		/* ------------------------------------------------------------------ */
		BADGE.elements.progress = {
		  css(id) {
		    return `
		#${id} .g-bar {
		  position: absolute; left: 22px; right: 34px; bottom: 3px; height: 2px;
		  background: #14161b;
		  box-shadow: inset 0 1px 2px rgba(0,0,0,.9);
		}
		#${id} .g-fill {
		  position: absolute; left: 0; top: 0; bottom: 0;
		  width: calc(var(--p, 0) * 1%);
		  background: linear-gradient(90deg, #b00500, #c03018);
		  box-shadow: 0 0 8px rgba(176,5,0,.85);
		  transition: width 1.1s cubic-bezier(.2,.9,.25,1);
		}`;
		  },

		  mount(parts) {
		    const bar = document.createElement('div');
		    bar.className = 'g-bar';
		    const fill = document.createElement('div');
		    fill.className = 'g-fill';
		    bar.appendChild(fill);
		    parts.blade.appendChild(bar);
		    return bar;
		  },

		  update(el, view, root) {
		    const ratio = Math.max(0, Math.min(1, view.total / view.scaleMax));
		    const fill = el.querySelector('.g-fill');
		    if (fill) fill.style.width = `${ratio * 100}%`;
		  },
		};


		/* ---- 50-render.js ---- */
		/**
		 * 装配层
		 * ------------------------------------------------------------------
		 * 把 skin（外壳）+ elements（面板元素）+ 数据层拼起来，负责：
		 * 建 DOM、注入样式、绘制状态、失败重试。
		 */

		/** 基础样式：面板容器、内容行、倾斜容器、状态。 */
		BADGE.baseCss = function baseCss(id, cfg) {
		  const { width, height } = cfg.size;
		  const { right, bottom } = cfg.position;
		  return `
		@font-face {
		  font-family: 'GaugeRacingCondensed';
		  src: url(data:font/woff2;base64,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) format('woff2');
		  font-weight: 700;
		  font-style: normal;
		  font-display: swap;
		}

		#${id} {
		  position: fixed; right: ${right}px; bottom: ${bottom}px;
		  width: ${width}px; height: ${height}px;
		  z-index: 2147483000; user-select: none;
		  cursor: grab; touch-action: none;
		  font-family: ui-sans-serif, system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
		  filter: drop-shadow(0 10px 24px rgba(0,0,0,.65));
		  opacity: 0; transform: translateY(8px) scale(.97);
		  transition: opacity .5s ease, transform .5s cubic-bezier(.2,.8,.2,1);
		}
		#${id}.g-on { opacity: 1; transform: none; }
		#${id}.g-dragging { cursor: grabbing; filter: drop-shadow(0 16px 32px rgba(0,0,0,.8)); }

		#${id} .g-content {
		  position: absolute; inset: 0;
		  display: flex; align-items: center; justify-content: flex-end;
		  gap: 9px; padding: 12px 30px 0 20px;
		}
		#${id} .g-num {
		  display: flex; align-items: baseline;
		  transform: skewX(-21deg);
		  transform-origin: right center;
		  white-space: nowrap;
		}
		@media (max-width: 720px) {
		  #${id} { width: ${Math.round(width * 0.7)}px; height: ${Math.round(height * 0.8)}px; right: 12px; bottom: 74px; }
		  #${id} .g-val { font-size: 34px; }
		  #${id} .g-content { padding: 0 24px 5px 14px; gap: 6px; }
		}`;
		};

		/** 汇总所有样式（基础 + skin + 本次用到的 elements）。 */
		BADGE.collectCss = function collectCss() {
		  const id = BADGE.ROOT_ID;
		  const parts = [BADGE.baseCss(id, BADGE.config)];
		  parts.push(BADGE.currentSkin().css(id));
		  for (const name of BADGE.config.elements) {
		    const el = BADGE.elements[name];
		    if (el && typeof el.css === 'function') parts.push(el.css(id));
		  }
		  if (BADGE.config.drive && BADGE.config.drive.enabled !== false && BADGE.driveCss) {
		    parts.push(BADGE.driveCss(id));
		  }
		  return parts.join('\n');
		};

		/** 建面板 DOM。 */
		BADGE.build = function build() {
		  if (document.getElementById(BADGE.ROOT_ID)) return;

		  if (!document.getElementById(BADGE.STYLE_ID)) {
		    const style = document.createElement('style');
		    style.id = BADGE.STYLE_ID;
		    style.textContent = BADGE.collectCss();
		    document.head.appendChild(style);
		  }

		  const root = document.createElement('div');
		  root.id = BADGE.ROOT_ID;
		  root.setAttribute('aria-hidden', 'true');

		  const blade = document.createElement('div');
		  blade.className = 'g-blade';
		  root.appendChild(blade);

		  /* 外壳先画，再放内容 */
		  BADGE.currentSkin().build(blade);

		  const content = document.createElement('div');
		  content.className = 'g-content';
		  blade.appendChild(content);

		  const parts = { root, blade, content };
		  BADGE.mounted = [];

		  for (const name of BADGE.config.elements) {
		    const def = BADGE.elements[name];
		    if (!def) continue;
		    const el = def.mount(parts);
		    if (el) BADGE.mounted.push({ name, el, def });
		  }

		  if (BADGE.mountDrive) BADGE.mountDrive(parts);

		  (document.body || document.documentElement).appendChild(root);
		  BADGE.restorePos(root);
		  BADGE.attachDrag(root);

		  requestAnimationFrame(() => root.classList.add('g-on'));
		};

		/** 按当前 view 刷新所有元素。 */
		BADGE.paint = function paint() {
		  const root = document.getElementById(BADGE.ROOT_ID);
		  if (!root) {
		    BADGE.build();
		    return;
		  }

		  const view = BADGE.view;
		  const ready = view.state === 'ready';
		  root.classList.toggle('g-dim', !ready);

		  for (const item of BADGE.mounted) {
		    if (item.def.update) item.def.update(item.el, view, root);
		  }
		};

		/** 取数失败时按指数退避重试。 */
		BADGE.scheduleRetry = function scheduleRetry(ctx) {
		  const view = BADGE.view;
		  if (view.retryTimer || view.attempts >= 8) return;
		  const delay = Math.min(1200 * Math.pow(1.7, view.attempts), 15000);
		  view.attempts += 1;
		  view.retryTimer = setTimeout(() => {
		    view.retryTimer = null;
		    BADGE.refresh(ctx);
		  }, delay);
		};

		/** 刷新一次：取数 → 绘制 → 失败则排队重试。 */
		BADGE.refresh = async function refresh(ctx) {
		  const view = BADGE.view;
		  const state = await BADGE.fetchBalance(ctx);

		  if (state === 'ready') {
		    view.state = 'ready';
		    view.attempts = 0;
		    if (view.retryTimer) {
		      clearTimeout(view.retryTimer);
		      view.retryTimer = null;
		    }
		    BADGE.paint();
		    return;
		  }

		  view.state = state;
		  BADGE.paint();
		  BADGE.scheduleRetry(ctx);
		};


		/* ---- 60-client.js ---- */
		/**
		 * 插件入口
		 * ------------------------------------------------------------------
		 * 声明账户服务依赖，确保启动时可以访问远程账户。
		 * 依赖就绪后插件激活，再挂载界面。
		 */
		BADGE.inject = ['remote', 'remote.account'];

		/* 供预览页/调试调用：跑一次跑车 */
		window.__runDrive = () => BADGE.runDrive();

		/* 截图/调试用：把跑车定格在动画的指定毫秒处（不触发计时器） */
		window.__freezeDrive = (offsetMs) => {
		  const root = document.getElementById(BADGE.ROOT_ID);
		  if (!root) return null;
		  const car = BADGE.pickCar();
		  const wrap = root.querySelector('.g-car-wrap');
		  if (wrap && car && BADGE.buildCarLayers) BADGE.buildCarLayers(wrap, car);
		  root.style.setProperty('--drive-ms', '1500ms');
		  root.classList.add('g-driving');
		  if (wrap) {
		    wrap.style.animationPlayState = 'paused';
		    wrap.style.animationDelay = `-${offsetMs}ms`;
		  }
		  return car && car.id;
		};

		/** 等 <body> 就绪再挂载（客户端插件可能在解析 head 时就被激活）。 */
		BADGE.whenBody = function whenBody(fn) {
		  if (typeof document === 'undefined') return;
		  if (document.body) {
		    fn();
		    return;
		  }
		  if (document.readyState === 'loading') {
		    document.addEventListener('DOMContentLoaded', () => BADGE.whenBody(fn), { once: true });
		    return;
		  }
		  let tries = 0;
		  const timer = setInterval(() => {
		    if (document.body) {
		      clearInterval(timer);
		      fn();
		      return;
		    }
		    if (++tries > 200) clearInterval(timer);
		  }, 50);
		};

		BADGE.apply = function apply(ctx) {
		  BADGE.report('apply', `remote=${ctx && ctx.remote ? 'yes' : 'no'}`);

		  BADGE.whenBody(() => {
		    try {
		      BADGE.build();
		      BADGE.report('built', document.getElementById(BADGE.ROOT_ID) ? 'dom-ok' : 'dom-missing');
		    } catch (error) {
		      BADGE.report('build-error', error && error.message ? error.message : String(error));
		      return;
		    }

		    const view = BADGE.view;
		    const tick = () => {
		      try {
		        if (!document.getElementById(BADGE.ROOT_ID)) BADGE.build();
		      } catch { /* 单次重建失败忽略 */ }
		      BADGE.refresh(ctx);
		    };

		    tick();
		    view.timer = setInterval(tick, BADGE.config.pollMs);

		    document.addEventListener('visibilitychange', () => {
		      if (document.visibilityState === 'visible') BADGE.refresh(ctx);
		    });

		    if (typeof ctx.effect === 'function') {
		      ctx.effect(() => () => {
		        if (view.timer) clearInterval(view.timer);
		        if (view.retryTimer) clearTimeout(view.retryTimer);
		        const el = document.getElementById(BADGE.ROOT_ID);
		        if (el) el.remove();
		        const st = document.getElementById(BADGE.STYLE_ID);
		        if (st) st.remove();
		        BADGE.report('disposed');
		      });
		    }
		  });
		};


		/* ---- 素材库（由 assets/manifest.json 生成，勿手改）---- */
		BADGE.CARS = [
		 {
		  "id": "m4-silver",
		  "name": "M4 Competition · 银",
		  "kind": "cutout",
		  "sound": "engine-m4",
		  "engine": {
		   "revScale": 1,
		   "roar": 1
		  },
		  "src": "data:image/webp;base64,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",
		  "wheels": []
		 },
		 {
		  "id": "mclaren-f1",
		  "name": "McLaren F1 · 迈凯伦",
		  "kind": "alpha",
		  "sound": "engine-m4",
		  "engine": {
		   "revScale": 1.18,
		   "roar": 1.2
		  },
		  "src": "data:image/webp;base64,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",
		  "wheels": [
		   {
		    "src": "data:image/webp;base64,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",
		    "x": 22.29,
		    "y": 71.47,
		    "d": 12.24,
		    "speed": 0.15
		   },
		   {
		    "src": "data:image/webp;base64,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",
		    "x": 86.29,
		    "y": 72.39,
		    "d": 12.24,
		    "speed": 0.15
		   }
		  ]
		 }
		];

		BADGE.SOUNDS = {
		 "engine-m4": "data:audio/mpeg;base64,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"
		};

		/** 按 id 找车；找不到返回全部清单（便于调试）。 */
		BADGE.findCar = function findCar(id) {
		  const list = BADGE.CARS || [];
		  return list.find((c) => c.id === id) || null;
		};


		exports.apply = BADGE.apply;
		exports.inject = BADGE.inject;
		return module.exports;
	},
});
