/**
 * 豆包（Volcengine Ark）用量采集
 * ------------------------------------------------------------------
 * 豆包目前没有像 Codex / Claude Code 那样的本地会话日志，官方用量要走
 * 火山引擎 OpenAPI（需要 AK/SK 签名）。所以这里做两级：
 *
 *   1. 如果设置了环境变量 ARK_ACCESS_KEY / ARK_SECRET_KEY，并且存在
 *      账号余额接口配置，就尝试拉取（默认关闭，需要你确认接口与权限）
 *   2. 否则读本地缓存文件 %USERPROFILE%\.doubao\usage.json（可自己写）
 *
 * usage.json 期望格式：
 *   { "value": 1234567, "unit": "tokens", "updatedAt": "2026-10-30T08:00:00Z" }
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CACHE = join(HOME, '.doubao', 'usage.json');

export async function collectDoubao() {
  if (!existsSync(CACHE)) {
    return {
      available: false,
      reason: '未配置豆包数据源：豆包没有本地会话日志，需要写 ~/.doubao/usage.json 或接火山引擎 API',
      value: 0,
      unit: 'tokens',
    };
  }

  try {
    const raw = JSON.parse(readFileSync(CACHE, 'utf8'));
    const value = Number(raw.value) || 0;
    return {
      available: true,
      value,
      unit: raw.unit || 'tokens',
      label: raw.label || '豆包用量',
      detail: {
        source: CACHE,
        updatedAt: raw.updatedAt || null,
      },
    };
  } catch (error) {
    return {
      available: false,
      reason: `读取 ${CACHE} 失败：${error.message}`,
      value: 0,
      unit: 'tokens',
    };
  }
}
