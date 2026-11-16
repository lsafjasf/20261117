// 浏览器环境冒烟测试：用最小 DOM/Canvas 桩加载全部脚本，确保 main.js 接线无异常
const noop = () => {};
function ctxStub() {
  return {
    canvas: { width: 0, height: 0 }, setTransform: noop, clearRect: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, stroke: noop,
    fill: noop, arc: noop, fillRect: noop, fillText: noop, save: noop,
    restore: noop, translate: noop, rotate: noop, roundRect: noop,
    setLineDash: noop, strokeStyle: '', fillStyle: '', lineWidth: 0, font: ''
  };
}
function makeCanvas() {
  return {
    getContext: () => ctxStub(),
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
    style: {}, width: 0, height: 0, addEventListener: noop,
    dispatchEvent: noop, value: 0
  };
}
function makeEl(id) {
  return {
    id, textContent: '', innerHTML: '', className: '', value: 0, style: {},
    classList: { add: noop, remove: noop }, appendChild: noop,
    addEventListener: noop, querySelector: () => makeEl('q'),
    querySelectorAll: () => [], dispatchEvent: noop,
    getBoundingClientRect: () => ({ width: 300, height: 180 }), max: 0,
    getContext: () => ctxStub(), width: 0, height: 0
  };
}
const els = {};
global.document = {
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  createElement: () => makeEl('x')
};
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = noop;
global.window = global;
global.window.addEventListener = noop;
global.Event = class { constructor(t) { this.type = t; } };
function node() {
  return {
    type: '', frequency: { value: 0, setTargetAtTime: noop },
    gain: { value: 0, setTargetAtTime: noop },
    start: noop, connect: () => this, resume: noop
  };
}
global.AudioContext = class {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  createOscillator() { return node(); }
  createGain() { return node(); }
  resume() {}
};

const fs = require('fs');
['config', 'track', 'physics', 'simulator', 'renderer', 'charts', 'audio', 'main']
  .forEach(f => eval(fs.readFileSync(__dirname + '/../js/' + f + '.js', 'utf8')));

const app = global.__app;
if (!app || !app.sim) throw new Error('应用未正确初始化');
console.log('main.js 初始化成功，模式:', app.sim.mode,
  '初始回放帧:', app.sim.replay.length);
console.log('初始间隙 mm:', (app.sim.state.gap * 1000).toFixed(2),
  '初始位置 s:', app.sim.state.s);
console.log('冒烟测试通过 ✓');
