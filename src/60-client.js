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
