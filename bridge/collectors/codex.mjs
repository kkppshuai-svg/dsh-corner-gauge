/**
 * Codex 用量采集
 * ------------------------------------------------------------------
 * Codex CLI / 桌面端把每个会话写成 JSONL：
 *   ~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl
 * 其中 type === "token_usage_record" 的行带 payload.usage：
 *   { input_tokens, cached_input_tokens, output_tokens, ... }
 *
 * 我们按行流式读取（单文件可能上百 MB），只累加时间戳晚于 since 的记录。
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const CODEX_HOME = process.env.CODEX_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.codex');

/** 递归收集 sessions 下的 jsonl 文件 */
function listSessions(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) listSessions(p, out);
    else if (name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

async function scanFile(file, since, acc) {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      /* 先用便宜的字符串判断过滤掉绝大多数行 */
      if (!line.includes('token_usage_record')) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.type !== 'token_usage_record') continue;
      const at = Date.parse(rec.timestamp || '');
      if (!Number.isFinite(at) || at < since) continue;
      const u = rec.payload && rec.payload.usage;
      if (!u) continue;

      acc.input += Number(u.input_tokens) || 0;
      acc.cached += Number(u.cached_input_tokens) || 0;
      acc.output += Number(u.output_tokens) || 0;
      acc.reasoning += Number(u.reasoning_output_tokens) || 0;
      acc.turns += 1;
      if (at > acc.lastAt) acc.lastAt = at;
    }
  } finally {
    rl.close();
    stream.close();
  }
}

export async function collectCodex(since) {
  const dir = join(CODEX_HOME, 'sessions');
  if (!existsSync(dir)) {
    return { available: false, reason: `未找到 ${dir}`, value: 0, unit: 'tokens' };
  }

  const files = listSessions(dir);
  const acc = { input: 0, cached: 0, output: 0, reasoning: 0, turns: 0, lastAt: 0 };

  for (const f of files) {
    /* 先看文件修改时间，太老的直接跳过（快） */
    try {
      if (statSync(f).mtimeMs < since - 86400000) continue;
    } catch {
      continue;
    }
    await scanFile(f, since, acc);
  }

  const total = acc.input + acc.output;
  return {
    available: true,
    value: total,
    unit: 'tokens',
    label: 'Token 用量',
    detail: {
      input: acc.input,
      cached: acc.cached,
      output: acc.output,
      reasoning: acc.reasoning,
      turns: acc.turns,
      sessions: files.length,
      lastAt: acc.lastAt ? new Date(acc.lastAt).toISOString() : null,
    },
  };
}
