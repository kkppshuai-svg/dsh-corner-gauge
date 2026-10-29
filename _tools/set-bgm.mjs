#!/usr/bin/env node
/**
 * 把任意音频/视频转成面板 BGM（本地覆盖，不进仓库）
 *
 *   node _tools/set-bgm.mjs <文件> [--start 12.5] [--dur 2.6] [--id bgm-verstappen]
 *
 * 输出到 assets/sounds-local/<id>.mp3，构建时自动优先使用。
 * 这个目录在 .gitignore 里——版权音乐只留在你本机，不会推到 GitHub。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FF = process.env.FFMPEG || 'ffmpeg';
const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'assets', 'sounds-local');

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

if (!file || !existsSync(file)) {
  console.error('用法：node _tools/set-bgm.mjs <音频或视频文件> [--start 秒] [--dur 秒] [--id id]');
  process.exit(1);
}

const id = arg('id', 'bgm-verstappen');
const dur = Number(arg('dur', 2.6));
const startArg = arg('start', null);

mkdirSync(OUT_DIR, { recursive: true });

/* 先读时长，没给 --start 就用开头 */
const probe = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' });
const probeText = (probe.stderr || '') + (probe.stdout || '');
const dm = probeText.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
const total = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 30;

const start = startArg !== null ? Number(startArg) : 0;

const out = join(OUT_DIR, `${id}.mp3`);
execFileSync(
  FF,
  [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(start), '-t', String(dur),
    '-i', file,
    '-af', `afade=t=in:st=0:d=0.04,afade=t=out:st=${(dur - 0.3).toFixed(2)}:d=0.3,loudnorm=I=-14:TP=-1.5:LRA=11`,
    '-ac', '2', '-ar', '32000', '-c:a', 'libmp3lame', '-b:a', '80k',
    out, '-y',
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

console.log(`✓ 已写入 assets/sounds-local/${id}.mp3（源时长 ${total.toFixed(1)}s，截取 ${start}s 起 ${dur}s）`);
console.log('  下一步：npm run build && 重启 App');
console.log('  这个文件不会进 git（.gitignore 已排除 assets/sounds-local/）');
