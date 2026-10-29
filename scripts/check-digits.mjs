#!/usr/bin/env node
/**
 * 数字可读性防回归检查
 *
 * 背景：金额数字用 background-clip:text + 金属渐变渲染。
 * 一旦同一个元素上再出现 filter / text-shadow / -webkit-text-stroke，
 * Chromium 会把文字渲染成暗色（曾经反复踩坑）。
 *
 * 这个脚本扫描构建产物，确保：
 *   1. .g-val 规则里没有 filter / text-shadow / -webkit-text-stroke（只允许 none）
 *   2. 保留了 background-clip: text
 *   3. 有 @supports 兜底
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'lib', 'client.js');
const text = readFileSync(BUNDLE, 'utf8');

const problems = [];

/* 抽出 .g-val 的主体规则（不含 ::before 与 .g-dim） */
const ruleMatch = text.match(/#\$\{id\} \.g-val \{([\s\S]*?)\}/);
if (!ruleMatch) {
  problems.push('找不到 .g-val 规则');
} else {
  const body = ruleMatch[1];
  /* 取属性值再判断，避免 filter: none 被误报 */
  const valueOf = (prop) => {
    const m = body.match(new RegExp(`${prop}:\\s*([^;]+);`));
    return m ? m[1].trim().toLowerCase() : null;
  };

  const fv = valueOf('filter');
  if (fv && fv !== 'none') problems.push(`.g-val 上出现了 filter(${fv}) —— 会把渐变文字压暗`);

  const ts = valueOf('text-shadow');
  if (ts && ts !== 'none') problems.push(`.g-val 上出现了 text-shadow —— 会盖住透明文字`);

  const stroke = valueOf('-webkit-text-stroke');
  if (stroke && stroke !== 'none' && stroke !== '0') problems.push('.g-val 上出现了 text-stroke —— 会遮挡渐变');

  if (!/background-clip:\s*text/.test(body)) problems.push('.g-val 缺少 background-clip: text');
}

if (!/@supports not/.test(text)) problems.push('缺少 @supports 兜底');
if (!/data-v/.test(text)) problems.push('缺少 ::before 投影用的 data-v');

if (problems.length) {
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('数字可读性检查失败');
  process.exit(1);
}
console.log('  ✓ 数字渲染路径干净（无 filter / text-shadow / stroke）');
console.log('  ✓ 保留背景裁切 + 兜底');
