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
		  skin: 'bmw-m',
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
		 * bmw-m：斜切刀锋 + 官方 M 标志 + 顶部红条 + 斜向速度线。
		 * 当前默认模板。
		 */
		BADGE.skins['bmw-m'] = {
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
		    logo.src = 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhLS0gQ3JlYXRlZCB3aXRoIElua3NjYXBlIChodHRwOi8vd3d3Lmlua3NjYXBlLm9yZy8pIC0tPgoKPHN2ZwogICB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iCiAgIHhtbG5zOmNjPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyMiCiAgIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyIKICAgeG1sbnM6c3ZnPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKICAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogICB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayIKICAgeG1sbnM6c29kaXBvZGk9Imh0dHA6Ly9zb2RpcG9kaS5zb3VyY2Vmb3JnZS5uZXQvRFREL3NvZGlwb2RpLTAuZHRkIgogICB4bWxuczppbmtzY2FwZT0iaHR0cDovL3d3dy5pbmtzY2FwZS5vcmcvbmFtZXNwYWNlcy9pbmtzY2FwZSIKICAgd2lkdGg9IjU3Ljk3NzYxOW1tIgogICBoZWlnaHQ9IjIwLjk1NzExOW1tIgogICB2aWV3Qm94PSIwIDAgNTcuOTc3NjE5IDIwLjk1NzExOSIKICAgdmVyc2lvbj0iMS4xIgogICBpZD0ic3ZnOCIKICAgaW5rc2NhcGU6dmVyc2lvbj0iMC45Mi4yICg1YzNlODBkLCAyMDE3LTA4LTA2KSIKICAgc29kaXBvZGk6ZG9jbmFtZT0iQk1XIE0gbG9nby5zdmciPgogIDx0aXRsZQogICAgIGlkPSJ0aXRsZTg5OSI+Qk1XIE0gbG9nbzwvdGl0bGU+CiAgPGRlZnMKICAgICBpZD0iZGVmczIiPgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMjEzIj4KICAgICAgPHN0b3AKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6IzQ5OGJjMDtzdG9wLW9wYWNpdHk6MSIKICAgICAgICAgb2Zmc2V0PSIwIgogICAgICAgICBpZD0ic3RvcDEyMDkiIC8+CiAgICAgIDxzdG9wCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiMyNTU4ODY7c3RvcC1vcGFjaXR5OjEiCiAgICAgICAgIG9mZnNldD0iMSIKICAgICAgICAgaWQ9InN0b3AxMjExIiAvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudAogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50MTE2OSIKICAgICAgIGlua3NjYXBlOmNvbGxlY3Q9ImFsd2F5cyI+CiAgICAgIDxzdG9wCiAgICAgICAgIGlkPSJzdG9wMTE2MyIKICAgICAgICAgb2Zmc2V0PSIwIgogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojMDAzZDY4O3N0b3Atb3BhY2l0eToxIiAvPgogICAgICA8c3RvcAogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojNWY4ZGQzO3N0b3Atb3BhY2l0eToxIgogICAgICAgICBvZmZzZXQ9IjAuMzY0MDUwMjciCiAgICAgICAgIGlkPSJzdG9wMTE2NSIgLz4KICAgICAgPHN0b3AKICAgICAgICAgaWQ9InN0b3AxMTY3IgogICAgICAgICBvZmZzZXQ9IjEiCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiMwMDJhNDk7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMTYxIgogICAgICAgaW5rc2NhcGU6Y29sbGVjdD0iYWx3YXlzIj4KICAgICAgPHN0b3AKICAgICAgICAgaWQ9InN0b3AxMTU1IgogICAgICAgICBvZmZzZXQ9IjAiCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiM2MTllZDU7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICAgIDxzdG9wCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiNhYWNjZmY7c3RvcC1vcGFjaXR5OjEiCiAgICAgICAgIG9mZnNldD0iMC4yNzk4MTQiCiAgICAgICAgIGlkPSJzdG9wMTE1NyIgLz4KICAgICAgPHN0b3AKICAgICAgICAgaWQ9InN0b3AxMTU5IgogICAgICAgICBvZmZzZXQ9IjEiCiAgICAgICAgIHN0eWxlPSJzdG9wLWNvbG9yOiMzZjdmYmU7c3RvcC1vcGFjaXR5OjEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMTMzIj4KICAgICAgPHN0b3AKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6I2RiMWUxYztzdG9wLW9wYWNpdHk6MTsiCiAgICAgICAgIG9mZnNldD0iMCIKICAgICAgICAgaWQ9InN0b3AxMTI5IiAvPgogICAgICA8c3RvcAogICAgICAgICBpZD0ic3RvcDExMzciCiAgICAgICAgIG9mZnNldD0iMC40NjI3NDY0MSIKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6I2RlODc4NztzdG9wLW9wYWNpdHk6MSIgLz4KICAgICAgPHN0b3AKICAgICAgICAgc3R5bGU9InN0b3AtY29sb3I6I2M4MWExNztzdG9wLW9wYWNpdHk6MSIKICAgICAgICAgb2Zmc2V0PSIxIgogICAgICAgICBpZD0ic3RvcDExMzEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQ4ODEiPgogICAgICA8c3RvcAogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojNzk3ZTgxO3N0b3Atb3BhY2l0eToxIgogICAgICAgICBvZmZzZXQ9IjAiCiAgICAgICAgIGlkPSJzdG9wODc3IiAvPgogICAgICA8c3RvcAogICAgICAgICBpZD0ic3RvcDg4NSIKICAgICAgICAgb2Zmc2V0PSIwLjUzMDI1ODg5IgogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojZjBmMGYwO3N0b3Atb3BhY2l0eToxIiAvPgogICAgICA8c3RvcAogICAgICAgICBzdHlsZT0ic3RvcC1jb2xvcjojYmFiY2JkO3N0b3Atb3BhY2l0eToxIgogICAgICAgICBvZmZzZXQ9IjEiCiAgICAgICAgIGlkPSJzdG9wODc5IiAvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudAogICAgICAgaW5rc2NhcGU6Y29sbGVjdD0iYWx3YXlzIgogICAgICAgeGxpbms6aHJlZj0iI2xpbmVhckdyYWRpZW50ODgxIgogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50ODgzIgogICAgICAgeDE9IjE2MC40MTUxNiIKICAgICAgIHkxPSIxMDAuNzI3ODgiCiAgICAgICB4Mj0iMTU3LjI0MDE2IgogICAgICAgeTI9IjEyNC4wMTEyMiIKICAgICAgIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIgogICAgICAgZ3JhZGllbnRUcmFuc2Zvcm09InNjYWxlKDMuNzc5NTI3NSkiIC8+CiAgICA8bGluZWFyR3JhZGllbnQKICAgICAgIGlua3NjYXBlOmNvbGxlY3Q9ImFsd2F5cyIKICAgICAgIHhsaW5rOmhyZWY9IiNsaW5lYXJHcmFkaWVudDExMzMiCiAgICAgICBpZD0ibGluZWFyR3JhZGllbnQxMTM1IgogICAgICAgeDE9IjE0NS4wMzkwNSIKICAgICAgIHkxPSI5Ny40MTEzMDEiCiAgICAgICB4Mj0iMTQ1LjAzOTA1IgogICAgICAgeTI9IjExMy4xNjM5OSIKICAgICAgIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiAvPgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICB4bGluazpocmVmPSIjbGluZWFyR3JhZGllbnQxMTY5IgogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50MTE0NSIKICAgICAgIHgxPSI1MjIuNzExNTUiCiAgICAgICB5MT0iMzc1LjA4NDcyIgogICAgICAgeDI9IjUyMi43MTE1NSIKICAgICAgIHkyPSI0MzIuNjMyNDUiCiAgICAgICBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgLz4KICAgIDxsaW5lYXJHcmFkaWVudAogICAgICAgaW5rc2NhcGU6Y29sbGVjdD0iYWx3YXlzIgogICAgICAgeGxpbms6aHJlZj0iI2xpbmVhckdyYWRpZW50MTE2MSIKICAgICAgIGlkPSJsaW5lYXJHcmFkaWVudDExNTMiCiAgICAgICB4MT0iNDg5LjgyMDk1IgogICAgICAgeTE9IjM3Mi44MTY5MyIKICAgICAgIHgyPSI0ODkuODIwOTUiCiAgICAgICB5Mj0iNDU0LjgxNDQyIgogICAgICAgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIC8+CiAgICA8ZmlsdGVyCiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICBzdHlsZT0iY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzOnNSR0IiCiAgICAgICBpZD0iZmlsdGVyMTE5OCIKICAgICAgIHg9Ii0wLjAwODA2MTYyMjMiCiAgICAgICB3aWR0aD0iMS4wMTYxMjMyIgogICAgICAgeT0iLTAuMDA0Nzc4MDg2MiIKICAgICAgIGhlaWdodD0iMS4wMDk1NTYyIj4KICAgICAgPGZlR2F1c3NpYW5CbHVyCiAgICAgICAgIGlua3NjYXBlOmNvbGxlY3Q9ImFsd2F5cyIKICAgICAgICAgc3RkRGV2aWF0aW9uPSIwLjA0MTcyMjM4NyIKICAgICAgICAgaWQ9ImZlR2F1c3NpYW5CbHVyMTIwMCIgLz4KICAgIDwvZmlsdGVyPgogICAgPGxpbmVhckdyYWRpZW50CiAgICAgICBpbmtzY2FwZTpjb2xsZWN0PSJhbHdheXMiCiAgICAgICB4bGluazpocmVmPSIjbGluZWFyR3JhZGllbnQxMjEzIgogICAgICAgaWQ9ImxpbmVhckdyYWRpZW50MTIxNSIKICAgICAgIHgxPSIxMjYuMDQxNCIKICAgICAgIHkxPSIxMDEuNDg0NzYiCiAgICAgICB4Mj0iMTEzLjk0MTgiCiAgICAgICB5Mj0iMTIyLjQ0MTg4IgogICAgICAgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIC8+CiAgPC9kZWZzPgogIDxzb2RpcG9kaTpuYW1lZHZpZXcKICAgICBpZD0iYmFzZSIKICAgICBwYWdlY29sb3I9IiNmZmZmZmYiCiAgICAgYm9yZGVyY29sb3I9IiM2NjY2NjYiCiAgICAgYm9yZGVyb3BhY2l0eT0iMS4wIgogICAgIGlua3NjYXBlOnBhZ2VvcGFjaXR5PSIwLjAiCiAgICAgaW5rc2NhcGU6cGFnZXNoYWRvdz0iMiIKICAgICBpbmtzY2FwZTp6b29tPSIxIgogICAgIGlua3NjYXBlOmN4PSIxMzkuMDEyMSIKICAgICBpbmtzY2FwZTpjeT0iOC42MzAyNzEiCiAgICAgaW5rc2NhcGU6ZG9jdW1lbnQtdW5pdHM9Im1tIgogICAgIGlua3NjYXBlOmN1cnJlbnQtbGF5ZXI9ImxheWVyMSIKICAgICBzaG93Z3JpZD0iZmFsc2UiCiAgICAgc2hvd2d1aWRlcz0idHJ1ZSIKICAgICBpbmtzY2FwZTpndWlkZS1iYm94PSJ0cnVlIgogICAgIGlua3NjYXBlOnNuYXAtaW50ZXJzZWN0aW9uLXBhdGhzPSJmYWxzZSIKICAgICBpbmtzY2FwZTpvYmplY3Qtbm9kZXM9ImZhbHNlIgogICAgIGlua3NjYXBlOndpbmRvdy13aWR0aD0iMTkyMCIKICAgICBpbmtzY2FwZTp3aW5kb3ctaGVpZ2h0PSIxMDE3IgogICAgIGlua3NjYXBlOndpbmRvdy14PSIxMzU4IgogICAgIGlua3NjYXBlOndpbmRvdy15PSItOCIKICAgICBpbmtzY2FwZTp3aW5kb3ctbWF4aW1pemVkPSIxIgogICAgIGlua3NjYXBlOnNuYXAtc21vb3RoLW5vZGVzPSJmYWxzZSIKICAgICBmaXQtbWFyZ2luLXRvcD0iMCIKICAgICBmaXQtbWFyZ2luLWxlZnQ9IjAiCiAgICAgZml0LW1hcmdpbi1yaWdodD0iMCIKICAgICBmaXQtbWFyZ2luLWJvdHRvbT0iMCIgLz4KICA8bWV0YWRhdGEKICAgICBpZD0ibWV0YWRhdGE1Ij4KICAgIDxyZGY6UkRGPgogICAgICA8Y2M6V29yawogICAgICAgICByZGY6YWJvdXQ9IiI+CiAgICAgICAgPGRjOmZvcm1hdD5pbWFnZS9zdmcreG1sPC9kYzpmb3JtYXQ+CiAgICAgICAgPGRjOnR5cGUKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9wdXJsLm9yZy9kYy9kY21pdHlwZS9TdGlsbEltYWdlIiAvPgogICAgICAgIDxkYzp0aXRsZT5CTVcgTSBsb2dvPC9kYzp0aXRsZT4KICAgICAgICA8Y2M6bGljZW5zZQogICAgICAgICAgIHJkZjpyZXNvdXJjZT0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbGljZW5zZXMvYnktc2EvNC4wLyIgLz4KICAgICAgICA8ZGM6ZGF0ZT4xMi8wNC8yMDE4PC9kYzpkYXRlPgogICAgICAgIDxkYzpjcmVhdG9yPgogICAgICAgICAgPGNjOkFnZW50PgogICAgICAgICAgICA8ZGM6dGl0bGU+Qk1XIE1vdG9yc3BvcnQgR21iSDwvZGM6dGl0bGU+CiAgICAgICAgICA8L2NjOkFnZW50PgogICAgICAgIDwvZGM6Y3JlYXRvcj4KICAgICAgICA8ZGM6cHVibGlzaGVyPgogICAgICAgICAgPGNjOkFnZW50PgogICAgICAgICAgICA8ZGM6dGl0bGU+Q01ldGFsQ29yZTwvZGM6dGl0bGU+CiAgICAgICAgICA8L2NjOkFnZW50PgogICAgICAgIDwvZGM6cHVibGlzaGVyPgogICAgICAgIDxkYzpzb3VyY2U+aHR0cDovL3d3dy5jYXJsb2dvcy5vcmcvbG9nby9CTVctTS1sb2dvLTE5MjB4MTA4MC5wbmc8L2RjOnNvdXJjZT4KICAgICAgPC9jYzpXb3JrPgogICAgICA8Y2M6TGljZW5zZQogICAgICAgICByZGY6YWJvdXQ9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL2xpY2Vuc2VzL2J5LXNhLzQuMC8iPgogICAgICAgIDxjYzpwZXJtaXRzCiAgICAgICAgICAgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNSZXByb2R1Y3Rpb24iIC8+CiAgICAgICAgPGNjOnBlcm1pdHMKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL25zI0Rpc3RyaWJ1dGlvbiIgLz4KICAgICAgICA8Y2M6cmVxdWlyZXMKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL25zI05vdGljZSIgLz4KICAgICAgICA8Y2M6cmVxdWlyZXMKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9jcmVhdGl2ZWNvbW1vbnMub3JnL25zI0F0dHJpYnV0aW9uIiAvPgogICAgICAgIDxjYzpwZXJtaXRzCiAgICAgICAgICAgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNEZXJpdmF0aXZlV29ya3MiIC8+CiAgICAgICAgPGNjOnJlcXVpcmVzCiAgICAgICAgICAgcmRmOnJlc291cmNlPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyNTaGFyZUFsaWtlIiAvPgogICAgICA8L2NjOkxpY2Vuc2U+CiAgICA8L3JkZjpSREY+CiAgPC9tZXRhZGF0YT4KICA8ZwogICAgIGlua3NjYXBlOmxhYmVsPSJDYXBhIDEiCiAgICAgaW5rc2NhcGU6Z3JvdXBtb2RlPSJsYXllciIKICAgICBpZD0ibGF5ZXIxIgogICAgIHRyYW5zZm9ybT0idHJhbnNsYXRlKC0xMTMuNTA5MDYsLTEwMS40ODQ3NikiPgogICAgPGcKICAgICAgIGlkPSJnMTI0MyI+CiAgICAgIDxnCiAgICAgICAgIGlkPSJnMTI3OSI+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojYjRiNmI4O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjA0OTAzODQ3cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDEzOS41NzIwOCwxMjIuNDQxODggLTEuMjIxOTYsLTIuNmUtNCAxMi4yNjM0LC0yMC45NTY3MSBoIDEuMzA3MzggeiIKICAgICAgICAgICBpZD0icGF0aDg3MSIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjI2NDU4MzMycHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MTtmaWx0ZXI6dXJsKCNmaWx0ZXIxMTk4KSIKICAgICAgICAgICBkPSJtIDE1MC41NDkxOSwxMDEuNDg0NzYgLTEyLjI2MzQyLDIwLjk1Njg2IGggMC4xMzY0MiBsIDEyLjI4NDYyLC0yMC45NTY4NyB6IgogICAgICAgICAgIGlkPSJwYXRoMTE4OCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHRyYW5zZm9ybT0icm90YXRlKC0wLjAxOTM0NDQxLDE0NC41MDM2NSw2OC42NzEzOTQpIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MTtmaWxsOnVybCgjbGluZWFyR3JhZGllbnQ4ODMpO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDU3My4xNjAxNiwzODMuNTY0NDUgLTQ2LjM0NzY2LDc5LjIwNzAzIGggMzMuNDEyMTEgbCAxNS42ODE2NCwtMjYuMjkyOTYgMC4yNTU4NiwyNi4yOTI5NiBoIDI3LjAyNTM5IGwgMTUuNjkxNDEsLTI2LjE5OTIxIDAuMTExMzIsMjYuMTk5MjEgaCAyOS4xNDg0NCB2IC03OS4yMDcwMyBoIC0yOC4wMTc1OCBsIC0xNS45MjE4NywyNi42MzI4MiB2IC0yNi42MzI4MiB6IgogICAgICAgICAgIHRyYW5zZm9ybT0ic2NhbGUoMC4yNjQ1ODMzMykiCiAgICAgICAgICAgaWQ9InBhdGg4MzgiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIgLz4KICAgICAgICA8cGF0aAogICAgICAgICAgIHN0eWxlPSJvcGFjaXR5OjAuNzMwMDAwMDQ7ZmlsbDojNTI1NTU3O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDU3My4xNjAxNiwzODMuNTY0NDUgLTQ2LjM0NzEzLDc5LjIwNzAzIGggMC43MDI1OSAzMi43MDg5OSBsIDAuMjQ0MTQsLTAuNDc4NTEgaCAtMTYuNzU1ODYgbCAtMTUuODUzNTEsLTAuMTAzNTIgNDYuMDA1ODUsLTc4LjA3NDIyIGggMTQuODk0NTQgMTUuMzk2NDggbCAwLjA0MywtMC41NTA3OCBoIC0zMC4wMDk3NyAtMC4zNTkzNyB6IG0gNDYuOTYwOTMsMCAtMC4zMTgzNiwwLjU1MDc4IGggMTMuOTE2MDIgMTMuOTE2MDIgdiAzOS4wODc4OSAzOS4wODk4NSBoIC0xNC4wMTU2MyAtMTQuNTkxOCBsIC0wLjAzNzEsMC40Nzg1MSBoIDI5LjE0ODQ0IHYgLTc5LjIwNzAzIHogbSAtNDMuOTIzODIsNzguNzI4NTIgLTAuMDM1MiwwLjQ3ODUxIGggMjcuMDI1MzkgbCAwLjI0NDE0LC0wLjQ3ODUxIGggLTEzLjYxMTMzIHoiCiAgICAgICAgICAgdHJhbnNmb3JtPSJzY2FsZSgwLjI2NDU4MzMzKSIKICAgICAgICAgICBpZD0icGF0aDg3NCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0ib3BhY2l0eToxO2ZpbGw6dXJsKCNsaW5lYXJHcmFkaWVudDExNTMpO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDoxLjI5MzMyMzc2O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLWRhc2hhcnJheTpub25lO3N0cm9rZS1kYXNob2Zmc2V0OjA7c3Ryb2tlLW9wYWNpdHk6MTtwYWludC1vcmRlcjptYXJrZXJzIHN0cm9rZSBmaWxsIgogICAgICAgICAgIGQ9Im0gNDc2LjM3Njk1LDM4My41NjQ0NSAtNDcuMzY3MTgsNzkuMjA3MDMgaCAzLjQwNDI5IDI5LjQ4NjMzIDMwLjI3OTMgMzAuMjc5MjkgbCA0Ni43ODkwNywtNzkuMjA3MDMgaCAtMzAuMjc5MyAtMzAuMjc5MyAtMjkuOTUxMTcgeiIKICAgICAgICAgICBpZD0icGF0aDg2MSIKICAgICAgICAgICB0cmFuc2Zvcm09InNjYWxlKDAuMjY0NTgzMzMpIgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojODg4YzhmO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDYwNC4xOTkyMiwzODMuNTY0NDUgLTIuODY1MjQsMzYuNzY1NjMgMTguNzg3MTEsLTM2Ljc2NTYzIC0xNS45MjE4NywyNi42MzI4MiB6IgogICAgICAgICAgIHRyYW5zZm9ybT0ic2NhbGUoMC4yNjQ1ODMzMykiCiAgICAgICAgICAgaWQ9InBhdGg4NDIiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIgLz4KICAgICAgICA8cGF0aAogICAgICAgICAgIHN0eWxlPSJmaWxsOiM1MjU2NTk7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDQ5MDM4NDdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIgogICAgICAgICAgIGQ9Im0gMTU5LjEwMzE0LDExMS4yMTIyMSAwLjc1OCwtMi42ODA3NSB2IC03LjA0NjU1IGggLTJlLTQgeiIKICAgICAgICAgICBpZD0icGF0aDg0NCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojODg4YzhmO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjE4NTM0MjI1cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDU3OC44OTQ1Myw0MjYuMjIwNyAtMTguNjY5OTIsMzYuNTUwNzggMTUuNjgxNjQsLTI2LjI5Mjk2IDAuMjU1ODYsMjYuMjkyOTYgeiIKICAgICAgICAgICBpZD0icGF0aDkxMCIKICAgICAgICAgICB0cmFuc2Zvcm09InNjYWxlKDAuMjY0NTgzMzMpIgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDojNTI1NjU5O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO3N0cm9rZS13aWR0aDowLjA0OTAzODQ3cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDE0OC4yMjYyOSwxMjIuNDQxODggNC4xNDg2NywtNi45NTY3NiAwLjc5MTAyLC0yLjcxNDE5IHoiCiAgICAgICAgICAgaWQ9InBhdGg4NDYiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIKICAgICAgICAgICBzb2RpcG9kaTpub2RldHlwZXM9ImNjY2NjIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9ImZpbGw6Izg4OGM4ZjtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4xODUzNDIyNXB4O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1vcGFjaXR5OjEiCiAgICAgICAgICAgZD0ibSA2MjEuNzg5MDYsNDI2LjIyMDcgLTE4LjYwMTU2LDM2LjU1MDc4IDE1LjY5MTQxLC0yNi4xOTkyMSAwLjExMTMyLDI2LjE5OTIxIHoiCiAgICAgICAgICAgdHJhbnNmb3JtPSJzY2FsZSgwLjI2NDU4MzMzKSIKICAgICAgICAgICBpZD0icGF0aDkyMCIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9ImZpbGw6IzUyNTY1OTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4wNDkwMzg0N3B4O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1vcGFjaXR5OjEiCiAgICAgICAgICAgZD0ibSAxNTkuNTkzNTIsMTIyLjQ0MTg4IDQuMTUxNTgsLTYuOTMxOTkgMC43Njk3OCwtMi43Mzg5NiAtNC45MjE1Miw5LjY3MDY5IHoiCiAgICAgICAgICAgaWQ9InBhdGg4NTAiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIKICAgICAgICAgICBzb2RpcG9kaTpub2RldHlwZXM9ImNjY2NjIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MTtmaWxsOnVybCgjbGluZWFyR3JhZGllbnQxMTQ1KTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MS4yOTMzMjM3NjtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1kYXNoYXJyYXk6bm9uZTtzdHJva2UtZGFzaG9mZnNldDowO3N0cm9rZS1vcGFjaXR5OjE7cGFpbnQtb3JkZXI6bWFya2VycyBzdHJva2UgZmlsbCIKICAgICAgICAgICBkPSJtIDUwOC42ODk0NSwzODMuNTY0NDUgLTQ2Ljc4OTA2LDc5LjIwNzAzIGggMzAuMjc5MyAzMC4yNzkyOSBsIDQ2Ljc4OTA3LC03OS4yMDcwMyBoIC0zMC4yNzkzIHoiCiAgICAgICAgICAgaWQ9InBhdGg4NTkiCiAgICAgICAgICAgdHJhbnNmb3JtPSJzY2FsZSgwLjI2NDU4MzMzKSIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MTtmaWxsOnVybCgjbGluZWFyR3JhZGllbnQxMTM1KTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4zNDIxOTE5O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLWRhc2hhcnJheTpub25lO3N0cm9rZS1kYXNob2Zmc2V0OjA7c3Ryb2tlLW9wYWNpdHk6MTtwYWludC1vcmRlcjptYXJrZXJzIHN0cm9rZSBmaWxsIgogICAgICAgICAgIGQ9Im0gMTQyLjYwMjExLDEwMS40ODQ5MSBoIDguMDExNDEgbCAtMTIuMjYzNCwyMC45NTY3MSAtOC4xMjc3NCwyLjZlLTQgeiIKICAgICAgICAgICBpZD0icmVjdDg1NiIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0iZmlsbDp1cmwoI2xpbmVhckdyYWRpZW50MTIxNSk7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDQ5MDM4NDdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIgogICAgICAgICAgIGQ9Im0gMTI2LjY2NTk5LDEwMS40ODQ5MSBoIC0wLjYyNDQyIGwgLTEyLjUzMjUxLDIwLjk1Njk3IGggMC45MDA2OCB6IgogICAgICAgICAgIGlkPSJwYXRoODYzIgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgICAgICAgPHBhdGgKICAgICAgICAgICBzdHlsZT0ib3BhY2l0eTowLjE1NTAwMDA0O2ZpbGw6IzAwMDAwMDtzdHJva2U6bm9uZTtzdHJva2Utd2lkdGg6MC4wNzUxMDE4cHg7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW9wYWNpdHk6MSIKICAgICAgICAgICBkPSJtIDE1MC41Mjc1LDEwMS42MzA0MiBoIC0yMy45NDY1MiBsIDAuMDg1LC0wLjE0NTUxIGggMjMuOTQ3NSB6IgogICAgICAgICAgIGlkPSJwYXRoODY1IgogICAgICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiCiAgICAgICAgICAgc29kaXBvZGk6bm9kZXR5cGVzPSJjY2NjYyIgLz4KICAgICAgICA8cGF0aAogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiCiAgICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIKICAgICAgICAgICBpZD0icGF0aDExNzEiCiAgICAgICAgICAgZD0ibSAxNTEuNTYzNDgsMTAxLjYzMDI3IGggLTEuMDM1ODMgbCAwLjA4NjIsLTAuMTQ1NTEgaCAxLjAzNDc4IHoiCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MC40NDI1Njc1OTtmaWxsOiMwMDAwMDA7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDE1Njc2MjdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIiAvPgogICAgICAgIDxwYXRoCiAgICAgICAgICAgc3R5bGU9Im9wYWNpdHk6MC4zODUwMDAwMTtmaWxsOiMwMDAwMDA7c3Ryb2tlOm5vbmU7c3Ryb2tlLXdpZHRoOjAuMDE1Njc2MjdweDtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2Utb3BhY2l0eToxIgogICAgICAgICAgIGQ9Im0gMTM5LjM4NTk1LDEyMi40NDE2MiBoIC0xLjAzNTgzIGwgMC4wODYyLC0wLjE0NTUxIGggMS4wMzQ3OCB6IgogICAgICAgICAgIGlkPSJwYXRoMTE3NSIKICAgICAgICAgICBpbmtzY2FwZTpjb25uZWN0b3ItY3VydmF0dXJlPSIwIgogICAgICAgICAgIHNvZGlwb2RpOm5vZGV0eXBlcz0iY2NjY2MiIC8+CiAgICAgIDwvZz4KICAgIDwvZz4KICA8L2c+Cjwvc3ZnPgo=';
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
		  "src": "data:image/webp;base64,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"
		 },
		 {
		  "id": "m4-grey-night",
		  "name": "M4 · 夜行隧道",
		  "kind": "plate",
		  "sound": "engine-m4",
		  "engine": {
		   "revScale": 1,
		   "roar": 1.08
		  },
		  "src": "data:image/webp;base64,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"
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
