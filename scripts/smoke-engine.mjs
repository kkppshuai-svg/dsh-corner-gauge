/**
 * 声浪合成器冒烟测试（不依赖浏览器）
 * ------------------------------------------------------------------
 * 用桩 DOM + 桩 AudioContext 加载产物，模拟一次点击，
 * 断言合成器确实创建了振荡器、滤波器、声像节点。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BUNDLE = 'C:/Users/22491/Desktop/建模/dsh-corner-gauge/lib/client.js';
const src = readFileSync(BUNDLE, 'utf8');

/* ---------- 桩 AudioContext ---------- */
const calls = { osc: 0, gain: 0, filter: 0, buffer: 0, panner: 0, start: 0 };
function param() {
  return {
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, setValueCurveAtTime() {},
  };
}
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = { connect() {} }; }
  resume() {}
  createGain() { calls.gain++; return { gain: param(), connect() {} }; }
  createBiquadFilter() { calls.filter++; return { type: '', Q: param(), frequency: param(), connect() {} }; }
  createStereoPanner() { calls.panner++; return { pan: param(), connect() {} }; }
  createOscillator() { calls.osc++; return { type: '', frequency: param(), connect() {}, start() { calls.start++; }, stop() {} }; }
  createBufferSource() { return { buffer: null, loop: false, connect() {}, start() { calls.start++; }, stop() {} }; }
  createBuffer() { calls.buffer++; return { getChannelData: () => new Float32Array(1024) }; }
}

/* ---------- 桩 DOM ---------- */
function makeEl(tag) {
  const el = {
    tagName: tag, children: [], style: { setProperty() {} }, dataset: {},
    offsetWidth: 322, offsetHeight: 70, textContent: '', className: '', src: '', alt: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : on; v ? this._s.add(c) : this._s.delete(c); },
    },
    listeners: {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { el.children.push(c); return c; },
    addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); },
    removeEventListener() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 322, height: 70 }; },
    getContext() { return null; },
    fire(type, ev) { (el.listeners[type] || []).forEach((f) => f(ev)); },
  };
  return el;
}

const root = makeEl('div');
root.id = 'dsh-corner-gauge';
const head = makeEl('head');
const body = makeEl('body');

const registry = new Map();
const origAppend = body.appendChild.bind(body);
body.appendChild = (el) => {
  if (el && el.id) registry.set(el.id, el);
  return origAppend(el);
};

const document = {
  body, head, documentElement: body, readyState: 'complete',
  getElementById: (id) => registry.get(id) || null,
  createElement: (tag) => makeEl(tag),
  createElementNS: (ns, tag) => makeEl(tag),
  querySelector: (sel) => (sel.includes('g-sound') ? null : null),
  addEventListener() {},
};

const sandbox = {
  window: {}, document,
  navigator: { language: 'zh-CN' },
  localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = v; } },
  AudioContext: FakeAudioContext,
  setInterval: () => 1, clearInterval() {}, setTimeout: (f) => { f(); return 1; }, clearTimeout() {},
  requestAnimationFrame: (f) => f(),
  console, Date, Math, JSON, Float32Array, Promise,
};
sandbox.window = sandbox;
sandbox.window.AudioContext = FakeAudioContext;
/* 强制走合成路径，好断言合成器的节点创建 */
sandbox.window.__DSH_BADGE_CONFIG__ = { drive: { engine: 'synth' } };

let def = null;
sandbox.window.__ModuleLoader__ = { load: (d) => { def = d; } };
vm.createContext(sandbox);

let failed = false;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failed = true; console.error(`  ✗ ${m}`); };

try {
  vm.runInContext(src, sandbox, { filename: 'client.js' });
  const mod = def.factory(() => { throw new Error('no require'); });
  ok('产物注册成功');

  mod.apply({
    remote: { account: { getBalance: async () => ({ ok: true, value: null }) } },
    effect() {},
  });
  ok('apply 执行无异常');

  const mounted = registry.get('dsh-corner-gauge');
  if (!mounted) throw new Error('面板没有挂到 body 上');
  ok('面板已挂载');

  /* 模拟一次点击（down → up，位移 0） */
  mounted.fire('pointerdown', { button: 0, clientX: 100, clientY: 100, pointerId: 1, preventDefault() {} });
  mounted.fire('pointerup', { clientX: 100, clientY: 100, pointerId: 1 });

  if (calls.osc >= 5) ok(`创建了 ${calls.osc} 个振荡器（谐波堆叠）`);
  else bad(`振荡器数量异常：${calls.osc}`);

  if (calls.filter >= 2) ok(`创建了 ${calls.filter} 个滤波器（低通 + 噪声带通 + 回火）`);
  else bad(`滤波器数量异常：${calls.filter}`);

  if (calls.panner >= 1) ok('创建了声像节点（左右掠过）');
  else bad('缺少声像节点');

  if (calls.start >= 5) ok(`调度了 ${calls.start} 个音源开始播放`);
  else bad(`音源调度数量异常：${calls.start}`);

  if (calls.buffer >= 1) ok('生成了噪声 buffer');
  else bad('没有生成噪声 buffer');
} catch (error) {
  bad(`运行抛错：${error && error.message}`);
  if (error && error.stack) console.error(String(error.stack).split('\n').slice(0, 6).join('\n'));
}

if (failed) {
  console.error('\n冒烟测试失败');
  process.exit(1);
}
console.log('\n冒烟测试通过');
