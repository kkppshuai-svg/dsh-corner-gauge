/**
 * 插件入口
 * ------------------------------------------------------------------
 * 不声明任何 inject：插件立即 apply 并画出 DOM。
 * ctx.remote 每次取数时惰性查找，等它注册好即可。
 */
BADGE.inject = [];

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
