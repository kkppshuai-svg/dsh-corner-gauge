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
  background: linear-gradient(90deg,
    var(--g-accent, #b00500),
    var(--g-accent-2, #c41200) 42%,
    transparent 92%);
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
  height: var(--logo-h, 34px); width: var(--logo-w, 74px);
  transform: translateY(-50%);
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.8));
  pointer-events: none;
}
/* 金属标：蒙版塑形 + 多段明暗渐变模拟镀铬（高光→本色→暗部→回光） */
#${id} .g-logo-text {
  display: none;
  width: 100%; height: 100%;
  align-items: center; justify-content: center;
  font: 700 17px/1 Rajdhani, system-ui, sans-serif;
  letter-spacing: .10em; padding-left: .10em;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.85));
}
#${id} .g-logo.g-metal {
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain;
  background-image: linear-gradient(158deg,
    #fff7e8 0%, #ffc46b 18%, #ff8a00 38%,
    #b35400 54%, #ffc079 70%, #ff8f1f 84%, #8f3d00 100%);
  filter:
    drop-shadow(0 1px 1px rgba(0,0,0,.85))
    drop-shadow(0 0 6px rgba(255,150,40,.35));
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

    const logo = document.createElement('div');
    logo.className = 'g-logo';

    /* 两个子层：普通标用 <img> 原图，单色标用金属蒙版层 */
    const logoImg = document.createElement('img');
    logoImg.className = 'g-logo-img';
    logoImg.alt = '';
    logoImg.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
    logo.appendChild(logoImg);

    const logoMetal = document.createElement('div');
    logoMetal.className = 'g-logo-metal';
    logo.appendChild(logoMetal);

    const logoText = document.createElement('span');
    logoText.className = 'g-logo-text';
    logo.appendChild(logoText);

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

/** 按品牌切标志与强调色：M4 → 宝马 M，迈凯伦 → speedmark */
BADGE.setBrand = function setBrand(brand) {
  const root = document.getElementById(BADGE.ROOT_ID);
  if (!root) return;
  const list = Object.keys(BADGE.BRANDS || {});
  const name = brand && BADGE.BRANDS && BADGE.BRANDS[brand] ? brand : list[0] || 'mclaren';
  root.dataset.brand = name;
  const logo = root.querySelector('.g-logo');
  const def = BADGE.BRANDS ? BADGE.BRANDS[name] : null;
  if (!logo || !def) return;

  /* 品牌色注入面板（顶部饰条、进度线都跟着变） */
  if (def.accent) root.style.setProperty('--g-accent', def.accent);
  if (def.accent2) root.style.setProperty('--g-accent-2', def.accent2);

  /* 每个品牌自己的标志尺寸：方形标要放大，横向标保持 74 宽，视觉上等重 */
  if (def.logoW) root.style.setProperty('--logo-w', `${def.logoW}px`);
  else root.style.removeProperty('--logo-w');
  if (def.logoH) root.style.setProperty('--logo-h', `${def.logoH}px`);
  else root.style.removeProperty('--logo-h');

  const img = logo.querySelector('.g-logo-img');
  const txt = logo.querySelector('.g-logo-text');
  if (!img || !txt) return;

  logo.classList.remove('g-metal');
  logo.style.maskImage = '';
  logo.style.webkitMaskImage = '';
  logo.style.backgroundImage = '';
  img.style.display = 'none';
  txt.style.display = 'none';

  if (def.text) {
    /* 文字标：车队缩写 */
    txt.textContent = def.text;
    txt.style.display = 'flex';
    txt.style.color = def.accent2 || def.accent || '#fff';
    return;
  }

  if (def.metal) {
    /* 单色标：图形当蒙版，填充品牌的金属渐变（迈凯伦橙 / 奔驰银） */
    logo.classList.add('g-metal');
    logo.style.maskImage = `url("${def.src}")`;
    logo.style.webkitMaskImage = `url("${def.src}")`;
    logo.style.backgroundImage = Array.isArray(def.metalGrad)
      ? `linear-gradient(158deg, ${def.metalGrad.join(', ')})`
      : '';
    return;
  }

  /* 多色标：原图直出 */
  img.style.display = 'block';
  if (img.getAttribute('src') !== def.src) img.src = def.src;
};

/** 取当前配置对应的 skin，找不到就退回 minimal。 */
BADGE.currentSkin = function currentSkin() {
  return BADGE.skins[BADGE.config.skin] || BADGE.skins.minimal;
};
