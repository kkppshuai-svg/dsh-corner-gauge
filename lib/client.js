/**
 * dsh-corner-gauge v2.0.0 — 由 scripts/build.mjs 生成，请勿直接编辑。
 * 改源码请编辑 src/，然后 npm run build。
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
		  },
		};

		BADGE.config = Object.assign({}, BADGE.DEFAULTS, window.__DSH_BADGE_CONFIG__ || {});

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
		      BADGE.audio = new Audio(`data:audio/mpeg;base64,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`);
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

		  const car = document.createElement('img');
		  car.className = 'g-car';
		  car.alt = '';
		  car.src = `data:image/webp;base64,UklGRmIUAABXRUJQVlA4WAoAAAAQAAAA3wEAqgAAQUxQSL0EAAABoEXbtmnHWju2nZRt27Zt27Zt27Zt24idshknd/1Edc8+++xVDzciJgAM/jf43+D///ftmCmjXQfv+5Nt3TJRiUm/oKSMTsQ/m5i0a/IML2Mz6jDrGYaK/vImrGf7hikxiijazQ+5+ODhjhIVfIAeSx5DrkbtXpUpixMVMAAouwf5m5wcMnV2M2Yh/RiAa5uD8chr3dv369p0cZV64DYmArkf8eBxy3Jl5Zyp17TXqJonD63NklW2NTqvQ3XV4YZhZhKt/nVU5cj+FgBMguWtextVO6i3DUjvzKt+oqr7D/WSW5mXx6P6H6wor9rO+4FCmHisipQybeuH4qg7W0E6Zer0EAXz7HxXiWRaaCuK6NdZLpKozpDXsSio3ya6yp+KU5/pUGTfTK4ocxxybryBAnyjIZMz5sXnP0dRvtpSwtQb9iYWRfpuM04wrVR5+gsUb1+/9D5qUrO2/ruBJs7S+BZq9uATZ5tmz6ttLAdvSELNv2vZQg87a83BAMC+185vKAl/fg/uP7BRSkwjQM7aVyJRNvoGbKha1x00Ydbmpz6irAw9fb4eMLGzHropGeVmdBkQeIe+u3+g/DwgUDYNUq55PCjFgCiUo5OExapgyvl3XUzx3AuUtO8cBMHUOUVH72XrUlx5B6XxbAEwGzC8/6VfKUejhK6uZlUa1Z4XEhyOkvu6KmUqnLf1lcuXUY7H91EVMxfH/Bs3rnmPUj3eSy3MB40cdCX6dzzK9yX8q9ak7oLQ0AiU9r8a8i1TuTMo/Z9wzNxl5kekwK1cYgDQ5FoM0uDPAjyCnItCkQ438ses/ZVvSIpDOVN440OkxlBrjlgN3pSIBDmMG9X6v0aiLMOFHJUuIF2e5cJtpMxQHtTRkYY/D24jcTVMoK5bSJvhymuMxLlEedeoo4rCGNRF6qyjMMj+hbpWIHFl/Uof9RW2FMnzjqmyssbRx2lQ9mqkz3PK8oklLovDSKAXFdUAKXS3ouqQSD7yykte+f7xVYC6gp2paxAQ10wgrgVAXB8yKa0edXwsDExh5XW0oSsByu9HG1uAg1aBlLEVuDiAMLYAH01CyCLWjRPQQ0cU0TWBl8YhNBFdE/jZjSaOAkfNfCnirAlPoCdB3DUCrlr600Mr4GxfakjuDLw1CaKF5E7A3246UugIHDYKIoSELsBlrwqHA4jglA9w26X8Pj/5F73bGLjNAIC1nf9R7v2sDPw3aXJJ4h2sAKpo5jP3tKRbAypass/D39ItqhaobKmuL+TaixygsgwAes2bN2/6I0k2BoCpTBpts2XLkm/34cP7fLWE777D+nwoSQ3Gggg6VapUqcKZx48fRHClU5lKquwE+l2sUgZWOJnIlXslQQQZpO7apUuXttffv3/3lQMx3qDSTL8yuO0nfiRftQMRNbKwMPWZPXv2lPvK2gwCb3WUF8ltAJiIpNGk9W0l9RM5MF72nQu3W4AAb/2lGF8joQMo/4sDh0GMC6xWymAQ/QKrlfath5kYMYB+QYr4XEr0GEC/MEW9LwsCbTFSCUGgBbNHKiVh777p9iDWxY8k6t0ALcDAeZT++d69Vq1MIRDxyu313UULAAOo317fzUHUGeg/0wIG/xv8b/D/vwgDAFZQOCB+DwAAUGgAnQEq4AGrAD5hLpRHJCKiISXSulCADAlpbvw+uKPAAzPl2QJvrf+JvoB9ZbhmF+iJkkZhvNDKJ/sPRIkq8o5RPLjkZ18c17zkvsvQr/WYpbB5Vyb9jgdZPvX9LYmDyrk37HA6yfeY7wTcJ2Jg8q5N+xwOsn3r+gSuf7//jBdrCUMjWwHXTZMHlXJv2OB1OXd9AD89fs+ZsdUMSQAvaQf+LfHYwJKF2998J5ZWCYemfSwsUPrzTUW6n1TIgj8NEnWfzOYWmrgXfY6bOy+i4N0FOBy0Y+keGBwxgH8GeMqLRjM6kvNw4EQn8/srVcsHP/12/hdZSgbGfGlUrEvXLaHXAb1kfQjd1GMAdbMYK3RlyA4bcN+VWIBqLJAUqjyHc2I/U126+ERd8LVbUfUcJXH6v6mKXQ5KxvDyG3uje0IuPk0ql9IPpHGQzgH44EJqdWRby5AGdtN8c4DbMSb2uRp0Fp8fu9Vt41YJdRTh/FMGQ/zLYbSvb55GV/ybLjpsuZ4tuUgT///itvKYzT3Z3HfNoGeGUA1OZDOV/xupujpCoBwHiiRNQk/U8n/zKl4B2mIesllZ9EwuC14VtlSdeJ0p780I9ES4GG0s4xpObNYxibzRX/7hWuylvKq0y53MExBm8HPmrfzGcRg0N54dxH05G6/5TbvTZafET/dxuecHas4KCjr+IAFGeFtrW/0HTml20NdygDxeJsgA1J2s1NcMNgf+2QTAxZ67uc0Styz2y9eFLYSXjLn8bPGflEGrc/HoAuYFFDRQcY5cxSlmxX6xlq4J6VnEiNUqcP+IfdqW10cYIh8zpsSzA2+0JYZa5OXAJlCGn7CYe/rCg3tKS7NhLHeMJnP8IRrhZpZv+z4tgOb3Cl/RtJh+a2xpgnmLrtpYQini+M2yPe4v+Yc2TeRZVUk31syegoEsjnWw3fPsePKmfOCsL56CIrNp+MaZZmf7v8U910YJKY83Hy+1zHInnRyLXt4ehh2syKqBkleUGkJ4nzLeW6bQ5Dkw3gQu42X2MR81eYw5W6ypfnCWIT2J0QGJxP0XK4pyHFqiecVR0UXDFLTJKy2Jg7dv4NOb9jgdZP6YYFL396/pbEweVcm/Y4HWT71/S2FwAP72voAAAASIlsgC+6ulQ7IAAB/rRNA2ACkCTGKvxZEzmm5mbWh6Lb0rsc5gks6BeyzijIQvCulrHmhhVvuD8NocShXAT6P7TOJN/HwrN1U0Skq42l0/Y5sou/Yyrq2gvA2cZD0A/uXc6OIe/oda0/EDJ61XpdaIB9kjZ1uUPf6prVpLQAJAgJ0MVod/6r9qe8ZWO0FNXHq3//6fOqViHms8YeB8jaDplSwSRlw9Uc+0RFIyR7MAMe2+bdOLFST+F4yl4bDfybpCPF0SA/del9i8GD3hOGXsmiFk8ovvDszKrEsw7TEuRh1eet+UDXl3bj6H0uVpdX3Q+wkXSHcpq8wKVR/vRUMj1aUmnNCnfDlLvHzuaC4hApK4RFzBCOxOCBIqHjjjJY191AUh557SR1EOYN5eAt19eF7N4ozf3xBFAPx/OjM5JQxRwmYhm0ZQqJBtchW49Uc4yWfGpdSihQ5Rg14UVseC1obmgVLILOppjl2E+RlJm0mEOqZMtgqKUnmNBkMP+UpV8+1QpB1CS+pvG4aEu7IwuGbvrj/fHUfuHwsZSRE7vk0OJSRk3uD0qOLv4tOizDCA6nQW5hvS1wJ8FaWJVlRLrCzJvzYHoYHCJKOIuqWduJA+8A1FSapqsUTOQ4uXUESreCO0itV7inYG3fvMolz+URoXFGwY6dHFC+nsR4LeZRv7miWRQTklS4Gg/x1flFwFLSXyyObeSwvAp+N1X8G0zGrU2gWN530RA/Qh1jia6dqQ1tDGkJmHbDrJ7c94w/wr2Zl+YM2osOBspWiLAacgakBzU7LzeUeNg96jVmHzSpvAK7BfGWukdCj2LJyuOMdCPWwTbtthzfrKDc2z1tBUY1kUmLLGto8QnztuWxDPO2DIwGSFBZeTCTW0joDUc5ZOIrWlBJ/f24V2P/puSBKV5gdLIE824qk58NGiYVKNtzobM+LOf4QOoAd3fjVmSZwxl1sHWM92rRvIoauwn3x2M1LYskt9DDcGFIyQ19IWzoVblnyOgzbB9h7mCA1xG61HSYt7hVsJlDsRmZtsSOJNgpKSBqg9MLIuV3yp21UcQFMA4L0hFenVjWZJbAvddLMH1vmeohZAXO8XaZXXCMiRZvW03mLUB7VxpubyT8NZDLgaBRl75mpN74ZKaSXD+KvNkdDpOGC1NlhyCm1XeJE5ygvV++OsVIk0p4ZWjJVJipPHUQO6nrRfKxuxX4CqbG9vM8NGrddcp6q9BdcMCWLWMNyF/Oh4F84K/d/9RW/9heHjy8Ck9T4QLpl8eQwi1pg3bg4eaDaAIOUxW+t9YWnbdbyxXElk3xWWe9Krnw6rPkjP+/XH+Sj1nzEE5tWUMtDGi8MA8PMGSO0+ZQDhUTGrJ9FLRG7j26GaHDO0W0uvEcyGihu0B3HUIUDaIldM/qcDGE1DOofcg2IcwPTFtcyovY9rWKLaAtILo5Hn6n618SGq+Z3AHNzp8eAoeJg9uPjCEq2vTKx2eolFt8oVZN7jUEGSdlsEo5ZnnCeXND5n2F+6+lTLNqFNomKYOU6Apb06PkrBErP15Xrua6dhWwZiPwNS/f0jIpGhDrqedYaEsFr/oiCxnipHBFkQYR9Erc/hND8CV/7GUNyoYRktkF71T5yADsMrxKYFOthznbwRocbIPTrP+Gu6yVF/6R9PrgONehxyAxFRitkCe/MOAbTiurYXDKm5t5XbyGDIc5fE3olZcWMnFGzV6u0chqc3NUQOpov6byqtiu3jHRjxnRhY5F3pGjKyM/BGIgaDeSUAsn8xMefMi6394wRMOr7BTkXPAJUP2dvpRO8Cgtxtf+EEVy9AvJeMROmTios66zQSp2oTRSX+PKr0opezTea/YhnH7BAbj3TEsQNDmlLe5EGixCqcmC05Ys8NoPob+zjqdqx8s7l/aToSJQjapeTujK0pnjdAjD8GcKS+2alWDwPkrpyS+bSh+Mg2Msb2Bu2xUQuapQYX1IXDGq1PlbrF7aLLA/+F8ppWHrl0XE7ChbiLUXMSE1L64WWNFAD52X1PgZj815L4mUQkbDaTmUEW2fC1Up6+8h5e1l3179rCVOHEGKYyWhjQy+4/TZDxjWvsaFqjkKLetnXIsf8p0T/3310uN1ZjKS7NIed4SR0zum2M7H9WfJ+D2oTF2+bUCvOFYiRoSxC79ck2SkCX6kQM9TjPavUZaxuLXS8yF2HDt3hiSrQBwAAnNmQCt9IS08gHEi4lInl9jey3fysXcwfDkX47E0cGtyjMvFZnz/zVBvnODPC4weOqCq84YCODp1Yw/z7WjJFdmOjPR4SMpNmZsRF6ChmEanvnGicp2GDe62JAufkVJTNe4BrcYCAJ+DK4mX9xxJo2qWYAkeDYSYgHXIn9C67to01lHWI1A1ujjSh+SdJi+wT8jN729llmF8JGKsBqkXUnraeQbBhfbOYF2cpqe4ZLlFzQB212EYEB1GQ25YxhzjzSLTGU522ywydYInBCUGWlhQyA2CSy2UsH/UwP91YXU0EluYle+lUZHQYtuw4ZAuywIBXZBxLuG6XYZNq6wQ7jauhNbjrWCq9FyTWrPwKnTmqsJ4Ivau/nkl7Ep2QYdZ47Qh8AnR1sSXU01ylx+R58718kT6UBIgiovNp6icUjZ+rN0ZrkMiRByNMtH1buCdCZl3qw0lNxez7z9uXTpu52GGRLL16zdpb6OSc4DOS1KE4dB0qhC7OndQ5PlDDezb5bTcl3SrCbePJLi24hIIPDBaHdc2g6+0oJ0XnnzbYUjq7HAW9yZ9U1iGzrj0HmcVkZFqcbmQthq5JGpzA+veCvfBTj1j1vktP0ytx8t4qhg4Ocwn3tu0ewDlt/U1x0V/JOz8CnkaWWXqupZGMxlWsFW5nb7YiZKgZC9kIw86gq5dT7ypycwxcWu/nPj3hqkNuryv3Gc/K/rUtbF1rztZEqsDRiXPuVwtR3SfQ6An8N5+UCOGltCQ8LtRToDdHWyWeZNn6J0KVH5HZhP49e6APDaCpN2UHhoYBLSzclvy0Atzk8MFzK/tSUiH03OBSa4WZyLJHLEUchAlcUG2nPX+n/TEflGXSteJp0MLXVNgGlpPlytH1zUoVAs4SRI1U+Q/l7sZ9T4z+yhAp47q9/BtndWZCqMvlvas+edfHGhFfd4TjtzZiAmgsiYnpP7F88aWWNA0z744IXCEiabnNzEHIPbtQQgCXBsFXwa2b1MH0ORbSSUUaB7wfanp20ezTDIP+KxEL2TuKCmAyLnFGXHyHl0gjVkfWdbQ+O92hKsD5MSaKnXjBYjGPMWNGUm+NVzUjSM5eee+rvIzZTUsCy+7QDhYvrrDh0L0Ih1aTv0CLNGH7j8vqHpYyd49R9dO5xwd4KBasCNxpdKzgRNaRAzgxk+g15MVCyKf2m5JiVyX39hCVFBbIw4KbjzsZKQ+Zujg6IpGO4+uIoAbCcH1Mv+FcrlM0Q+kn6+2jeRQpTZgafRPTClxUDRvA+JNg7o8qmWrrZnCPunIsdnY2SiCkslGVOY09JJ8/sBST8ZAXUexEZFk4mu+7oIRiyGMZFeuLnE3tmXwDWDzhm6sDr7zogmRSCOStCo11YMKSP7zy6ALU6BVUCczBP2Fenu1gK5+GTvC2BAgdrReua63Agu786+KrgczH4xWH8gwyFTxczK32ub/gEyfARNIh/fZMfSqUNkyerUV24MJdT3jSg03QbrG0VmaM2+7Trii7Zrmo/DLCnN5MYn6FVVsHPGOqmcuHm0BmtUP15dlVlk9IVODVN7oxnYQMjArcSMQa+jI/YcMZImbsAEL1Mri1j4dWo3jvqYxKPriKLddgVcjKRJzGEnFQ+MCBf0OPI50ZFRLvCb1x/l2Oz6S9e9rDt7UIzHPdZVbGhnN6tgg/ctriL/w2g1qSzds20S8MUyMXp66MAF28J76XQZWAeTip2ICKmjWSQnXIlVwcp7lcLqfDpqImtuyEHvfom4PM+hOfgOLl5wbfagRVsMJmffiH+/zFI8HtrpyvBwmvL2edVuRXCCae2GF+dYzBlQ2NUFCh1KSHMKl1Q86rHOlKaI/VfYvgr3pZKNUpqM0LSCc7VkumkXHqL4Wu645dSoazkqHe5dUxggi8HmigVi3XaixEjsBW7AR/R2/a8NBwQHcpLQBsLMV5wAAAAAAAAAAAA`;
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
		 * 不声明任何 inject：插件立即 apply 并画出 DOM。
		 * ctx.remote 每次取数时惰性查找，等它注册好即可。
		 */
		BADGE.inject = [];

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


		exports.apply = BADGE.apply;
		exports.inject = BADGE.inject;
		return module.exports;
	},
});
