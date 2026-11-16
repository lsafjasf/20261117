/* DOM 冒烟测试：用最小桩对象验证 app.js 控制流（初始化/单步/重置/回放/报告）。 */
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'js', 'config.js'));
require(path.join(__dirname, '..', 'js', 'physics.js'));
require(path.join(__dirname, '..', 'js', 'render.js'));
require(path.join(__dirname, '..', 'js', 'chart.js'));

function makeEl() {
  return {
    innerHTML: '', textContent: '', className: '', value: '800',
    style: {}, disabled: false, checked: true,
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, addEventListener() {}, getContext: function () { return {
      canvas: { width: 960, height: 150 },
      clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
      stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, strokeRect() {},
      fillRect2() {}, save() {}, restore() {}, translate() {}, rotate() {},
      setLineDash() {}, closePath() {}
    }; },
    canvas: { width: 960, height: 150 }
  };
}
const ids = [
  'scene', 'trend', 'gauges', 'statusPill', 'liftPill', 'clockPill',
  'checksumPill', 'faultBanner', 'forceToggle', 'runBtn', 'pauseBtn',
  'stepBtn', 'resetBtn', 'replayBtn', 'brakeBtn', 'attachBtn', 'cwSelect',
  'eventLog', 'reportBtn', 'modal', 'modalTitle', 'modalBody', 'modalClose'
];
const elMap = {};
ids.forEach((id) => { elMap[id] = makeEl(); });
// 仪表动态元素
['tension', 'speed', 'temp', 'pressure'].forEach((k) => {
  elMap['gauge-' + k] = makeEl();
  elMap['val-' + k] = makeEl();
  elMap['fill-' + k] = makeEl();
});

global.document = {
  getElementById: (id) => elMap[id] || makeEl(),
  createElement: () => makeEl(),
  querySelectorAll: () => []
};
const listeners = {};
global.window = global;
global.window.addEventListener = (ev, fn) => { listeners[ev] = fn; };
global.requestAnimationFrame = () => 0;
global.setInterval = () => 0;

require(path.join(__dirname, '..', 'js', 'app.js'));

let fails = 0;
function assert(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; }

const app = global.window.CraneApp;
assert(app && typeof app.state === 'function', 'app.js 初始化并导出 CraneApp');
assert(app.state().status === 'idle', '初始状态 idle');

// 单步推进
const s0 = app.state().step;
app.singleStep();
assert(app.state().step === s0 + 1, '单步使步数 +1');

// 重置不漂移
const chkBefore = global.CranePhysics.checksum(global.CranePhysics.createInitialState());
app.resetAll();
assert(app.state().step === 0, '重置后步数归零');
assert(global.CranePhysics.checksum(app.state()) === chkBefore, '重置后 checksum 与初始一致');

// 跑一段后生成报告
const st = app.state();
st.requestAttach = true;
global.CranePhysics.stepOnce(st, {});
for (let i = 0; i < 100; i++) global.CranePhysics.stepOnce(st, { hoistUp: true });
const report = app.buildReport();
assert(report.indexOf('最终报告') >= 0, '报告含标题');
assert(report.indexOf('峰值') >= 0 && report.indexOf('校验和') >= 0, '报告记录峰值与校验和');

// 回放可用性
app.startReplay();
assert(app.mode() === 'replaying', '可进入回放模式');

console.log(fails === 0 ? '\nDOM 冒烟测试通过 ✔' : '\nDOM 冒烟测试失败 ✘');
process.exit(fails ? 1 : 0);
