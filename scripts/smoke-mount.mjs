#!/usr/bin/env node
/**
 * 挂载冒烟测试
 * ------------------------------------------------------------------
 * 用一套极简 DOM 桩把 lib/client.js 真正跑一遍：apply → build → paint。
 * 目的是抓「改了某个变量导致运行时 ReferenceError、面板整个不渲染」这类问题
 * —— 只做语法检查是发现不了的（历史事故：删死代码时漏了一行 txt.style...）。
 *
 *   node scripts/smoke-mount.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8');

/* ---------------- 极简 DOM 桩 ---------------- */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...names) { names.forEach((n) => this.set.add(n)); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); }
  contains(n) { return this.set.has(n); }
  toggle(n, force) {
    const want = force === undefined ? !this.set.has(n) : Boolean(force);
    if (want) this.set.add(n); else this.set.delete(n);
    return want;
  }
}

class Style {
  constructor() { this.props = {}; this.cssText = ''; }
  setProperty(k, v) { this.props[k] = v; }
  removeProperty(k) { delete this.props[k]; }
}

class El {
  constructor(tag, ns) {
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = ns || null;
    this.children = [];
    this.parentNode = null;
    this.classList = new ClassList(this);
    this.style = new Style();
    this.dataset = {};
    this.attrs = {};
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
  }
  appendChild(child) {
    if (!child) throw new Error(`appendChild 收到 ${child}`);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...kids) { kids.forEach((k) => this.appendChild(k)); }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  addEventListener() { /* 事件不参与冒烟 */ }
  removeEventListener() {}
  getBoundingClientRect() { return { width: 322, height: 70, top: 0, left: 0, right: 322, bottom: 70 }; }
  set textContentValue(v) { this.textContent = v; }
  /* 只支持最常见的类/属性选择器，够插件用 */
  matches(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (sel.includes('[')) return false;
      return this.classList.contains(cls) || String(this.className).split(/\s+/).includes(cls);
    }
    if (sel.startsWith('[data-')) {
      const m = sel.match(/^\[data-([a-z-]+)=["']([^"']+)["']\]$/);
      if (m) return this.dataset[m[1]] === m[2];
    }
    if (sel.startsWith('[data-')) {
      const m = sel.match(/^\[data-([a-z-]+)\]$/);
      if (m) return this.dataset[m[1]] !== undefined;
    }
    if (sel === 'img') return this.tagName === 'IMG';
    return false;
  }
  walk(out = []) {
    out.push(this);
    for (const c of this.children) c.walk(out);
    return out;
  }
  querySelectorAll(sel) { return this.walk().filter((el) => el !== this && el.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

class Document {
  constructor() {
    this.body = new El('body');
    this.head = new El('head');
    this.documentElement = new El('html');
    this.visibilityState = 'visible';
  }
  createElement(tag) { return new El(tag); }
  createElementNS(ns, tag) { return new El(tag, ns); }
  getElementById(id) {
    for (const host of [this.body, this.head, this.documentElement]) {
      const hit = host.walk().find((el) => el.attrs.id === id || el.id === id);
      if (hit) return hit;
    }
    return null;
  }
  addEventListener() {}
  querySelector(sel) { return this.body.querySelector(sel); }
  querySelectorAll(sel) { return this.body.querySelectorAll(sel); }
}

const document = new Document();

const sandbox = {
  console,
  document,
  navigator: { language: 'zh-CN' },
  location: { search: '' },
  requestAnimationFrame: (fn) => { try { fn(0); } catch { /* 忽略动画帧里的异常 */ } return 1; },
  cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: {
    store: new Map(),
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); },
  },
  performance: { now: () => Date.now() },
  fetch: async () => { throw new Error('smoke 环境不联网'); },
  AbortController,
  URL,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  RegExp,
  Error,
  Promise,
  Float32Array,
  Uint8Array,
  Int32Array,
  isNaN,
  parseInt,
  parseFloat,
};
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.innerWidth = 1440;
sandbox.innerHeight = 900;
sandbox.devicePixelRatio = 1;
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

/* ---------------- 加载并挂载 ---------------- */
const modules = [];
sandbox.window.__ModuleLoader__ = {
  load: ({ factory }) => {
    modules.push(factory);
  },
};

runInNewContext(BUNDLE, sandbox, { filename: 'lib/client.js' });

if (!modules.length) {
  console.error('  ✗ 插件没有向 __ModuleLoader__ 注册模块');
  process.exit(1);
}

const ctx = {
  remote: {
    account: {
      async getBalance() {
        return { ok: true, value: { value: [{ currency: 'CNY', balance: '168.50' }], bonusWallets: [] } };
      },
    },
  },
  effect: (fn) => fn(),
  logger: console,
};

let failed = false;
for (const factory of modules) {
  const exported = factory({});
  try {
    if (exported && typeof exported.apply === 'function') await exported.apply(ctx);
    else if (typeof exported === 'function') await exported(ctx);
    else if (exported && typeof exported.default === 'function') await exported.default(ctx);
  } catch (error) {
    console.error(`  ✗ apply 抛异常：${error && error.message ? error.message : error}`);
    failed = true;
  }
}

/* 给异步取数一点时间（内部是 await，桩里同步 resolve） */
process.on('unhandledRejection', (e) => console.error('  ! 未处理的 Promise 拒绝：', e && e.message ? e.message : e));
await new Promise((r) => setTimeout(r, 250));

const root = document.getElementById('dsh-corner-gauge');
if (!root) {
  console.error('  ✗ 面板根节点没有挂到 document.body');
  failed = true;
} else if (root.children.length === 0) {
  console.error('  ✗ 面板根节点是空的（build 没跑或中途抛错）');
  failed = true;
}

const styleEl = document.getElementById('dsh-corner-gauge-style') || document.getElementById('dsh-corner-gauge-style');
if (!styleEl) {
  console.error('  ✗ 样式表没有注入');
  failed = true;
}

/* 断言真的把金额写进了面板：build 中途抛错时这里会是空的 */
if (!failed && root) {
  const texts = root.walk().map((el) => String(el.textContent || ''));
  if (process.env.DEBUG_TREE) {
    console.log('TREE:', JSON.stringify(texts.filter((t) => t)));
    console.log('DIAG:', sandbox.localStorage.getItem('dsh-gauge-diag'));
  }
  const hasAmount = texts.some((t) => t.includes('168.50'));
  if (!hasAmount) {
    console.error('  ✗ 面板里没有渲染出金额（build/paint 中途抛错？）');
    failed = true;
  } else {
    console.log('  ✓ 金额已渲染：168.50');
  }
}

if (failed) {
  console.error('挂载冒烟测试失败');
  process.exit(1);
}
console.log('  ✓ 模块注册成功');
console.log(`  ✓ 面板挂载成功（根节点 ${root.children.length} 个子节点）`);
console.log('  ✓ 样式表已注入');
console.log('  ✓ apply → build → paint 全程无异常');

/* 插件用 setInterval 轮询，会拖住进程，显式退出 */
process.exit(0);
