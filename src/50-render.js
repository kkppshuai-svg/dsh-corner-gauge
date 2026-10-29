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
  src: url(data:font/woff2;base64,__FONT_B64__) format('woff2');
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
