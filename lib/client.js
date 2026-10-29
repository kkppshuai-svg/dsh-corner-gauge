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
		#${id} .g-logo-text {
		  display: none;
		  width: 100%; height: 100%;
		  align-items: center; justify-content: center;
		  font: 700 17px/1 Rajdhani, system-ui, sans-serif;
		  letter-spacing: .10em; padding-left: .10em;
		  filter: drop-shadow(0 1px 2px rgba(0,0,0,.85));
		}
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

		    const logoText = document.createElement('span');
		    logoText.className = 'g-logo-text';
		    logo.appendChild(logoText);

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

		  /* 品牌色注入面板（顶部饰条、进度线都跟着变） */
		  if (def.accent) root.style.setProperty('--g-accent', def.accent);
		  if (def.accent2) root.style.setProperty('--g-accent-2', def.accent2);

		  const img = logo.querySelector('.g-logo-img');
		  const txt = logo.querySelector('.g-logo-text');
		  if (!img || !txt) return;

		  logo.classList.remove('g-metal');
		  logo.style.maskImage = '';
		  logo.style.webkitMaskImage = '';
		  img.style.display = 'none';
		  txt.style.display = 'none';

		  if (def.text) {
		    /* 文字标：车队缩写 */
		    txt.textContent = def.text;
		    txt.style.display = 'flex';
		    txt.style.color = def.accent2 || def.accent || '#fff';
		    return;
		  }

		  if (def.metal) {
		    /* 单色标：图形当蒙版，填充镀铬渐变 */
		    logo.classList.add('g-metal');
		    logo.style.maskImage = `url("${def.src}")`;
		    logo.style.webkitMaskImage = `url("${def.src}")`;
		    return;
		  }

		  /* 多色标：原图直出 */
		  img.style.display = 'block';
		  if (img.getAttribute('src') !== def.src) img.src = def.src;
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
		  "id": "mclaren-f1",
		  "name": "McLaren F1 · 2024",
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
		 },
		 {
		  "id": "bmw-m4-gt3",
		  "name": "BMW M4 GT3 · 赛车涂装",
		  "kind": "alpha",
		  "sound": "engine-m4",
		  "brand": "bmw-m",
		  "engine": {
		   "revScale": 1.06,
		   "roar": 1.12
		  },
		  "src": "data:image/webp;base64,UklGRq5tAABXRUJQVlA4WAoAAAAQAAAALwIAoQAAQUxQSN0KAAABBm/Utqtyom3bXOWapOIepAVJgmvSECiCa0LjRJDGSXDrxt3dQru7GzHc6eCQ5qIDTXA6ScW15o+qFFmrKmutmpedMyImAETR9j5IUI56guucjkIicSc/ntd9whsTbY3LNdedmcaPF4c6+PIwGbXSNG7ssCvPTbYXYFYL8hJFoXY+PIwBBCCblvMUHmOOP41/jbFQqMScRq48DIBB8hmPsT0+uD1NhwCmbLBQa108XSnVqRVyBQINI2fEkc4evAzoggfYTmnmmOXf3M//6pdfD2fQI8cAIDMjDeDwbxmHgYojw3rreRiDPN/D9ptTBHUvjoxa/CoPA8PUa3bEqjgyfE04/2JQ8LdYvBuzqYU1uVJFJVKGF4Fu7AURL2JkCAKQ6TUqrYuhkxLZLJGpNTq1lJFQCgzwiubpWMSzLvNzRQDM643kFqp2MTBg6NhxE5PnLpg9IS5xAoV4OjrG6Onr51u7n4+uHut5WjST2CLRe1h3px6UursZPCg1vLptfK+OwYpel3Adb9y739bdc3p7untYVdY3vp9j0UwplyEApYte622cs23ri2/ClkeXnMFc3b5lq+XO0V5avSXUF20zRTFGIlMoqbFvk+ZhcRtXL/0YO9ZbC1dbznVVqiilcocXcVzsYiRSUDdsP3Bc0pxi7OBXLVxM6fLhPkhKKXVc8vexyKUIiZ0/dVeN2RI7erP1tAmz6JzxjqvzaTFK2z850kIb0G5wZnFZRXkVrldryisAHiVOojNUDqnDSfFJF70k0YAgIW7EzSfP86txfW0qpEXJoyf7IQDGseysFJ9Apdf690h4Bk9xvZ/37J81A+JCkUNtdw6LOwwCYF5I+6px6tWch5gn5t17uMaxRPwh5rhIAcK7aBBji++h5KVHL2Y/wrzy8QyHsrdQzAFo2ebjm1uCUK3awB2p5id5mH8+eLNtp+DaGDtrcx077nkCqEXot1n4wWfdrfm2fu9HzFerT5z+aTOClu3bRboiO+9xy3ElIaEb1HJZ2kmcmzmhdUOLxu0/ycQ8d+lbaUfhVIR7q9beCICxE83m547q+8VIwDIIZE3affA7htxvY0MVCABaL/4yA/PkL1JS01K6o0bITiNzsWPOXxeChCuDQB1k/OF3DPDLEDUCABrYLRPz7L+SD/g0CLGLwfe4dJ1yxXTi8HokaHUegz5Nx5beSAYRE2LmfHwK8++KQx+9p/f1D5JyjC58yqGr0XC2ihNPNoToDUJGrxlz8BS2Ps0wNvoq5vFJew9+0M5Vy6kOzzFXa3Kv9ECwqIgD+dlzpEjIaumkTVewjetMmPd/s21mZ3+tkjNxT7lSc2ZAFAL5I8x+0apGSLAyCFRM0tIcLEAvLRqC1FTFicnPOGI+F4EsRxewlrfKBQlNxgojk6qbSiVz4TkWqH8mv7l0rgR0wLDU6BnmZvWpSGQp6fKQrfIgJDx9NRYvvZW0pjoZSrGgpUn9zS38VexMNHFkM6p97BOWGiAByqDWk6cl7quEKlwJWOBWluOy0ikyVhIKuHG0gw2v/M1CkTEoWCJEoFNGUTEtx8K5aMuwzioETJ0wTR9gbqa3tkE2yVRXdGYTCRKi3lFpD6uwwC5+9vC9mE6oTiVvVHAko40NoG42ejKFHhDdo0s3SiM6d+naoW2rUNqhkU6FBKh/9MkcLMjLcn/p1rouYEIZV9raAqDUgAIBg15cIjx69Tn9JxbsFdlXvox8IUn4NTNHDre0TSgruw++fgML/Kwvu3nbppiKuXrIILAYBExwXNZVLAJe/C66k9oGSK7hyjIkqBkE6pC4725gkfDCyYOrY4JVFrKINMzVhcIK/BpO+uIOFhVzPtk8t1/jeNkxzNmdKiElc1v91X0sQuZ+UjMDc/e3MOHk4ZWwMw+Lv2ktBJP7ql01WAy+0F8YSQ0tt2Kx+HSEEHKP3o1F5Fu9kAKBVMBIUPB7WFy+kxSDJAGMcAlbuA+Lzk8SvJRIqHac+mFVtfgElWWFMiHCIO1rv5RUYpH62fTBSsEBURmPK7F4bd4wfUoQklFhcRuL2cM8XN1QrYwQaAgQ+kupqHUipluPXr0BoA8NRQJQfiw65XwNFrfvXL9h9Sb9uaOR9zGv4NsAANmf54pYNh+dxv8C0k9juPZ7YnC/H0Wxyom8D6Bti98ujW6mRhAnipmEAEDbaCUCgElOP6lncCClQUOb+MpYYpD1ieLYJH6h8/Gm1CsyALwpdQ8du/79d+CDTypXRKlZAgYMPt6GJgdFseKEek+pd6vVJSAqaf9ugB344x27ATb+gS2Lc0d2YlBdM1KZHBQqpbHPqn27N2ZhMbz6Wvv6Sq7RAoDGtcWoRRs2Wl+egesyO9aAbJXI5Eq1hlIVpb5Nwlt3NvYdTIclxFdi8fxxLKpvJQoAkHs0iVm4cjmlSw5glqsv+qBaJaD2atTGODgxaR7MnDZ95g0szj8ZU48wAIAULeZTSmc8wVw9jkCi8XWXMsjQIvIT7AysT/yGzZ5BJ6+trLbEnDXnjJtfAbB0auLFyiqzc2BkvTB24gQ6/HBxKaW0HHO+pAwD0NISM3YSmv/l6djcxo8GGPGwIB/yqrCT+FmoQ2IsXhkV02/B08eUUuxUzh/jkCBiQNftV+7fzXmCnc+mSQ4oqnvH9Oyr5dhJbZroeLzPZ1Ezdl6bJjkYTdtOn2PndkGco2AQgHuzqN2Zx7CTu7SXQ1AgAK1/7x0/ncdO79Iv/R2CXOrrOT7lDnaG5y1CDlEfu2t/LnaSFwXbn87QbEUNdp6bptqZVOc+ewN2qhcu0NqVPmLtJuxsN8+R2I0ENfwYO+HLZkntxWfotENmZxxUREntonnMT6Vlldgpb56ntIOXex/Nq8LO+ppFnFND17MPq7HzvmYh1wLPDbyAnfrcYhAMOoVvAymh1oH7xzex059L4Nb/C0wAckk66k9MUii6rr+JiYqGv2FCsGY2w5HWGaSAOaURR3qcIwUAPgrixgFMEM5Qc0H/EUmwL5ALkWdIAjjkz4GI00QBxBIXb8jZa3OcLNjtgRiW5CllZIFpiy9iucNFTBiahrIVfYU0gOxJSnaMl4gD+CmQtHgwV8JK54vkAaQ1YCUpl0C4N52Vo5hEPKxjIewCkZDqy0K/bBKheJ+chXaXSYTjrRGbX1cTCGciWOmaRR6Yj3VkxXiJPMhogwiL4+0Ii9ROiLBIDyMs0oxSwuLrxoiweEtJWJxtgwiLna6IISvODpUghqiA68OliKyA7GGkRdVOD3aissiCgn9ydwcgNSsDrxMFJYsTWyGWmXRMFK7XI2AAWGlxkSzY7I4AAikrfbMJBAZY6UcisPz/lq12sZAAG8abZMGv/r46xKreb4WJLICV+5cmdAgdOGRQzFBKARoHBIZobPCAJeN+PJZPFlievwC1f5XyzkfJA2NjBkR3ckNgVPzVCsHCfOKgrpe+2h2BS4uBAWh5JRkBAMh66I/VpARjDZr9SEr0NFhr8gMpUVwwb9xEgJGfVhETJffvAcDdp0UmPl1QXVlgorQEU0ppAS41iel36f1cy7/v8ukcc/yCgrv00e+vPrlL6T8tP396V0TP4uV3Yof/di0LLh/beSUL4Oqe9CtZIjrl5SdWfXgmLZ3SzNPplqePpIvpX/HyL3/5gX4l2qcQlxuJy0XE5STichhx2dMymqRs1RIA2rQlKBVyqYz6NWpYK5CPyLoEGKlcpaTu5CMAVlA4IKpiAAAQGQGdASowAqIAPikQhkIhoQp1H1IMAUJY27gwABlXvJ1o8lvc+cNxv2weVfuX6W/t//p/0n30XqPXf8Pymubf9T/h/3j/w/y4/1//J/vP+K+F35o/6XuCfp3/e/69/k/+L/eP//9dP+P+xvvl/r//I9Sn8+/u//c/xHvUf83/b/033yf4r/Z/8L3E/7d/metN9BX9rvV0/837j/Dj+3/7lfA//Pv7//1/z/0Tz+Zfh7+yHyQ8Z/vH41/vD6s/kv0H96/v37Mf2v/0/6f/0fS1/sd/TrL/w+hn8r+8f4z+6ft7/iP3N+439D/1v8540/En+0/MT+9/IR+NfyX+z/2n9pP7r+6v0pff9yNtH+r9A716+if5n+3f6H/h/4f93/rK+1/6HpV+9/5j/i/mt/h/sD/nP9L/0f90/dj/J///7H/6HhleeewF/Nf65/u/8l/rv+3/g//n9tP9z/4P9N/uP2s9236V/m/+l/mv9p/7v9t/////+hX8t/qn+n/v/+b/6n+M////K+9z2Wfud/+fdR/Xr/gfnS5yjlHKOUco5Ryjjp+95g3FL0oaSN5Mxf4rGyz18Bu2JDdRkXCpDMLFqwGIENGsRiKgw7vTN603CvqGbdQ4G/lMa98T/7fA0dS2Q8XZw+Cjxh0MbpwiEVwZrQ9xPEwVgrBWCsFX3AwvXDR5i58Izllt0S5Sf/3TX/+A5bgg8B6WtM+XQWF5Iz5lOdH1HsRQzHijauxwoYdfGqQ/tsTImxNVZ8lqL9ZvGoloTeqctGH+Zt+Nob5JnWkb0AoHc5ipYnIImtienipZU237cjG3X4HgYtEf3fq9lIcQ24E1aX0SvFeK8V4rGhZ1Y10Emr972Drm/9DVuX7ldW8EeN1p1P9v66+hENc2cp6rOk5B1av/8vivXenymHP0DOxRbEEaQvp/+n75hNg05MWIlxVxG+Kjiy2TTLvxJcHvKUoTc4Ch2E7NNHuXU49qjje6nhNAGMcrAwSNdH1UXsNZ3NcAK9VrEqfm/XjPnrU0sU5ftP1DXNHL7Voe9ARRiiUnCs12Qe74zSxZ+q7/1WAxRB64FP6O66ce09EaklHRmhKR4OZuvv/mVOvp2IxesNrNXmwFzyJ0n1U+HLaYOOGX7zAde/PSR9eu+ACNq0CxTXAmep9ltqDv8NIVAOfNvc7fQ17Pfk5Za4tv4dPrf+zm5ozQLv/aRZh4bnF7Bxa9Bn2Vx+j4PEpFDeNx84kYYLas5epr5DHiAB/VVUiEczDxLqK1H0ssy+/uCbFCclXvHKfNrioF3D1y694j2BTSNpTthncA7kBbKRFpAb291BlHp9y159QEwQLUJ3+vJuKvo4u+EFoiglcj6XItbnmqynaPcyN/+M6DiP4h72jXTuEmGX8Y+Dt6LAoUY8QgXrdtOf2D6Xh76gSN8vPBR22dyHgYf//6VImj4j+4hzkMOUIG39IQW95Fj9Wq6fW2vRfsgBvReZsqEW0dYfJinogdf6oBjPrNNUV8G+cr2XFfCbn39TVNuiNYU20voDt/SbhzAuWuGcl8Uv15XoQsiO8R//8m0CAdObTyjM5YO6HUwz+L/OqNN8Xp4EIUalWmMTa8e/Uth/PGiKjs8WUSvmOnbvvhAc0SsvwaLUrfqHT5EeOHG+ucZXMZarM73DZ89+lOsYpET7NT6k046pJ5ttjfidfNiAp7W8zLaGPUHq/LZanvrEcdoybxeYw2upkcGjBFxSe0aiC+JBvFGYHhy8Sk1dUowctT6fNOyiY9CtnlaObD4oHp1ckeITY/88yxsz9o9SPW6xyWKsK/UT+DGCTnJZ/MMphmMLhs0Omal0aiTvxt64MhiqJaw1kNpXKv8Dfl3cPrn4wpBQ3//XBgu19m0YdHtpj+bs555LfAdGUsWu6iY1J0nWw7FTOT0cpaxwEo1ld3sfv4keI7XpXP+bwQNmjJvJLvEbJaaW6y89EDl8nOdQTEYI0CyL/FztOX/HzwNYYvCXAdGC1QYKFEXVJ0/IBomddr2YqcXpL776jm7Nw3zfo5kIhHw0mzm+k5M2hwtrkC0IRUhltTQSVn5dZn3DJGzDrKDFsTkefK0fjXVwrBlWr5JcnoHw0eVwp6GylCGwiSXiAERfdjah4KBSBX2R9tgKKqa9Vni+Ffh6t1oub+Sp1JmkB68GfTogp2+bui2wpz74bnH0nWq8lY4u/fiNvW79gnjptuclBG4OffZm59QW52JB289qu69EHIEw89+5U6pBXuf/T6UYqpDmSs3hrzq+HVlBCsWGoLyY2DBhOhuAMBCL5Ct+SefupTA642VjbUbcZVQ64Pdf+nH5T0u/0G+aVrw5LZi+EtqmVjC7Zx4mtkN6BhxaA5z4RQyrYNXk+c/txB/h5gvKeTCOpfO2dTGZvX+vIzL9jb8in0p5wksrfAHefk04aqb2VXGY3eNw4KzdvNwWkRdSiUB8mT7dhViuU2Fk45JsfFr/SPEJsFwF2kTgdrZ3L2YOQnijY0tGAnNX1DnKNn0UDLhvd8a7EjI0GmGLA2T2pn7DL8StSpunNmYsouX9EDxKAKbdMXVof+nCwOwJVufdG2J92tj+WuUtwTq0ULlGcwnksZzYTxFT3GRNWycUjmQVuMDDWlpOp9VKfVlfU9VBIFS86pllGJiPFmtDdrOmXjqslwgGceCH8c45sjGZWx5nI1WrLH291JHN+82/Sds6fKr9+edoA33xPQcLk/+j5/j9tdZWi9xV3KIf60M1DPue8RCCQ9zwUgeIkl4ZXzWTsFhH7Fr24Set5r7JsQ79YBwViO2rtONfQv9ICTkBKX4QDavXfMkS08y/gMv4zWyPxSjgNdx+3LOruc/YuWYn1XmtPBPy2zk6DtEKwTzrloybWmevYi29shFnZ7hk8WJhOaTBwhnJdB8r8HpZiAem7Rl7bF72rOPS/3oGQ+dauzjsktYejl/YBsz67nO44567cSC4K8vNBjLOQ9PEJFlWFkHxTG4d4bxSUGfA2aA0Dln4cAnPkAAP76arAAACIm7Pwe/EffSP6PJpJ8OPflwXwaN4TjlbbFjDWWblwc0/d6GtZbL3Kqx3pZlIWcmLdZSGYYg3h6XMvwNlbCuEq+/msiz1XqOG9VyxQgC+vh2ADQe+PRANiN9d4VkvYc2rSecWoZ1WI/wgc/vLqQxaMgv+NYkupOO2KpSJzefSFFyYvr29kPiTDFsHZa6vwUEBFHxPgELtelf17JTL5wVlxtuZN4BqlWP8Ipxn3X/M5Ka3oz06DztlcFhGvd5McoTkVsxBojqQJb3NnjNL5q6gkV8U2zHS3gJVfZ83R4DYMxqwz8R5pWOqJbKPJtCf97Rp21PqkKkmaknSaOyuE8aqJV/rbZ8L/SNNSl9dypJC/B4FDSfAi0qNVFBF4DBdaKka/XFvKZM36d982ilgyvCYT+DCSgMA6DCzG1Sa/P8+dwPIJeBgK1PHAl/dv97IUN61LeEOKbH4uuFtp2Fw92B1Y7r13XAxxW0wDum/Tx772AnYk87I1ibOFVzsR0Ywy6ZThwolW/+M/7taZZKjcajccK+uZwctAAel2IiQ0Ou2B9YDrTF084r2mXTPFIH7ziqrycy+oj1SD5iAJZZLUa5h63YSXAqNnRFbzAdWXZfKZ9JQlfuKJgZkvqbeD73q8eOCH4EjD1jsyFLjlHTpn0JccptRDVfY1Wf8VSA4ZvNP0QiEXrpJ9vrl9BpkbxzxZOHz49DNqp4VbKou8l5cdS4DROcuKJp3w9A73aGvvRYk85HmUK2P38359TkaJDUtAjxMN2NMVp/o/1uJ91hsQtsGcjUH03HSkBjrovw7ihGwVVg9gmJZL9Kml/lieZGI7GMpTPckGVR0qW41vSEHJjtGW8uZzO4EtpOSrMlpdzschTC00NpBKGjJBc5sTHg8Tik9FlPLu5R6McuxlBYNZyo40TfTXGRG1u8r6rJbIUsmMW8jqBpFEiPPr351pmlGOwJsXp9UVxaSMk0j/ZEvX2DP+8Gt5+hhSjv+gxg6/qSGRoODNzJgHrkYArZyBJqKCq39a2tLGTTOWvoZkg5U1BtIBE2tBPg9HWojd+xD8mb9DrjwWMIOXuk2iYeO2Tv/s7OWPaLKDosL8KbouySUhVy7G+3ubVPi2SNLhGp8Y+S3CSNgLxOxfbyOGHFx0jufqcvNKIpssAeLAww8X0FHcnfaGT8Zk8WjNBt4hGG3VS/Q07B/UHM5Wqx6k9WGgpiJ2k9OrlcuYCFfI9/edpoJeNPdKOyKMNfCpW90t20DMnbL0awDMIng01DGrVVPZDT+fzkkaq9ZCrkOkPkISj+IbM5JGPaSqIM9VJu1D4aYzU/Ea/wT/mqTquOnIAccFL56jQj4l0Q+4atRU/+Va6dzn9sFZrtPkGggQ8Gs3O94xl65ph8xFF59PuKj2a8vSQkpHw+yspIC7ahdS+PMKDd0G2D5NcoJUKmeXE7YAAfKyprki99btP0ZClefQibwgPTfpmz21FiXcGb/I9JeaPM6x3YDW9bMUWqxE1x8uLig0SVoynO8xBtsyw+m7w8oyO9ACmaHp//LjSJ8jLxsHs65p8CPn+iBl74vvN29X8Xe1l/GC6Hv4Nbf1Uy0lAhq42rI7YSmy6DpUGCEcTQ/BPes8C0YlXjy6LrVYWzc9ZO9RQtNVcDhMa09TEldaCjJHf0vs3YMVALpZraNm9+CU2ctr4xKYD/52BUmsdVBjuZ5djoILx9C1ktXEKG2mDHrcbDc7Y7wBvRyMvYNtccfDtDd7pOeHEYQA27IM3XKlpugfKGX95hGRadRmPV1iuO+3n2TRQfKuINUhCkD8zioxYuEDjD4sYY8dpedz66a9fbn0/1Tv310m2hncpgNEahevP88rVgixfv92quHnPqTPaqi+q1FA7VfmbodsFflZ5pv20lSm4G1ELafWY1brHnoPC6pgCqaNANoDHjVkkNsqRSmKDkCcSdtSqakrwTtABU8eXA+rWGA/CbjBKyWPEcgO76C/f1XMXkcSx9o5ae75Ps6aWcXRtcQi3qxat3JsNtwqNefIqC68M0yLBr8itzpd5rN6wp1ZPmzBBlJAqzyp6aBrvW2ku/iIk0uLH3UcJc6YF0yqe1uadbERVBd2CU6POAjLjwkqyVYGZg+guWYfzCqG3bNUapyVWoO8SsVcCyOaRyFwYTWjyn/TKmN5UsAsBcs5+ReWV1MzjSdnZ5mz6/7x+9h60mNubzyntpySC/M1in6judcdU6D++0od86Oq8qyo7W4HYLbbYT0vP0rAMuLLfeyCATUFV2fjqfT9jumavE5Gwq/oKn+VfGrsR32MJA0C8Mhr/O+hq1ncIxXKzgZM6iZn8MOM0ZQpceNaUgoEa/Qov5OCBg5lkGTu6dBjZ+yn4Kw/2YU4RSWvG+4h//w2wDjkO7lvQZrM1HaH/ozFR8LNfknFqU8s2eUJIiAWJpzc/FxVXaFeRlHcMA8L94hObbaxMKLEm/mgz1eFhXqEpdL1xTYKq/lbqk1qbrOfpNcP5zbVlNuRxPgFLmqQDfnpbG5rCLX9ien/ra4oelpF3A5Nf7dlKmVwY1EIk47/sHpeKkMVU+oLYJod2h01Fak3rgd0A923JdLaiqSK/+sRV13DWyJjNFvVaBxueTqLxm1yXNR79R7B8cYGO/WZaDQX/7TNJg/k+mYMDn/+ZyU5UqV5XO7A9H8xerYHc6UO1YPyMO+15IvJhmLghnbQp4Cz3mrzZEY3ZmbGqmTU/N43D2J6MitrrtW7Mb6avyxl4So6AdaMAil+09+imu/dQP7n/6nIZWxscCzZ6RGVo03WMMS7tmmQbgarmGfsmXaW88c0pssmEsPogc5nwStaSDds8X+eeU+YpnvO5H5xSSRHmKs73ZUpBeJwQv8Cyiq/xbdnldMMmFB/C20CokC3V59bLF2+zR2P//VK6LYEXF9ZxPEmLyKkJugwf8TpJMrblseiFd6mVpFgEau1/NCJku6iuKlt+jy42fpmSV3HoDSEQn1jZgqJQNimKcQIf0P0Y215WTjdtlJuIU7ILrdeTZkUSdXLLcHldFNWQ+eqi9VWIXz9AQ59wpzfDdbhz90/YqTLy5XjqV4gk6/8BXVu71w7pOIqQ/zfG7D2Wg84WJjrcD17khWYjIGv83tvM85g3S3JD4WJ2Y+80XEbfX/rwQoBUgMCUOX7JZ8o98Ovpj48MH68blzALKb7d9+g1bFHDJEP+1U6XDrOHs3x1F4HGK5i2TMKPKdzM9k+tU1U7Ynoos7bPytedutVTPlynhPPHjoXoeUOO21C7PphM5e0ppamcKNHrLMb4xzbjus3iwYHPsXpXU0vNGXhrQwqxHklm7H2dyoD9Y0GeHTewl5SduzdHxiq1f2Qa6kGi+bg1qqttntnT2SC/Qak+TcZiMbWW90DDCKefn2V+uuY90OVestCz1lsET/XbFlR6K4KZ/7j4E7UxQJOo9eHbv7dSwkCusLAr6LTTGvstLSFMdYwM5RbgJCXwPo+SZIinzyJXKdMtI5mptjO4ZDU9GAhr+tlRho5lAXZfi9itP25rWTC/ZBJu8aRHtFxPC/NhgMgKEHIj7lXOxzdmN5B98SAEPLuypRhrs0Gq4nwQOCsWNDfve3lpfwcfJbViMgOrSiKsBKZV7xz4JFtnX0KauDSb3VHnbP+EAYki0Oo6oGReY0ZfumyD+yhzi7maPApgoeWGK+s1qjc4sW4DktkpaBuHCpK++cOb3Oc1Ius87D8x3AAQ/ysVNiEWiTbG7I/2+SdLG900n8X1VSB8ssdhV2qHorcmxNiOGKZeDdtalEglvR/+47cjbpY+xqeq6/6BXj2z/vCJZVzVBIjzLarA3xZ/0qMrHTqk3CCrDnjgLLGjKLfXydVm7LDH5VgChYx4O0rtuHaD2++wkb2aRYgEgfjNpzW/5t9IkYaDw4m/aq9CL9j4LXs/b3PfUbLp/0e/as53HGb1MEsxUcoKYjtSnFPXdrs1p4o8nSYNAG0e1F35lLMoM3/b641gC/41IMtQAAQAq6m5lfVq8g15gk1mVlzicdcZ3gf+4CphrInXRgM7TABCv19nJm6nyPm5VG0ZlZ+/zaqT2gmgQOqAbyAbkZtU3pNKp9/HO5MwU3PG6xAxaDeDKbF2NFLLK+CSAv9Q3VRj/co805qi/fQ6GPweKWRcnkmYqx8F3OEWkqaMXU4eT3mBSodh69k6MFBHnqyexpZVhE7jW7Y8IIbuxKmp1zHfeqgK21fLDTshE+UUjwxKrrTL2O9+f8sSdCYvtVACC/5PtZh1cohWp52smPTcaN6AqtJ4k0TBCyitOr5nSPINRjew620C26vpTWdyRNSwAytDjIj6vVLA+9g1vRnqM/F3C8y3cMR/uU4w+F8qmM58ihlOsB6ABpmMANtnyemzM6EGaFFHExORyT6R19bUzsy68tFCiFzi1qX9MNRc/oOC4tuijFjWJm7Kbef4LIRAAnFIw7kyOJKhXUaHPYr2hNd6v8uF52tVR81iedE/j4QWWjARTJhJweYSh2T0MW6eZw22OB+jvHHTA6bdDXS/2dDTKgZdzsx8YGIUhJB3hFoZOqPJLqn42P3amr9y74XrtFnRidb/f1lpoR2m6Kt9Al7NfJcygunmlAxFe26w1BBab1cZV/ThzYTOm9G02hj+T70ZnRWNqOabXtnwWsnR8mjIyYU49U3rSs6AaXEaF4AJ17f/X49+ZygyOxPN/A/dPWVG3WPC85gyC0eJnD5lYcFw+1Wmkz8DdzhRZOzt3SWVUcOZfVrQvshMzSKSzlARPhiCZyvRlRw1YFi8b/g4/YAtryRlvtGkT9c6JXfJBQ1XRLoHjeIQiAeU0XHlNbCtsZ1IbDK4nPNAACkSUYVMQFyMZDJp/ZbqqCRBz55HCJ3uY8lA0ivn+AWFjTQkhAoIAIwODGd7j4LW792Yc+dQfpAIvCItaOw6GOPon64QzYuTj8jQewFyG9X0cFwpUwNHTi2S2q0ZsjVWWtHYWwETCfIHlgeRrOWgdi2BU3O/gQGx+BYRa/ql2Wl0b6C5aA67SNakkixujKO61rOffm6+Enuof4VQo5P9KJS0+E3/Vl5sa5voj7rpxLpXdHJK+12Qg8kT1hqlvCgMg5szuTLarfyW6cNdV1LO9rENrjHNucHYKSRPHMaBAFLQw1vARoY8o4ZPv1Cyq5hi0+tC8z6eAe7LT4207nzPTRT6PaQEsfNYshavDsSY25YpPWIWdtt8FZAaGmG7kwVPxo11SVV9hPTA9n9Npv9CUX6cKwChBtnaPD782QomMJnf/96SERDu/mWQ/Orvb33/R030JD68wlNc8iAF5i7zL6XP59Az80BmgIegfwPJon2+lMHH8KbMRE4/DNio4TQ3ZrmMrfH/ANoQZJJc9v8TBpPlWIK01NDirlw2YHAVRbZNEFwMucRM8iZmjb3B/wPNpjbN47xDAbGkRYQlwFx57ArTVU+c5G2NJ/4qynNs/NVykyhLv90ZITFPj9/y0EE2jkpwdk2aHn9gCmY7g5yARkChSxGdopt3VlCvedPx/zfNMw5k4mCxErve/2ZOTB7OJNmvOh0JL1gsjJsbRmPBoGe6G9dx3QaLrw/vy+Fblc21IeSuozUQd7WRrupsJNVgJ/MXyqnjYhAJp0DfehUdLYmqDeUyDwhlBeSMBLhfrCR/mt0zZmVVbfWE5mubjlKtCgT041xLP3BTy1fJtTeP45ZzSfErM/eKmlMKwUqrhJkPV/AHlUEbel+zEWkTsSq50vzRkOHSq9Pp9MNOjA13zlg57e04QpywCrgdk4pld2teRl1R8099dBqcpVcKDYRkuDEs7tvXle4yOKf2NXpA7APeWhpAIyrqzS52w0g637wpSivIzyvLW4QVYronD7/Gbi/gmxYc3uaFEAAdygcczsc+u/0+e1m6Yiht2eVof9Ko+7HA7tmceEE9c1TXt94mqEgC1RFL4PVAB4yk+sIzDuxik2wWvyMof4IhryKkkxJImIDnv5vTSIOfTG1JoQpQnGKFuRrIZvD+SMV2hr7oMaeWfFzNKRGy8rVz12dKG8nM8jA73gD82zCMuyVEwO1smz2ouGSlunHkUDttBkcXmp5CSKjMZFjEyCx1WlWIciGDRSuysji3U6+HunbKgNfTR+VwIqc0Z4L/j+PY5qemXF5MoE/v+GU7Ig1sI2fLytXAV29I3n/pdctQbjqOpwRTSR/DTilVAFKk9T5qIPi/y9cw6NFP6Rtav+eZR2MwJUKLbHTBzCkCTfZkZUJOc+3mkB61Tzqr6KamZGWdl6klK2t52YcvTcqBxXGEO0IQUSmFUc/1OCAxhyjCUAPq+6PqEXBDpYuk68xn5IubrbydzT3OiobZA7ZayZkU7MPJ9+mR7p6h3G0dlg6WcWVfjtMAn+4VOG5dM6nisfYfAvlnco2Kj54A8mGlJ/LX6aF+a2J1dgZQglEYpJwDpLzYgaKPhXglCuy94/idWHu71GIpwoBcCgpVHDX8jscPA1+g7HnyVswrXBLUJOrNJ2UyFVd6Oadq8g2+aJkQUN4/uA2OKHrziI3jhTBqQFrTrDJPKBjyEP68ZLQMJvAgKZKguX3MPAL6w0pD7s7VBWAPCEh8x1R6sRhTQwuRQnMEQ7L578OvEMpwPzrL3Vn9TF5pNJQPImY04PS5wi0gcC/q0DTts+apFl8hHMgzQUJvPj1TwlrkC0LUUJKFi+h7xC4VMP9HCmvwa9Iy8XMSXMehsOtWvSdZPSdcyMItc6N/7LOkOM7uJlA9czVbaWcYuEbbB7S44TQJGdaoW1M2hRH+p3OEcB5noBoNTWkj1V/IiTHtUcEUFobhWxnCFb96hxxu0r0jW42/Tve1fxrskPrTtLatZoVnxya04BFCOzT5qMN3yw3o8qybh/bS+sgkJXaI07Ch/xRDZ8NejsYef9Xgp8Y1far8cws0mNeYv4N2xwBu3LnwM+QXW0cvswXUaT6ZKU5uhbUPzCyoglts+N79nmVOpvAPdzrWSqSHEMoeGfHceBXf/raL4y05scoCaX1TQ1mOj5vVMxXz3bplHJEMaFMHlHcUSLxG8F9Ce2tin2ieLhOwQyRsONYPt0gcVnQvwv7GkNMACKuw2ehrT/ilWTeW839JhbnTuemlgdOHMuULv+Wc5+/YdKRMx1E0kkhqJd8tt5DAjLybPQMW94dcSppaVprybgQVpFOegszP54YTS3uccfftz0EDD1jtvD7q5GcfkJ0N/cNvfzS7jl3oT5BPFDDUBrNLGI12Lt2+HcATW42mhSoORX7V+6BUr2NLR9eOey5fLdSvha+5oAUDk2L5n6VjpJvLUlDyBU5TZB4fVWoIy7DDQGZ27rgXnJ7Ahh0LJs5WYOAHrXeSc1JbnNqwxlRtRM6gtNGF+b4+FxwE45zU/tOlSCQGKFZdlNZ5dvroQMlNqMI8ticN9ZryDjJPUZgPJ3H8+Uq7CMC/HQeUVjK3saF1qaI/MuvDI3P2/3GuezLmVoJGojKvFS6wMYj+LSyVa0KZ0ju6bX/Yur6F3AKf88H5KfywGBcKqRDDD1JS+V3bL4QmmPMqJKta1m/Wwsxeip/x1f4mEQzvxaMho8VL0kVW/USoL1RScONhobjhQwoPgc0GHyuhdlIORSdq9ceCN5Q87G9G+QUFGBgvT8foEMkdBIdZOjDloAs8nPG/cuRoc5UPh2Of8grbf5mmz9SDXEMrLnUmjTV0HtUwQqRBw9/2zmaec2HDIsfp4qGag/q7T9K1KZRrCw0EbhL7MGk8CQd3PJA1yjWxjIRUWRjXrBiHs0tMpXuACGHJoNz18eGijq4wlD+kZW/83kNxpg4riKF0fBLZOSqHV555EoLz9ulmAxOxVifReIWmIvoshkdEx1oXKq7KftuUY0w0G/TFGK8xlnqoSfogUc7FZxeJrzQRlkLRuMgw0FRnGM8smo8bs5knwMvhxOWa/sYDq2F7GdLgHVs+kxuKcHwYh+lsLVhL1HesRM/jEP80yV/AY7QSsYXhXoUOd6+xaVpOKzw7Dgmwz7WveuEcK2MCd8LcJwHcoLqFZ/a/ZCKM/7dZpcghse7RnvIYRSWs0LvU7su4EjhuJwFLI+iILiVNaLXqz06iptocMgKaKOabaDQGPvtYxTCv4I5D7cuXIuPKY3glEInKgjyf6h1XEQhXjqkzdKoUmdr1rqRpmLPMU3uO7rUFp4QkvVAcpZPpcaH0BIcYoBTKYJLxw1MB/qEN2loAXhFaquDU7AuFDVV2iYliZodoJzCX61vUFXS42tE4HB+MG3u+PF5QI27KOW8DTxDsB95MiIzV7/hhZx8Re4V4ooglL3gWd+cXltqObhpqL+behhmCODFb6G02kBlibwZBG4fuN86jM1/n/aOln7EfE6tNm7MDkilaSkHV7nLWSubc9ClDd4J0IQlYchayrTCN82LE2qDt1p5opHubAo8nprawQA9DTawEshEy8m+WVMeLmbA5WCulSsgyJPAe9mOrembAjfxcGDjEW+13jtI7mnkJmwIDl6LDlZG3HrVVwDSXS1uozogEWaPVLX6BgederXwd/ANzuxT5NiBhgTD6kXD4xuZWa6XAKg+OUl3mbnf9bDT6pE8B7XhNAZGpQjbUkOaBP54QeaXPJS+xxZOZyNL0y0sKYvgUZn+4h0bodyqRgWzGQkXxJQeH9i9IUjitbnhBhMgvDXtvhL8Pkf3g9RwprNNuDfAo50HNA6dey7b6mK7kfNeFobd1u/ti5EfE9NI6YicmUQRHIjO+oVbgq5T6pP++MS9u+9R5PK1X0KOM6wzvcoLowZfvXp9d/wj94yNRsFiJcukNtt9xHSlztQjCfzJVYdvxgQ/TrEb0xBivElEgQ5/Daizs0ZF4buSyy/nYxkDJb5VzgKZdqmGUKuAQyiilSJoDONWgjzFyGIWuKMVDgGZunIiTK4LJZ/PSYIXTGbfb4G7E8EgXEfzuS8Frwf5jvF5ctSR7ImN6JswwdrPRPjfFwgh7+geOb6T6LSxtGgMeTTUZs7Ki1j7dAqtbdFk7PJMewFgXthfXjDZByycg2gHRMU/vaDSwiVDA6nkT8qBvh6MbZ8BvHT25Iz1j9RGBABL3nMhP4CVw5/wlTIcXsS8HB4CzvWOnLhmxVCAWJ6imB0UGKFeyoyRFvwf/MjKqI1UB6a8CF8rm1iPVMp7kWVj1YgpykzONLVnw7LAfOTgb5DFh+wyaY8zwc/pZ7+lsI0pSXWCc+vbB9GOn4Erzkbb08qmakpJY6jjE1I5/UNZcJOqOp3Z/ixRRrQaOBTvsjiwbN9xJsNggm3g/5WlSLJaDM6Xsqln3CK3wbRGRe2t3hesuak0S+Y5lt9HWwRyZJOPTQETuQu40Af/BpD6Yu6yMIE6eSfhtgsY/Y0ifrPJ0IrGZ4NEg/7/AuECq1XcpDI4SqVCHD3z6eNDPaPCRIPw0FivA0HevsuFTl7lgTpPjg7CeZMD2Y685Vc1/KsL1m771oKNeibNx5Ky9kCAqSpdqhh7jf9ky4gzQiUsSfXfgNl2WJeMtxEfWHsXjKIJkzyZ+hF9hDoJPjt90jmP0OXuRMn3Y0+mJS2LITQ6lfZbNvjv9JqhwSZufpbEcl4Vf+8DJwhoBcHUHV6pUl3/c679HTckS3nmvGJKQh0AAvlhrkPX7mRq3Ddr8uyYTrQKCRg0BPke4KgidvlbcBv10nIly/g3TRyP+rARy5emC66tNZmRxYA9614b9n6JOvtrXSIZwg+0zqTqnP+rmYPXTLBZ89vlyV+2krxTFzCIILSheX2IS7pJqFWJML1ZdxJNbzdYfJYGfQir1rWuJLbecg8r4ToPrbx02zQ30gPnx2F/3icBtM+i7yg4KKNb89DLdJgEZV5ICO3HAccHQQr8iEktjZ4uAKHWdtLZduJFfhzs8Cfp2j9Dms+eMS1ms+qr4eETy0ld/MnkvfuznIHXUXGpoxPRBlfBzWChyCVWYC91CCae34v8ACQvI5HW2kdJJdGk9S17M3Wdrt0xkvIoiiUDUW9coQdXucX6IkIMTPV2uiAiLVytwCnXtMADlYTTNe9WVT59/1f6MCFYF7bZBkxR31B/iKOf2quH2nKn9KgfLLl+3Wct2smvi9c7JdLUzuJ87J3UQhjR3mfJMQAtCSiweVhaQo3j6o9RHuAYx8mmPRq0VKn/wGa+UYRCBnNTWpP1iERw+uIx0ptCHzcp4uQ3rMhs9vviNvIEn1k6aT6SJNCwJ54asb6uRtNNCNExuLLkkP81FCTuzFwtb8n8eQXmCoUKHYP8505Y4zXJFXTZDTpjK4Q5nalAMGNeKroDq18QNY3JMl3LErnUFrX0/09JKm3T1zLAC3qp7NeswXlhbGHirgTsKTyb3ER5GmxxnwRIOUY6mGJx1GoS2+Kx/lZoQUPjYn+t/PHruGvKXBE8tabWoaYVoJ3cH+ByN7hIbi/sTrJmZhNjGeLhPfBfasqUHGUsqViCJDcqM++Robcplcc44lHCWuSWeuQfZmHDhLRb372nQJy7FP53od5mrtRpD7Y/r2JHbkJ7AimIqI21klIjIXH6cOzVQXiTFpOT5HeB7VkDW9hx0YXxWosjNS1pIUTp/dQ68Hn37H+LyiuLOoYvXgHSwHkNKH4wzq4PvPJReUDGbyhOpd4iV+60DEw2QKCUxJmdl8SpSPurjCFi3W2cbngiknlmB6ncT85jXgwtaqlvHzstnXMj4+NAKUM1eqOe4ozQ8xHnKtgVhbc1ZokaUSiuid82uLXPRFqrfbxO4W2kjv6Z8shvWlPJfbeY7b2hbekalnCNhZI1ptI7seh7XaG3KZWkN95ERRjruwlwb0pnSXX6WQlLilNqRBk+KmEwBtaBZ+XYwLcVPZbh/X6Y0xmaFse3+EB1NWAopFxlnTnqXxh41HcwgQrQfUAlw8U9dZhcd5M2p/dOGF+NCCH5LH7Y2mpElT8AAFXb7sGBK3s/ovsbrjS7h2OWkmPlj6prDrQUPbgfDY5BNy82CwJS1taSq0K3NaEbIrpnjs3eXGQ6sjp7r5MkK1FhFsrmUmzbIEj3g/yNYPtEAiRqD93yt4Ncw30RpHwsPF9V9y3StS+YIQjF6ilcxt8F4ngQl7VPdjqhG+eQcIHJt/7bbtXgxPOTM5z9A+XjYfw+iQCMJG5QLC+5bO6SQrINFa2yrGYySJ/3JO9+G9l8oe3uS842HfuCGFb/z99vEr+qdJ4S60hsFkx67QeCG4fE1daebQKc+6ZkY6ozasT5AjJKijsUP0fj3uDAUmWGQT9+d7Gn/TdWsdiITJ6syEGzp2UA6uFFbs2T3SgGHXi0z/LTzjTfwG2xx4lY+1fj48kYRpm6Owt1lhNyDvc3g1IWjP571NDGvHENRiE50TuCP4iLhqd0Q4Pg0dxs56Xpx7J0/OT539uN+x9NontW8I1ApcB+jZM2XX9ZoHg3zrbDv2lh1odL3+NBpKZ+VdTeYdP+p1tc6byx2hTYlEeyqQ5U+5IeBWbsA+e9Qt49uk/pSkxn02A4o9hLoMY7kqz7tCEjm9/hGYqh9zB3f63BEf+pcik+K3Ha9aRboSBTN66T1IsrR7K8++rX+WorLoyPRlwRPT4cbPRKCWtZjON6IAatg90o9SfFlIVGmlMXIUUawtJX8uAs8Ao7NFbOCTK6Byj0A5wY5vOV2QWE444vs7oMJ5Q4w9B3PAVYLalC26ixPC3Pmve/SJ7z/8KZ6lHklH4eOQMHs+ojDoYPNQi5aRg9P9KHEeOj+EsaR5ZDzInAddopDQbxua4J4L0tJwpNO/UdMJ7/OPXHRphG6Dzq805OeFWv/bMp7EV/326bTQrdriNE3hQqb9ptHPdTTlTI0IklZ0MvtT9OkK0rzDHPdU3cVJy/Dv03MAy2k9lURodZR7dk3cPoWNpuqF/J6OQmfQYC3n1nBCbNqsbxwHqxMKU/VgbXLGi7sDXeyEaO5T0I2ZG0NXy7ywepKbTU0PwjiGAnIbg24ZdvY/P3IB+MCKmNbeDfC43nJUqRs8UmSG9GjNicK1Ssnq6+M475XxvCD7Z9ix8UCH2GRKlRj+hHK3MKq4D50WtfoGSZxDLitYR+Q4tDlQrlnKrW4JdFZlnM8/4Iu4xs6TKjuGjUTJUgc017LoWVwlhCMxNxgq/xv7fye5EtADObOGPxmwHHYafEP+a6ekbh3nSi1FvnjOWw+mDKnpjdtFx6I+WnscpXBBhFIdPtXtGAyPMwDSvBaPYmstdGIy2ri74q6f7dC9tnQaeUwTZL7/2d82vPyUyWxFGfyYQX4emQYLgHLNdBmgUs84ltQdFPfW6Jq8bM1n6l5AOWABX5nMfhSP/6AABKeSWNbAn4SJuCXagQlHPNHLoCD3xS6XTW1c0omSRRNlnA7I1Fn2IPpR3dgqG35JK9lvkD5alptvXCbr7YuTRhbqX1FDvi4F3PBro8qAM49FHBqb270t1OsutUIOoI9rvZ4zzrXaPhjRtkB+YV7Km3RI97WSJB4o7zlPRd63gBmD3WVmeQLvdCx0X/YCWZSdu6jo+sTMYP8/SWx02BUUp7wwwn5BtwuozDChS8dPMysaXMSDf1Y255vkrzHUXhYzhbbLfb0S0hqhX/40tF/vKMNftDfWA9n/q/sGnTEjV3n85GWTxz5RpZ+KYQV8Iqs2uEsGun5KAYFJCnV4zkD+bwdSbZR812u9qMUbdTklb64J9Ugl+h9bn5UwBkxNhGugI0UPPFPVXm+Q/3dqFRfpncSxaMPaU00tOhR6MBE0x2aeWS3qq5PxQWV15+Ba4HQCUMV5I5Ssc56Rw1sscYsJRgsQxPiTg8IpPQiekgEdNVqdrLM78DYeJo4jaHezjUcGjBrboXe0xUtKXNBRXaQQQoTlwndu34U4yAVxGZ/2fH6d+VHn84V/8oUketUukFCT2Xed7jU2ABO1/DoXM5GPhsdnGmfN0f3FqNG5C6e3ihNsupbgBsl9FucEiyXGqkPFOylVIzVGwUdEE+Zd3Hr5y9d8o90PHaM5q4T3nljXYih6ZzjF2dua7hoS9CAFmEUn8zB6jZWmVrJxHET8gSZxmLYl1L8QV6Mgo3g3hXqFnbvCrY/3eOS5SNvZxktsJexrUHbBuC15NAIvG7glzeo+8w3Be1Z1hIRb/d2Djy7cYucpC2eoEYOjRRZLBAAxP1Xanlx/MxEY+wjKUKywmCPQZsmOk37/Qjbvo1lbkw+9AbX39+ospabSlHFwtsIb6CVsNcwiLaUhVfSFfHB0C/rvojD8EYmPzFJv7OvYTfdSHxyGS0SLjde7nIxdzEWR6QEgYaSuVIMIWnzUm7TreqPNm3WuDBYsbWLdLB2v5d22aaoprTDrFBf85P5R7CeyDJ8lHDUoOTvE94aiFORJydWvCa7hY9E/kpj6uKiZ9dQW5yrgWelH4lWIp7Wgy4ZtCJnpQZ6LFi/u//vkupuAXRVez2hXYI9r+WxmxeODCqIADoo9zCXgmUdospMzHE1K7270XM5pgIIfxKqjAyV8KfxSfhJLGbzyRf58X3jvNnAx3owRLt77tBgNDDMzML4tUPkFWbbgMBEPTZgJ+/5O0lrWjMPNrqiTtBTviGJwUmhOJD6XmmrX63QQA1/rWOBHJgzz3tJmJz6W4hjSFbEcPCivNbYHpVGFOUg9nnWeybA/uu1rMJY7AKXn085B0aflH688AabRcl090R8qRifVoui3S+et2tiZ1kfIgYPbud1eRmutXbjW+VAxD4gfgX7rELVHwS0Uen9akf7r9I4aMSqiqXE+aWNUaXz2HvwU6C2otHWnKkkiX4JBhTlCE+8v6TUhkgIZ0Fx/RoaDW2bH1PdFgn0s6dj1eft6NKJudSMKRYSy/CeYGX15aLdqRwldlSsuqqxSLoQeHcpkEiLlwNyVSeLJm+ze65KKumAclp+8u+3Xb/6m1VKDi8s7SvtzQoV57wpdcJ0kPnCZWyvCn977wFzU4DIEGP+/OAh1hwdIKRgTtefFcGDXkwpW1JTMzJJ1cR4WTr46SrZ6/wf2lwBWsPmon3gPe7gjIH0kG+cjylgiRzBIRubENv9JdLMKsM4IgyNGW6U4LbMv4RPmePmlLpZnKaRFrXlWZCTVFDmkhWcO4/aXgVqV9oE3g36fCLBfvVGOPm1nfxXrQtC3wqjiAg+7CDuOjLdagVSL1OVemAdfYgXk2yszNs9B4Tt7YVILljS76UhPYzWMdOZMuFW6pJV9D8/mHkKzoO0EhSUVlDIAqclfxogmO2KtPUQ+It7r1+UeHNl6sQr5FEm9+jKXpuXCONU6Kx6HfxOlwZ3jBQ6/7MHEiP+6VBHH05jgSccgaDEUnVP+L/IpxFmbcmpEpa/PKJfTdXy0FnirpSAaTL0RTrqQ5R25CwGE9ZWqJju1Agd5k0EnjJ+cmByTrwE5UA+w5qkLeFSprj0y8SXdGDQWTXSxfyngqzxONzvA0Z0+RdfHxpcaUtJPJDGT/WF3P8viwG22gLbC1225zo7DQmVECcFRSBfhTbvDRb6/LjKrzDx3A2QkoXBPhuqxvfzNw05SttC635FAuf481Sc2ReWc649A2jLa+tJdb5QUwEYyvy8H4AdoMiN1UCNK/GDLbgipF/eCQid9IDlRSvcyp7YY2eSQk1Tns04tASR1OmYesgUXcyC9xzq69o4CQ57Pl5gJEWaVd5RYCXILFXvvCarbP0eAiBEDbpOOAxUgI/JL6yvIwJp/zIRk8tD+SvsS/C3F8zedQS5D9NtZSK2H36LdMfqKBtPUVc0EhrJO9h8JyCyD1gx3Zei+ZITsIxBFmUAnaeWgBXVuszUDyMkX/qT8/zpEZpezPnyhMeGJc9CJfEtLKAdVg0QMmNnU75723f2a1cT2dmWF207StIaqqow7mhKj9cCcK2J9TMUnNhxI/Rc3vQMKFq0skFxbdI8e3avrj9h/fNAVQkyOBDx3f3XD+GnIGBJvpUSylfBq6e3YPShhDZ6CmaJfhELRCgwODd1QlpnRq9omm146cRSQdADPY6T69c+h0h7pT3jzy+4B7BkdEV5kPvAVODPzWGFN8QtKxuM6M/LEjfwSmKoDrYNa3IBEtJ96vE06z5gAJgPt/c1XoVJaDF4aMw3yP290ktX0QBjKrO8mDs90jNRJDbzsGg44vRDR2kaJ6CjCpO1OZMXs4BQOy2rNgsuAO9URoenNgkpItdXT4Wk1Hm+4wFLhHpqdR6PDUo7AO76x63sarT0QNQjSmh54WglUxM3u/+ziGAkMK1vDHdbsz0VIM07WEMScYyjHP/UyvKutpCmM9UBpxbknwRCoFBGRyB8B43xQzA2fnB+DvYr1GMs+iW58owZl5j21jTbaAvjK8xvJ3yRvTkj9JhYnxNXIvDpMoBML5Q2mBXjNA/vqjQTScv14dn32Kc5TbqJTEPYtpxhxzzDK5eseAjlmz0Wz+ZALMjy3bh8yJZON7qWsV8WBdkoofc8XiseInNvk8UpRZcHd/XRhwysXOCTmNnyRxoTbmhfEDiGXU7wMkEKk/YS135uug8N/nmVAoTslp2rUYHjjx0w5fJFEzkR0L11xwE0i/2Op8rShF92NuJVrQbIBW2jiQVOK8SKNG3iSGtOCmSgCGc0O2yA0pJ0zpX7g+q9xenW54hOvL8l0WAnCWWemgRrIgM/alzhjk4u5a0MHLT/jc6i3+NkkFIJjGx9y7I5RykjQdZIJdCOIuT1PcqSKVjFvMn1M+6kFry5neqVtveDHohggSjUEQq+udHGsXeRw5XLgjFT7SfzTs8kkmhfdfH2dcBLEvcybyzQ1HGDX8uDg4ft4qQuxS5THYXKKnmbmKzog9s1YhftKT9W5AIqMTPj1vjOKpDFz4jxQKvytwYQ6m2/EW7fqKdEWcT6d7U9QVGtFkK32Ia/dAoxcDPTtc6xyyBGMnJB1236RZ2cyzbNyXO6u80v/l9opxMwHcVfoITrxXn0xtpuJZsE+kyNtYKFpDozjlm/GpMaW7Do+FUbl91mODKNjfmG3Ivt7tQhe/xgHqbIk7kAtfjkRKFO0OsqFG3FNHnOW+pA+nD4s6x8nP9GXX4mJ9mQN4aD1DLbscsn3C362WyfPaGH0NkqVTeJKKj0pbpnI65+IIm52LZ6pIqjINZF1sqmExdckWom5PQWNSplYLAurgHuKc5Qxa1lE5y+ALVsqdl1JhSX9y22xT4l6fBBHv0TB1k8JVaT6g/0YbDbaqnv1xTqyBwdDnlWo9vza+PxMuM7bJ3wVQbjVy0AWjqG/4bM5X0OKR/pQtAIHJjbCp8gCje15OVohJZdan86miBortJTNiTHL5jB5UK7ifKl8QzpbKzt/ZyRpCF/LcTxzJscjAjbjOP3rtURnRAX2JPFKCwAKSptGiNObp4QVKU6Vonk8ux0MhlOEfa7mGn3ScXl6hQ+Z2hMUHnKf/znL2aYBywcbQ/HciXMQsp3opm4ieDnzZFjGHfn//3yW5+udUagYu/zGkGsyjU4tD9bZVOCdxyWMrd5SUB6etXOZu0nypqwhNiYfavZNgH1vbvaG6CErALpSaD5NA7vxAcGhs0fGnly3V0GSJBICBxAVL1wdWm/J9GpKKvmr3X+hAt8qiSAV/Du5uy4iCrrfZQV4LPa1FExsAZZopNgV8utFVkveE+qzN7qeSn14vgHzLX7/O1BGJ0iRnnI6/fEwFJ4eE19tbwD2nruKrlehnavDEaEg4PSwtQpowXUJojNAWMf9gkrKSt6tRbnx8Nvdz/3Yw596IkAkv0VHE4VrIlDwu+6HU8U2/vPqOuLVmNGG2KarvPyCIDU9b0ixGsuXQJgaa7/PHMW+beMmaBCE/Y4cbCCo3EGFwR9ad35TmdwBPpr9LZzx2TjNl6eU6+RQ1cq+H71FpVID3YIfl4vf6u3ZokfcxcHM10ssXU8YhS9/m2x+E1cf8TWTHC1V709PEr+5cSPSCHeocctPG0GdW4KTFGw5eVqECtepJg8p9ddh1KX0hLSkxRL1A4xSEKI5s5g70X9RPAsjnckZyrjFNZ/+pCIQ+1tibPL+M0GxdVkorSiFxnUViKoxVd4HFk62E+8Nxa9T6tTuvdN1ev3R4jZ/HH0dbCK6tAXX3Ik6iR8rSTJ54MNvLJC3YKhpNrlP6A+iYNAIY4wu2OYUzQPBkW0bw6Ns5/8/Nl4D7jis2QM7oySrXMNrva0dx+kSCqTh0vG/8h6rsHsVmu9lLbC1uJlcvZQSpf1d5GMJZ1tbx3omkkbyZnBgljbpHZPFPpoX/ovLfxiv/GW0j6BPyYpKJUy1XARPtyT5GvwP9ugd/yepZMwMG0pZgCChu98Um6HmBAFr2AT+jdCMxQHhil0rjtevMNUlgwJfMqlx2EGzfsYa5DvlqYsu18Q1sUu4W0Gv80f42FdFlaw7MK15u1afdu5VIBt/B5Ih4riYCebeLbuDNyCa1AX20GD86tt8SaehOZS06V1im6Vb7BXIqHTpxJB8Ddr8YDlxrHXgXtXCq/2i/E464bU6euDQ7hssOXliXBbdEyfKA+TTPNUGO4WcvqXWtlN1QMKScl7R7vnp2sYwO9XxVuxdFMzOypG9JeGt/7mDfvThAAhPdAARl9U0RQT/EUif83VTcaQqjNeSfe4qonJVpJg6aorGeSp7Z636LUR5ahsifhJOBr2Vv9ERu+OQqy0kYR/MVkSaESH/8eUwDZoeSwIwEmkO7A/+vobqbsVpN3ryTSoiPgTtpdFsCrB+06kJ/Q+ZHbMEtGjuzmRDCxce/VzgxBVmiZ1Md2D4x8FFBITb4I8FJgoq7qtKmg+SLPh2duFNi34r/wEDDeo2tIFJ7oMxHf7QkLMthYhhbVZti/TpIwPEx5cLAKvZ7sflDD4WGLRRD1zqQQ3zx8kHw0wCla4f65wGpxCdyE1FCXnVdjwKbxtaVSlUETlH4my6Gvw2tYRuBPvyvNYmT7s6n69or5Il9MGPQzJqKcMwbDh9abkL4VOj+73v5KcYf45FQ3ckZDktBTYV3Z5yWQddqrRPcXFuypBwh68GfwDcOIagyfuSos+eG465rRaDmH9hWXCaLmKc9dti7ei+FiqyJjYha2AfblX7bUrGtgG7Q7K/JvpiG3ta/EKg5aBXn8wX+5p1vC7+btteZC8MpbnBTlpvyI9+Ktg61IxQoiKC1sC9MUn/pjVUV+nmBt7qxhePK0ApnvCEYw3KisGeFGUAZp21E6fgH9PQikv3Q+nQnMZcf16cjXFM5O8EdvvVtZ46+WnxiDOdjt+2txly2ffSHLxag4mwnJg3/PZEyeOvUPKDmUNLiBcj53onfRuvDspyP2LBo4OynOxV7vw3LBsrxq5ghPE5ocFUF2pC1ru7Diau6i/ISpvgszpsoW7HlRWyzuneTinP+RwB3KKJO8Xo1SO3iDxFHuDuImhTo+s8xUNo3oCJLOfxowrFYy8fURmuqgiuhsONUvAmwBkYj2oYrLw2Ipoz9NEg4keXGbyW1CaG1PJfvIYPY2z8pZkKFNQcxOU4ZLtTmRLybhGp+JTVD6130jZm7HMN9jLwCbmCfA+QCckqZxthh0VXflLUnsXTsL5OD4zjzu+nJQcGe3fkB1utjUXVrHxold7L56xdaQTvx+8nZGCHMcSegGCZY+kUg1y7wX1innkxQt+CJF2AV9I5EoSU3PM22lcdhSJIyXkB/45IMw876k3FzXZcrf3xrrD9jPk+F7KnEoXMX7Vi7W64c0n/jw7EO5VzVHzTp7+wItXE013u+tg7osdwv6XCMA6qbQWVFt3/9N99Ri2sDPkjJ5PyTZBJ3oxxxsEqKXjMD9srryOom40pCgNZ1wwiIgXiSrhDUbkNw1tgwtuYIjVi3aaAxRk6Jo7riI/awuv1L9Drmr75q3rdZcdSYTZEub9IGtzCKl/tdP7TOmc5XQXT/8EbFB9LBSUnzG1uFj08ipp0OkMUMmylBUYDSyY0JJoCNzrKeS5yr4oP2H+tWLPmNTneA9MdLKqJknZeeV/1kI7II4auPR/vr3boJmqmO2dyK1zHCJZ7yR3oBAPHa6f3OH9mg0DVBqe12LeDWXMfVSi5nrffYgl64J14q30gGt21s7xv+2obVldH18fTO2mAm017KF5FothtdHj7xjmM3atEyQdd4DBN/h3WoB5+EHEhlYQp80HqYLcIpvCltyIwHrqziu2QRXuQQN1LNnTdxIFQW1bvELZbn24PsvLzEwVLxB/mqDDgMF+pNPZjTnMiTno0GX1Z4OLpxxAsiUeL7RPsuELv+iW/aP1HJ1/wNU+S6uh/8ZpRm1fZqwNItJYCm1A8q+t8UAOlqqlzLgbRP1fFDMIW+q89tFX9ZRZ9GWkrbHqKyy3U/v0CaRL7X2AHfSLipIOgHbDg3Df5oSvUsqrF557YAIjM/1qVxLtRgobXVACxQ/kG5ykTTVA968FaF68v9cLVoO9H7Dfzjzblm/TbD7uD2+peT9czyUNtJrd0FsOc7rUomrHLASBYVddGSQwsfdypnMxnyE5dHGN5QFNJHoKXk4UlrLHtKC27YOTKyOmz6cypQjGfEZLLkDYP7ZZpCviEN3qAA5QQ4HxaonkasEEB6FAzUWzrFeBUWGCa0wY0ZqfJaZbVARZSy8N64S2oXPmzM0KrELZtFcx2WLHZrYxOKUdPLJUebpS/CheqQ96Kx8p2yixpcjpSAM1Q/vbDZKTZE8S+RrPWTkvtTJlIoRzs8IyuqSa248utcwr3K4vVnFPffMZJRKf/ZaAT4MA2LBSOmVble4oN9IyP6AHmhzCv+dT2nt8GRrI5ccP1kD0iL/KnVOexC2X4l0KINCDSBmzEZDFIK3PQ7nKjOl9W9rxWT4X+FN5+GqmS0zN4ilDFINxZG7VXz4/1rRQJm0iildLcnKgjmApgJwbr74PdRsttvGbIkGJVdVWOJOOotDKyrQf8Dhx1d8cqI0C96kkvZJxClFpw5jUCxTbtX5Vr62GmkVidgHf/9d2+S695hN61IMm92JH0n+duRQMY7mF+MM/m9d3VvV2iqaZtYDzzDCqzbOFuip1tqYP4pZ4rmTEcJckt6cLUeOVR7g92mPsgKqtbizb3WAp68Vk+Y1XgVdI2yUFEtHgzs+b+5VErMH2fXOsiiMUrxc5mXDuyVmuunFhV2VtXEl4u0Q23KM5+GJRTrJJiV5ZxZRcR+VBI/3bCl822hMFn4yHqXl63Bv5tBfRlQfF+7bcZbj9UGMVlZ6hnDZzeDOybqnk3Q4rH1uSuQwU1pKnrCgP0OilGrPTTK3FCyLwiyYkMcuZB38LII9NbD9C0OQB+494FMZim+PDcV8I9RW5f8kEvBJmmph5U7FJbUL8ykNEqM+ESKAmIyt01bcPWmGc/8l7QNGTu18HKP0q0fFBD5K8Qo4cx+A6SC+mz5jmBtp4s2ZQ2jn418dVqDgx+0yygRZOZ81psA895A+Di6POVIUtGSqxIZTIov59bb6J7/F8s26l+JTdebbvqf5Ej5r7wRzQjAeA9hwSRc4TIVkaqgT0CuafrNj2/8cxYEdbafE0OUNphcHeqQhmMpEiyFoHGC3U69jEkmwTKpoon6pFz4tXboC82MxmvyRkeiP8IlrWs5lO+wD3zvNk2uayAWobSYpdt/QczFSeOQmznp4vaPQ0EQPiy5RHuglgAey0d/jQRoyM0EeGMrfCMS1tSaEXFiTNNjlvxHAeKNdG7Co5K84Fxq0T7FV41/bCHfPmqYi6MkXQYEjT3hm/G+Gxr3Np+b4KyFoHT2fbXiYlofXg0eNQMc3DHjlCvYaCDe9Q+OaNpShdCf5davdmC9v1t53s5eUmf5un/TeUFOaduARfaxm2SJ3I+/NoA+MYdnJ9WDCRonq7ixb0ApNZIo3ZOoUULVY8XxG56HdY/vMtZrTROMg0ROOF2DjQYW6RbgokG8WdlqHEVK+LTJH/eTrMiKA33sMn59PJpADFfU5FzSxZ4qurLIHge5o8/Bf/oL9L5ZWxtCK9UMBKFl4o7IreWGH8ZysV1KcRUESHUEZIhyTAwMVSNNz+xMsIu4NZNLK62bPDIC1YZPek56RwBwdORXQXS0u66OlblFdUsyQKEK1/xg2vHyNaz0vIRZTojTfeH4FVO08ap/qkHp8QL2fk5Gt7T9WVyUEHH/w+gFZADmZJ+knEzO8WMJfwe9ANnSSwlDFXBm47I79suZVf/eOOVezYES6k3a8wMg+oPwDAwC8XSLVI2bHPZjwT7pvKKDgaw0PT8jvYMF+LaAdVL8oTqv5p/29S0G6wN0JSrBgCOWYVgxvNRRHdFsQrU7PTloqRazPN2m7MaZX+RuBeYNmbV3prawqzy1SqEnJf4UjyaKliilU+angfGhL59okHJxjlAnu4oBJL5VE/teSMq8MsdQuwopL6VGFdceJ0kftNtx9JaUr0CE0TVloSBdklV1GBhgx22W9j5aewjggbqzhzBj0j+8mfKR1QSfOROLCcKq6uoKrhomvBsnq9KF0MNx48Y52oK2uK3bE5eLyMv3+WH7EOIUuqkcy6HUF8tFOTxjJE82ndoRDYpotOfcsxtV3C3yp7NgrpnzmcyvgS1L69OX4v0ixA8ndiOXwRWO0yhaCpmQN9swfS1i727uLH2K+yvCJA7hzpvoWLTcdpI3M5kWVzMl+jWZfivuqVmRBk2VXCgx20FL6YimPhNP6swXqeskp0DKWapxi1osDqAa8pWFzjUQp7EH/wM5gvN/1ig4d9B4gRISl5WLNfyGnQgjdXXfSLGNGIxd4GILL/FYKyn9+2mUodLEfma3szhJsj0YhDgii2zRCcKwX9Q5Q3V3aRyVqOBnTMGRJynKcohn+peb0mBCIoKoy7MoAjjwPiHAf+Zl+cRxFSpcUsiwdboRULK1ygS/LJP1am2r5eqcByWKbRpPhY+8/qGNmnAAPNEbemLpbZi17zm1KpOICEqWK/NxKspI9GavppzRZ6GuSYSs+nXx78OiVuYZcoXlRxiWj7R1Ijgfv0ZAbwnx1Gbo3TO31YQonwRpA+RCP0zoixNNXPpz0BdtmKqz8y7u5KKI1l2kRc7I3Lz5s4kDeEohgGbpk6taSnWHUJD6vDG9vNH+fjnKxzYBSMe35RsH6zfP60nxhJ3pGiynHtprkY7phCiEuuK+vXo3W6ib1bu7MvjvFwvTCAu3T1NpYPIwzdzGHsiWWNqcJx97hgc0qse41l4bR/U43Hqa/O8VnMl/ZitJy8ExuwuXU+AZBmOU2XTR+JA2SFfkhMDazqSYBMZeO/hNFCaPtw06l+jLDwGBPMfL6351btU1kcGWsYxwPVzWdRKAmA9a5PXBIQkHpGeNI3Fps/WzZTofhYn1RqFYBLwfDge6GkzdiAVapCHz9f/LDvw+E8EaagzA44LZhjkqtQL04szTGxbZIhzLIWP+0OPI35E+zN+xh9Wcwz1PvulmWMB4Fhjj85CuaWtF6Mrez4AAfxP79Df5NPcUIafFcD9uWBMWi9wxTaAvMVkRhhZ0jmWgezUFQSoMzdty68JhQym9F2vIxWibTqTiuHu0AZlYlcPbj+N1FNmBnX2ikb6l4ju+/dm9W4v3yvm9WBwaotWFYlzuzmSLQnKlbhSDkodwpCGqaC4bWIRJ7f+Q6dvTiz6D+8tgTbPb+UqDKCSQqcnlDXQig5pH+Pk+uajFyefi76bL5O7hKQTjEq2m+BY6UXR2gRsT0CMEtrC6qaNnmCn/iSn7pQHqWPJRfhEjAWryJkfvOQmGHCDyEV+icmv/nbnH4PyiDfmcN8Uv4E+OrMrGS+I/lXs8oAcrm0eduh+/xvJ5GhD8A36doOQyaHEJoyUMfYS97Kb6oB0MWWYxovrTB+iBkguc9awimqxvsPQ0owxJeSMDHNApXcgFAl4UykYBiubi3xj/05ZILDog4W0puO038BSVk3XUcAiowPzGsbPb46MavQaT3iHqd3r58srQbKJJKmKAQYO2k/kfn4sSzWO/4BrTP3/2Wvhvzxrzf2lBGZVy3wM0zfNG9EDAdAAXTIUWJqTiPIEj9C5sqsHlyvZTI4QqaZ02HXMVLUULgjQALApEj+N7sXejOp16Lhhyr66A0cSH91+H+H1INwhqPWwiGqjmZQFqtuzEBKpbKipPlGrFKH9QfvC7tqICY/HMWlPMvSahQmoTbS7I27oTblkGQFyhRUc8Uyx6L91iJ8GEyuQglDS5//HamthBWCL5rd2XoHKjXla5WX8w9CabLQNtRaEYfPZMjJAZ1q66eoINKHz4vMB3ubQseQV5If1ici1NUIslBS+X4ZQ5tYhozIM/g5fnetStptK8HIr0S5O2mUMNvguuHl/1qlr9H9VVoCdOb3Y2THYT48HF4cuoft82HOMASodkfiJvpWu5B0pBcwaHgLKl2xh26d6dshasxL03Zi+1NDQiD+lqSX06usXDeGgXj33Kf585UQbywqtHPwhB3xExxmXX7bhnsC2x7RqJtn4229IFDoG3ZYp+aQmgB24jq1+1yRrLuTWS0FvtDnViMabWF6JUSotY99PtswziBrzdqsaj5IrnGeEjJf8ASngDKlVqc/szFLV5nQbYPVldjUXPd+9T3q3t5GfohctBg8yAtc9S6qIj2LTFx3ltSfggjzvpo2NpysL0RV2XvlPdEhTZhD1tfM8SfZ9XVZtIAcWUOCvHg3Mf/mtFwBOZyLWadOWViMbJhXtpvm4nH0m8O/Aa98Sh3bLvGFXbDSkYHLU0TJ0uphWMl3fJHHqveuw6pnvSAdH+89goibsPaspJ8rSFrEJxrgeYZXg9IfqTcMxffaTQFUurVNL/M9iWnc8t3ugK2LIvKk9uQqee5y9UIftOuT+k5Tl4/PSzNLZF2yAFpLJuCavwxjtiwsuxFtDyRQbiDAbyW6iu23XDesp4BV6pkWNFCwLKfwPHfUtocAlru0RopIdWBWl78/5Bg1u7ITfpXdK2KadPWpYtYkdQbeY5DH1VhpV1bCfjnaOu9g+YPVAClLazO+2o/H0QaYRonDtd+NH9tLojDZoHjSVahjOGkt06lZbRHxnlSqfC86oPis785daiwr+CWOU0YA//6vznCCXUpEVwBYMwYGFhj7hO4nH0w8XqTz3pwODa4swPvSxvUy/+Y5AISpKdJGI4g+5Z4+InD5G8HwTn4JVb8KDm9lb/OKwz84F1kljQH2/XjLkxNLJFpf3aYv9+K+A2OtRuEzGrMK8TRimLR5NimZLJLPqIj/llv8ToyobqdsYKULtOJVokXIlYPVO9tNFx1wvW7/UTcpLpb1a17c5dnZRQU9nQ8C9QEh8ljqstkyhjHiFfPJ7rBexgPTzat3GVF9n8FNT49fP2GC0jYhBRTS+aL8FwhsVbtHxxYjMtpFr2PULuvo5pfQCrV/ThqHAJp9VSCxixo8TOvuyXTqatelH4aEA2idKAzUeeCspg0rGS/HNp8N+ca9FIWkMDWaT25sdDit77Z1pvsoKSj2gTkUYmKL/6J3hSdEyXJ+U7zrWqbZfJw6764S8Ml6D9fALS1X0MbNvjT1a/nULQ563NPCy6AjOJUzO7GVgZqS8ZM1kv800moFOU8cZ0f/6a4aksjlDNWYzvbirfmSiB3NBT5+ueP44XGVoIB2UjGg73jXVHjbwJaaiYMpEit9wUqjYVzreaH7vN3Z18Nn712fa9zxqke/i1S48bMGy7WPhfmxiOpVD1thlklq6I/HQfJEK9vHstzzPOT5wO3qv8v+wR+fvtU9LaYoJtnR4rTdetgpEoXubKe+n39dxMA3Mj1nDQ7bEKDBOVI7D9Ka7T7SxdvsVgmYCXvbx6+8AU0bDay332VUizB/uUHEnzXiZn5tDKMguVwtyAffRQANEL7jMBIPv6staK4Ol4oqeZzGDbSkViYNy9i0RRRuy50rM7L7OT0qaeP9IcvCG/kAFQcSPDC2wNrRDLAphzOJw/VlHOeXfvBZZwzXLSGiL14RR9EflgE84dSS+q67uoRRGjn5shsNWJhapimZ0TscmGL5hw9hOjydO+ljidH19YPYUOxCLxSJbisSpsz+D5oNH3pKGfCJLKZgt7t8diGXZ3Tt2dwwcVvnky/rRf2uNgirfJT0CGRTfaMdF3aWggqLua47+WQxVkHCE2lGL6L0PJyso6fggK6YARTBi/OHJc7EVkWd/BqLeqdJi3bX1V6HFOaQbgvmA0NT62NrJ9ZVzOyIjHT69arz1tiEBf7YFp/dUw+dstjrkGcA1xcdJ6U+SljVj1dp0jMRXC1sdR8TSDTNwaXCMv+31XbliyHFbWWTuiWwjQfe/2Njf3fi53Dkhrcjq7z5MlLNjvBIDFvn5wtqJU91Xl1Tmzc38QhljY+c8uP9/VUWs24Z0s+59KFkF/61Ft1RHuBjwsVzs3rf4sVGU5oyIEutczMb7JTHEOvL1wQXuYZexsAbp9+MZ8G1yiHIdXBUggB8OjPczzM4I0YjZ37RmjksADvmq940GvcOMJXzHu/RnOZdDeN/+gurNJH9rfpfLT4WleuAPuNCwYV789LJ4xkNl22o3IhcyMuhEtWPiPPFU4ULqFOSO3DtJKgpvfi9eXqxnLw9HdFSs532wUFYVSlfcWN9L+4cW1HFRgN8LFrF2pmbe+cdh+NQpr9jHBfoxs/nTu1PXTYD6nP5xhGIfEdy7lCmnu0hrF3h9h6s5UqQyXVjWCp/CrnMLGkZ8Q7qywawM+bJVJqV3H94ZTZC1v+RyxCPGSGE8l05WyOeeZHMK0ISHfSu4z7V+eU7oHuJMpX3+6Rjb8/RuvsjluZSBPyPh4kJ19Rf0kclOMEWrHCjKmuvYgZ2WaFdiM3ZYLM+RtHuu3JrwzzPnC32AVl8igIKKdK4ktKJOQbdulBPx+N/YgR0MoweCMfr9qVjD0qbiE/IsmyXxvIYiBCY/stizQ7ji+GKKdvfHE3Ce8jzDofvRZAIwCeGdgAid+VbYo16Ww0n+h9xZ/IGcPzQ3iuj47DzYd/w3AhjHClvIrg9sRQ1KPM6fiUS2Z8sX8HCo/RToexxEsTukOlYU24e50jqGT/ptlJgPRyTPhAed18HUQsTGzWShZUeyQUnPMBGcwgwTN+nn3Qzg5OD5hFrAqE/vmN27JCemGC8ijrFbHv3ZIifgP5lPm2JyOx1IiCFBpzM/WsIQoVgK04EyH7t53IT6YebNCdX9q4sufW8UZgAoBtvPMwdoTZVwIY/aRwVidk3i2GfgDMqH943/Al81xq9HQnq/htvvC+xgzp2mSIpgSbPVMOtICWv4cPYAWOicYfVT3Wyz8+LEQp3WTkbYV9CbdS+Jx8WO2bWBCdgDABlJAEwrHxf0DaYIY4s+5RQGIGLx+i9GVl18FHdRDEbxkRuQDlRIsJGQiQ43KAhufDjkCgV5kKUTQLhJx/pr5h0qOYlq/JDtpK503kLnXdPaqJj36OSIQ70+hzHY1YUEnRK4I4WPOEQHD5oMXnmWKnnFW2hJBHhShif834wy6FHfSTghV+kIZS2k3YzH5eif/n5//7urzO6AfdlIlEZbwVxRrpBTQv/1LhQrzJhqKrS/7wdZ8yguxveI1VZMPasB0jNXHujXIx0UnKwnQWla3rXJiZ3Jskg3EPLREGceAFjKlDJKlQjf/Ul+4WQFgijAQZAglYrSsflx20yI+KlRHqoDWjB55VTNGvhV4q2Ci4DCmQLUqoAEJ8xLZK8C6vQ1wmm8aAXQJ49cb0fNtuKAQl+V/StlcR8t/6114SMqcccm/WV+Jp0QK8NXzsOU4pynqRHt9DbwiFdcAZpjXV41NRxolPak+iI5IymN87CnJfMkhjg3ZlME+OPlrBG8eaK9CyScN6ZpohluAxxC4fQChON0zFEp8RrQAXCwTs6TRCq8ktzukthWFCL+Prg0b7FjEIYCWRS8H19wZ3BGj2cgPlLKe7KlBq3tUIsaoGg/FEEdYSnoCZpbSNllUafghXf1xZeuxbsV2jqT1MwJ6jW4geIfqMwhAa9lcwvfs5logsVreYwGEFeVpp67fGpzLBWyMErhLRIW5EJDq0njr4mN5dz2g/BzLzu0S827sf9PzmKunaSfXQJ762RbXqN4MmouCzP9o/i80+Xj2tzqQQxNQeFn/1Ef/ATnovV5RAyCJmgiQ7tcUkvZnrfxCFLbC9axSxLVFIGgyoDxlk3Tbi9gLawvCuX+kqi9g8e+H7eH8w5w7vjuyI0f+HtLgdqfZvPkCze556d0G0LOEcKUw05fIt2v2ZYE/juId3gVg2QBK+xMDPIrTxLHSDhEnSuNqgqw/1nv64QI4J9CLfP/MuKz7WSaodQoOf6PzrOBPRgRb1K2/pVPWF/3ACBj7IuC0Z/g6mRQbvCQq4A9HJccLctW7uObUtZyD/rRDtwvwGJesCGC+EkZryQyQ6uwPslJkRr3fNy8s5p0mdC46lfLdPPKQQfC/yd6lL/JsjsmSjafuJYJaoSQG/z0T+0ip86EU9VoxTQAYGBjp8oCV8w8WGuvi3cOWL9bfkWXjYV6eTp0+j5RbetkOm0DsoQF0xO9QimpJJ/jSY1e03JWk0pZdFDlduU+SigYxDcl9nnME8AbcnFD20i0EcizRNJmsrW4fUPC0bcH970cliOU1Yg3D2L1y36QSBLiAojFJ7GXSphoPSfRfvYakgBvVIJpQirl+QerhqqZ0vMbvxUlwfOQY/nWrhZOltvTWCGzwqmA4dG0oVrpUd9feFZWPXAIfpGbIg1Vmjbf6Onp/Gi+kg88UEEjoDSeeLCD/R0ZZevF51vC3RpOBeXucVxDUzlfNxFbBGxOO8pQO91FTZOAJqURpaTvNLk/UH8P2ecVENsk8WEvIvIDeeJ7khTG1OeujnLyiLig+iEHc9EEJE0U/8A+pUL2cJaO2TO70GjE7WroiUEhLOsZ/FNlhWDUWsujwz10womDMqJn3Iw87JcPLrFm1WACXQaumT4ctFnfyo7tNOHjNDIhse5j//YnGf2FT3nj4yf6JBT0jpU+6ptHRtYdYkmACpfOgAn+5Ul7wTdvYLx+x1w+MLc+byYWroXf9vZQVHwWkinwtUZSmbxvN5Gf4ZEc42KNwNX9cwTz/kINh7b007lV9lv8qLWzNJQ0tPgsizyvyPVtvHkAl/y5tWDenLgsZzzfzvvHBOF3Teo/suZhMHehRVuTK3DCO66TSDv0RIEI2Rdlrf/weUVmUwRfpJpeIiqLB5zDtzeXzpnBL/J+WWFng/NtKShqPqbj69egyeFLsPu9FR7WEs4PTMp5OBzv1zFnaadCVb4exPgVYa+33zo5+n2/rdehX7crLSPtxAjWHYSjNFpWlBXvxjqbt6wANhZhE8sctO+sNUySEB8K26LYiF1ZAKlQ7XAXbhPQ7SY7AA+MtWX7dcT0iBYVYJmv4HcXMQRSU2Ex3FHruL87jmQRIu+GqDISBNsM4/Z18CyV/sZ7RsFhZpjAXQjQuuBKc9T9i8toqjju2gfzD6XquuGK5AJv4flj13mLCVDrFA8cIXxGJYMCQZMOxcWS65KALy4jTQatqzD41IK8zFtmrfa376dqzs48DTFfkSfKyZA/frYTy/ps5T8YcPsOXHE+hmVWOJ6oU6+XDONhEkjg314kCcj7t68k1snkE+5MPCgkVXX6fEt+eJHVN7mekE3p7vAVQD4MtrnIVbUFBVnS4EMlD+K5An/s1d09iPnFr/B974FNsjZb69ieWP1PzZzpJWCkkvfnOV7YJS/pvBCFEklTOOVPgxCN5csOkERwoYkk0VFna7DcVj4ZiV5XbRPj1MtAlV7jESlyD+JcITDtmeFyXZBeMopeMzhh9UHM//Kc4f3AKHKvBELEE7U4RZM9S3ifXg+eVogRqqxrBRfVN5F25EJ0/riVO1m1x3V3Hb451DpfUCtZQQi7cOOLx2XGW2iteBppF8eB2dNF3TkZ1qmtEDoEcymUKUBrkWfo47wuVpzrmq/5f2EqtI7viUQ2dKYgSX5xOj8v8VFskMVY6qh4W+5pYS1dFMUCreC+cI10GEflN2eXqEmXTWzbeq+4TL8h6LtAvxQKdQQac7glAXt0SbXOBrKi/6CKDmJRUVQuf+mrrdUBCe4edsjG4r4aqaSWsKtYkzHpPH2c/vWYAEoTNCgRyzeMZci24BjMmaerhTUxK9toB+M1kmUQT2/JBHWpykyux3UgYwvTXDquyZEizVluoe9qRapWQzljavSnNSYpnFQzNCc72RwUS4KcMk98X50mwz6qsRbf2kLKNNDINOd4FSuBHTJ2XjL7ClMdiDhUF7otdcm16w9mSIwnL/u076vts/UJERmz3Ry+UfaV2CukQMgRLynGqWPv9LQypU0LMrBMQvI7T944r1lYXU+WFVW8yEC+7VpSnlFnQP3N6VFwEmITkpfkexWMrxyukkLX0hv1YLGfodu/P7UwCCmZFD9dmbOv8RFbwJs47sGfswkPaWLekM8T5ZweRajlMl9eBanlG0hmI3depPbeH7WPOEvDvjbfELsJiys5fNuoha1+62Qdvs1H3vXuXYO2lxrXyAXEsDWPOHth3MXD+l/A5CZh5Q1QROd3wKzz/x9wVwlw68GtpFqFjyUdMGgIw9JMp/BVj/isqCu+KvQU/fhjHrBf2jIwMCeYpDNkZEd6/MJSVPpIkLJznr3C/hwbx/JpvYHFuoM2AAJ88toODqiCBnXuLngwqs1MAQwRDU+8yD+PUvOKdytrw3x+Kjo7JFtWtMADBVBuxPrLeGLkFjcNiETgMAxjaADvasEgdvh/Us6NbOBs4CGOxdT/a2dFtwJz0aVul0QY3CB48bio0rcp0RkXwZDI29G2/HjcpMYqwbivUnsnGZCsZ8C0OZ/ExElVCiRVi7rQiGF3uxxKJT4hCK508v/0+QYkN3+NJBhihxB8lheARUHIuBXHUkfJVLMEiOrASIXoq6FGcBQeaYQXCk/hUS3DrbqLH6qXgBxXvVYPU2sGcB6QPAGwDsOwvg6ucSmcCmZFku1f88/FZxf+L3rpW74j2vVfM2QdrwlQxr6neIR7KyYKBwIZH9J2GH5C9JOhB/sb1w3XCmZ2Zcf4ec/zeKeFA6xg+9gErBHg9oFZBDbLWm2tfcaG4axrEB8AXsmoicquvcy1NkEuWoKz89TbIBKfVLnj9a7UmwoPDxsbyIqMSHbuDjqL3bfg/bygKuNqYDoa+sYrXLRWIPwACSDt/SC6eOXwO1pezvwCEHIGCq/awRw4E2XzVuEHifAPZLmaP5u4AB9X2mcS7ygCJ3kCmPDiVNszkH40wgqZww0hf0XrIX97QnsU40X8wHcuOyGE1UYAenBfBctr9fLj2DlD4YAEfgH3A53Nwf9jvDytla45OiGpm/vPeQAAARJDUdOQdlNK9y9PAQp+7g/3GjkB+5txxiRq01lr9a0ChHuWcaBk/YgADtRMRiAFdB3fKoio/FqWgG/G/32tFzTETxT5+j0E2ZwumSrXssVSe58CRkzGx/u62usD5woCt/2C4IA2vp9/0v/9Ydpo3DKV8Z36oxHGuLmZF4aCIch9A9R0Cjp1DIo/UHHpT+rBFoPAAYiVShHgbckdFK/kBBzPp1MLAJuWWBdC+t1z+wNM1ZbOad2+e9jTwBRNiCGmGHdxPmHF3GoMmNtGBJAjXCfvXSvA6cj8gZ+fCLUACEKrJlh4WCM2YAB33iy+cZi9VdSaSq6rYAI6s3AQYYIvDt6qSYmeif9qj7zL4ghpGDN25+Qj8hl13aU+QJo0IaAAAAA",
		  "wheels": [
		   {
		    "src": "data:image/webp;base64,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",
		    "x": 16.76,
		    "y": 73.68,
		    "d": 16,
		    "speed": 0.16
		   },
		   {
		    "src": "data:image/webp;base64,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",
		    "x": 78.48,
		    "y": 72.37,
		    "d": 16,
		    "speed": 0.16
		   }
		  ]
		 }
		];

		BADGE.BRANDS = {
		 "bmw-m": {
		  "src": "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhLS0gQ3JlYXRlZCB3aXRoIElua3NjYXBlIChodHRwOi8vd3d3Lmlua3NjYXBlLm9yZy8pIC0tPgoKPHN2ZwogICB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iCiAgIHhtbG5zOmNjPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyMiCiAgIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyIKICAgeG1sbnM6c3ZnPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKICAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogICB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIKICAgeG1sbnM6c29kaXBvZGk9Imh0dHA6Ly9zb2RpcG9kaS5zb3VyY2Vmb3JnZS5uZXQvRFREL3NvZGlwb2RpLTAuZHRkIgogICB4bWxuczppbmtzY2FwZT0iaHR0cDovL3d3dy5pbmtzY2FwZS5vcmcvbmFtZXNwYWNlcy9pbmtzY2FwZSIKICAgd2lkdGg9IjU3Ljk3NzYxOW1tIgogICBoZWlnaHQ9IjIwLjk1NzExOW1tIgogICB2aWV3Qm94PSIwIDAgNTcuOTc3NjE5IDIwLjk1NzExOSIKICAgdmVyc2lvbj0iMS4xIgogICBpZD0ic3ZnOCIKICAgaW5rc2NhcGU6dmVyc2lvbj0iMC45Mi4yICg1YzNlODBkLCAyMDE3LTA4LTA2KSIKICAgc29kaXBvZGk6ZG9jbmFtZT0iQk1XIE0gbG9nby5zdmciPgogIDx0aXRsZQogICAgIGlkPSJ0aXRsZTg5OSI+Qk1XIE0gbG9nbzwvdGl0bGU+CiAgPGRlZnMKICAgICBpZD0iZGVmczIiPgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMjEzIj4KICAgICAgPHN0b3AKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6IzQ5OGJjMDtzdG9wLW9wYWNpdHk6MSIKICAgICAgICAgb2Zmc2V0PSIwIgogICAgICAgICBpZD0ic3RvcDEyMDkiIC8+CiAgICAgIDxzdG9wCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiMyNTU4ODY7c3RvcC1vcGFjaXR5OjEiCiAgICAgICAgIG9mZnNldD0iMSIKICAgICAgICAgaWQ9InN0b3AxMjExIiAvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudAogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50MTE2OSIKICAgICAgIGlua3NjYXBlOmNvbGxlY3Q9ImFsd2F5cyI+CiAgICAgIDxzdG9wCiAgICAgICAgIGlkPSJzdG9wMTE2MyIKICAgICAgICAgb2Zmc2V0PSIwIgogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojMDAzZDY4O3N0b3Atb3BhY2l0eToxIiAvPgogICAgICA8c3RvcAogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojNWY4ZGQzO3N0b3Atb3BhY2l0eToxIgogICAgICAgICBvZmZzZXQ9IjAuMzY0MDUwMjciCiAgICAgICAgIGlkPSJzdG9wMTE2NSIgLz4KICAgICAgPHN0b3AKICAgICAgICAgaWQ9InN0b3AxMTY3IgogICAgICAgICBvZmZzZXQ9IjEiCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiMwMDJhNDk7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMTYxIgogICAgICAgaW5rc2NhcGU6Y29sbGVjdD0iYWx3YXlzIj4KICAgICAgPHN0b3AKICAgICAgICAgaWQ9InN0b3AxMTU1IgogICAgICAgICBvZmZzZXQ9IjAiCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiM2MTllZDU7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICAgIDxzdG9wCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiNhYWNjZmY7c3RvcC1vcGFjaXR5OjEiCiAgICAgICAgIG9mZnNldD0iMC4yNzk4MTQiCiAgICAgICAgIGlkPSJzdG9wMTE1NyIgLz4KICAgICAgPHN0b3AKICAgICAgICAgaWQ9InN0b3AxMTU5IgogICAgICAgICBvZmZzZXQ9IjEiCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiMzZjdmYmU7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMTMzIj4KICAgICAgPHN0b3AKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6I2RiMWUxYztzdG9wLW9wYWNpdHk6MTsiCiAgICAgICAgIG9mZnNldD0iMCIKICAgICAgICAgaWQ9InN0b3AxMTI5IiAvPgogICAgICA8c3RvcAogICAgICAgICBpZD0ic3RvcDExMzciCiAgICAgICAgIG9mZnNldD0iMC40NjI3NDY0MSIKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6I2RlODc4NztzdG9wLW9wYWNpdHk6MSIgLz4KICAgICAgPHN0b3AKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6I2M4MWExNztzdG9wLW9wYWNpdHk6MSIKICAgICAgICAgb2Zmc2V0PSIxIgogICAgICAgICBpZD0ic3RvcDExMzEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQ4ODEiPgogICAgICA8c3RvcAogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojNzk3ZTgxO3N0b3Atb3BhY2l0eToxIgogICAgICAgICBvZmZzZXQ9IjAiCiAgICAgICAgIGlkPSJzdG9wODc3IiAvPgogICAgICA8c3RvcAogICAgICAgICBpZD0ic3RvcDg4NSIKICAgICAgICAgb2Zmc2V0PSIwLjUzMDI1ODg5IgogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojZjBmMGYwO3N0b3Atb3BhY2l0eToxIiAvPgogICAgICA8c3RvcAogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojYmFiY2JkO3N0b3Atb3BhY2l0eToxIgogICAgICAgICBvZmZzZXQ9IjEiCiAgICAgICAgIGlkPSJzdG9wODc5IiAvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudAogICAgICAgaW5rc2NhcGU6Y29sbGVjdD0iYWx3YXlzIgogICAgICAgeGxpbms6aHJlZj0iI2xpbmVhckdyYWRpZW50ODgxIgogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50ODgzIgogICAgICAgeDE9IjE2MC40MTUxNiIKICAgICAgIHkxPSIxMDAuNzI3ODgiCiAgICAgICB4Mj0iMTU3LjI0MDE2IgogICAgICAgeTI9IjEyNC4wMTEyMiIKICAgICAgIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIgogICAgICAgZ3JhZGllbnRUcmFuc2Zvcm09InNjYWxlKDMuNzc5NTI3NSkiIC8+CiAgICA8bGluZWFyR3JhZGllbnQKICAgICAgIGlua3NjYXBlOmNvbGxlY3Q9ImFsd2F5cyIKICAgICAgIHhsaW5rOmhyZWY9IiNsaW5lYXJHcmFkaWVudDExMzMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMTM1IgogICAgICAgeDE9IjE0NS4wMzkwNSIKICAgICAgIHkxPSI5Ny40MTEzMDEiCiAgICAgICB4Mj0iMTQ1LjAzOTA1IgogICAgICAgeTI9IjExMy4xNjM5OSIKICAgICAgIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiAvPgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICB4bGluazpocmVmPSIjbGluZWFyR3JhZGllbnQxMTY5IgogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50MTE0NSIKICAgICAgIHgxPSI1MjIuNzExNTUiCiAgICAgICB5MT0iMzc1LjA4NDcyIgogICAgICAgeDI9IjUyMi43MTE1NSIKICAgICAgIHkyPSI0MzIuNjMyNDUiCiAgICAgICBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgLz4KICAgIDxsaW5lYXJHcmFkaWVudAogICAgICAgaW5rc2NhcGU6Y29sbGVjdD0iYWx3YXlzIgogICAgICAgeGxpbms6aHJlZj0iI2xpbmVhckdyYWRpZW50MTE2MSIKICAgICAgIGlkPSJsaW5lYXJHcmFkaWVudDExNTMiCiAgICAgICB4MT0iNDg5LjgyMDk1IgogICAgICAgeTE9IjM3Mi44MTY5MyIKICAgICAgIHgyPSI0ODkuODIwOTUiCiAgICAgICB5Mj0iNDU0LjgxNDQyIgogICAgICAgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIC8+CiAgICA8ZmlsdGVyCiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBzdHlsZT0iY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzOnNSR0IiCiAgICAgICBpZD0iZmlsdGVyMTE5OCIKICAgICAgIHg9Ii0wLjAwODA2MTYyMjMiCiAgICAgICB3aWR0aD0iMS4wMTYxMjMyIgogICAgICAgeT0iLTAuMDA0Nzc4MDg2MiIKICAgICAgIGhlaWdodD0iMS4wMDk1NTYyIj4KICAgICAgPGZlR2F1c3NpYW5CbHVyCiAgICAgICAgIGlua3NjYXBlOmNvbGxlY3Q9ImFsd2F5cyIKICAgICAgICAgc3RkRGV2aWF0aW9uPSIwLjA0MTcyMjM4NyIKICAgICAgICAgaWQ9ImZlR2F1c3NpYW5CbHVyMTIwMCIgLz4KICAgIDwvZmlsdGVyPgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICB4bGluazpocmVmPSIjbGluZWFyR3JhZGllbnQxMjEzIgogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50MTIxNSIKICAgICAgIHgxPSIxMjYuMDQxNCIKICAgICAgIHkxPSIxMDEuNDg0NzYiCiAgICAgICB4Mj0iMTEzLjk0MTgiCiAgICAgICB5Mj0iMTIyLjQ0MTg4IgogICAgICAgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIC8+CiAgPC9kZWZzPgogIDxzb2RpcG9kaTpuYW1lZHZpZXcKICAgICBpZD0iYmFzZSIKICAgICBwYWdlY29sb3I9IiNmZmZmZmYiCiAgICAgYm9yZGVyY29sb3I9IiM2NjY2NjYiCiAgICAgYm9yZGVyb3BhY2l0eT0iMS4wIgogICAgIGlua3NjYXBlOnBhZ2VvcGFjaXR5PSIwLjAiCiAgICAgaW5rc2NhcGU6cGFnZXNoYWRvdz0iMiIKICAgICBpbmtzY2FwZTp6b29tPSIxIgogICAgIGlua3NjYXBlOmN4PSIxMzkuMDEyMSIKICAgICBpbmtzY2FwZTpjeT0iOC42MzAyNzEiCiAgICAgaW5rc2NhcGU6ZG9jdW1lbnQtdW5pdHM9Im1tIgogICAgIGlua3NjYXBlOmN1cnJlbnQtbGF5ZXI9ImxheWVyMSIKICAgICBzaG93Z3JpZD0iZmFsc2UiCiAgICAgc2hvd2d1aWRlcz0idHJ1ZSIKICAgICBpbmtzY2FwZTpndWlkZS1iYm94PSJ0cnVlIgogICAgIGlua3NjYXBlOnNuYXAtaW50ZXJzZWN0aW9uLXBhdGhzPSJmYWxzZSIKICAgICBpbmtzY2FwZTpvYmplY3Qtbm9kZXM9ImZhbHNlIgogICAgIGlua3NjYXBlOndpbmRvdy13aWR0aD0iMTkyMCIKICAgICBpbmtzY2FwZTp3aW5kb3ctaGVpZ2h0PSIxMDE3IgogICAgIGlua3NjYXBlOndpbmRvdy14PSIxMzU4IgogICAgIGlua3NjYXBlOndpbmRvdy15PSItOCIKICAgICBpbmtzY2FwZTp3aW5kb3ctbWF4aW1pemVkPSIxIgogICAgIGlua3NjYXBlOnNuYXAtc21vb3RoLW5vZGVzPSJmYWxzZSIKICAgICBmaXQtbWFyZ2luLXRvcD0iMCIKICAgICBmaXQtbWFyZ2luLWxlZnQ9IjAiCiAgICAgZml0LW1hcmdpbi1yaWdodD0iMCIKICAgICBmaXQtbWFyZ2luLWJvdHRvbT0iMCIgLz4KICA8bWV0YWRhdGEKICAgICBpZD0ibWV0YWRhdGE1Ij4KICAgIDxyZGY6UkRGPgogICAgICA8Y2M6V29yawogICAgICAgICByZGY6YWJvdXQ9IiI+CiAgICAgICAgPGRjOmZvcm1hdD5pbWFnZS9zdmcreG1sPC9kYzpmb3JtYXQ+CiAgICAgICAgPGRjOnR5cGUKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9wdXJsLm9yZy9kYy9kY21pdHlwZS9TdGlsbEltYWdlIiAvPgogICAgICAgIDxkYzp0aXRsZT5CTVcgTSBsb2dvPC9kYzp0aXRsZT4KICAgICAgICA8Y2M6bGljZW5zZQogICAgICAgICAgIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbGljZW5zZXMvYnktc2EvNC4wLyIgLz4KICAgICAgICA8ZGM6ZGF0ZT4xMi8wNC8yMDE4PC9kYzpkYXRlPgogICAgICAgIDxkYzpjcmVhdG9yPgogICAgICAgICAgPGNjOkFnZW50PgogICAgICAgICAgICA8ZGM6dGl0bGU+Qk1XIE1vdG9yc3BvcnQgR21iSDwvZGM6dGl0bGU+CiAgICAgICAgICA8L2NjOkFnZW50PgogICAgICAgIDwvZGM6Y3JlYXRvcj4KICAgICAgICA8ZGM6cHVibGlzaGVyPgogICAgICAgICAgPGNjOkFnZW50PgogICAgICAgICAgICA8ZGM6dGl0bGU+Q01ldGFsQ29yZTwvZGM6dGl0bGU+CiAgICAgICAgICA8L2NjOkFnZW50PgogICAgICAgIDwvZGM6cHVibGlzaGVyPgogICAgICAgIDxkYzpzb3VyY2U+aHR0cDovL3d3dy5jYXJsb2dvcy5vcmcvbG9nby9CTVctTS1sb2dvLTE5MjB4MTA4MC5wbmc8L2RjOnNvdXJjZT4KICAgICAgPC9jYzpXb3JrPgogICAgICA8Y2M6TGljZW5zZQogICAgICAgICByZGY6YWJvdXQ9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL2xpY2Vuc2VzL2J5LXNhLzQuMC8iPgogICAgICAgIDxjYzpwZXJtaXRzCiAgICAgICAgICAgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNSZXByb2R1Y3Rpb24iIC8+CiAgICAgICAgPGNjOnBlcm1pdHMKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL25zI0Rpc3RyaWJ1dGlvbiIgLz4KICAgICAgICA8Y2M6cmVxdWlyZXMKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL25zI05vdGljZSIgLz4KICAgICAgICA8Y2M6cmVxdWlyZXMKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL25zI0F0dHJpYnV0aW9uIiAvPgogICAgICAgIDxjYzpwZXJtaXRzCiAgICAgICAgICAgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNEZXJpdmF0aXZlV29ya3MiIC8+CiAgICAgICAgPGNjOnJlcXVpcmVzCiAgICAgICAgICAgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNTaGFyZUFsaWtlIiAvPgogICAgICA8L2NjOkxpY2Vuc2U+CiAgICA8L3JkZjpSREY+CiAgPC9tZXRhZGF0YT4KICA8ZwogICAgIGlua3NjYXBlOmxhYmVsPSJDYXBhIDEiCiAgICAgaW5rc2NhcGU6Z3JvdXBtb2RlPSJsYXllciIKICAgICBpZD0ibGF5ZXIxIgogICAgIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0xMTMuNTA5MDYsLTEwMS40ODQ3NikiPgogICAgPGcKICAgICAgIGlkPSJnMTI0MyI+CiAgICAgIDxnCiAgICAgICAgIGlkPSJnMTI3OSI+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojYjRiNmI4O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjA0OTAzODQ3cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDEzOS41NzIwOCwxMjIuNDQxODggLTEuMjIxOTYsLTIuNmUtNCAxMi4yNjM0LC0yMC45NTY3MSBoIDEuMzA3MzggeiIKICAgICAgICAgICBpZD0icGF0aDg3MSIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjI2NDU4MzMycHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MTtmaWx0ZXI6dXJsKCNmaWx0ZXIxMTk4KSIKICAgICAgICAgICBkPSJtIDE1MC41NDkxOSwxMDEuNDg0NzYgLTEyLjI2MzQyLDIwLjk1Njg2IGggMC4xMzY0MiBsIDEyLjI4NDYyLC0yMC45NTY4NyB6IgogICAgICAgICAgIGlkPSJwYXRoMTE4OCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHRyYW5zZm9ybT0icm90YXRlKC0wLjAxOTM0NDQxLDE0NC41MDM2NSw2OC42NzEzOTQpIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MTtmaWxsOnVybCgjbGluZWFyR3JhZGllbnQ4ODMpO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDU3My4xNjAxNiwzODMuNTY0NDUgLTQ2LjM0NzY2LDc5LjIwNzAzIGggMzMuNDEyMTEgbCAxNS42ODE2NCwtMjYuMjkyOTYgMC4yNTU4NiwyNi4yOTI5NiBoIDI3LjAyNTM5IGwgMTUuNjkxNDEsLTI2LjE5OTIxIDAuMTExMzIsMjYuMTk5MjEgaCAyOS4xNDg0NCB2IC03OS4yMDcwMyBoIC0yOC4wMTc1OCBsIC0xNS45MjE4NywyNi42MzI4MiB2IC0yNi42MzI4MiB6IgogICAgICAgICAgIHRyYW5zZm9ybT0ic2NhbGUoMC4yNjQ1ODMzMykiCiAgICAgICAgICAgaWQ9InBhdGg4MzgiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIgLz4KICAgICAgICA8cGF0aAogICAgICAgICAgIHN0eWxlPSJvcGFjaXR5OjAuNzMwMDAwMDQ7ZmlsbDojNTI1NTU3O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDU3My4xNjAxNiwzODMuNTY0NDUgLTQ2LjM0NzEzLDc5LjIwNzAzIGggMC43MDI1OSAzMi43MDg5OSBsIDAuMjQ0MTQsLTAuNDc4NTEgaCAtMTYuNzU1ODYgbCAtMTUuODUzNTEsLTAuMTAzNTIgNDYuMDA1ODUsLTc4LjA3NDIyIGggMTQuODk0NTQgMTUuMzk2NDggbCAwLjA0MywtMC41NTA3OCBoIC0zMC4wMDk3NyAtMC4zNTkzNyB6IG0gNDYuOTYwOTMsMCAtMC4zMTgzNiwwLjU1MDc4IGggMTMuOTE2MDIgMTMuOTE2MDIgdiAzOS4wODc4OSAzOS4wODk4NSBoIC0xNC4wMTU2MyAtMTQuNTkxOCBsIC0wLjAzNzEsMC40Nzg1MSBoIDI5LjE0ODQ0IHYgLTc5LjIwNzAzIHogbSAtNDMuOTIzODIsNzguNzI4NTIgLTAuMDM1MiwwLjQ3ODUxIGggMjcuMDI1MzkgbCAwLjI0NDE0LC0wLjQ3ODUxIGggLTEzLjYxMTMzIHoiCiAgICAgICAgICAgdHJhbnNmb3JtPSJzY2FsZSgwLjI2NDU4MzMzKSIKICAgICAgICAgICBpZD0icGF0aDg3NCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0ib3BhY2l0eToxO2ZpbGw6dXJsKCNsaW5lYXJHcmFkaWVudDExNTMpO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDoxLjI5MzMyMzc2O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLWRhc2hhcnJheTpub25lO3N0cm9rZS1kYXNob2Zmc2V0OjA7c3Ryb2tlLW9wYWNpdHk6MTtwYWludC1vcmRlcjptYXJrZXJzIHN0cm9rZSBmaWxsIgogICAgICAgICAgIGQ9Im0gNDc2LjM3Njk1LDM4My41NjQ0NSAtNDcuMzY3MTgsNzkuMjA3MDMgaCAzLjQwNDI5IDI5LjQ4NjMzIDMwLjI3OTMgMzAuMjc5MjkgbCA0Ni43ODkwNywtNzkuMjA3MDMgaCAtMzAuMjc5MyAtMzAuMjc5MyAtMjkuOTUxMTcgeiIKICAgICAgICAgICBpZD0icGF0aDg2MSIKICAgICAgICAgICB0cmFuc2Zvcm09InNjYWxlKDAuMjY0NTgzMzMpIgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojODg4YzhmO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDYwNC4xOTkyMiwzODMuNTY0NDUgLTIuODY1MjQsMzYuNzY1NjMgMTguNzg3MTEsLTM2Ljc2NTYzIC0xNS45MjE4NywyNi42MzI4MiB6IgogICAgICAgICAgIHRyYW5zZm9ybT0ic2NhbGUoMC4yNjQ1ODMzMykiCiAgICAgICAgICAgaWQ9InBhdGg4NDIiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIgLz4KICAgICAgICA8cGF0aAogICAgICAgICAgIHN0eWxlPSJmaWxsOiM1MjU2NTk7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDQ5MDM4NDdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIgogICAgICAgICAgIGQ9Im0gMTU5LjEwMzE0LDExMS4yMTIyMSAwLjc1OCwtMi42ODA3NSB2IC03LjA0NjU1IGggLTJlLTQgeiIKICAgICAgICAgICBpZD0icGF0aDg0NCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojODg4YzhmO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDU3OC44OTQ1Myw0MjYuMjIwNyAtMTguNjY5OTIsMzYuNTUwNzggMTUuNjgxNjQsLTI2LjI5Mjk2IDAuMjU1ODYsMjYuMjkyOTYgeiIKICAgICAgICAgICBpZD0icGF0aDkxMCIKICAgICAgICAgICB0cmFuc2Zvcm09InNjYWxlKDAuMjY0NTgzMzMpIgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojNTI1NjU5O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjA0OTAzODQ3cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDE0OC4yMjYyOSwxMjIuNDQxODggNC4xNDg2NywtNi45NTY3NiAwLjc5MTAyLC0yLjcxNDE5IHoiCiAgICAgICAgICAgaWQ9InBhdGg4NDYiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIKICAgICAgICAgICBzb2RpcG9kaTpub2RldHlwZXM9ImNjY2NjIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9ImZpbGw6Izg4OGM4ZjtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4xODUzNDIyNXB4O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1vcGFjaXR5OjEiCiAgICAgICAgICAgZD0ibSA2MjEuNzg5MDYsNDI2LjIyMDcgLTE4LjYwMTU2LDM2LjU1MDc4IDE1LjY5MTQxLC0yNi4xOTkyMSAwLjExMTMyLDI2LjE5OTIxIHoiCiAgICAgICAgICAgdHJhbnNmb3JtPSJzY2FsZSgwLjI2NDU4MzMzKSIKICAgICAgICAgICBpZD0icGF0aDkyMCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9ImZpbGw6IzUyNTY1OTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4wNDkwMzg0N3B4O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1vcGFjaXR5OjEiCiAgICAgICAgICAgZD0ibSAxNTkuNTkzNTIsMTIyLjQ0MTg4IDQuMTUxNTgsLTYuOTMxOTkgMC43Njk3OCwtMi43Mzg5NiAtNC45MjE1Miw5LjY3MDY5IHoiCiAgICAgICAgICAgaWQ9InBhdGg4NTAiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIKICAgICAgICAgICBzb2RpcG9kaTpub2RldHlwZXM9ImNjY2NjIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MTtmaWxsOnVybCgjbGluZWFyR3JhZGllbnQxMTQ1KTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MS4yOTMzMjM3NjtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1kYXNoYXJyYXk6bm9uZTtzdHJva2UtZGFzaG9mZnNldDowO3N0cm9rZS1vcGFjaXR5OjE7cGFpbnQtb3JkZXI6bWFya2VycyBzdHJva2UgZmlsbCIKICAgICAgICAgICBkPSJtIDUwOC42ODk0NSwzODMuNTY0NDUgLTQ2Ljc4OTA2LDc5LjIwNzAzIGggMzAuMjc5MyAzMC4yNzkyOSBsIDQ2Ljc4OTA3LC03OS4yMDcwMyBoIC0zMC4yNzkzIHoiCiAgICAgICAgICAgaWQ9InBhdGg4NTkiCiAgICAgICAgICAgdHJhbnNmb3JtPSJzY2FsZSgwLjI2NDU4MzMzKSIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MTtmaWxsOnVybCgjbGluZWFyR3JhZGllbnQxMTM1KTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4zNDIxOTE5O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLWRhc2hhcnJheTpub25lO3N0cm9rZS1kYXNob2Zmc2V0OjA7c3Ryb2tlLW9wYWNpdHk6MTtwYWludC1vcmRlcjptYXJrZXJzIHN0cm9rZSBmaWxsIgogICAgICAgICAgIGQ9Im0gMTQyLjYwMjExLDEwMS40ODQ5MSBoIDguMDExNDEgbCAtMTIuMjYzNCwyMC45NTY3MSAtOC4xMjc3NCwyLjZlLTQgeiIKICAgICAgICAgICBpZD0icmVjdDg1NiIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDp1cmwoI2xpbmVhckdyYWRpZW50MTIxNSk7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDQ5MDM4NDdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIgogICAgICAgICAgIGQ9Im0gMTI2LjY2NTk5LDEwMS40ODQ5MSBoIC0wLjYyNDQyIGwgLTEyLjUzMjUxLDIwLjk1Njk3IGggMC45MDA2OCB6IgogICAgICAgICAgIGlkPSJwYXRoODYzIgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0ib3BhY2l0eTowLjE1NTAwMDA0O2ZpbGw6IzAwMDAwMDtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4wNzUxMDE4cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDE1MC41Mjc1LDEwMS42MzA0MiBoIC0yMy45NDY1MiBsIDAuMDg1LC0wLjE0NTUxIGggMjMuOTQ3NSB6IgogICAgICAgICAgIGlkPSJwYXRoODY1IgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiCiAgICAgICAgICAgc29kaXBvZGk6bm9kZXR5cGVzPSJjY2NjYyIgLz4KICAgICAgICA8cGF0aAogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIKICAgICAgICAgICBpZD0icGF0aDExNzEiCiAgICAgICAgICAgZD0ibSAxNTEuNTYzNDgsMTAxLjYzMDI3IGggLTEuMDM1ODMgbCAwLjA4NjIsLTAuMTQ1NTEgaCAxLjAzNDc4IHoiCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MC40NDI1Njc1OTtmaWxsOiMwMDAwMDA7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDE1Njc2MjdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MC4zODUwMDAwMTtmaWxsOiMwMDAwMDA7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDE1Njc2MjdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIgogICAgICAgICAgIGQ9Im0gMTM5LjM4NTk1LDEyMi40NDE2MiBoIC0xLjAzNTgzIGwgMC4wODYyLC0wLjE0NTUxIGggMS4wMzQ3OCB6IgogICAgICAgICAgIGlkPSJwYXRoMTE3NSIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgIDwvZz4KICAgIDwvZz4KICA8L2c+Cjwvc3ZnPgo=",
		  "metal": false,
		  "text": null,
		  "accent": "#b00500",
		  "accent2": "#c41200"
		 },
		 "mclaren": {
		  "src": "data:image/webp;base64,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",
		  "metal": true,
		  "text": null,
		  "accent": "#ff8000",
		  "accent2": "#ff9d2e"
		 }
		};

		BADGE.SOUNDS = {
		 "engine-m4": "data:audio/mpeg;base64,SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAyAAAAAAAAAAAAAAD/+1jAAAAAAAAAAAAAAAAAAAAAAABJbmZvAAAADwAAADMAADqAAAkODhMTGBgdHSIiJycsLDExNjY7O0BARERJSU5OU1NYWF1dYmJnZ2xscXF2dnt7gICEiYmOjpOTmJidnaKip6esrLGxtra7u8DAxMTJyc7O09PY2N3d4uLn5+zs8fH29vv7/wAAAABMYXZjNjMuMS4AAAAAAAAAAAAAAAAkAkAAAAAAAAA6gDy66MgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+1jEAAAOiQkYFPeAChgk6bcwwABkXY3wj4SMXNHogWwCGCrFzQuzx5V+hhbCCFwdF/FvL2XQBbAxl7bDQNBQTXePIlKUpT//3vvDxXq9Xs8f0ePGd+/fx733R/H3/d+/j017w37+PvN73//u81l+/3imv8UpTWbvHlKUePNP0MQxWMkTUcMAAAAECIGBEUjIIBkQkAABaCCgiUFygHJi1ZddoTdGh9cdx3DauwVvpOxICkSgvHAuLx3Kaap4I54uJmmsJuw2GBbTtmao1MjxYs1a4nUq4zQ7X0nLMvz1WKH/L54mZrube05TYbTTZuscn5+89mR5jTS/o70hcq5fZmZlzpWbSOZ+ZmiyyycFFQAADAGKgm5BICiOVUWU4Vr/+1jECAOQSStMfYYACiMh6gmnpPmDBS+C9Vhsmut1XuyfMMSasA+pLBSEiodqBDOyWWG3XH1qZ3GLH8xa1BSikp8TDGqJ1pDYLMK7cPLoa88WKIj3631iB5xvMMFjH7dZBjU0gX8+eQLEJ2fm9KNduzVfFkDpfXwe4y1A5tLWp3z0/M6+X8PDAiGLGI0gyHD3bWlbiz4HROkhCVg31MBjwX822GGlSRkvQtVk/R6sWFOV6fIWT9VsKtalwfikYII0lyCMiFUwSFvoFxQnTBMRowBkYFzRLEbBR6gUDAmXNzXJHCi1Ooo4UNlNUZtg3O0aOLyQ2UQQYUixSMjRrpkO4pCai5SPP0IgQk6S/cNdDwEZwFZGpJp6jYGDaCjwn0v/+1jECAPQPQ1WLCTVEgeiasGWGqJdWSBEBjAJxp0RSWdJ7ofe57l+Qy5sIh6PNMvPpCRWuXJotE6hKWQQcgigaJV5mw8RljZpmWhsgBfQkOCNtRgbEYHnhZCcZYp5CtM02P7CHsri5lNCekNIqIxR5jGop69IGAMLlpuUywqqSGoJjF41BdLcAaQNKNLD+FUx5YvQzp2FLH/lb8MjQJPitF22dxNalK3i5nVdhmtPMRSHmmkIp2WE8bOIl91x633XPIliit1g1IY9KmEE+xMYFeI+1c3VQllVAmRldOdnUcmZx7ssVvHeM0rCXMLTD4id7D6XJxVyAZRPcAoQyZ15WkiOkg+nhUilASGBkAptDEDmTRbMUJbLfyV9XrZNSPj/+1jEC4PPjQ1WLKTTCgSi6sGWGjK7D+wOvG5JYbsxBnkigFNIkcPkQjA2zCYJFWiRexOhpgPqE7NqTYJ0zFyRIAyYFQ0LkSAmEiyKZ40mQmFlIIAwBPcXIpC00N6BFPmYouDhpgBAcWthFZ99vSRN0LSKUS9BUHLa8ql4MhHgSHGF8S/4cEWkTra7BMBsKa4zukY0oPC3aYKv8Dg7isfxyCQdDoYH4cJVQkGfitKfldY9DdQurKtxUtPHS9rZKMVjEA5KbMryrC48PKZadmC+SdiljmKWW5bX2+bp3oZyVpsciRMFEVlE2VbbrF4rZQNhSZm/2x580xD2uoUBHNBoJzEmg8BoiocJwVJGTLN44AMpY1GwkwsJm5lWU4LU/B7/+1jEEgOO4P1WLL0lwfegqsmUrmoN5PC4Mzw5GVwOCtsMOR0b5ZiM5MulZNC09KkJUhpelCAYBjRuZtA0hJo5tLLKIVuwunG6bSsu3OqcvfXbrKRpMKKMLzjSe+bUmJGBIIAACqL+BggVhMncSBNHSbAR6ibU1zL+ZQuxYWkfh9n2jLBX3faXK+i7J4VKgeEQwBkQxHUwRIFwbIidoUn2qcL3ZEyFmDqvQGkby4qPhQ0Cja2xJa3zHsVieUJnzmeViryO3LWujDFFLVIVBsoloFVCabeVJzCq7fjt64sWD7CPnAkVGgACCwMFWngGCjQkgs9tEMH+Xe2BnDvOTCIYoWURl55VCXah6f6KHAsLBgQe91LBB6/uLD1TFaskSov/+1jEHQONiQVYTRkTEdyeqsmWJhmRtHFq1dqaIMMQNjpDz7fMOOvWF+1cdTq9W5RJxBImARLEQVmDVtuq4ilNUiKnWgHz40MAYEALhIsLcJgI+pHtoyNvo5G2Wvrg0p1X/XKw16GVDsXGRrhjIFnzs5OVjmIrZVF1zI5MmmVyoFUByMyqQTIkCpHPUSNvlVWZTIWcjSJtfYRTt6XtOXmk0dQRhUZIxIWmiQhUJNZOlUNNQRr9GEG2BaTN3/9clQADBCQadGaAEDMtMYWu4MEqmYWNDXrEdxOT0MdE9IgTZNhgWx4o6RzkrFCi9hb0Jeu6wW2GV/GUK039SUn9cOtLytO6qLrEa1U4zfdrN7x/GyxafmtaVp/UgrMENo31C6X/+1jEMIOOvPtYTD2HAcefawmWGhsK4eCU7Di5C6/yzXmguIQ0aRa+3EIQL8GIyzIHzVqXlH35lMMpIMkk7/SmUSNlz3RZqbXXAeGS4gjGEe6qqH4YGiRarYUltBYTr2U/1JKiQ/pnnLKI6+kQCUSCiQNgjNQDsW3Rf+IObxlXs6Ygq3OtN0aiQIDT7lv9z4xdSB3AtJhfC//o5+kAAgkIEAMnBTFsx2FPBLG7wdZZBSUxXAKSBbcXlBsyJJRH5898K1ReDwikBQXBPIRg8oWaYrIaKz+Nk/L5zRG76/15ji5eKRrY80cQZXoiFPI7x9JUnLDai8ZZ0C4kGgNFzhKxjrovkjg2DJgHz6/tKkgwYKYkKlADwMANXPyYMs/WAhz/+1jEQgOOOPlaTDENkdcfqwmnsLhioVVsMRyYl2k1knao2qiRo1IRh/wWYmwDlhIJKXpQzdlFAvjSqMSwpFGPluM7VB3Yws6vrH0b9X3Y/fju7s3ruTtejyCVFK5Sl9+kuvngHh5SezWk2ne6cZPkRUBpXQ+8DPm1AAMKcDFS2Os1Gr7D2tsCeFv3tLZ0SwQEcyCJfapKMF6LjUsuG/HMOwKW6PqktD2FDgTPuR2jKVpxbqharXBZSAMQ4F1hKKE7zt3EtmiWHO3zo4fWNCClWWaXg8Yf+BLMiO6Oz+b3y2komFgzfzKwWVUEcyh50jAYLFKcgFwmSLRTJd67H4ZSpdLouSdLtO4uCThBN5ttCpBEyc7z+ICZt6rnqDTcmSz/+1jEU4PN+Q9aTDDLwcAiawGXpHhMK01jR+DyyJv2zN2VlzlTHhii1/pkFNXBryR0s9l3VLES1DpAWt72G8l6+Q3ISqtj5paTcP1BEFkAAghgwlRBPhgzLlVoi9ktlrX33dhbBOHwSQ3EJ4ORGLbfvYdCV8vumaxyY1InoVI0nKqHSnKrWrrKQj4uPa2BTCR1PiJ6P897Y/cw1F6POePCikXxDFJIdt5oI4Z8ubnZf3ub//CtNoEHegDIBsMJeVIwEcXDEi2cMUVCx5oMTiisGLNiyZjQZDwYhaQlBTgG7lETh2ZvOFAwgXMNNLkmJMq/zZ3BZ6CNGJyVx+x0mnbZ+Nx9ovSL1uNKM3zDS9LOdzb1e/UtMgwy4UefjHzqNtT/+1jEaQONyQ9aTDDNkbuf60mWGbGKeDB7YyZX7f/oxSoAAgeAt4ZSF1y6COMrfhQt2oJf1+obkVpnsoCSSQEiEuIA2HSxKRjoXJBGcMnBREksilMxUone3zJNAydDwskXlCeabxi0pM4lOEy8ccSckFs+2B7OdKkRjgnQCrq8n4zFT9XJScIg4L82q3gF6+Bg3o5UYIxmUIhhwcIchC+CxwTHg9iSkOBrOi2qOHzAeFSfIhkSjFSUmI1lW4EjdkkReWM3ZfOwifJ5QgmmhjpKIy+lZumQ7PtxJ8u7O66jU3jm49HMz2UW1ViJtL35dRXwxHE9jD4FpnYkMvDlARxRlwLgccoDVAJYxRW1Y5qHgQPpZjEgqHy0fA3LhZOjA6L/+1jEf4ON1Q1cTCRvmbQh60mWGTh4fH8R4pOimksfslJBGR4YCbawhHPkosQSNOPP5JjE5GnV57chBbIySlTZV5lGZ9u5KTlOzDWucKxnvWQwu9qHqTrUcROQposN2LLCMIGerfH6mhsqc16n+dZZE9Dk9LFzl48IxNXFwRQHhwAkenjdQUy8UzvW2B/2Bm6EqODtDQnWD1Zf7IC5xSdHsGN9DDrjwEPsx5bmLRTUg6SYeHh/HTMrHSpR+mwiHLzpvU3l7RZzvt3ZA/Tx5Wn/uWp1SgEUxJQTgRKh5NkiZcZ0rmTsDAZOhMS3zgSiuKAgHkEwuHOBonJfLBqrbW8mWqE6loqWQnMxtCBCRwOGHpiEj2XzyDKXqzEsQNRL5Sv/+1jElwON8RNYLDDJkcihq0mGGbNMohZIyGbemYXU9jSRa40ghyESwXhfScoxTyhh9QSR7wgfDAPwzvYoMHRHAAlUyBwoQXtizOFtrGa5MvbGp1oUD4PFkuvspA5BBAjTPVMi44AQWaQ6Vc4VSNJgZmYVQ1lQdHk4FVYRUrDPqFYgbSDoR0xnLZJjk2OiEjVIHQWxGSJFFyFUfNXE58PaUU1VmG5SPKHa+Eo0TgEWFEKxiCggY9iX9TiVRRERNWm3kI9HIhFcrZc6EARyyViuchahH0KiIimCwbuwWRxDTDi2TNMXhZKFHB/UIngIgocDKqYSTSO7UdtVpPVJeCXI9PDlFXaBSInZ2AO+pE34qdzx2kD3Y6ceEBcB1+6nDBv/+1jEq4OOeQ9aLLDJwcAiawmWGdEI4EdopdYXbV2pYzlL7ipWCRR1XHCAkKhQaDYwCHshNCFAjbMUKhYqiYFCFR+ZAhOQPpmHx7aE2jUNyXIEaS6Q400y3GFod5bEBRZM5pRHUzKIcxA3VkJcEuq+jy8QjBTIm+K21RYpBw3ab9AvKgEobpi4CVoca3csHJqi2BdmyJiKlRnGdBml+WnSbThlI4xGFOEiQKeXBM0rdPoRCxCLyrCk03jQoPUE6JjadpSbLo0bQKCN5+EGMb2oPhSJOlqipsbOrsRbRRxmMTCU9kigd7/JoeYtVLC84tINS2DCN7dRghxRdYvb+afP0MLDCRxMx4FssGTCKBnrXemy/pOECbDMieTgs5GbnQP/+1jEvwOOIRdWLLDLGb0cqwmUmblztfVdsY8klTDJYWMv2vAhnGpVp2qdWrG2GGDR3HlRa4TJQiohmO+57/9sdqH2yBh5CJMIlAsmmnFEgZaCBKJTaDq73ytl57ARiFHjSs387xx5OgADCRKrDPAbNRBVReiXKx3RTOgeNPWxGJrynROShVIHhEDZKSEoAZGFRCV0gbIUI5IsqjREKNIiWrZs0mmjETSjcpznEbTIlrbmksTjZIkyk5TfdCD1ymChIScUTARgKDoDII0W2Hvs6TboWY890uY5yAL6vo/yzk9KhHfb02ZRB+CjRpgLhqLIS10o0xnGVEOwZrGZBgGSPMu7kHAbqkbnihUBe9D5IQjIu5BInSQkcEdqjizz2yb/+1jE1AOPsRNWLL0nycgh60mWGXkbkh2abFKWiZpWSpGxPcey2y9Rtht1pnElvJUPWjIGso2pFVtiZEMwnZv9JjoHSgcOtpmiFEIVEfYPkqWEQ4qcNdjTWenuaYiY2eZQMDiaBILiFxuWDSO6/rdS2JCRxBpKF6q6wMUFXJxrVcZwfghXr+PhfHUtBkQSEWx5KgNgak1MOKAtODcmsvCeVmTi6RxCafuZFAkFw9QKG6xIhnXLX22MPKqyevRltlbxdRWUs1XirVhK9FAZMLUzbrZqjeO11XNfhPi63VLz5+d0uzLN11ZeuEGrjyJNpoAS4Koi/gKIER08nEqVhTstsvB9URVqt6A5IW0YHcMCWcOrDO5yfASzqaloGsJF1w3/+1jE4YOPTQ1aTCTPSgIi6sWXpWEUZF5oULcTpmckLKZVltEQKtxGaY3YM2xPxYSQZr14FZNlICfBwUs6p3sU2UShhOsTSpeb42meJUZGlvQKvPnrvtYifxm3dgEJh5X5j5QGGgLBDFQEC0CCEyC1Sdy9GJFukiEDF/MIlLdkak1Jl0ExmkNbfp+ZTKWfYlUD7R2Ip0ShSqTLyU68fFs4fquXtr1B+y0rYqzQ7gXuUjZeILBBEj3okRpDEmg0modUjGvLz2F5LS51U+V+X1ySJefn776rTEzfStxxo0DqvvmasivVmr68V4qw/fo02V2BWsxkjWTEjRCAhYvtkauKGxKFIqvbnPsKWREDoOXx7sPOFwTyOQSyNRIkurkSImH/+1jE6YOSgR9QDWGFweui6sWWJdEjBRuomkEVXdzWRjBcnXjFmEm18ghVUIomFJMv8Um104rly5OoICSHbGBQKGalhXWUMW5ty3XTmbRtvSdJ9wotUXThiQjKNyJCAQaFJumMdgpkNvxAwdAaABQIIwKiLEXIT4C6XYFKSdQNJPCQkAJiQpIoYXs/hPDuPtNkgopDcRhO1w7QiEJstgobPJj6GK7ZBgrd1LTkkq9BCZMlaEqKXlgkHmyUU0SC5ycSEohVMORKAMIjqDAbTPoZrKIkInFJhjCQjHpwkVLINEhlwlhWXG4vfdTTBNy0DFuloldwKw11QGMtA2kSh4sZYEPI2LUuEeYCIUx1pwm6qUqKIMxKc4DQMllTcAu0FGL/+1jE54PSMRVQLeGFye0i6sGWJdrlUtm6AgmpCJ6ORmlz8byFwtYMMwONRWpYUlDlHoau0nIqhlC3MHQDhcJrg2aDDdOVLCAKIAQfopm2RiuaNRu2twtMWhBu0qZgmeCAlXrA1qIAAAUB4BAERsFBFJQVxHovsyaGo8yJpMJZUMjMLzIpiUOZfPhdap+eXNTEIj5j3DyrtqNqaK4LY9Ja7Tn5smC6UjqUq16JmSlrPisXckuwl1b5DOoIS7lrKWJEZpjZRVLyJUMZL0hesQs3SaLqwi54Jsnwr//iOZ7pUi5jbEOMs3ATaGNVtKsOLVqS8FRlgBlCFHkKYZZzOBLla6UiQIwzlhWBaC6oBnQgFQTGQPJ1xAhRphxATVIgNiT/+1jE5oPR9RVSLT0pmgyh6sGHpPqxSGiJTXI8WnIo8wR8mZe4kYgmRUz2D2ckatG5OZAYWaZChIkNajLk1FShOgRIE0CEskiItuKN+XCOOFVr+Em+nWv/LlsKRL4YqWhuCsBgSifKBNXTmqGsaSvd5fEddNY0vcUs+AhY8GQfZCzpup7H0ciEJlRFEcB1LlzYDxaFxoICg9LB5Y/Tmd5OjY8fOzo3qdJk52crxkrdvr5NEQnUEA3Soaa171nCYWxLIYnsE42V1OxxS1Jz/GJynfhnZbbTrKJNOGkIvVeXtlluFqrq33s+KpiCCSMvfQGWLDj3JNQo4kK20UVoVkh1kjD3gWjVcAzyYSBIsVBs4jLlBSTrBIGj5gqRhAH1JsT/+1jE4oOPMQdabDErihgiKkWXpWOonBxAmba6OIKsDxZ5SiCyl4pi5Lyca4uygQ9KlkgEBHFzbKhx1Ofp0mzUpwYxHHOxnaKxzETzejsFgiZ4sq4BCVUfCFChzk6hy26KJFko+WbFavuSQZkGpB7kPL6O0mQ/iWiyIA/kmcTApW08lA/Q0/1Kqmjdj9VqrNBTjjT65jEuqj7MBtSUgYUtSwudNdpuVIkLRclRAnSxhAGKRJo2FQqcESYw0GyOZs4xbD0K7bwPeVsj36VgmiCuoktO6ihI9idzXDoAeeQT0iAR4Cj8DsjMpxrqZQE70lbErcu4LjyUACAsKAKIhYwx2rgbzOxEnM9GJ1C0G8OY3xX0GfLchbZC2yRvRAiXmZP/+1jE6AOSIRtSDT2SQcwiqwWUmdpgku9Y2gKpYZaAIkKSUfLC5vxskEsNU6hpEgtG9ls4ofXk2vLvfsloPEEPJEjKIwsks0gLkbc9JknzbVJ0DZzLbjQ75+7LdQERUIfTigDYTtjAA5pxDDY6StIBrKpGC/C3ERfmeLGA7mGCZNEuhpBHUSpLpo6D4LyIovMDHHKFNI4+VLC0IwcnDJ74/RForRrB6IJIA0JLZUUJHyWS1TR6W1uF6M7OzbVJTNMcWnSs8bO7FpetMla5qpoqjXr30InryuTTLbZE+dLTCzRLZaQDpfZxxhQkPDKEDNdDXDsCgYMEQQhNIVLBKzUkfVes5WFm0SHMqNUclyJKpbPAhHcdS+JBiUiuWoVY+n7/+1jE64GRfRdQLL0p0hohKhWnpWtqVMWrG4KOWlJ1GTNGlGtqEGUCmg1uCo6kOsp5ovDkiKRwCiEVEi4USvy99kpNNNUxI1z7dPX8Ck1FKi60vGhAyKCiqDv/39xVAR0jdIgAsNLZDkKySoGTpSPQ5tsyEOFoTVdK0puPHpUzMV3Oy0JPV/pkqrh6LRWA8PoWYcOCAb/URn1kJmoTFxyWJCNeRGQBoxif1uEGbJttJVUushxGYqEKMEDokWIFsD0EPYuydC0q2waFabz6h1WB2qbR0yimmTppx0PQQSyHt8qU3SPmCyiGBlaJNZR8IrgQeBI1xBQSuRoSgacrgJKxN1OKfh6SRRYTH7IAkmS82dTgDkwrLZMIlhcWj8ePrl7/+1jE54OTDRVOLL2Jic+hasmWGdl4Y44wkdX1SpXXZ+ClMgSQ99iqbUVh+kTwlh6opM1x9YLMgaiPBwoKCZG9ClbUocJbOk1K3bKqOEsK1k2XCLt1onqRAzmPKmsQk6/IlXUAhCCIoKsjhgakDl6hjCo/lCplCO1CC9o4t70nr52pDnaLCY+bLiY0lAnWEvgFU0TCWkUWGE+tNtnYwfFmKzzBzUkGstsmlJyojUGSgpTZIiUiAyaIUYwDZAakKwyTMrkTIw0KgLDxMZPoxKwuhjIdRoWENzi+TD2Z3rLTWBrwOi7ln7bkVflbhGkAl0ok/Gau6putJrwECedH7TJbGRWNyCORPAkraby6/SkgzUkGUy5Spo8Rycu1Hf8ppRL/+1jE5oPRHSNQLTEymhuj6gGmGjnF7RFwQTJUcQQhhOLlNNpE8F1JolDqyj0SiR2gGo2FVBSaIDGrmiReCUXG2ILpMvihm6agGPCYzfpSL8mROm2KiG+fWFQQQxnSTDKIJSPRFQhVoX66MBEtMVBMcCaACCFc5XpT1MVS+VzAeB2qYapeP30pkV3S87hchrdYWHauu6tPSSnOBykyBAZnbqCkJI5m4EAoNNQhoMBJJ4GIoSspoMy6emJ0Qim2snlpgvJ9Yrs2SK1xg5DChGB5ZZEftHkUJ/E+2p7FMFL1VQTnR6KtAK1JoMnRGQHIIlrSxHxvk+o/CITDDYFjOtQzEwEoUnksqi2xbXHY7DBaSYnolLyQqma88NW8OF6znV3/+1jE5AJQcRNWrL0nCc2g6sGWJVLevVstXLxNVRCUfVU6SQMJg8AcIZisPRgeEstmYKFU7ViWHa8AggHpfqO8JYWk96yay1KzEyVSTarqojLXVR8VV0J4ysSGDlGKOHgHASR4BDcBHRAgZQmY8qS0Ns2blG1Mi+vWl0R2izcGZLKBgySFDrBh2EdCtfRAunMiZtiK+SuMq3Y46UYKrvmsm1FCrHVFG3SZUKBeAggTmR4vihK0hLKCVwpJVygqMoJYiNWrAmSeiwu3JR9to/uNkdNwpRJR0HOdua249bm4kIrznGgqBPS2Y0eAExQodprlILw+80sjjLFdLea6wmOwqFMWkdD4Pw+XoCc6P2SYiOD4nL1qgrwuTEfxYpPCudn/+1jE7gPR8RVODWGDQkmjKgGsMHH7q5YZrh5eQo4WEyaz5k5QDx0DUumAlIRJ9AZQFqJFIekGiZ0dilJSlNAyS3LvIoojc8NlTg7Ewf1bRNbJpyWi3zp6e2ae6FoaUDRp0VkBJ0wxBpE5a2Tvw6jEk74MiUCLQgmeZVDzYm3dmDX0mnzjk/Kmzw4gEpLSxIRzXEYNlsPRFDLkb5LJWzbcUpbSS/kfva9OWbrTiNDBRNFIlUfM9qa0m1BCTSeyQY3kajTwucTJ0cmHkIFD19ToU/MYERnzz4O3pXoJuiw06zAiCAYiXZHAQwJLMO8rpFdUjWRCjOVQSokimC9TSqThc0cp06xDpLlEFo2Lp+tPimcDyTRwKIGolZ0yQHonP0j/+1jE4oOPERtYLLEo2j4iqgGsMHmVRJiqTVQhFUqLlBpQSFja65IOFp4WhzscnScqk46dWp2kESYVd4EJUL1L7hmTSOZoSi0yDU0VhQ6TkY7uoDzQ5FpfLb6lJXo4XHMt9WZYcxUAAwhwRRlozXOSPac272gTCYKRyopUwJgpHslgUEskFc3I6xa+uGLRZ5aIDBPUo4UyaRfYIKCa1SF1SxOi9Fm4R8hMeCRdJLtZpe0UjSqsVJpHTTnpSDlajSNKIln9MzwxxuPlERVt9UkytKWfTbLgFSnjFhAzMLMao0gCQFIYAc5lePrWARyY2sZOtl7xM5ScXapvD0AM2p2FtEnlwwW2Jy4GEgc41ozWQuFcOD07o4TDkjWKbKK63ub/+1jE5AOO0QtWLKTTWlskKcGnsZhOseRnaGLddEZoppJSlndRVosQhC8+IhyIR8+tLRqamCctdQ8YswvQ0VbrWmCcKi0ZPoio+dJTo9VMLvMG4NbazGZ9RfK6y8tG31UAAwZQFqjio0QM5l8KVsIIgsmaHDUXV3R2DobCwUKETg0YiKWojxVEwVPnTCc6LCjJkerqxgpKXhKq3wUyW7cW/VUxm9pBWdQLlk07cTETD4q65KbyA6y1EsQm0dGH+2LlHFf0CNTGFehqSzVQGvpov+LQ0QBSaJCQwmgOARriNpH8KCTpXIGhTIcoiOPASRGgNNcB/by8HKk0TjJmKm0bYHhIUiMAK+WniyTywcDusSEUD5LHBcZGqw0SmA+0QU//+1jE4oOOJQ9YTLDHwkykKYG8MLkJnCh+8pOLlUule106NAVl+TcqpTItOoa1fC6YQH5nxo+eR2dukPjmy25bWaYahNLICu+vQj06RwOr2IX4N16sTPtTltIBCgqIegG0GDTHUHoCTEJAuXGNl5F1DqgdkekX1fVkyElNNPTLsogqzL2AOFDTsSSrVCwkFY22DwZD5wEAaAOkmRkaqcTCjCaZyjZwwyPLCQzMHh7hAUjr5DEiRYXMEa60CRAwiJD2ygoXsnZIoJk4rSWgNWbRMpvLLdYt3QNRXcrZS5Zcp6gBoLEt0etBgWRBsIacGKCBGEABzDEBCBTXeZH+MLNb5KFuL6N1Zu5MpfWXQkHkdCyc/RKT7r/V1OCCTlJ5jzj/+1jE5YOOVQ9WTOEhSkgiqUG8MHlaUQDq/z8FAYxIX7yTzAQwpKGGpSSuk78nQ2SfBBZpM7D2MvyYKPyHFtdScY7Xhp5idmdIoKzkCjy1uD8hbKFblwwCMRC0RoIgXHNQMOxDxgUIGXAARSQ8M1Fcrp2CwAzZPZYZzHfibvO+5QD1qwQFUJm6yfpWRAC9k8ZJ5kiZYSEJHROW6B2YXUF/jN/F7kTyo9T6nOlsB5q/kaFCvXYX3iYkY1YoRtacUdSvHCG2mufK1Kl7dqydN8+ZZNVyhOudYvBMRuYYX4+T9kCCKLZ4QhYNBu8EDQQbGCS2HIGDbEFJIZI1o+SFMdL+H1CXBUPaI/tLAhOUk4Xk4MTdksCXAGwjeSzZMeL1BPb/+1jE6IORrRVMLWEnieYh6kmmGhjTr6jwIhANUd7MMqrwksmNHtA7KlhkPp4bprspGSIbZIKFUDKNCiQHlVkSuULJIFjpl65I0zBHDkaM2SJCulNbZ5C6a29KbXvuJPvHKgADArEEqE6ZIyYwwx5gzJACVUsSUUKUKm2UCETLGhpCwuDYMetcMfj8ZdAoPhqYsqzpMVRarE9w2HPhGL56xYrt2KWe/KBYBDoY7kgk6LOB9wlRjQdhVCk9NC3NA8IeNQUcrlEbKMADdAikcdKKD3129IkYuS1q5hn8ptfFEPACm5/VDXBnelrR0pV+AUixAa1WRdqtIogqCQYaSW/ZpkOKXTfYJLoUXxrCYD6GPSRSEJVKQ5MF+UwTkYrDyOD/+1jE6oORPQ9ODWWDyjEjKcWmJmBWVHANCsbLni4lQx+MR/PalZNdKWZaYbVMTx0en7dqHZ71URsdHhu6fpJQLKTFAYLh2aHzKVttszOcOFLFqvssqzmVyWNt2OL4epD0/R0ijVbf7gADAoFgA/ETVBAuy4yoGk2LPxluDJEqmiJeq0zDO2iOQ7i6ovJ5PB0QjhyAmnBR8ywurbsmJmdlWjFr2dW7LMJqwV8kppyncoUxjV027GKxDraK1eeR2WYQST9pLU9pSrm5wsggkklT4JVO8msqrdza++Y1AQgQDCRY2f9Ca6EFMny4Aiw0QIQuLqiECgLJEdEwIy+hMFzZC5bJ3mgxolIyWD0/ZssIhuoIGJ2lnoZBNgnhgXOIZLP/+1jE5IPPtQtSTTDSikyiacGcMLETou1gPjpS6pcY5m9viSro1Dg5F5+Pqp3j58sntWU0KpddfGlEkyu7hsWyqcnJ1Za4uarEie60Xa3MHfblq3s512LlWrUldQEBgslLnQnGrSmYHkwUaGh1EAGQsTEh5QbOslySLQOQFESU+ChLEWSLLbdUnYnSwogxZUcPpdkIUJ5WUhkQjk9aBlCDVaTHyQBZYY7pwf1JS8stJ3l0T7SaB0urXAoKpTYEoPIOMzs6XEAunp6tLJi4XV6wv3My5hSagQD2Ki1vjEv1XKz6ZssWPuLWIs+bvY/tTNCAgYCsICWpgKZlmygIgg+sgHNSjYAwR7HENAKoCzYYDYIHUWhSxOAQ2gJgMSEZCPn/+1jE4YOOxQtUTLEwwiEi6cWsMHoslAqTEBMIjx43Be023b2IoiU1iySdUmgqDBHS96LzRnoGhQujQGTZGgxM0wtfes64umi20E1oySi9pBKsrE/OeRxPDwacQ44IVAETdbmdlh9DHmUD0WPGACDDEcWsEocHqUKxqY0SpmMKxuVYAkWSzAPYyKhkR6GZ9GXRMOy4yiTIjVCKtk7anll48vChtqE+nq55hCMFWfAeuQkkZhbrVr6aMmjiBHp8lTdkS92EzPFcWtMnRdpCzDdxw5q07AOlPevDCyChkwFKarvugwQxSiBcowXYAhQeBCuDPRBAXUFqiFSGaZg9hlsDRl8kkkqHbo70Nr4ddxYXel0NNdeqIyEwDkhZcbKrggL/+1jE54OSkRdMLT2LQeWhaomsJGKPTZRSRRpGLqrn1yIYPkYhOivUBE2sbe2Fxsuwg0fIypqKZM2xaAwgwqm3GmzTSOK4mioKAUHSGKBJODTy2Kugn0HpiDMWf4JURa5cuuoAAwWqCAYHkgF0aIsY4SWlHgEckahRc9o8MNhlcByFYkqb9upNMDJ4x0KUN5GlUlSIdFywcamjpwVxNPHEM6qhmbpkZJkd5TxEg6T43CTDuy/qHCRptnEhmxzZMk7HdefnZm6a4y2MCmIIiZQlEs1RmWF3tiZNzqFFoPy6C8OhPh/gqAniRcyqp7+O6TihEaYzd0enPLrRFuasSYc2v6mHMRROFZ6sFhiP50Zmyk5srOkI6hpVEceWIXFZgmf/+1jE5gOQaQdQLLBx2iwjacmsJLiOH8LDjjEFOUJ3jx5RCaHLzzNHmPtBqBU4syzQLJ5SZFAaWCOWUo45kDSnIkkWt/gFqCZulA5UkQDgnAtCOUoBCgDQrNIgRDOmfAgdpna6Z49cMsanJnMABoS1UEqWMYVIX6HQKQfZdMvYb56SwVA2LTI9MDQ/PUGUAqLuRkUAV3z0eiOZE4alxMJRkauFxozO+uPg7KoEKExCtGWzs/MihAaoQ9oiQnqZsnpY9laXF0L5LIK47is6ZMusRLGFis0feaeLRwz71icoSs1cU3hW1y6Pt+dmK9FswwUyLcCO4BP4ytXwnFDqVyQSH4iAwdPFYaZavWX7AlNGL64pLDeY+T0FgCKERhgXSTX/+1jE5AOQnQdQTTDRidqfqkWWGfLJwXAdWQIg+F5kqopploTEBxM/s3UsPic46kkSk24xXXPGBAQEFHE+M5HEJJw2+FD16eYUB1R17bBNHNrnIbm25aOA0wNGW83mKgADBXQXBzDUMwKPGrMSdAcGpOKmd8wkGX+mQqNUbVb78vw0tRvY9GIOAzLCptYfE85EIWifo0q1QpRF1aTVVII6rj8zPZZOGlDNG4XkTzpy7Rxa/Y8Td6syflakVHTyxVds98weL9GIydKSASTiINjpiiKZicVcF+bPjCL+XRAZDvh5JFxJZmdEBYYTiQoGBYgAguDNcRoMeC2vvAEDTOQGQSd0JqrirNd7UhSsOSIpTmSZpOZ3JRTJ45VUiVMtq1P/+1jE64OTSStKLeGFiewhKgmkmmAQijgK+Y/3EoQGNaiueoGGhlw0TJsEslNIG+hbYWFbKCydCwq5cVCJGGCxCelCVFNPOUq1yFE2shgXapdrYmSdgVJo/CbhIaBJRpjOmgADBSaghm0xigYTuJqSCefaavkwIhn61yIEzOG2lrUDgfWyVgkjcRBJXmcaQmmZKqYt8cntX2qjwtPFxUaOGfTRE4yVsLEJ1kqLHk2KiTqajbqcTPDpJFdsscSk0mtM/DoInl97LYuET7BxEYcCWom3RHpWrNnr4iwZ8nllCJJIimFP7GiNTGQ4YcF7ygX0BMrzdxbieTYUtiIsMsoTBfNd7YIYcGH4EUxvy2CIbfA7dbczKg0PIiW8oPRAKoT/+1jE5gOQbQ9OTbDRgiig6YW3pahjkI4RvognqCdxzEp8vXNjKWmGTpcsPFlkylXpwkUF98GjtysiRJSxFdqCp+yrWIomXHmz5pxsxRLNRLikrOh8q+4sLxwf843jtqtmSVOM1dUAAwha8DPVAqYKUY0ZBwsYIlUYYQIW6pWFqtV+3JckGEP3cC4diovXBRQntEcsJByNzjoOXKkJRpuurzTYa2hxpfFCr6FfTFQO1EkWWd3WqvCQZKngORlW1WO1oikkN+yEkJrZxlUjIF3MsjzNTm0TpdtLOp68+7ixE6EQzjmTISAzkRHV6NeSKB00xgcsAoaZyng2ysEGNrH2/Vj67cZikOV2rNJuXpyMOjValA8WzioBw2JghZI0Lj//+1jE5IOPqRNQTTDPSkciaUW8MLkSj1E6CLKoqXYUIWUI4eEBIhXfzZjm13xTA62IIGgRORS5LUtagIw5k2Ko+S+fLLkCoow2ETKok0HWyBLKTsynSdDqagEKBCt50iZi5wJQGGDumF0SqokEUcaUoDLYMQLVUaoSAiYPDSL7JHch6ddVu7QX8n4emzGgkDgkk5Te0jGk55esHHjNlIJRJcWlJ1LDCdKFC9SfHTCRSZwrKFllpkiEDRD0nkFCHG3wYeiI5nk0CjNoWGeq2aGWS8tdRVIkeVPmly+3Ko7qmBb9q/xcIGmoiHDoSJDgwGfSKX+sVgK4WwtxeN12SWIZnZy3FF+U0uhjOXSKQ2rdEFHlA02LBUmC0shNl6LzTRX/+1jE4oOPFRNQTTDPShKi6cWkmtKD6BgzJ+SFYXPTA2Uk6Uez1weicMNO0/qS/CDsQqwixzGpbeqTaWy+hVRBqN1ccASNjAKEzPrsyMlNMAQFdEgKFyULvCvB1Y6oKhAoUUErocRaSXUSjTO5lQKLOqqSQrPbm5sEwkPBNWg6FIgLy4tMgSPxOKgdg4Dywhj2rUl0qIJKA0JZaEchRvj1AuHr8jMiclLxIUylNERVMn2x4m3NrLwngVlexENCSPBcXsVw8ucrldSftzq8TiZcPiMzXNOolzuLMWx3dmO93LIVS+YQMgJRRgPQJbmcRtKRSSRS7DAt3BI1yzDLEFWXMwfZ2m/WGZ9LHoiFa3FZMxaHptMlCp4MCzJg+kNphhf/+1jE6QOReRVMLTE0ya+hqomTDqIkEawjUEhxLkWlzpRVCfGtR0UQxWSaWUNMK7i4pHSVHOaOvkpXF9LKLLTUnCbkSKSzE0mKuVRjUqbS6JpFFXwoL2q7esvN0gEWWzw1GfAjWZsZO4LAiJxDuWZRhEhGWKBPKgslcqoGAHgHhKaEwAP3V6CZDlLItEd4UKQjEgfkh4PBkrAsJJMbHMmrSccl9F5aGJSJziRfAfJKq3XFbKRL6GcPnpEX3QrvnyJTfKIR1EiaVpHmVh+kdYcSsooWeeVr2UrS6Ftpuq6LbOxWWMxa+xB+wgZIt06mwLBAMXIpikla1YE00VVh1blyNZgRWNuI7jWYAyConkkwE4RIBaXSbNPgK50Hyk/i19L/+1jE8oOTvSNIDeGHigshKcmsJLvWEQx346SsIaXD+5fXN0idLjSdq5xeilCed3l9AyCCn0xEpKVn1aRo1azq5EIMQsudoq2SqbpEHQTJkgg2pC+FypIBFcF+zkUkwJgEQCAkkWAyERWCIgdKJcaYIXCEU3ETIdKeYW5jBqubsyGPULR3RbouqFAJFIoBUJXEkQ7XTLh5JhNOVYklQvKmiWfmWW8rGR0uNoapVZR1IqpxZUl9mjbSNeucXviUpmBjMNQo1JgoBDgqkBShEUOCYXXsQsSz4gbBI0tUUacfCjKrVhgJETF0znBE+zRJVhxYCjU/4UBmIExctowi4GcPSaL83T0WRhmgcDCUwkqKJQQcySfnUyMcxpuZKVExH6r/+1jE54ORiQlKLeWDWeceqcmmGfJpHEC4S1MscFrby2I9EucioelAnSZiAakMnaJAbFowHt9SVHhSPEAlB0SRJYudoCMlEg2GAViwjlUzK56eiHpwWzRcpH0yEREcMmqRY6uHuBadKcaOSefHKNlCU0WoRyqrGxLlmfiO2LsXOI7qAAMFtFCRajyr3c4ebB4WApQsAITgkCYoNAdNoHhsOGgZRgiWHzvFaImOF2yirCI6WJQs8RNI2ySR6BKkyWJyqzDNp+iXtFNXRUnFWl2MfjeENNuThjT3WTNLhXJTUlKTz6c5H1oapL3CNZaDGq+TS8fN8ZsjRCl49BfTBaFl9DIJLi/rpYQmyAVlpINCwsJAJEZCHJUPbJutPS/CXrz/+1jE6gORfRFKLbDVEqWmaUmnsXlpUrQlER1a8hRepgfiOGTxowN05ZVGmDi4KF2YTPoAwUTg7QbpKpk8dE1EpEcAAUtZLXIl06yYgsTSb1Z5uXy9zCMFpFlHAI0OL481ARZA4EKXfhKtpysD+ssZ7qwUAbH8TiS+JZeCgaSIIJsPAZk7nsAqXBCSCk+0NHSckEBcmOMIzUjaBAyroqHBqDyrL27MbGD0Ki8UK9rOWEs216YtGOfP5D5dhRYgdbe2YjyVC0iNbcmCcgLNcgNNI0CDJQTV76kktM1bFmxnL5pSYIEpyl2RCGElo3oJpGkmXqMQ0EyLGZKqN5jDTSresR1GdRfR3J0QiWaKx2Kq4QWNI5qChNcypcIa4mr7RPH/+1jE1IOOgQVWTGEgSdehagWGGXrh+WTlOmeRFV0gnCYzNrehIk604g5K2SDdec8e2YPy4vMkCzJfLBdoWTOBBHNSeOoiaspxhVbR0+n5MYkA5s029a5hMtdmrfW7agECppugnOMpsb4KEIOHbaJsDfZwS5j5PhkUQ6STkjNIylQsl/SCQoVKjOBS3E5YwSgEEiEaC4yCwwcEar7XKGZpodegGyqELxLRMUR8tOM12hsMFWSni8YRaeEbuLg+ZRnidwltAgZDZmVUR0OtYh7d8jJTJgWUWLFjbWvIjHQ/2zRtjcaGwQIAMHewvBGnxexelFLqCU22oReeGkJA+bJAqqOwtJz0RpEJaxpGwSKEcrnMldfzDRifXKT5fTBmHon/+1jE5QOPcRdMLDEpSjOi6IGnsLkAwRZy8srDdSJqOIk6OBpFEqBFal9XiM9Mp08ggCJmqGa2lfXP/8kKut6nLLERQsAuvcZUhILuXVVAaZcKAhggDsZWkgyhIpy3YjLTC/7tlsU1ErljK0uEkc5LDEq1/Rdoz9R+dautySSN82UdlU9G4Gtuw9KsUDW2kN4+Fy4OZ4sH00Si83VIBRMiVg0mJ+ejcfxGw1ZPT0wjICnAaKy4B8vEhtwlmB8eFV6cyBYutDqs3JtI2vdCIX8jk+RVNyLZhzpk/nHp5S39LIRJpuf63eJvX8HzZBhB1IsOJCgFmSl8nebbGfqBRztZczzIMnEsTor5jBHSypZ9pha1UuVenMoUhTOoFWzkpYn/+1jE5gGQyRlELL0rAcygqR2GGai/K85MroJPepBKPiiLTdjIefZdVqtSg/kxZG1OKJPoSQ81JHiJcmWFUVvEAt6oad1RV/VejK3+yPape1JnlxPD62WRqiDg14TUAW+KgkSCrE53ea4jkuT4lQr1BSRZzKW3IeZfpQrXw6ENVB6nOq1Ad5ejKgHUbyXJWiUS8TjLeKpDmiE4cITowSSKyGzQnIWRVOiNCLk3RnAKJkIyYimjFy79OHzMlklQFIUjxoWRbImLWXETMgbBKHpGo40OKlzyGWg9r/R8o861fgsVIdsMBHgHVHAGnUl0jklRJ4fh2y+yjSryOeJbScKJDBbjnuPllPlyQ9ac0ShBIkOam9QVvgwW9DCFSM1IzUz/+1jE7oOTrS06DDH4geAhaEWHpTjiHlTRl7DkaHrwiSw50aQkvRS8mk1cWJoMpORUsUJyrbkJ08aFTKSBAqqjd8RkLGdEoyzTTMYy1YVH8tlbU3rIwE5TlzMC6AOKVqbDgoZanOyU2lSkiFLtJIUp0D04feRXSEiwn8zKsW5D1h21nQSYvpKTNMliSJihVCjMRKhordTNPHRW9eoEJWyWR5eSrXCcXQOwFaKstKoFTvddo6ulMeWtL0L3qiKtglIjgMi0hgdKpOgNjo56aPGX6SUJKyWdWwqZjOU+IdeYxYjfEetNEFCiEgmLAwLCH4gaxPRnFwXyZ0yJ12uxEKRyVNFVGtYXiKPROEohlryqeADD9CCI641GSRFRGT9eOmz/+1jE6QORYRM4DL0pygOh5smXpXD2BUclI2IhMrSbBMFUDN5LynkiJGKWEUkyVYsRhlYqYBI0hVOPcRLiVEVmIiMDNXCXVciXciTSbRXBFNDipUBHsSpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+1jE6IPQmQUoDL2HyguhYYGWJiCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
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
