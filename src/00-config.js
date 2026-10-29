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
