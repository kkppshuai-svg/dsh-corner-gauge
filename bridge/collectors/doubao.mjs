/**
 * 豆包 / 火山引擎用量采集
 * ------------------------------------------------------------------
 * 豆包客户端本身不落本地用量日志（只有一个 public_config.json），
 * 所以按三级回退取数：
 *
 *   1. 火山引擎 OpenAPI：设置 VOLC_ACCESSKEY / VOLC_SECRETKEY 后，
 *      调用费用中心的 QueryBalanceAcct 拿账户可用余额（¥）
 *   2. 环境变量 DOUBAO_USAGE_URL：任意 HTTP 接口，返回
 *      { "value": 123, "unit": "tokens" | "CNY", "label": "..." }
 *   3. 约定文件 ~/.doubao/usage.json（同上格式，自己写或用脚本产出）
 *
 * 全部未配置时返回 available:false 并说明怎么配。
 */
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CACHE = join(HOME, '.doubao', 'usage.json');

/* ---------------- 火山引擎签名（HMAC-SHA256） ---------------- */
const SERVICE = 'billing';
const HOST = 'billing.volcengineapi.com';
const REGION = process.env.VOLC_REGION || 'cn-beijing';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s, 'utf8').digest();

function signRequest(ak, sk, action, version, body) {
  const now = new Date();
  const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const shortDate = xDate.slice(0, 8);
  const query = `Action=${action}&Version=${version}`;
  const payloadHash = sha256(body);

  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalHeaders =
    'content-type:application/json\n' +
    `host:${HOST}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `x-date:${xDate}\n`;

  const canonicalRequest = ['POST', '/', query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256(canonicalRequest)].join('\n');

  const kDate = hmac(sk, shortDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return {
    url: `https://${HOST}/?${query}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: `HMAC-SHA256 Credential=${ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** 调费用中心查余额 */
async function fetchBillingBalance(ak, sk) {
  const { url, headers } = signRequest(ak, sk, 'QueryBalanceAcct', '2022-01-01', '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { method: 'POST', headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    const json = JSON.parse(text);
    const result = json.Result || json.result || {};
    const value = Number(result.AvailableBalance ?? result.available_balance);
    if (!Number.isFinite(value)) throw new Error(`返回里没有余额字段：${text.slice(0, 160)}`);
    return value;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 采集入口 ---------------- */
const unavailable = (reason) => ({ available: false, reason, value: 0, unit: 'tokens' });

export async function collectDoubao() {
  const ak = process.env.VOLC_ACCESSKEY || process.env.VOLC_AK;
  const sk = process.env.VOLC_SECRETKEY || process.env.VOLC_SK;

  /* ① 火山引擎官方 API */
  if (ak && sk) {
    try {
      const value = await fetchBillingBalance(ak, sk);
      return {
        available: true,
        value,
        unit: 'CNY',
        label: '火山引擎余额',
        detail: { source: 'volcengine:billing.QueryBalanceAcct', region: REGION },
      };
    } catch (error) {
      return unavailable(`火山引擎接口调用失败：${error.message}（检查 AK/SK 与权限）`);
    }
  }

  /* ② 自建 HTTP 接口 */
  const url = process.env.DOUBAO_USAGE_URL;
  if (url) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return {
        available: true,
        value: Number(json.value) || 0,
        unit: json.unit || 'tokens',
        label: json.label || '豆包用量',
        detail: { source: url, updatedAt: json.updatedAt || null },
      };
    } catch (error) {
      return unavailable(`DOUBAO_USAGE_URL 拉取失败：${error.message}`);
    }
  }

  /* ③ 约定文件 */
  if (existsSync(CACHE)) {
    try {
      const raw = JSON.parse(readFileSync(CACHE, 'utf8'));
      return {
        available: true,
        value: Number(raw.value) || 0,
        unit: raw.unit || 'tokens',
        label: raw.label || '豆包用量',
        detail: { source: CACHE, updatedAt: raw.updatedAt || null },
      };
    } catch (error) {
      return unavailable(`读取 ${CACHE} 失败：${error.message}`);
    }
  }

  return unavailable(
    '豆包没有本地用量日志。三种接法任选其一：' +
      '① 设 VOLC_ACCESSKEY / VOLC_SECRETKEY（火山引擎费用中心余额）；' +
      '② 设 DOUBAO_USAGE_URL 指向任意返回 {value,unit} 的接口；' +
      `③ 写 ${CACHE}`,
  );
}
