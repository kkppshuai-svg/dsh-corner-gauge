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
  skin: 'mclaren',
  elements: ['currency', 'amount', 'progress'],
  position: { right: 22, bottom: 96 },
  size: { width: 322, height: 70 },
  currency: 'auto',
  pollMs: 60000,

  /**
   * 数据源：面板显示谁家的用量
   *   'dsh'     DSH 账户余额（默认，走 ctx.remote.account）
   *   'codex'   Codex 本地会话日志（需要先启动用量桥接 npm run bridge）
   *   'claude'  Claude Code 本地会话日志
   *   'doubao'  豆包（写 ~/.doubao/usage.json 或接火山引擎 API）
   */
  provider: 'dsh',
  /** 统计区间：today / week / month / all */
  period: 'today',
  /** 用量桥接端口（bridge/server.mjs 监听的本地端口） */
  bridgePort: 7317,
  /** 彩蛋：点击面板让 M 跑车开过一次（声浪可用右上角喇叭开关） */
  drive: {
    enabled: true,
    sound: true,
    durationMs: 1500,
    /** 跑车期间的附加特效（速度线、拖尾）。默认关：只留跑车更干净。 */
    fx: false,
    /**
     * 用素材库里的哪辆车：
     *   'auto'（默认）= 每次点击换下一辆，把整个车库轮着展示一遍
     *   或填车辆 id（见 assets/manifest.json，如 'm4-silver'）固定一辆
     */
    car: 'auto',
    /**
     * 声浪引擎：
     *   'auto'（默认）= 优先播素材库里的录音，没有录音则回退到 WebAudio 合成
     *   'sample'      = 只用录音
     *   'synth'       = 只用实时合成
     */
    engine: 'auto',
  },
};

/* 用户覆盖做一层浅合并：只写 drive.fx 之类不会把其他默认值冲掉 */
{
  const user = window.__DSH_BADGE_CONFIG__ || {};
  BADGE.config = Object.assign({}, BADGE.DEFAULTS, user, {
    drive: Object.assign({}, BADGE.DEFAULTS.drive, user.drive || {}),
    position: Object.assign({}, BADGE.DEFAULTS.position, user.position || {}),
    size: Object.assign({}, BADGE.DEFAULTS.size, user.size || {}),
  });
}

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
