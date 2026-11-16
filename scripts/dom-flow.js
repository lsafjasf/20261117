// 完整用户流程冒烟：运行、故障停机、报告、回放帧、重置恢复
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
function makeEl(id) {
  const listeners = {};
  const classes = new Set();
  return {
    id, textContent: '', innerHTML: '', className: '', value: 0, style: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    appendChild(c) { (this.children = this.children || []).push(c); },
    addEventListener(ev, fn) { listeners[ev] = fn; },
    dispatchEvent(ev) { if (listeners[ev.type]) listeners[ev.type](); },
    querySelector: () => makeEl('q'),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 300, height: 180 }),
    max: 0, getContext: () => ctxStub(), width: 0, height: 0,
    _listeners: listeners
  };
}
const els = {};
global.document = {
  getElementById: (id) => els[id] || (els[id] = makeEl(id)),
  createElement: () => makeEl('x')
};
let rafCb = null;
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = (cb) => { rafCb = cb; };
global.window = global;
global.window.addEventListener = noop;
global.Event = class { constructor(t) { this.type = t; } };
function anode() {
  return {
    type: '', frequency: { value: 0, setTargetAtTime: noop },
    gain: { value: 0, setTargetAtTime: noop },
    start: noop, connect: () => this, resume: noop
  };
}
global.AudioContext = class {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  createOscillator() { return anode(); }
  createGain() { return anode(); }
  resume() {}
};
global.alert = (msg) => { global.__lastAlert = msg; };

const fs = require('fs');
['config', 'track', 'physics', 'simulator', 'renderer', 'charts', 'audio', 'main']
  .forEach(f => eval(fs.readFileSync(__dirname + '/../js/' + f + '.js', 'utf8')));

function click(id) { els[id]._listeners.click(); }
let pass = 0, fail = 0;
function assert(c, n) { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n)); }

const app = global.__app;
function setSlider(id, val) {
  els[id].value = val;
  els[id].dispatchEvent({ type: 'input' });
}
// 模拟 HTML 中滑块的初始 value
setSlider('in-current', 40);
setSlider('in-damping', 2500);
setSlider('in-v0', 10);
setSlider('in-load', 80);

// 1. 故障工况：高电流
setSlider('in-current', 60);
setSlider('in-damping', 2500);
click('btnRun');
assert(app.sim.mode === 'running' || app.sim.mode === 'fault', '运行启动');
let frames = 0;
let t0 = Date.now();
while (app.sim.mode !== 'fault' && frames < 100000) {
  rafCb(t0 + frames * 16);
  frames++;
}
assert(app.sim.mode === 'fault', '高电流最终故障停机 (帧数 ' + frames + ')');
assert(!!app.sim.state.fault, '故障对象已记录');
assert(els['report'].textContent.includes('首次故障'), '报告包含故障位置与峰值');
assert(!els['faultOverlay'].classList.contains('hidden'), '失败弹层显示首次越限部件/时间');

// 2. 回放
const frameCount = app.sim.replay.length;
click('btnReplay');
assert(frameCount >= 2, '回放已录制 ' + frameCount + ' 帧');

// 3. 重置恢复
click('btnReset');
assert(app.sim.mode === 'idle', '重置回到就绪态');
assert(app.sim.state.s === 0 && app.sim.state.gap === window.CONFIG.car.gap0,
  '重置后初始位置与间隙恢复');
assert(app.sim.replay.length === 1, '重置后回放缓存清空');

// 4. 成功工况
setSlider('in-current', 40);
setSlider('in-damping', 2500);
click('btnRun');
frames = 0; t0 = Date.now();
while (app.sim.mode !== 'win' && app.sim.mode !== 'fault' && frames < 600000) {
  rafCb(t0 + frames * 16); frames++;
}
assert(app.sim.mode === 'win', '基准工况三圈成功 (帧 ' + frames + ')');

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
