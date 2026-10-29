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
