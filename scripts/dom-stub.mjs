/**
 * 极简 DOM 桩（供冒烟测试与分发包验证共用）
 * ------------------------------------------------------------------
 * 只实现插件实际用到的那一部分 DOM API：元素创建、class/style/dataset、
 * 子节点遍历、简单的类选择器查询、localStorage、window 事件占位等。
 */

class ClassList {
  constructor() { this.set = new Set(); }
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
    this.classList = new ClassList();
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
  append(...kids) { kids.forEach((k) => k && this.appendChild(k)); }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() { return { width: 322, height: 70, top: 0, left: 0, right: 322, bottom: 70 }; }
  matches(sel) {
    if (sel.startsWith('.')) {
      if (sel.includes('[')) return false;
      const cls = sel.slice(1);
      return this.classList.contains(cls) || String(this.className).split(/\s+/).includes(cls);
    }
    if (sel.startsWith('[data-')) {
      const eq = sel.match(/^\[data-([a-z-]+)=["']([^"']+)["']\]$/);
      if (eq) return this.dataset[eq[1]] === eq[2];
      const bare = sel.match(/^\[data-([a-z-]+)\]$/);
      if (bare) return this.dataset[bare[1]] !== undefined;
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

/**
 * 造一个沙箱：DOM 桩 + 插件需要的全局对象。
 * @param {object} [options]
 * @param {string} [options.locale] navigator.language
 */
export function createDomSandbox(options = {}) {
  const sandbox = {
    console,
    document: new Document(),
    navigator: { language: options.locale || 'zh-CN' },
    location: { search: '' },
    requestAnimationFrame: (fn) => {
      try { fn(0); } catch { /* 动画帧内的异常不影响结论 */ }
      return 1;
    },
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: {
      store: new Map(),
      getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
      setItem(k, v) { this.store.set(k, String(v)); },
      removeItem(k) { this.store.delete(k); },
    },
    performance: { now: () => Date.now() },
    fetch: async () => { throw new Error('冒烟环境不联网'); },
    AbortController,
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    modules: [],
  };
  sandbox.__ModuleLoader__ = { load: ({ factory }) => sandbox.modules.push(factory) };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

/** 把面板渲染出来的所有文本节点收集起来，便于断言。 */
export function collectTexts(root) {
  return root ? root.walk().map((el) => String(el.textContent || '')) : [];
}
