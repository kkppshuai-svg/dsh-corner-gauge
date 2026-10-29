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
    logo.src = 'data:image/webp;base64,__LOGO_B64__';
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

/** 取当前配置对应的 skin，找不到就退回 minimal。 */
BADGE.currentSkin = function currentSkin() {
  return BADGE.skins[BADGE.config.skin] || BADGE.skins.minimal;
};
