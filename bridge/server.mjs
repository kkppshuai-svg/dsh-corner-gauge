#!/usr/bin/env node
/**
 * 用量桥接服务
 * ------------------------------------------------------------------
 * 面板装在 DSH 里，浏览器端读不到本机文件，所以由这个脚本在后台收集
 * 各个 AI 编程助手（Codex / Claude Code / 豆包）的本地用量，通过
 * 127.0.0.1 上的 HTTP 接口喂给面板。只监听回环地址，不出网。
 *
 *   node bridge/server.mjs [--port 7317] [--once]
 *
 * 接口：
 *   GET /usage?provider=codex&period=today
 *   GET /health
 */
import { createServer } from 'node:http';
import { collectCodex } from './collectors/codex.mjs';
import { collectClaude } from './collectors/claude.mjs';
import { collectDoubao } from './collectors/doubao.mjs';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PORT = Number(argOf('port', process.env.GAUGE_BRIDGE_PORT || 7317));
const ONCE = argv.includes('--once');

const PROVIDERS = {
  codex: collectCodex,
  claude: collectClaude,
  doubao: collectDoubao,
};

const PERIODS = ['today', 'week', 'month', 'all'];

function periodStart(period) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return d.getTime();
  if (period === 'week') return d.getTime() - 6 * 86400000;
  if (period === 'month') return d.getTime() - 29 * 86400000;
  return 0;
}

async function usage(providerId, period) {
  const collect = PROVIDERS[providerId];
  if (!collect) return { ok: false, error: `unknown provider: ${providerId}` };
  const since = periodStart(PERIODS.includes(period) ? period : 'today');
  try {
    const data = await collect(since);
    return { ok: true, provider: providerId, period, ...data };
  } catch (error) {
    return { ok: false, provider: providerId, error: String(error && error.message ? error.message : error) };
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  /* 面板是 file:// 或 app:// 页面，需要放开跨域 */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  try {
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, providers: Object.keys(PROVIDERS), periods: PERIODS }));
      return;
    }

    if (url.pathname === '/usage') {
      const provider = url.searchParams.get('provider') || 'codex';
      const period = url.searchParams.get('period') || 'today';
      const body = await usage(provider, period);
      res.writeHead(body.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }));
  }
});

if (ONCE) {
  const provider = argOf('provider', 'codex');
  const period = argOf('period', 'today');
  console.log(JSON.stringify(await usage(provider, period), null, 2));
  process.exit(0);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`用量桥接已启动：http://127.0.0.1:${PORT}`);
  console.log(`  示例：http://127.0.0.1:${PORT}/usage?provider=codex&period=today`);
  console.log('  Ctrl+C 结束');
});
