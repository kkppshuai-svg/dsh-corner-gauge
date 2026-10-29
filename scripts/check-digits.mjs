#!/usr/bin/env node
/**
 * 数字可读性防回归检查
 *
 * 历史问题：金额数字曾经用 background-clip:text + 渐变渲染。
 * 只要任一祖先元素带 filter / transform / opacity / 混合模式，
 * Chromium 就会把这种裁剪文字渲染成暗色甚至不可见——反复出现过三次。
 *
 * 现在的实现是 SVG <text> + <linearGradient>（由 SVG 光栅化器绘制，免疫）。
 * 这个脚本扫描构建产物，确保没有人把它改回去，也确保祖先链上不再出现
 * 「会让子元素进入独立合成层」的 CSS。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'lib', 'client.js');
const raw = readFileSync(BUNDLE, 'utf8');
/* 注释里提到这些关键字不算数，先剥掉块注释 */
const text = raw.replace(/\/\*[\s\S]*?\*\//g, '');

const problems = [];

/* 1. 不允许再用 background-clip: text */
if (/background-clip:\s*text/.test(text) || /-webkit-background-clip:\s*text/.test(text)) {
  problems.push('产物里又出现了 background-clip: text —— 祖先带 filter/transform 时会渲染成暗色，请改用 SVG 渐变');
}

/* 2. 数字必须是 SVG 渐变 */
if (!/g-val-svg/.test(text)) problems.push('找不到 .g-val-svg，数字渲染方式被改动了');
if (!/linearGradient/.test(text)) problems.push('缺少 SVG linearGradient');
if (!/g-num-main/.test(text)) problems.push('缺少渐变文字节点 .g-num-main');

/* 3. 面板根部（#id 规则）不允许 filter / transform */
const rootRule = text.match(/#\$\{id\} \{\s*([\s\S]*?)\n\}/);
if (!rootRule) {
  problems.push('找不到面板根部样式规则');
} else {
  const body = rootRule[1];
  const valueOf = (prop) => {
    const m = body.match(new RegExp(`${prop}:\\s*([^;]+);`));
    return m ? m[1].trim().toLowerCase() : null;
  };
  const f = valueOf('filter');
  if (f && f !== 'none') problems.push(`面板根部出现了 filter(${f}) —— 会让所有子元素进独立合成层`);
  const t = valueOf('transform');
  if (t && t !== 'none') problems.push(`面板根部出现了 transform(${t}) —— 同上`);
}

if (problems.length) {
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('数字可读性检查失败');
  process.exit(1);
}
console.log('  ✓ 数字走 SVG 渐变（未使用 background-clip:text）');
console.log('  ✓ 面板根部无 filter / transform（不破坏子元素合成）');
