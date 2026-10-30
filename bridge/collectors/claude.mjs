/**
 * Claude Code 用量采集
 * ------------------------------------------------------------------
 * Claude Code 把每个会话写成 JSONL：
 *   ~/.claude/projects/<项目路径转义>/*.jsonl
 * 其中 assistant 消息带 message.usage：
 *   { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
 *
 * 与 Codex 一样按行流式读取，只统计时间戳晚于 since 的记录。
 */
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || join(process.env.USERPROFILE || process.env.HOME || '', '.claude');

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
      if (!line.includes('"usage"')) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      /* 只认 assistant 条目 */
      const msg = rec.message;
      if (!msg || !msg.usage) continue;
      const at = Date.parse(rec.timestamp || '');
      if (!Number.isFinite(at) || at < since) continue;

      const u = msg.usage;
      acc.input += Number(u.input_tokens) || 0;
      acc.output += Number(u.output_tokens) || 0;
      acc.cacheRead += Number(u.cache_read_input_tokens) || 0;
      acc.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
      acc.turns += 1;
      if (at > acc.lastAt) acc.lastAt = at;
    }
  } finally {
    rl.close();
    stream.close();
  }
}

export async function collectClaude(since) {
  const dir = join(CLAUDE_HOME, 'projects');
  if (!existsSync(dir)) {
    return {
      available: false,
      reason: `未找到 ${dir}（还没用过 Claude Code，或日志在别处）`,
      value: 0,
      unit: 'tokens',
    };
  }

  const files = listSessions(dir);
  const acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, lastAt: 0 };

  for (const f of files) {
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
      output: acc.output,
      cacheRead: acc.cacheRead,
      cacheWrite: acc.cacheWrite,
      turns: acc.turns,
      sessions: files.length,
      lastAt: acc.lastAt ? new Date(acc.lastAt).toISOString() : null,
    },
  };
}
