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
 * 取数失败时怎么处理：之前成功取到过值就保留旧值并返回 'stale'
 * （面板照常显示、不变暗）；从来没成功过才重置为 0 并返回原状态。
 */
BADGE.keepOrReset = function keepOrReset(fallbackState) {
  const view = BADGE.view;
  if (view.hadValue) return 'stale';
  view.total = 0;
  return fallbackState;
};

/** 紧凑数字：1234 → 1.2K，12600000 → 12.6M（用于 token 用量）。 */
BADGE.formatCompact = function formatCompact(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs < 1000) return String(Math.round(v));
  if (abs < 1e6) return `${(v / 1e3).toFixed(abs < 1e4 ? 2 : 1)}K`;
  if (abs < 1e9) return `${(v / 1e6).toFixed(abs < 1e7 ? 2 : 1)}M`;
  return `${(v / 1e9).toFixed(2)}B`;
};

/**
 * 从本地用量桥接取一个指标（Codex / Claude Code / 豆包）。
 * 桥接没启动时返回 unavailable —— 面板照常显示，只是数字变成 --。
 */
BADGE.fetchBridgeUsage = async function fetchBridgeUsage(provider, period, port) {
  const url = `http://127.0.0.1:${port}/usage?provider=${encodeURIComponent(provider)}&period=${encodeURIComponent(period)}`;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
  try {
    const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
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
 * 取一次数据并更新 view。
 * provider 为 dsh 时走 DSH 账户余额，其余走本地用量桥接。
 * @returns {'ready'|'guest'|'error'}
 */
BADGE.fetchBalance = async function fetchBalance(ctx) {
  const view = BADGE.view;
  const provider = BADGE.config.provider || 'dsh';

  /* ---------- 非 DSH：本地用量桥接 ---------- */
  if (provider !== 'dsh') {
    /* 桥接返回 CNY 时按金额显示，其余按用量紧凑显示 */
    view.currency = '';
    view.compact = false;
    try {
      const port = BADGE.config.bridgePort || 7317;
      const period = BADGE.config.period || 'today';
      const data = await BADGE.fetchBridgeUsage(provider, period, port);

      if (!data || data.ok !== true) {
        BADGE.report('bridge-error', (data && data.error) || 'no-ok');
        return BADGE.keepOrReset('error');
      }
      if (data.available === false) {
        BADGE.report('unavailable', data.reason || provider);
        view.reason = data.reason || '';
        return BADGE.keepOrReset('guest');
      }

      view.total = Number(data.value) || 0;
      if (view.total > 0) view.hadValue = true;
      view.unit = data.unit || 'tokens';
      const isMoney = view.unit === 'CNY' || view.unit === 'USD';
      view.compact = !isMoney;
      view.currency = isMoney ? view.unit : '';
      view.provider = provider;
      view.period = period;
      view.scaleMax = BADGE.pickScale(view.total);
      BADGE.report('ready', `${provider} ${view.total} ${view.unit}`);
      return view.total > 0 ? 'ready' : 'guest';
    } catch (error) {
      view.total = 0;
      BADGE.report('bridge-down', `${provider}: ${error && error.message ? error.message : error}`);
      return 'error';
    }
  }

  /* ---------- DSH 账户余额 ---------- */
  view.compact = false;
  view.unit = '';
  try {
    const account = ctx && ctx.remote && ctx.remote.account;
    if (!account || typeof account.getBalance !== 'function') {
      BADGE.report('no-account', ctx && ctx.remote ? Object.keys(ctx.remote).join(',') : 'remote=undefined');
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
    view.hadValue = true;
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
