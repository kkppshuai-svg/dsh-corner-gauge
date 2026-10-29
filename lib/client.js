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
		  background: linear-gradient(90deg,
		    var(--g-accent, #b00500),
		    var(--g-accent-2, #c41200) 42%,
		    transparent 92%);
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
		  height: 34px; width: 74px;
		  transform: translateY(-50%);
		  background-repeat: no-repeat;
		  background-position: center;
		  background-size: contain;
		  filter: drop-shadow(0 1px 2px rgba(0,0,0,.8));
		  pointer-events: none;
		}
		/* 金属标：蒙版塑形 + 多段明暗渐变模拟镀铬（高光→本色→暗部→回光） */
		#${id} .g-logo.g-metal {
		  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
		  -webkit-mask-position: center; mask-position: center;
		  -webkit-mask-size: contain; mask-size: contain;
		  background-image: linear-gradient(158deg,
		    #fff7e8 0%, #ffc46b 18%, #ff8a00 38%,
		    #b35400 54%, #ffc079 70%, #ff8f1f 84%, #8f3d00 100%);
		  filter:
		    drop-shadow(0 1px 1px rgba(0,0,0,.85))
		    drop-shadow(0 0 6px rgba(255,150,40,.35));
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

		    const logo = document.createElement('div');
		    logo.className = 'g-logo';

		    /* 两个子层：普通标用 <img> 原图，单色标用金属蒙版层 */
		    const logoImg = document.createElement('img');
		    logoImg.className = 'g-logo-img';
		    logoImg.alt = '';
		    logoImg.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
		    logo.appendChild(logoImg);

		    const logoMetal = document.createElement('div');
		    logoMetal.className = 'g-logo-metal';
		    logo.appendChild(logoMetal);

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

		/** 按品牌切标志与强调色：M4 → 宝马 M，迈凯伦 → speedmark */
		BADGE.setBrand = function setBrand(brand) {
		  const root = document.getElementById(BADGE.ROOT_ID);
		  if (!root) return;
		  const list = Object.keys(BADGE.BRANDS || {});
		  const name = brand && BADGE.BRANDS && BADGE.BRANDS[brand] ? brand : list[0] || 'mclaren';
		  root.dataset.brand = name;
		  const logo = root.querySelector('.g-logo');
		  const def = BADGE.BRANDS ? BADGE.BRANDS[name] : null;
		  if (!logo || !def) return;
		  const src = typeof def === 'string' ? def : def.src;
		  const metal = typeof def === 'object' && def.metal;

		  const img = logo.querySelector('.g-logo-img');
		  if (!img) return;

		  if (metal) {
		    /* 单色标：图形当蒙版，填充镀铬渐变 */
		    img.style.display = 'none';
		    logo.classList.add('g-metal');
		    logo.style.maskImage = `url("${src}")`;
		    logo.style.webkitMaskImage = `url("${src}")`;
		  } else {
		    /* 多色标：原图直出 */
		    logo.classList.remove('g-metal');
		    logo.style.maskImage = '';
		    logo.style.webkitMaskImage = '';
		    img.style.display = 'block';
		    if (img.getAttribute('src') !== src) img.src = src;
		  }
		};

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

		  if (BADGE.setBrand && BADGE.CARS && BADGE.CARS[0]) BADGE.setBrand(BADGE.CARS[0].brand);

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
		  if (car && BADGE.setBrand) BADGE.setBrand(car.brand);
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
		  "brand": "bmw-m",
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
		  "sound": "engine-f1",
		  "brand": "mclaren",
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

		BADGE.BRANDS = {
		 "bmw-m": {
		  "src": "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhLS0gQ3JlYXRlZCB3aXRoIElua3NjYXBlIChodHRwOi8vd3d3Lmlua3NjYXBlLm9yZy8pIC0tPgoKPHN2ZwogICB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iCiAgIHhtbG5zOmNjPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyMiCiAgIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyIKICAgeG1sbnM6c3ZnPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKICAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogICB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIKICAgeG1sbnM6c29kaXBvZGk9Imh0dHA6Ly9zb2RpcG9kaS5zb3VyY2Vmb3JnZS5uZXQvRFREL3NvZGlwb2RpLTAuZHRkIgogICB4bWxuczppbmtzY2FwZT0iaHR0cDovL3d3dy5pbmtzY2FwZS5vcmcvbmFtZXNwYWNlcy9pbmtzY2FwZSIKICAgd2lkdGg9IjU3Ljk3NzYxOW1tIgogICBoZWlnaHQ9IjIwLjk1NzExOW1tIgogICB2aWV3Qm94PSIwIDAgNTcuOTc3NjE5IDIwLjk1NzExOSIKICAgdmVyc2lvbj0iMS4xIgogICBpZD0ic3ZnOCIKICAgaW5rc2NhcGU6dmVyc2lvbj0iMC45Mi4yICg1YzNlODBkLCAyMDE3LTA4LTA2KSIKICAgc29kaXBvZGk6ZG9jbmFtZT0iQk1XIE0gbG9nby5zdmciPgogIDx0aXRsZQogICAgIGlkPSJ0aXRsZTg5OSI+Qk1XIE0gbG9nbzwvdGl0bGU+CiAgPGRlZnMKICAgICBpZD0iZGVmczIiPgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMjEzIj4KICAgICAgPHN0b3AKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6IzQ5OGJjMDtzdG9wLW9wYWNpdHk6MSIKICAgICAgICAgb2Zmc2V0PSIwIgogICAgICAgICBpZD0ic3RvcDEyMDkiIC8+CiAgICAgIDxzdG9wCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiMyNTU4ODY7c3RvcC1vcGFjaXR5OjEiCiAgICAgICAgIG9mZnNldD0iMSIKICAgICAgICAgaWQ9InN0b3AxMjExIiAvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudAogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50MTE2OSIKICAgICAgIGlua3NjYXBlOmNvbGxlY3Q9ImFsd2F5cyI+CiAgICAgIDxzdG9wCiAgICAgICAgIGlkPSJzdG9wMTE2MyIKICAgICAgICAgb2Zmc2V0PSIwIgogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojMDAzZDY4O3N0b3Atb3BhY2l0eToxIiAvPgogICAgICA8c3RvcAogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojNWY4ZGQzO3N0b3Atb3BhY2l0eToxIgogICAgICAgICBvZmZzZXQ9IjAuMzY0MDUwMjciCiAgICAgICAgIGlkPSJzdG9wMTE2NSIgLz4KICAgICAgPHN0b3AKICAgICAgICAgaWQ9InN0b3AxMTY3IgogICAgICAgICBvZmZzZXQ9IjEiCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiMwMDJhNDk7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMTYxIgogICAgICAgaW5rc2NhcGU6Y29sbGVjdD0iYWx3YXlzIj4KICAgICAgPHN0b3AKICAgICAgICAgaWQ9InN0b3AxMTU1IgogICAgICAgICBvZmZzZXQ9IjAiCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiM2MTllZDU7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICAgIDxzdG9wCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiNhYWNjZmY7c3RvcC1vcGFjaXR5OjEiCiAgICAgICAgIG9mZnNldD0iMC4yNzk4MTQiCiAgICAgICAgIGlkPSJzdG9wMTE1NyIgLz4KICAgICAgPHN0b3AKICAgICAgICAgaWQ9InN0b3AxMTU5IgogICAgICAgICBvZmZzZXQ9IjEiCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiMzZjdmYmU7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMTMzIj4KICAgICAgPHN0b3AKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6I2RiMWUxYztzdG9wLW9wYWNpdHk6MTsiCiAgICAgICAgIG9mZnNldD0iMCIKICAgICAgICAgaWQ9InN0b3AxMTI5IiAvPgogICAgICA8c3RvcAogICAgICAgICBpZD0ic3RvcDExMzciCiAgICAgICAgIG9mZnNldD0iMC40NjI3NDY0MSIKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6I2RlODc4NztzdG9wLW9wYWNpdHk6MSIgLz4KICAgICAgPHN0b3AKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6I2M4MWExNztzdG9wLW9wYWNpdHk6MSIKICAgICAgICAgb2Zmc2V0PSIxIgogICAgICAgICBpZD0ic3RvcDExMzEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQ4ODEiPgogICAgICA8c3RvcAogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojNzk3ZTgxO3N0b3Atb3BhY2l0eToxIgogICAgICAgICBvZmZzZXQ9IjAiCiAgICAgICAgIGlkPSJzdG9wODc3IiAvPgogICAgICA8c3RvcAogICAgICAgICBpZD0ic3RvcDg4NSIKICAgICAgICAgb2Zmc2V0PSIwLjUzMDI1ODg5IgogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojZjBmMGYwO3N0b3Atb3BhY2l0eToxIiAvPgogICAgICA8c3RvcAogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojYmFiY2JkO3N0b3Atb3BhY2l0eToxIgogICAgICAgICBvZmZzZXQ9IjEiCiAgICAgICAgIGlkPSJzdG9wODc5IiAvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudAogICAgICAgaW5rc2NhcGU6Y29sbGVjdD0iYWx3YXlzIgogICAgICAgeGxpbms6aHJlZj0iI2xpbmVhckdyYWRpZW50ODgxIgogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50ODgzIgogICAgICAgeDE9IjE2MC40MTUxNiIKICAgICAgIHkxPSIxMDAuNzI3ODgiCiAgICAgICB4Mj0iMTU3LjI0MDE2IgogICAgICAgeTI9IjEyNC4wMTEyMiIKICAgICAgIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIgogICAgICAgZ3JhZGllbnRUcmFuc2Zvcm09InNjYWxlKDMuNzc5NTI3NSkiIC8+CiAgICA8bGluZWFyR3JhZGllbnQKICAgICAgIGlua3NjYXBlOmNvbGxlY3Q9ImFsd2F5cyIKICAgICAgIHhsaW5rOmhyZWY9IiNsaW5lYXJHcmFkaWVudDExMzMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMTM1IgogICAgICAgeDE9IjE0NS4wMzkwNSIKICAgICAgIHkxPSI5Ny40MTEzMDEiCiAgICAgICB4Mj0iMTQ1LjAzOTA1IgogICAgICAgeTI9IjExMy4xNjM5OSIKICAgICAgIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiAvPgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICB4bGluazpocmVmPSIjbGluZWFyR3JhZGllbnQxMTY5IgogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50MTE0NSIKICAgICAgIHgxPSI1MjIuNzExNTUiCiAgICAgICB5MT0iMzc1LjA4NDcyIgogICAgICAgeDI9IjUyMi43MTE1NSIKICAgICAgIHkyPSI0MzIuNjMyNDUiCiAgICAgICBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgLz4KICAgIDxsaW5lYXJHcmFkaWVudAogICAgICAgaW5rc2NhcGU6Y29sbGVjdD0iYWx3YXlzIgogICAgICAgeGxpbms6aHJlZj0iI2xpbmVhckdyYWRpZW50MTE2MSIKICAgICAgIGlkPSJsaW5lYXJHcmFkaWVudDExNTMiCiAgICAgICB4MT0iNDg5LjgyMDk1IgogICAgICAgeTE9IjM3Mi44MTY5MyIKICAgICAgIHgyPSI0ODkuODIwOTUiCiAgICAgICB5Mj0iNDU0LjgxNDQyIgogICAgICAgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIC8+CiAgICA8ZmlsdGVyCiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBzdHlsZT0iY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzOnNSR0IiCiAgICAgICBpZD0iZmlsdGVyMTE5OCIKICAgICAgIHg9Ii0wLjAwODA2MTYyMjMiCiAgICAgICB3aWR0aD0iMS4wMTYxMjMyIgogICAgICAgeT0iLTAuMDA0Nzc4MDg2MiIKICAgICAgIGhlaWdodD0iMS4wMDk1NTYyIj4KICAgICAgPGZlR2F1c3NpYW5CbHVyCiAgICAgICAgIGlua3NjYXBlOmNvbGxlY3Q9ImFsd2F5cyIKICAgICAgICAgc3RkRGV2aWF0aW9uPSIwLjA0MTcyMjM4NyIKICAgICAgICAgaWQ9ImZlR2F1c3NpYW5CbHVyMTIwMCIgLz4KICAgIDwvZmlsdGVyPgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICB4bGluazpocmVmPSIjbGluZWFyR3JhZGllbnQxMjEzIgogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50MTIxNSIKICAgICAgIHgxPSIxMjYuMDQxNCIKICAgICAgIHkxPSIxMDEuNDg0NzYiCiAgICAgICB4Mj0iMTEzLjk0MTgiCiAgICAgICB5Mj0iMTIyLjQ0MTg4IgogICAgICAgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIC8+CiAgPC9kZWZzPgogIDxzb2RpcG9kaTpuYW1lZHZpZXcKICAgICBpZD0iYmFzZSIKICAgICBwYWdlY29sb3I9IiNmZmZmZmYiCiAgICAgYm9yZGVyY29sb3I9IiM2NjY2NjYiCiAgICAgYm9yZGVyb3BhY2l0eT0iMS4wIgogICAgIGlua3NjYXBlOnBhZ2VvcGFjaXR5PSIwLjAiCiAgICAgaW5rc2NhcGU6cGFnZXNoYWRvdz0iMiIKICAgICBpbmtzY2FwZTp6b29tPSIxIgogICAgIGlua3NjYXBlOmN4PSIxMzkuMDEyMSIKICAgICBpbmtzY2FwZTpjeT0iOC42MzAyNzEiCiAgICAgaW5rc2NhcGU6ZG9jdW1lbnQtdW5pdHM9Im1tIgogICAgIGlua3NjYXBlOmN1cnJlbnQtbGF5ZXI9ImxheWVyMSIKICAgICBzaG93Z3JpZD0iZmFsc2UiCiAgICAgc2hvd2d1aWRlcz0idHJ1ZSIKICAgICBpbmtzY2FwZTpndWlkZS1iYm94PSJ0cnVlIgogICAgIGlua3NjYXBlOnNuYXAtaW50ZXJzZWN0aW9uLXBhdGhzPSJmYWxzZSIKICAgICBpbmtzY2FwZTpvYmplY3Qtbm9kZXM9ImZhbHNlIgogICAgIGlua3NjYXBlOndpbmRvdy13aWR0aD0iMTkyMCIKICAgICBpbmtzY2FwZTp3aW5kb3ctaGVpZ2h0PSIxMDE3IgogICAgIGlua3NjYXBlOndpbmRvdy14PSIxMzU4IgogICAgIGlua3NjYXBlOndpbmRvdy15PSItOCIKICAgICBpbmtzY2FwZTp3aW5kb3ctbWF4aW1pemVkPSIxIgogICAgIGlua3NjYXBlOnNuYXAtc21vb3RoLW5vZGVzPSJmYWxzZSIKICAgICBmaXQtbWFyZ2luLXRvcD0iMCIKICAgICBmaXQtbWFyZ2luLWxlZnQ9IjAiCiAgICAgZml0LW1hcmdpbi1yaWdodD0iMCIKICAgICBmaXQtbWFyZ2luLWJvdHRvbT0iMCIgLz4KICA8bWV0YWRhdGEKICAgICBpZD0ibWV0YWRhdGE1Ij4KICAgIDxyZGY6UkRGPgogICAgICA8Y2M6V29yawogICAgICAgICByZGY6YWJvdXQ9IiI+CiAgICAgICAgPGRjOmZvcm1hdD5pbWFnZS9zdmcreG1sPC9kYzpmb3JtYXQ+CiAgICAgICAgPGRjOnR5cGUKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9wdXJsLm9yZy9kYy9kY21pdHlwZS9TdGlsbEltYWdlIiAvPgogICAgICAgIDxkYzp0aXRsZT5CTVcgTSBsb2dvPC9kYzp0aXRsZT4KICAgICAgICA8Y2M6bGljZW5zZQogICAgICAgICAgIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbGljZW5zZXMvYnktc2EvNC4wLyIgLz4KICAgICAgICA8ZGM6ZGF0ZT4xMi8wNC8yMDE4PC9kYzpkYXRlPgogICAgICAgIDxkYzpjcmVhdG9yPgogICAgICAgICAgPGNjOkFnZW50PgogICAgICAgICAgICA8ZGM6dGl0bGU+Qk1XIE1vdG9yc3BvcnQgR21iSDwvZGM6dGl0bGU+CiAgICAgICAgICA8L2NjOkFnZW50PgogICAgICAgIDwvZGM6Y3JlYXRvcj4KICAgICAgICA8ZGM6cHVibGlzaGVyPgogICAgICAgICAgPGNjOkFnZW50PgogICAgICAgICAgICA8ZGM6dGl0bGU+Q01ldGFsQ29yZTwvZGM6dGl0bGU+CiAgICAgICAgICA8L2NjOkFnZW50PgogICAgICAgIDwvZGM6cHVibGlzaGVyPgogICAgICAgIDxkYzpzb3VyY2U+aHR0cDovL3d3dy5jYXJsb2dvcy5vcmcvbG9nby9CTVctTS1sb2dvLTE5MjB4MTA4MC5wbmc8L2RjOnNvdXJjZT4KICAgICAgPC9jYzpXb3JrPgogICAgICA8Y2M6TGljZW5zZQogICAgICAgICByZGY6YWJvdXQ9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL2xpY2Vuc2VzL2J5LXNhLzQuMC8iPgogICAgICAgIDxjYzpwZXJtaXRzCiAgICAgICAgICAgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNSZXByb2R1Y3Rpb24iIC8+CiAgICAgICAgPGNjOnBlcm1pdHMKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL25zI0Rpc3RyaWJ1dGlvbiIgLz4KICAgICAgICA8Y2M6cmVxdWlyZXMKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL25zI05vdGljZSIgLz4KICAgICAgICA8Y2M6cmVxdWlyZXMKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL25zI0F0dHJpYnV0aW9uIiAvPgogICAgICAgIDxjYzpwZXJtaXRzCiAgICAgICAgICAgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNEZXJpdmF0aXZlV29ya3MiIC8+CiAgICAgICAgPGNjOnJlcXVpcmVzCiAgICAgICAgICAgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNTaGFyZUFsaWtlIiAvPgogICAgICA8L2NjOkxpY2Vuc2U+CiAgICA8L3JkZjpSREY+CiAgPC9tZXRhZGF0YT4KICA8ZwogICAgIGlua3NjYXBlOmxhYmVsPSJDYXBhIDEiCiAgICAgaW5rc2NhcGU6Z3JvdXBtb2RlPSJsYXllciIKICAgICBpZD0ibGF5ZXIxIgogICAgIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0xMTMuNTA5MDYsLTEwMS40ODQ3NikiPgogICAgPGcKICAgICAgIGlkPSJnMTI0MyI+CiAgICAgIDxnCiAgICAgICAgIGlkPSJnMTI3OSI+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojYjRiNmI4O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjA0OTAzODQ3cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDEzOS41NzIwOCwxMjIuNDQxODggLTEuMjIxOTYsLTIuNmUtNCAxMi4yNjM0LC0yMC45NTY3MSBoIDEuMzA3MzggeiIKICAgICAgICAgICBpZD0icGF0aDg3MSIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjI2NDU4MzMycHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MTtmaWx0ZXI6dXJsKCNmaWx0ZXIxMTk4KSIKICAgICAgICAgICBkPSJtIDE1MC41NDkxOSwxMDEuNDg0NzYgLTEyLjI2MzQyLDIwLjk1Njg2IGggMC4xMzY0MiBsIDEyLjI4NDYyLC0yMC45NTY4NyB6IgogICAgICAgICAgIGlkPSJwYXRoMTE4OCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHRyYW5zZm9ybT0icm90YXRlKC0wLjAxOTM0NDQxLDE0NC41MDM2NSw2OC42NzEzOTQpIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MTtmaWxsOnVybCgjbGluZWFyR3JhZGllbnQ4ODMpO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDU3My4xNjAxNiwzODMuNTY0NDUgLTQ2LjM0NzY2LDc5LjIwNzAzIGggMzMuNDEyMTEgbCAxNS42ODE2NCwtMjYuMjkyOTYgMC4yNTU4NiwyNi4yOTI5NiBoIDI3LjAyNTM5IGwgMTUuNjkxNDEsLTI2LjE5OTIxIDAuMTExMzIsMjYuMTk5MjEgaCAyOS4xNDg0NCB2IC03OS4yMDcwMyBoIC0yOC4wMTc1OCBsIC0xNS45MjE4NywyNi42MzI4MiB2IC0yNi42MzI4MiB6IgogICAgICAgICAgIHRyYW5zZm9ybT0ic2NhbGUoMC4yNjQ1ODMzMykiCiAgICAgICAgICAgaWQ9InBhdGg4MzgiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIgLz4KICAgICAgICA8cGF0aAogICAgICAgICAgIHN0eWxlPSJvcGFjaXR5OjAuNzMwMDAwMDQ7ZmlsbDojNTI1NTU3O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDU3My4xNjAxNiwzODMuNTY0NDUgLTQ2LjM0NzEzLDc5LjIwNzAzIGggMC43MDI1OSAzMi43MDg5OSBsIDAuMjQ0MTQsLTAuNDc4NTEgaCAtMTYuNzU1ODYgbCAtMTUuODUzNTEsLTAuMTAzNTIgNDYuMDA1ODUsLTc4LjA3NDIyIGggMTQuODk0NTQgMTUuMzk2NDggbCAwLjA0MywtMC41NTA3OCBoIC0zMC4wMDk3NyAtMC4zNTkzNyB6IG0gNDYuOTYwOTMsMCAtMC4zMTgzNiwwLjU1MDc4IGggMTMuOTE2MDIgMTMuOTE2MDIgdiAzOS4wODc4OSAzOS4wODk4NSBoIC0xNC4wMTU2MyAtMTQuNTkxOCBsIC0wLjAzNzEsMC40Nzg1MSBoIDI5LjE0ODQ0IHYgLTc5LjIwNzAzIHogbSAtNDMuOTIzODIsNzguNzI4NTIgLTAuMDM1MiwwLjQ3ODUxIGggMjcuMDI1MzkgbCAwLjI0NDE0LC0wLjQ3ODUxIGggLTEzLjYxMTMzIHoiCiAgICAgICAgICAgdHJhbnNmb3JtPSJzY2FsZSgwLjI2NDU4MzMzKSIKICAgICAgICAgICBpZD0icGF0aDg3NCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0ib3BhY2l0eToxO2ZpbGw6dXJsKCNsaW5lYXJHcmFkaWVudDExNTMpO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDoxLjI5MzMyMzc2O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLWRhc2hhcnJheTpub25lO3N0cm9rZS1kYXNob2Zmc2V0OjA7c3Ryb2tlLW9wYWNpdHk6MTtwYWludC1vcmRlcjptYXJrZXJzIHN0cm9rZSBmaWxsIgogICAgICAgICAgIGQ9Im0gNDc2LjM3Njk1LDM4My41NjQ0NSAtNDcuMzY3MTgsNzkuMjA3MDMgaCAzLjQwNDI5IDI5LjQ4NjMzIDMwLjI3OTMgMzAuMjc5MjkgbCA0Ni43ODkwNywtNzkuMjA3MDMgaCAtMzAuMjc5MyAtMzAuMjc5MyAtMjkuOTUxMTcgeiIKICAgICAgICAgICBpZD0icGF0aDg2MSIKICAgICAgICAgICB0cmFuc2Zvcm09InNjYWxlKDAuMjY0NTgzMzMpIgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojODg4YzhmO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDYwNC4xOTkyMiwzODMuNTY0NDUgLTIuODY1MjQsMzYuNzY1NjMgMTguNzg3MTEsLTM2Ljc2NTYzIC0xNS45MjE4NywyNi42MzI4MiB6IgogICAgICAgICAgIHRyYW5zZm9ybT0ic2NhbGUoMC4yNjQ1ODMzMykiCiAgICAgICAgICAgaWQ9InBhdGg4NDIiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIgLz4KICAgICAgICA8cGF0aAogICAgICAgICAgIHN0eWxlPSJmaWxsOiM1MjU2NTk7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDQ5MDM4NDdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIgogICAgICAgICAgIGQ9Im0gMTU5LjEwMzE0LDExMS4yMTIyMSAwLjc1OCwtMi42ODA3NSB2IC03LjA0NjU1IGggLTJlLTQgeiIKICAgICAgICAgICBpZD0icGF0aDg0NCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojODg4YzhmO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDU3OC44OTQ1Myw0MjYuMjIwNyAtMTguNjY5OTIsMzYuNTUwNzggMTUuNjgxNjQsLTI2LjI5Mjk2IDAuMjU1ODYsMjYuMjkyOTYgeiIKICAgICAgICAgICBpZD0icGF0aDkxMCIKICAgICAgICAgICB0cmFuc2Zvcm09InNjYWxlKDAuMjY0NTgzMzMpIgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojNTI1NjU5O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjA0OTAzODQ3cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDE0OC4yMjYyOSwxMjIuNDQxODggNC4xNDg2NywtNi45NTY3NiAwLjc5MTAyLC0yLjcxNDE5IHoiCiAgICAgICAgICAgaWQ9InBhdGg4NDYiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIKICAgICAgICAgICBzb2RpcG9kaTpub2RldHlwZXM9ImNjY2NjIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9ImZpbGw6Izg4OGM4ZjtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4xODUzNDIyNXB4O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1vcGFjaXR5OjEiCiAgICAgICAgICAgZD0ibSA2MjEuNzg5MDYsNDI2LjIyMDcgLTE4LjYwMTU2LDM2LjU1MDc4IDE1LjY5MTQxLC0yNi4xOTkyMSAwLjExMTMyLDI2LjE5OTIxIHoiCiAgICAgICAgICAgdHJhbnNmb3JtPSJzY2FsZSgwLjI2NDU4MzMzKSIKICAgICAgICAgICBpZD0icGF0aDkyMCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9ImZpbGw6IzUyNTY1OTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4wNDkwMzg0N3B4O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1vcGFjaXR5OjEiCiAgICAgICAgICAgZD0ibSAxNTkuNTkzNTIsMTIyLjQ0MTg4IDQuMTUxNTgsLTYuOTMxOTkgMC43Njk3OCwtMi43Mzg5NiAtNC45MjE1Miw5LjY3MDY5IHoiCiAgICAgICAgICAgaWQ9InBhdGg4NTAiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIKICAgICAgICAgICBzb2RpcG9kaTpub2RldHlwZXM9ImNjY2NjIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MTtmaWxsOnVybCgjbGluZWFyR3JhZGllbnQxMTQ1KTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MS4yOTMzMjM3NjtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1kYXNoYXJyYXk6bm9uZTtzdHJva2UtZGFzaG9mZnNldDowO3N0cm9rZS1vcGFjaXR5OjE7cGFpbnQtb3JkZXI6bWFya2VycyBzdHJva2UgZmlsbCIKICAgICAgICAgICBkPSJtIDUwOC42ODk0NSwzODMuNTY0NDUgLTQ2Ljc4OTA2LDc5LjIwNzAzIGggMzAuMjc5MyAzMC4yNzkyOSBsIDQ2Ljc4OTA3LC03OS4yMDcwMyBoIC0zMC4yNzkzIHoiCiAgICAgICAgICAgaWQ9InBhdGg4NTkiCiAgICAgICAgICAgdHJhbnNmb3JtPSJzY2FsZSgwLjI2NDU4MzMzKSIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MTtmaWxsOnVybCgjbGluZWFyR3JhZGllbnQxMTM1KTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4zNDIxOTE5O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLWRhc2hhcnJheTpub25lO3N0cm9rZS1kYXNob2Zmc2V0OjA7c3Ryb2tlLW9wYWNpdHk6MTtwYWludC1vcmRlcjptYXJrZXJzIHN0cm9rZSBmaWxsIgogICAgICAgICAgIGQ9Im0gMTQyLjYwMjExLDEwMS40ODQ5MSBoIDguMDExNDEgbCAtMTIuMjYzNCwyMC45NTY3MSAtOC4xMjc3NCwyLjZlLTQgeiIKICAgICAgICAgICBpZD0icmVjdDg1NiIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDp1cmwoI2xpbmVhckdyYWRpZW50MTIxNSk7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDQ5MDM4NDdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIgogICAgICAgICAgIGQ9Im0gMTI2LjY2NTk5LDEwMS40ODQ5MSBoIC0wLjYyNDQyIGwgLTEyLjUzMjUxLDIwLjk1Njk3IGggMC45MDA2OCB6IgogICAgICAgICAgIGlkPSJwYXRoODYzIgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0ib3BhY2l0eTowLjE1NTAwMDA0O2ZpbGw6IzAwMDAwMDtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4wNzUxMDE4cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDE1MC41Mjc1LDEwMS42MzA0MiBoIC0yMy45NDY1MiBsIDAuMDg1LC0wLjE0NTUxIGggMjMuOTQ3NSB6IgogICAgICAgICAgIGlkPSJwYXRoODY1IgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiCiAgICAgICAgICAgc29kaXBvZGk6bm9kZXR5cGVzPSJjY2NjYyIgLz4KICAgICAgICA8cGF0aAogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIKICAgICAgICAgICBpZD0icGF0aDExNzEiCiAgICAgICAgICAgZD0ibSAxNTEuNTYzNDgsMTAxLjYzMDI3IGggLTEuMDM1ODMgbCAwLjA4NjIsLTAuMTQ1NTEgaCAxLjAzNDc4IHoiCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MC40NDI1Njc1OTtmaWxsOiMwMDAwMDA7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDE1Njc2MjdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MC4zODUwMDAwMTtmaWxsOiMwMDAwMDA7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDE1Njc2MjdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIgogICAgICAgICAgIGQ9Im0gMTM5LjM4NTk1LDEyMi40NDE2MiBoIC0xLjAzNTgzIGwgMC4wODYyLC0wLjE0NTUxIGggMS4wMzQ3OCB6IgogICAgICAgICAgIGlkPSJwYXRoMTE3NSIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgIDwvZz4KICAgIDwvZz4KICA8L2c+Cjwvc3ZnPgo=",
		  "metal": false
		 },
		 "mclaren": {
		  "src": "data:image/webp;base64,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",
		  "metal": true
		 }
		};

		BADGE.SOUNDS = {
		 "engine-m4": "data:audio/mpeg;base64,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",
		 "engine-f1": "data:audio/mpeg;base64,SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAyAAAAAAAAAAAAAAD/+1jAAAAAAAAAAAAAAAAAAAAAAABJbmZvAAAADwAAADMAADqAAAkODhMTGBgdHSIiJycsLDExNjY7O0BARERJSU5OU1NYWF1dYmJnZ2xscXF2dnt7gICEiYmOjpOTmJidnaKip6esrLGxtra7u8DAxMTJyc7O09PY2N3d4uLn5+zs8fH29vv7/wAAAABMYXZjNjMuMS4AAAAAAAAAAAAAAAAkAkAAAAAAAAA6gIfB7qgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+1jEAAAOMOEeFMeACi+lb78e8AO+LDAwMHISWBADgiOHYhg3LcBzk7Lmo4RyE4QhFhqBMEY3oeo3936sVisZImYb/d8QIkNPmmo2wnZlxk4hjJljZ1Y8iave970pR48ePNXePKa/9KP4+HisVisiZViseaze+4Cvfx9/4GHh74AeHh7wMPmXdjhlZlZVZku2t1f1AAANx6+T85F1Q+GcVFef6IOdlNsvrHGEXM9Sltb2ijWtpIvyOW7q+MybZUc4vpmdxgQZ41IjxWF8eMDari6HG/R7FO81V/5rv90hwIeWddo5vc2O7hE3iBNn039w47dFh4vErXG9agUrf4f7vh5E1v//xnmMzwYv//9N0pD86tLCmgSUSU8AphBrqvT/+1jEBoAQXTVnvYSAGhAf62j2Jogj+XUcktflHSqNV+DkNca+2jtyVEAwgBdSMBtRd5wsM7bmQTNpgWmQBQVihYA4B2kC2n0bbUILYzCBc7qspzjLwhFyXpV8mL+wR43tbV4WIbROLo5JQUjoojq7UrsmwYPLUbUaMQhJhf7ks/j//xXI0gmhWo1JIAAAAAAgECRjZFZpsVDoswloCGsj/fNyfa1lCkGdQORSps1ybqzqhMIQbINBbEaiKXCqnq4BV0dV4cj++FgaHToL0cMIwJGgYOoUI2UFA6oG1gw9hIF4tEpkiOJPtoe09ciUe0gaViIyOiujFY22yhOtMeMlMNM9tuKBkFyqDULJ5c5RxAAAAAAAAgBvMGGS92FVtiv/+1jECIHQpQFdp6TaQgKha6GHpXgLsBTISrjljLB3oappE6W01VcrH6UZnywtG6zl4V0aEf6EwFpiRzi0PNK6At2sTU33ey2rCic2iMIR8QLlQ+SEg8sK4zKjg6jGZJh8SWbVMsihVklinEOcAAAPB0zk1vmV7N1JIjDuZJKpKwKhElcxfFjZxEgFO6c1J6GPvxB1OlMQORKXKEHovsqwpDJN8RcySWJ5SoVDYqH6ojRN8amGLR2skeMl0ajEwpZFwaLY8VmS5JFJK1hdQ0y4ipk7iqGhUgMCdx9m2JLPNvIExU1R0xIeZSSGSjjcdRrmopvVt2SUVlhx6ruu1S8NlCCeiwKCvybGLYAAAAAAFAlL7VZBduw058DKzDFm2gP/+1jECwGQYRFdTDDTAguiK4mGJihp8FXJW1mUxdgCnadzToYirm0JRqgAZjVjGMiPtNl0KhAweiayluIiS0dC9UnljkpnAuR0SXPCalQzhdqaGxsSKJQEhNaAp1MWCIMQMICTZNY09ZpPKYDRNJysaQpRgljahRtYW16fDficqtgVDCrIKag3GrLWn4XOIkQzL4w3es2FoNqKsybmQg/AiBweyqiJxivWhEYlh9dUnnyIhBCZp2FMEK+SgZCHCb3OhxTHVlwLslwnNCQJJ4sYQ8dLxIwRIV23ruttG2HgaYaD7CNEc2iiIoUVWRnHELSYnayTb6fmTu0/NqME+4ocZyZ4HiYAAw+rhM08ARZ55CMFJQIkLqXRALN5dK+Srrb/+1jEDYGPsQtcTDEzAeygq+j2Jlio/Mue+ZfhIgB42B42Rr0Mtj2uaOICXBGV8jOxyUmy0rD6faZiOuQkxgKSIcqYoHI7LzikEFJ9Z3XVbGira4gbVLLjxdyNEUI7IzDkU1Ud5s/JNDGlHmcRuulnL0sI46nlVppAAoCma3mXtl9zUZBBDhi8/zvPRJrS7jnyWwcqyXd64BYgE18STkcjBmC6pOdoZkOSAfWEQeXFGllaGyGLDVYWlxycLmwffFU2u3ckhAJmxUGXslFGc3ECIzHkbfLzwdej2U4jp747lYjSNeTvlJ2re9tQAgYgxniTMUUQgAAAAAACgdpNwxGDelS2CdASCaQJ+HInkIu3H8nhsKNAotFMQ4RCMQoUwmz/+1jEFoHOtP9hp6TTQcefbCD2GjAJA7EeZEo8VRy3RUsUUZOAukHkmowY50eamRfbmrVKwEq5qkQnRtRTiXQsLz1qtQIpXp8k8oS16fXfSt2/u09WYKlF2L9R0kpKwENmq9Z8LlNqhxA6IYlXFDmZAQ2tvLAOYKA2OVByVGk6krFR+I/YJ94JOA8wsEyh8hq4Cyacykw//j9U/LLratjKt0LSGyvWnmMmj5cPoESt5yGBWfQrDmyCtLzqsCD4lVXnNKOp39F6IQXkUO+WSLmlIAAAAAgewoy6kmRTJCKsB4KR+3kAQBUrNhCBsXwgBovWtkheibwrNJIXzJeRFsQ5B4Hp6uZMLwvstFJqB86KrSOXywTr2SPTJYY3rMxlEYz/+1jEKAGOVPlhJ7DN0bifrHWGGigeSNJUWebNvQo4NymoKk7J1M72inXPMLPgixMKguDr3P+cQTAABgOUlTlepTV5xuZVE6jvUVas4ExHrz+sZHp0Yn6dcpTPk8hRqGIi21jt1yV1TdJNEy8/Csup3Q6u19PfWHShaZPwZvt5C6BrWpJNA0q1KMInm4UdVlXOVuQZ49pY7kWfZ3MXAWI7l/Fw+bcpvQAAAAAAAgBIifmynW1scEdY0BFkJVTGf41G9kqEWBHNg+BwuryylbuXQWIx0tXD4uO1hWX6gQHKs9dWtPWVWYSrYmXnCQeRwGkLdG1+r2K4DIL4S5KkUEW9ZZEktTkRGPndjUPhv+VL/t7vVrrqr3+SPHkAQrCvFxf/+1jEPQHOXQVjp7DNwbif7FD2GbAH9VO+EiCiVJa5XRPSxF+ESwqMx/RLnqk1asE4lHxRi+9S0tVlRsxWfCauOOGR8HqGZr16p8Tz8YJARKHXguRJNyFmIJ6YlZ9JkTvyaaDSmhROSMIRWtLv0YerzLnfBjxOg0wz6CIA8gAAAAA4CivclbFgscBcmkDIOlaiMqdUz5dMbMHwjH8gpbwoJ8VkwdY+cnq74DqT8UHa90mKHW7uqILZc/hU4+ZRF+NXE9V9DWx3huy9BS7jeHy+FfEwVnVlOZ6YOy2LzF1rPk3es01jH6HJWcPBwqYt4weXPWUgIADAFOeygWcuTLpwSYUxYT4MpNopI0rlmIEWBmnbcxdCT0p1WrJ9zfLquk3/+1jEUgCO1QVjR7DRgckmLKj2GiNfaExhTJmDgSGNn4zmXX0UJzXNEZKZ0WfptEMw4wu5srTZVGMdm8yieNO3SvGZjxqjkILSMLg/dr1Z0f7///05LjMs1fggAAAAoGlmD22WZoXJ2hJhUKgyk4nldHPF2phBhQSpnLakRFtpQDl1a40eRvPHB2VvOENWfHkB8Uy06vPliQ65TVTY4Qj9COL8c3Xj9aGj3SkGAVUPNFyEY5FKAgt6IGeuNNZoLStaOejd32VA2MUHH/hoODyQAIA2QV1aq2rJzmPxNhuLBeYSwXWOwPGE3hKunilnXMGskckRlZ7c0aLAlwgdbbMYXIxeKp0C1pITjhtA9UgEphiJKhkm96UzqbmUcW0lcYL/+1jEYwGOmP1g57DTAcig7Cj0jqjLM32lmFkesvGWp7SFt53EEtav3foCK8gs2A2LNR1rHi3WAAAAAAACAOkLTlz+5RmMSGQvBGW8tO06ViSP3MRKH2RqQm7NFU1tDYKxCFi9TdhbvHJWOx3JMByc5BNID06qXYJccsdGS/oHpaOHVjhePIOkkLDhnxOSR/1DWKCohJUJrrzAhWOx2ZRBBjOIhYHCwRJJNp8i1EAABQD/DSGQKqFMztzQ5lsgiMpSpx9cMTAAALxIPjY/PX9fRicTVB0uTuUspUtLSOtqYNM0D0t1L+XY2iuzY8URoo5jxRAhJyRDAJUDgl6xF8nzpawsYbln2ohC5ly+nWJaxYfAEFgqfDqWfKAYUbyAAAD/+1jEdQGOvPVjrDDTAb+d7Hz2GXgAAAOBcUEyaqzwmRiRZZQFAzrCzO2wpS3EhLE4IAwjghNjZOwLKxTiSo4CWwwlqJC0tDqEw24ypJHrSEV8k14tbDzT4TTdJuU1JTuPR2jiZGCVV8fJpye2XJeFBEpjRbZda8mP///uBMkdg8ByJOtgOTArvlUHislWCWHCg7K5+GoMbE6Yrr1zwlCtSyqdW1T8WjQskxFGwRYDiB6qc9pGxH65q9H0CJZBiw6o76hh2bsQWaSPO1OLS97LTXd2u5arm0Yh32ol2IjqQ9m2ft/zDoYYntWqAAAADBeWZ8vlIx3cKjSUioaKKfWHbgTMWRsza5yEmIEQsRwr9YOzmx8lA2cwDMuI9WFlAQD/+1jEh4HN1N9lp6TRSaambKDDC4npKcE7lC1Y4a5U8P5erHFVG+jRqaosXqspbNXl/K1MWPss0sCM4IkidjZJG7nZQuhyDa5xeg6TPhGr7kpwABBZC4718hCOc3zUDKOZCUs5n7GWUo7L6CiSJL0oxo+AIbkwVD+S3mLLy8W7m41oy2uXHyEkbJ/s+WDhLiU79IPEjz0XKDE2AtKWpM04LMKzNoicigXNqD2kpFJ4xyt6K4y+5z3Od0FAN4ma5wa+tKp5AAAAAAADAHyqnFkhQYbPO3A4DMGFRNXGRLLJmQALCST0SqI484XIKhmsO6lkxOB4sLzfFLMS5hyj62n3kpKWCGiRtHdkOnNFoKinNTRt7Q1OoMZMww3WZgNvXw7/+1jEoIGONQFjJ7DRgcYfbDD2Glgi7NtQTqCI4ILLMP///yOt6tBABoBhjoNGK/X+825g9E4uVebh7OLm5uBsKQyUKbWSAYmmdKlmxJHzD72BSAx83U2EQlbLHDpDyG/R5koRDR1Eu2tbcmqLKGbxWEqxE5BI5Wkzl8sQQLh5NKd2o1krPtJArKbDegagUNl0hgz8TtbVOAAAAAAUCiNXGGtlYDniJ0KaSiUOZcMz5yUS0XQeLlnHEI2TLCoSiCx7zJVgwnk8EAPVIjglpKPEscCbhkwrYEd8+BqgjFU9B9Dw4fQy5yw29WExLwrrESOMkoHVCEPwJE+xBpuaGN0ly6qqV26XKRBcDlzAmRv6gwTTWAA3JQf41Ujsltz0YHH/+1jEtAGNuOFlp7DLycGf7HT0mmAT6AOs7VzBZlSqRzrBqR6MyvbDqZobCSAmGLJUTa7ZowUBYdkyXiQE4yJycgHDBcOF1GXicExkXmXVbXOoL8feTQkZWZQYxvDeq0jb6A403Ot84eloKJWsaitqqUc1VvNtZuni5j0IcHwqcIAAAAAAAgDc0LofeG5OxuRdyGKNxZLfdmOu1C7mUJWGHwGRsbjuViiTU1A6fLEEuMlJQ6WwHQL2fQkqY+ZJZiUkGlyaJ1oERKRkB0zqgeQkrapKZJTZMIYIYLSIoIxIkqXM8O9CRkSFlsTtQpNky4pH3N+qvaFUVISWltUgUo7c7yMQeABgSQsORzhPV4/vLB0jkpxDvd2howFwOJTImvr/+1jEygHPXPlhR7EzAeAhbBGHpWDYB0NRIBZMTBfVa2qVvlcwsYOE0s1Ja2iwf0aJe07ayw9EC4lkZQqgjJzUneF27aKyhgk5dOcHhbPoFxz0Cpc4gIq1itHS61L1PXsrclbBE2srRnQSHiQTkUodopXVDAAAAAggJqd45OTmgmFfCXFxA4CYMKnIVpDVUtA2Hygc22pmKFRPBJ4JNMiweRGC0spSAQ068vnJCdK7rZkLApI5PGg4Q0NU4IRcEY4NYHeMlqfEVDR6qChRGZjFZmL2TxlzOXPoCDBE8dqZWUodfai5l0uxMiQcYhWUVcFUiiTJXa3aUZc1yAk1E7sqziOnXh+TEAH0Gosrp4LoqDVE8aaSw6M0Jzh0PRyAyHL/+1jE1gGQhQ9frDEwwegf7CTMMQDMJybB6cjyQa4BU7aaOz41LX8OggLTssE54rt3Rk+haK4/CW7zl1LDb610yTm6lg689PGrxOSsiUQOqBfUdWrI83AYYLIk6onxCIIbJhf7lhYePFn9laogAAAADBcJoCVNEK6QiosCeqU1ly1lPx1G+VS8HJRJw7xmxZdJQ5A3QjnDEt1hlJCPYGyKrQk6ATshSOQLikpTkk4s3ycotlR/Dk/WLW4z9qVbpw3R98lQKbHShDVtfAsxh95NRPAugibh9cyvraxxVU9TRRECIhqMZ//+G0AgOtMEVjbKyoxPkiLEK01yujIlVI7DWLkEZL+hJdFRpTqmJSMK2FhUQS6OagSYB4igLMtrjEX/+1jE3AGQ8S9fJ7C1We6hK9WGGjKwDyySVZyfnoxqmTB0TQNHCouIaIvUHJQwj8uGRsgvKiGfg0PjVxvzr7vURkpY4hq4ldC0eVNqbZpFuk99ihlM6882jtL+PKUdwcoWBAAAABAJXCCroypQtuY1O8JO3qdtjqqErqkqI2gFdZEwzLZG9cm4oYu0uSKvBCYSGJisgLHhCRriIiCoje5JGVVWswiF3EJVZRNeZARmxYDowmeDrBS+TAJogxEzkivFDiCX1AxRp5Mci0pGlOaShSYhMNEZYZd3TEwAAAADBdiLLWWCZQe+7a0chIAEzz7HaTg4zwbi4qMtiUGC5l8drKpXZYjUJ8Lgzn42rhmiuKEnIO4fkBykfl8ZDHeuZVH/+1jE34GPoPlhJOGIigYhq9iXsLDOeacPSE8Ua4fgWWXUFZKFlQwyFCpQjYYRy0BGtgAcRNjhGNYyoDRCZlzJGlKEC8EpEUVFzeMNMPmUGUDGiohSnCovcd31P5xlAkqYAAAAAAACgNeTHXtfwjVuUU74EAks0GTCFDW9u1ylz5GCaSmq8a2mxpEbnYGRcPmZhTl4TCdsFyULU9a72kiIXuQqnyRAtAoIRGpAphM6kaFAmvFG23FBNd4iMvmosipFyEyGXY72Rp87qSKM8k7ZdGaaaUxRQh0Gu+u//1ZchOAAGEBrebtB92WsNjdaKCjk2UzmDwBKoRHpozaQFFOBwtjmW1gsThwGNs/VO5omFY2WJUCRn6eRyN0WV+rlAkz/+1jE5YCPRP1jR6TUwkGh67GHpXmEEKLE3l9yrTrOc6Dyeo8tIDksqo+3CaC8qywmpLp1mcHjG0tSsZnrCeJpLKplDCeBAy1BowJBSDq5xEckQtFYNvXNO6ndCb3E9kLe7eWTnargAAAACBYFQRtn8u8jOq8bJBOObaaSazEcWdthHol1OtNjrSIYmQ7m9kUTZLErNDeuyQvml6qKbhamVEwmIguTqrmUPEa7QfO2ysmK4oFCGKtraiWYtg1IxFRChJoSXV1Ziq80sbRaj3X3iSSdLKWnlu17Sdnh61ZgAAEAajUPFNt0BVtSIHKBJF1F+V6mT6KVqsRJbTQNFHvFFdZCD9U5JH4uGKVUdk86HIDY4jxhRGvBIVwUfKqwmLD/+1jE5YGP9QNhrD0rikOha7GHpfk9Uojt42AxcgHBOGFXiDAfbRDyy4ATg3BEsFSe3wPRIDxEoCYrDgBcg2+ZaY+hay5c8xMiXUYN/FXW+6RD057mm4wQAABAhIECgsNnBMXggK8ESM9SxEKOlNOKXIsG0JQ9jnUSpkUp9qxDWRTNMjiklUzojKGFEj3S0TZJHqs4VhDBQfTApk4biUWSerFZz8TZTL59pw6dibCh6jNB8fKwUGRWc8lkhYhFsgOOK6MuKmzZJpwufKqHdg4fu3CrRlqtHj/PUws4mIkirfNbk2WvQDBTGmlm9iJwOxYenYzg/DyPwkCVO5xYMn4jgWmU2huJi+oWhpYVNK7Tq7dJpTzq1MHGHW4K1tPVnxn/+1jE4oGO/QVjLD0rkhChK/T2JlgYjjkSR/5GHK0uIQlMljfHmBQ9xqBE0Tm1wqcxAYES4lISBCKAwZfEkEhIRkKB+yqrTQs+UMaOM755VZjGYjomXxrALWgU0R6aCAAABMoJ1hCS9E1RiiPQIYIBcTxRFynhqpwPJENBeVQ2qpknIo4zfyrOzbEAkP8hA3MQ6HcXLCmciWQTIQNPT5e4JZXJBWNi0TyoqSvHsR2rUtn7NCsaNUXIztEQ1xVQfWsSmXolonvOIlahP7TZ4dlTXly2jLThK2jBbnEjkqKkHaWmrfrACAMLc8ULCuHqsbR9jkB4I0vBIap/8WtIIekwzOGlodj1QyCMuoiwhnVxDaPRx8D76m8R5GeDoIS0Fjz/+1jE6gGRqQdcxj2JyhEiK+T2JwB1AJaEamAoOREMxxNDxKcHpgyy4qb6BUiMkAKniNSmkcFNI21BP2zCBhlVrp7NKKhGzGbaZlKetXv1TxmwFltKsyDSpqpAAABBhCNK6AeDMh8Eko3wGiCc6ZIerT+bkIRon43h/D1JVuO41O3J1ww1xD/iRC5LCw1J1W7ORnUbgN0RRFRGg+nRVK5ikLBZO1CIewRKJ2gCs7ZO0zzqJyj3olxqpNzLzP0MktOssie2wuXtkx5tWuyMsr8O44WKwJ9EHOm1JRKMlYIEH3g1YBBDqyuEVq+Ea7Fm4EyHPa07Nx/mXXHqaQueILjbs/ksttJe2Xs0eoysqMU52WYCQXxpFLpy4aHR2lOD6w7/+1jE5oGQwQtfB7DVSgEhq9z2JfCFzUA2ApQuKhdkGBJJso+yo+5FSgkQO7x80FzRZdEnqghEFpxIENtjbc4ouwpC5pOYvLL3aTn/ZEpNFBbEN9f1//7Tkx8BB4Bu0PDghkwPFhUTKB9FXv5ELjeW4ci98gSYABA6P5yGYiHMZKBoPgkCHdSpLZbKqkKT48fEsKWTNaJQTgwFr5GHdGAonLEtSpZkcbNQMrTc78ftLBwYLlepl6GZ1MTyNk1jJqhdA/dGW69A8jiX5Wh9VKsIDi5bBqI4iJXUsu+N+C248H8bQgaGF+BpbX1KYYhmieMvuR5cKHaaGWfx1MszWPkvr2zixmAZEFgOdJMDcp7OKdiMirZDjUyccCSIxogVWV3/+1jE6IHQ/Q1cx7DYwgwla+GGJpAvSToYwH+uIavtydpSC8s33jeC8h3YJ2Nooxx1HHUxTuLS5wdR8xEh3FLDjgcgQoEBklHbvDHGCk7wqFlnFbDrJ1xOX/87QdpwAAAAABAI+5krf3CFYQPHYYHFjZGaMKguOyyKwuCGDI3olvVTssjMitsilj8sWEw5M1poTiJw/BwHNBKILxFP158wwdjrc9WD+ORePHSyHSkWE48/3GTMlcyWh9fagWqBBL5wc2P0bT69pY2pfRu2O2EiG6jQmLnsvrH3YoDhgwOxzMrhIg1bpzIq/6/1Lzld18AAUA9gaiE4jZZGVzPtWAjiFloorHe8yaiBTpklOiHURdF9SkJelAdtgQnAeEoVOGP/+1jE6IORRRlaJmGI0g4ha4mHmfnbgeGdJlGiVQKwMEJK4L0FSESTVZak0iNRRn/0i6rSsCacWot2kuwhNtKnmjvV+PQH0tTS1fzSUklXehqYWTZOSZ/n/8IHV8CMgAAAAAACAGFDC4LpnSet1InKGzTZMhwmX2IteisCt9dh58lnuHXjANQEoNvEITtcwoIwiXGwPB0+AUSGA9AIMqkoLDAHCZsSoIiIH2geIQ4ES7KSowyyWZUSMkGBBSEoA4sKsmSSBhUrcpMK2yGwWGNSTInmyhg/SIKvy+YxYK0Qknt/7kNgEBghKDhzOTPpgQ9nDHDBSNUw1Hq0QDJcwNdQK8k1I42RJCWEC4SyUnOlQXlddi507WE0My1ChFJ43XL/+1jE5wGSPTFdTDEVSeSl7Gj0jqkd0FYWHCbJdNyoOEBYO6H3PJIEIl8+JECVJ6FUjpIKBePIq6JrSQOecaNk2ndJEspAvnGPUHuFgVMTvscZAAMGStel8bkDpvwv1/BEEsFIDt/DlOerhprOVDhpniL1dnWPcUpWP1ccoxjKME7FQfrGh6lSBzKYoSSoWaTgK8XNCVIrG9HtxzNsFKGIg35yjvZUUhrAhTecMd+/MR6eA5CuOBEiD4LbslGg8pjsfUJaVcPlqM7ucKmzsXIly8tGF7G0nSEeK0OpLYRnSJOfXbeOHajRD9eBiMjPXQAgDGyYcaaTijfrsv5noFwZLQ10h1DOG/opVYrpoJ2jKFBQXE6xQuQkJzIGQ2IESxb/+1jE5wGRBQdhrCTTCd+grBj2GmBsMjYmbNOGiAbMqm1DNsQs4pNPAtn5NYhSQSQJJE8Bhx6SBsJukYbE3LPuN80zYhJDRG3E3Gt1mTIH+gCSdSAAAAAAFAYjxwoNqZkXC0JgB3bS7plMPyVLhIF9DoL4ZSjTEYuC85RV2WTWr36oKtCD9VOQKBMTDIqFsmlQnNH4Nh7aEkQS8sIKAcqXgIbFSQ0hMMmicqcGx9AMGkOAsjbPC4VSD6FESNlDqwrWVURnhUibQm1UUVUNIUdqKkzTTabKVLz2HSaYCf3hk8eUgGCenan8VOLa7iCPGCoB1sZpwDDYckYRIQkeZe0Yr4TpGQCYAgP0ZbBs6JxKdHgcxmYD8JwuIV1JO14gFlD/+1jE7IGTmRFaTD2Nybqg7Jz0mliRoLJ+ZIIubpcsFhesbNmGDE/Spn/RH8Fjhh4knrDRzyY4pShZXVNbY9kK6F9jaRt6stCwSyQnCPVbGN0KTP+FjxggDmMSQAAAAIAsDNOmobFonRZkI6N5WXSm05zvR116dg4hCnmya5d6ehwmEoViAU0SkOUq5SbkglCgngQdWKSrDdbGRgQiKx7FEWi48fHKEVEMyQ2HaYwlVFbTRtQpWPNnOJC4ib6p/y652aNxmC9xQsjcihOisztGjhKdP376bV2u0Zojmng3/2ZjJAwKtkbXKZdnOplt8O08GBhcCcHQfxoOQIQRkJ4PCSVKdVA1MBADFADAPC4S14dF1xWIQdLDQmrTEyPy4d3/+1jE7AGR3RFfR7E2Qg8nbBj2DnJ0Ji2TTQkiKTCUoHApmg5HTcaQyu4VCQZgqIwuZVE7EoKkpYViYaIi4VaVG7cjkURSsVKoEnw6FRtEXehlm4pjRla4K0DuziJRJdUIAABA2PjKEydmQ6jygAfAAEonrVBWJQ6ktMD44gZdVltAPigTkIQDsdT9svipZKwfySbUUNnrcT3mhmd2ZWrjl1Qhn522bqffsuhied+yRCbJCxaA9AwSINmHJpBSWIcsqiCRjjzNnkTSp7Woa5P0YVc13jgTDC3HYfrQXUeJ+JlQYlytR7Y9IoYqvmqaWuO0IIM5cBPZmdT16W9jUJbAdaNazoUZdWsng7RPR/nmoUt0ii2FUEILojCqud8E1EL/+1jE6AGRAQ1e5mGHShyhq8j2JmAqZKfXbGWNhUqTholEMiU7aSxFLD8JaJUA6QD2GhdNjFI0vHstt9crWXmEC5ktpjo/fOVMbq+tKuJUNp5bMEOUY5v7MjKI150SqgADCmkeNeUSOemo8sGML7chZgK5nOxxNYekdITZro1ASF+6resoyzlV8qtZUYulOuhMXhO1GlnTE4QDDhbMNFsUrIvsCpbxpCPiMhJRC/V0IWGXogkjc4amiIDhQqqSFzo2wJFHNiuTZomPvS7DZO9pRAvMk9+yKbKcnzk7XUQMyjv/DxFtegAUBEj+TqkeSNCUkdDLV6M1pIwrHKzFEqhCimb5cHS47o1Q1KU8BTIYpliEfKqUBe08wvFO4N5GLoz/+1jE5YGOwQlixhh8Ukyiq0mHsmDwnJA80SioYkbLQFwYczbRIfbuSahIycZIyXFitFCYclN5NtcmgBI2E4jXzoKP6NbRgyi86WpHrhp1HjlnRtWgAAAADBeMgl71zEP07zxuJCp4Las/LSH0a1Ls2dMjT+HIfhOK6kahLfhBIviTGdg6bEwdh+HQijUJAejckLCqVzwBBCPgNYWml5IM/FKdBN1o9sMQIkKAeCCwNkmxDbypgkTFjQqHImTa4eSmTLD6aNU9J8WyuzgjJkbmIEV0oyiirJjxeFi6TiMsG00u4nA/ssgiv2HIfWQS5TzXRJ4Ndx/mzvCo60kEYPcHSo2NPUcjBZxlKBdmqulMlDtiltahBpTPY3jJEUlyXqr/+1jE5gGQxQteTD0ryeQgLGj0mxAbyGI5Kw8qJne7HMiD2XOsVU6AT0EzQj07AgXV7CEJJk46J77aQsrUYpLsZbapFc7yUEroza+ni9dVzGHOWQXObTdALrkMHrLA1RrVkAAAAKA7z+y+bj1DWg350kGr6KwzNyihqbpI0sI2FWCLQzECgTIFADBYGuWIJisiGYDwLmQfhRREiQilVCG2XicRQEh9eKUYragHJI12Yn4NTQvTAWXPVDIWkWRouQK7KUyRJW6j+r4ia3Pw7fenrOuqfyqWJAgBAIYe6ISyGpNSOXSxVaYeMqRfIcx6Lyoi7i1F7A4C4koTzGsRGJ4k1Sex5lxRTUdSFMyEGqb5dkqrHcOAr1Un1Ukj3bnDRkL/+1jE64GRrQtfLDExQieha0GHsiCVYJIwIDQ5qvTXuepTgpCQdFyJgqG0ZzcswnC5CcH5l4UieW1Tao8QFC8lmLKwxMVq095IkLRIa6lj6N9FDWjnojxaQz7eI4z+1RgAAAAAAAKAe6FFxgOKkOlsTyhKkBHRx/KdOLg4m5KHIXwQxAP25pRDqOhYXjqWiogOEg4HcuGROEYJhupWnkZWAcbEgDnnLqkBMQFzY4iEDADgMQQsgFIUFJU4iYJw+wkKSHR8wZ3aRxVZgJG0u9p4nc14RyEX5Z6ylMaylTXx+wzGb+wn7//vXNJzpBMAIBKlLOEV4s4fn+9FrPw95l9PzI6Afgi4bIJgWTtSV/KycJ9RsLTNM3EdEM6qaLS+veT/+1jE5QCOuQNi7CTTAkohK52HsXmF0sFZa+oMmKL7ULMMK5JzLCQ/sX3jVeeXBBIFlKyLwJT2LBcQC8QxKQkLYwgcQZAq8/cnjGzC4uu2G6oQfsIGmsQAAARTppstd1sVSbh1rDSXRKHn6UQ4HdirHgizuC0kNGOSoa50EIHE/SA5GIh7CnnFCzeHYRZdCwkRkpWOBkWA9YD8vlgvn5YqZg8E7B8SxSDVtWuQkS3T8SXlCxFZePaUQWTJXHiWBCM13KlJZILrJeOkQ1kQ1XbEfwrUCqKIwfocPpIcdvGmUNxvQA6NLuxlEAQNRxsyshQnFtZnwSQFMrlSoUOOc/HjcxnoG2axsqBQLD5iXlFIXPqyhEMRVjh6qfJVB7Ojkrv/+1jE5gGRoS9hp7EyidOh7Gj2GijhyWRFhffYOy0OatJHy4vDDDrttY9VSPamKGAlnK5la24f2Sssld4ztsLl7ri8erlELFmkiabuH8IoLcn3mAhxDTQD6bQAAAAMINS6ht56tK8kLjEeKtHaZUuhqlVhK2BQLpkoTdCz6N9In3HL0dJmqs6+1UdJ4/kfCYkwqkaqlwqWNWLkgfKQ6Rngdvm5OAm8WU8rXUzKxf7Zfss9lcLlJQPS2hnBjEwcK7IisqJhbHsv0ZP72XUvY2WuVjPPXPL1NfhhYb9C17OlzL3+nAIFCeM5wKdsQaoUC5JUEDQp4XQ4FIXZSmBQ3SLDwTI8XsIpToIGXE77gSVDgOKEOK5aPxiWXyadlsejESz/+1jE6oGSTQ9dDD2LQe6g7Bj2DqjQkGBLOnVqZeLBLIQBzA8VbVp8ulxhQbWKrZcJxYHkektHSAYHhaTKS2n48rcwPTZMeo2WxzTKS3qh2kPqVpxh1D6IMhjLbTAqUu8xEAAAYQkBGVzXpsZ5lUSgXMhEY/KRkVzAmEQcBwAafg1NxQB4wf0zgVuiUr8gsGxHM7GhaYQ0RJPCOKpDIgipA0vEdBIF2RUcMNCYohSQkSy1yc8sSlxzEVB9EZbYUejHtLHu3UnMyt3gtVxhUCK0puUivBCgi0rRh4tIARuktv0UfjchgeJ0AqptW/WXDi7Tg8jdKIGMY4mLGyH0m2ZtPk0B/NxOUk+gp8/zzNFCk+dRbm5pNEg54pYu6Fn+XJ3/+1jE6QGRMRNfLD2LgiWh69j2GqizIbGG+XFjVSsQlOv8v0A6NOmFBYs4jJIHhGwcG10RKQnAoGiywlSCJMKULxoIEiAzaZsNxTppAnckyAiIGdnUyyhaOJTxORVW/u3eXqrlAAAAABQD7NeOxRoLx69nFcOQSzTrvDq6hloAEAg+ZRhYdCM6IShctjiPTFBSmg7Dw6rs8YsL7TVAZCZrjTSkSBRBqBciJ9090tR5CRR6aNUREOemHQOmUJJqJSmE8TnJTseUcYTlkH2SBIVKBscO/NQ4EBAAYPg6nacbGe7Oo9iMwCg6L6LosKqR3q3V7lrWQLccd/LUtao5DWYZUDH8aQ/Fw+i0RwPC8VgCiMOx0Yno8DYOwPAWB8dWh6P/+1jE5QGPRQVix7Ergkgia6GHpbnnT4HqjgJQMg7EloJi2TARVk4RTSqy9UR6TSwW7nbQTLlZyAxeOpVEuHyEevr/PSumODwfX/OD0qqki48Xc8VFKIjHrK1a/CwiSM5P7TJnMl2bN7EbDAQAAAAQBO3jwlpJp5bVhfR3jaRhPiw5U6IONpHQxi/VFlw2h9jA/A1CsyKSg9EAqhUSiSgxFVMVwEoBELkZKQLpHhFMD52hqLDrD9CdfLCVay6cr03k1JlkVgmuWCgy+jC7ajskTceYeCNnCRfWWFZvce1BRfSqr2FGEcMljpyl/d7ishNIAAAAAAAoB+igP4+5YMCjpcRT9R8NPRj2UCQYibmm1jhY9o0yooH4K0oocnjOK7D/+1jE5ACOXPVnR7ErgnymK2T8MSk4lk3IZus9asgeTCdrG2HB4+IIoWm8bbI4mxWYVaZUgfe1k4MIkI1fXaXZsSEalQeljFuI0jPgc57FIdJrUkKYBC5UGCTnfFUiFFUxEAAAAAEDwxScIGA0sVprnvGXEO6yhi6Uza2CAHmIwcKtV/nZTuGAgCY046scSKD4h1csyoRjyhDmcmBD9eVDIzODc5JvoOFIsuRsURLWoYbwogeVdA7MDmNAEsiBkYIJDaFueUPT1aWXRBJQtHCkmk0Ki6ROGoWu1trweA2vHZs+Ix8Yk1VFTZgsaiEchl3FMIdlAXskily5Ey8kPvPGYaiqKTtPNAm4jKJC/S5n7hphDqOXLMHQsEMhnpKIrAz/+1jE4ICQwQ1hR7EzCeifbLz2JlCHs8ifL7AfOiccExU4hGKourTE4MIrlQyIA86cFyB1DfiOyvCsNIiPCPtVJkfKTGlI1jRIXFl7FjrpFik+cPIpbXIT2u+CRvuGCiqMgAAAAAGC0x43X9YW5tgOR3KRTJV6p29vW1Qsk0DDFQdL6VWpGVzwiBOhFk+8rQuNLjspkErWJgkoaMlmhbJh0V2LvzMTqJ1jnXWUy14UtnsydEZU4fvtvKHzs/tU9fOXDjGspsC5h27Xvnhj3482dTt9rFfWXgqhhAFfVaaABE1+Oy1vU/M4y+BE7mAL8hx9IRGWft0p3HETQbAcieUa8fyrR5LzwUJVD9QbC4KxUTMpCaBstLjlpyE9IjlToFj/+1jE5YHPaP1jh7DTAjuiK5TMMTjZYOB6tEN8fhUsQkY/+OHFUrrDYwERmNjh5DtAEkuHSc/JuEyxwJLrbZglLRZd+EnlqkVdWVhe3shy8uVmWte68TQDNjOm26pAAABhEULmvdVNyyrCbjsJo4mSa1GwvpqrS6KUCSZS4tBIx2ucI3TdkV5KTodxFK1P3ND0EMtjjSxkudBgJZKJxqHiCPC89MzHmWXi7hVVKES+kLI7PrH3iiu9taZnsozkyoT1KZhdh4kPkNHHiqHoA9XWXFk+/IAyjzYuTyq0D6oSOY5uKPeuiAEAOhVQGGK27ckMRhADhYmdndp85ZUIYBhF0VFrvg9Kai4JjaFM0RQJ/AMgIUMUdWE14QsihbD8kaL/+1jE5YHPrQNjjD2Dwieh69GHshBUiWEQXJcmp5GUbRItg0Ro8NJRw6Sog/eLsjRpQ7wTocSV+URKOSJWkkupQNLkQyx63uVyce19IAAABEq1rPLGJTWlbXnFdNrQs2rAFPFGbNFfd2G+ZyIEJAQ+8EAJDDY3uZNSUqxNJxPrLYOMvLEK+XMna5kT6UT46gYRC24OCaTRU+STMwEg6ZfOkNOXh9ZYC8iFQfh/B919MOJ4YIgbjyUR7SoiQ8WJG/pOBod+XVRKK7p4ICGyiXD7ATy0WFqU2fpG0oLiVdi5d+Xy+R7zHWqFCAAwZ1idBrh5lEUO4dp9M71hU6ta36rIQLiXwUEOMbCZdZTzIkFAaGzYaBfmYIyVcCZKkBQMk3f/+1jE5wCQ+Q9ex7DYwcefLJz0mmDJgQrldUVVFDZly7ipgmtJYHVAbIgQSg9SkhJNGRnF2WV0ZxzyctFkQq2w8lAe1mcpY0w1UGLmkBl3Mf/72kAAJgxV0YZmqGIvJJ19sBVe8+cgdqA18sZkzjjhg2BepxIJo2MqFmVghIsxKo5d1yZJGUORDSK+Qgwal+yrDjZCXuKKMlIp5Fj6N3SyiH8mph0RENO8jL62FEILxVJQiGa+AgyW3DlCsVBHbZXGRsYC9s7Pi66fxsE8mpXLIzlOWmUUTq08ggheZ+utrwaBB6N495RUABAAAQBIELHE8edjZVWmTuPt+tzJSc3XA9IAVjq2yvOCqXzoh8FRsmbislsXy2H58cPtrPaLiND/+1jE74GTcR9bDD2SidiebHD0mqEdKmqN9HZ+jg6VZQ8PrlltRVVK9mt5YpA9JUgayCFR84X6JEWJbFFCdMWsokeTMOMStJGKakqM4ZE72eDxKmogAAAADB6Yy7pZidNlSDGUq2RII4badM1CEYJUDRGYtO0A+OExLHFYA01OQbJlg6tpw5PCqYmZYOUY6DiqSjq+KC9S7cJlGsLA4HjhTLDy61BOQ2FrSyIezA8gKoh+SDLiXVmFKqWH6dCRjs+mSW8urTy7OOLID08pR1nsLRhIis7bSEygovmyNpgAEAbzgVqM0tUcKnAAyGgX1XpBV4iF0U5LiMAqSDNYcqTgOlBdHA0Ml5+JRjpKHlgyHVk3EdSODZKL5VBshLju4pT/+1jE7ACSgQ1arD2REd0hLHT2GfimJdJp5XB2SqyxDcwVwIzVrkEW1HBJhIyhFSpggPtHDWgsXKJgjkkZ7qviighUkuSTiVlVVW6iyT6tPJVgoKnmJmAAAAAIEgcNy9v0nY6DvV4H4WBGH4wpwgI3nZ7gSAWQ9KAnXWGAgI8oowUoqTeJ2zmUhJxKIlrmryRqRtfl4cjvYOjYFiqeG8aaNeZG4L4TCc2DYcTA3OhkPli2vK7w8n/Z8IVHyYyaK0JzGTR4TCiQ6vrnHWhUTpEM0ER9CUFwPsgRJ02s98Ure7M3pm4vU1LxAAFAPQN8u6heMb5rgM45WV7BXKPVpmCsShrDwcRemLRklMIx9Wp0ahBPHyaxxyOIMGLOGjKg+OL/+1jE64GRJQ9dJ7DRwg6hq6j2JiilocR6JTxu828+hKrrKk1VAvgKTT2MGT/QQJ3yaibOX1jDUaWFONwLVij2JWHJg0YThNWRpGLA83Sm90gKx/xEUe1FNAAAAAABAwi5GU6U+l9kikwS6gGKgmhHl+F2GmlxfjmE0H+ZL9QLgFKB2HcKicYlUuoQhh6aieTRiIYIk4TwhUHZeB0incKU6Ep91UTy0eFy5iWWYXy48dRqE3j6vXEZaOpXNhOMap9iLWrJQFk6AzFoFskgRGCkzTTzeDtJxqSCJ0yjZqyYlAq+q+NQ29tDKbVNN01t6xwryMLkjkZ12haPJoIWJ87Rm25cnPChlzJptXMTyCu1apGG7odzUroSTVMItlcnkc7/+1jE6oGSHRdXJ7E4ge8hK7T2GfiUHCtxEVhZwNV2V+6+hMLb6GPzJdvEfNkw2hPzpx94xeyBnFhlazao+p6pqLdqx9H5T+mSu+wzTaNbiqGIHAYJeDJ549I0AAAAAAACAF4PUSRNzjCVsPGFOlEar0IR5rnIStACPJRgbHTMhc6NSaFpZVLhfZnA91OCowAcqbPSItDAEzCIKtFixYnWIkjQHE6pIQpLD+CpnjTTKNRC4jmTqIwyTyg2mgRHjckxxFDkcOwZJjJYwvJC31SlbBJ9IPOpS7adi8Tgq0MEOWmRTObtTXVZzC7FAgk+XsxS/B/m4gTifCclYsRloVnkZitqMFCE0OLagJXAbqgFlcKXCijEkxEg9LSMsnZNNzn/+1jE6YHRiQtXh7DTQgKhqtWHsXI4RwIUY4Ph8NFVwRGhCQmyEPunZE2ITjQFHGoYtAlEt48PuGBU3xK5OZ1lE3GRbRQi0yykjuomJfV8Rvph5vnwIbpAAABgLMJaAiHZvnInkKFxXY+CXhZvU25EFP46QCEHST9AM5jpMWE8am6ih6yVDIRSiufiVKVeVC2AQyNzYnETy+Gg7B0PpkmMvCVgcRIFS8ehKTFpo4TphUQimTw+w7TRXUoZV4xSUHYoIJwvXkgBhMgQubISaKU34lIkaYIiq9IhLdPSSQxOsKETIUaP5pBY2oQoACAE0oJjxoeh6Pl8ahwoh4VFTI5EpcuBYJUxmiLpgnejRBoHwEPrESWLtB8NDrMUxNcmkFv/+1jE6IGQaQ1Vpj0rQhEiKgj2JlibInk2tE80iYmaJlWKXnaFNyESkTePJ5R/WKGWKZ6hUaxogKJFHTUAtw2zJtQnTvRJ81ywVCh9pL4FYupAAABArjplVrCpVmVcnVVKj+nlwihoseasssFFSOe6rDT9V5JTy10pFZhp+q1HHlTdruyvqD5M60UedxaDSqQGQpH0/LwlFcdUJKYGSrLklIPRqmLpNLoinglH4hI10Cq56TQmwhG9lq2ISrJkNM2tLxajdaat5JYaVSSWVJ0fa7MFK49ckt+lsm7POhPSfHlAZk6yKo/Ws9AkSHo1fISdz8/TOPJWqknxYm00V9U7TrgnlddOxrLk6UkXJjQklRhJtFKMuMymc2QV0vAao8z/+1jE6gGSSQlIx7E2wcggaXTEmmjpowxZglIhOvy59SHRZOhKJz5jRd50qOWEZJLgVDiPI4C4kuWhEkvJF5NTP0XVgWwLlz5imRsmSHFZHK4MiDALSKNQFhUJWUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1jE7QHRlQc4x+GPCiUhI4D2G1BVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU="
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
