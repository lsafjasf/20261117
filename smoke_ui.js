/* app.js 冒烟测试: 用 DOM 桩在 Node 中执行界面层, 验证绑定/渲染/主循环无运行时错误 */
'use strict';
const fs = require('fs');

const gradStub = {};
const ctx2d = new Proxy(gradStub, {
  get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? function () {} : undefined)),
  set: (t, k, v) => { t[k] = v; return true; },
});

function makeEl(id) {
  return {
    id, children: [], value: '3', textContent: '', innerHTML: '', className: '',
    classList: { toggle() {}, add() {}, remove() {} },
    style: {},
    addEventListener(ev, fn) { (this._h = this._h || {})[ev] = fn; },
    appendChild(c) { this.children.push(c); },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); },
    getContext: () => ctx2d,
    click() {},
    scrollTop: 0, scrollHeight: 0,
  };
}

const els = {};
global.document = {
  getElementById: (id) => (els[id] = els[id] || makeEl(id)),
  createElement: (tag) => makeEl(tag),
};
global.window = global;
global.performance = { now: () => Date.now() };
let rafCount = 0;
global.requestAnimationFrame = (fn) => { if (rafCount++ < 5) setImmediate(() => fn(rafCount * 16)); };
global.URL.createObjectURL = () => 'blob:x';
global.URL.revokeObjectURL = () => {};
global.Blob = class {};

global.FillingSim = undefined;
const simMod = require('./sim.js');
Object.assign(global, simMod);

const src = fs.readFileSync('./app.js', 'utf8');
eval(src);

// 触发控件回调
els.pressure._h.input();
els.beverage.value = 'cola';
els.beverage._h.change({ target: els.beverage });
els.pauseBtn._h.click();
els.stepBtn._h.click();
els.resetBtn._h.click();
els.muteBtn._h.click();
els.exportBtn._h.click();
for (const btn of els.devices.children) btn._h.click();

setTimeout(() => {
  if (!els.status.innerHTML.includes('良品率')) throw new Error('status not rendered');
  if (!els.clock.textContent.includes('仿真时钟')) throw new Error('clock not rendered');
  console.log('UI smoke OK, frames:', rafCount, 'log lines:', els.log.children.length);
}, 100);
