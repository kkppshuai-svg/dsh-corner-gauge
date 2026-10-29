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
/* 数字完全不用 filter / text-shadow：
 * Chromium 在「background-clip:text + filter」组合下会把渐变文字渲染成暗色，
 * 阴影改由 ::before 复制一层暗色文字实现（偏移 1.5px，落在背后）。 */
#${id} .g-val {
  position: relative; display: inline-block;
  font-family: 'GaugeRacingCondensed', ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif;
  font-style: normal; font-weight: 700;
  font-size: 48px; line-height: .86;
  letter-spacing: -.2px;
  padding-right: 4px;
  background: linear-gradient(180deg,
    #d97a5c 0%, #c05038 18%, #ad3218 40%,
    #c25a3c 56%, #a83018 78%, #8d1c0c 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: #c20800;
  -webkit-text-fill-color: transparent;
  text-shadow: none;
  filter: none;
}
#${id} .g-val::before {
  content: attr(data-v);
  position: absolute; left: 0; top: 1.5px;
  z-index: -1; pointer-events: none;
  background: none;
  color: rgba(0,0,0,.8);
  -webkit-text-fill-color: rgba(0,0,0,.8);
  text-shadow: none;
}
/* 兜底：万一环境不支持 background-clip:text，退回实色，绝不显示成暗块 */
@supports not ((-webkit-background-clip: text) or (background-clip: text)) {
  #${id} .g-val {
    background: none;
    color: #d0432a;
    -webkit-text-fill-color: #d0432a;
  }
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
    const text =
      view.state === 'ready' ? BADGE.formatAmount(view.total)
        : view.state === 'loading' ? '···'
          : '--';
    el.textContent = text;
    /* ::before 用它复制一份做投影 */
    el.dataset.v = text;
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
