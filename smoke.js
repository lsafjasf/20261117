// DOM 桩冒烟测试：在 Node 中执行 app.js 的初始化与多帧渲染
const fs = require('fs');

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (typeof t[k] !== 'undefined') return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeEl(tag) {
  const el = {
    tag, children: [], style: {}, dataset: {},
    _innerHTML: '', textContent: '', value: '20261117', className: '',
    classList: { add() {}, toggle() {}, remove() {} },
    width: 720, height: 460,
    getContext: () => makeCtx(),
    appendChild(c) { el.children.push(c); return c; },
    querySelector: () => makeEl('stub'),
    addEventListener() {},
    insertRow: () => makeEl('tr'),
    deleteRow() {}, rows: [],
    scrollTop: 0, scrollHeight: 0,
    onclick: null, onchange: null, oninput: null,
    get innerHTML() { return el._innerHTML; },
    set innerHTML(v) { el._innerHTML = v; },
    get firstElementChild() { return makeEl('i'); },
  };
  return el;
}

const els = {};
global.document = {
  getElementById: (id) => (els[id] = els[id] || makeEl('div')),
  createElement: (t) => makeEl(t),
};
let frames = 0;
global.requestAnimationFrame = (cb) => {
  if (frames++ < 120) setImmediate(() => cb(frames * 16.7));
};
global.window = global;
window.SimCore = require('./sim.js');

eval(fs.readFileSync('./app.js', 'utf8'));

setTimeout(() => {
  console.log(`smoke OK: ${frames} 帧渲染无异常`);
  console.log('clock =', els.clock.textContent, '| goal =', els.goal.textContent);
  process.exit(0);
}, 500);
