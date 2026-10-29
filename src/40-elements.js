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
/*
 * 渲染方式：SVG <text> + <linearGradient> 填充。
 *
 * 为什么不用 background-clip:text：
 *   那个特性依赖「文字作为蒙版裁剪背景」的合成路径，只要任一祖先元素带
 *   filter / transform / opacity / 混合模式，Chromium 就会把它渲染成暗色
 *   甚至不可见。面板根部有投影 filter、.g-num 有 skew 变换，正好命中。
 *   SVG 的渐变填充由 SVG 光栅化器直接绘制，不受祖先合成影响。
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const AMOUNT_GRAD_ID = 'gGaugeAmountGrad';
const AMOUNT_STOPS = [
  ['0%', '#d97a5c'],
  ['18%', '#c05038'],
  ['40%', '#ad3218'],
  ['56%', '#c25a3c'],
  ['78%', '#a83018'],
  ['100%', '#8d1c0c'],
];

BADGE.elements.amount = {
  css(id) {
    return `
#${id} .g-val {
  position: relative; display: inline-block;
  font-style: normal;
  padding-right: 4px;
}
/* 用一份隐藏的文字占位，保证布局尺寸和字宽完全正确 */
#${id} .g-val-ghost {
  display: block; white-space: pre; visibility: hidden;
  font-family: 'GaugeRacingCondensed', ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif;
  font-weight: 700; font-size: 48px; line-height: .86; letter-spacing: -.2px;
}
/* SVG 覆盖在占位文字之上：渐变直接由 SVG 画出来 */
#${id} .g-val-svg {
  position: absolute; left: 0; top: 0;
  width: 100%; height: 100%;
  overflow: visible; pointer-events: none;
}
#${id} .g-val-svg text {
  font-family: 'GaugeRacingCondensed', ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif;
  font-weight: 700; font-size: 48px; letter-spacing: -.2px;
  text-anchor: end;
}
#${id} .g-val-svg .g-num-shadow { fill: rgba(0,0,0,.8); }
#${id} .g-val-svg .g-num-main { fill: url(#${AMOUNT_GRAD_ID}); }
#${id}.g-dim .g-val { opacity: .45; }`;
  },

  mount(parts) {
    const wrap = document.createElement('span');
    wrap.className = 'g-val';

    const ghost = document.createElement('span');
    ghost.className = 'g-val-ghost';
    ghost.textContent = '—';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'g-val-svg');

    const defs = document.createElementNS(SVG_NS, 'defs');
    const grad = document.createElementNS(SVG_NS, 'linearGradient');
    grad.setAttribute('id', AMOUNT_GRAD_ID);
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0');
    grad.setAttribute('y2', '1');
    for (const [offset, color] of AMOUNT_STOPS) {
      const stop = document.createElementNS(SVG_NS, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', color);
      grad.appendChild(stop);
    }
    defs.appendChild(grad);
    svg.appendChild(defs);

    const shadow = document.createElementNS(SVG_NS, 'text');
    shadow.setAttribute('class', 'g-num-shadow');
    const main = document.createElementNS(SVG_NS, 'text');
    main.setAttribute('class', 'g-num-main');
    svg.appendChild(shadow);
    svg.appendChild(main);

    wrap.appendChild(ghost);
    wrap.appendChild(svg);
    BADGE.numWrap(parts).appendChild(wrap);

    return { wrap, ghost, shadow, main };
  },

  update(ref, view) {
    const text =
      view.state === 'ready' ? BADGE.formatAmount(view.total)
        : view.state === 'loading' ? '···'
          : '--';

    ref.ghost.textContent = text;
    ref.shadow.textContent = text;
    ref.main.textContent = text;

    /* 基线位置按占位文字的实际高度推算，右对齐到容器右缘 */
    const place = () => {
      const h = ref.ghost.getBoundingClientRect().height || 41;
      const y = Math.round(h * 0.78);
      for (const t of [ref.shadow, ref.main]) t.setAttribute('x', '100%');
      ref.main.setAttribute('y', String(y));
      ref.shadow.setAttribute('y', String(y + 1.6));
    };
    place();
    requestAnimationFrame(place);
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
