/* ui.js 冒烟测试:用最小 DOM 桩跑若干帧与场景按钮 */
var fs = require('fs');

function makeCtx() {
  return new Proxy({}, {
    get: function (t, k) {
      if (k === 'canvas') return {};
      return function () { return {}; };
    },
    set: function () { return true; }
  });
}

function makeEl(tag) {
  var el = {
    tag: tag, children: [], textContent: '', value: '50', disabled: false,
    dataset: {}, style: {},
    classList: { toggle: function () {}, add: function () {}, remove: function () {} },
    appendChild: function (c) { el.children.push(c); },
    removeChild: function (c) { el.children.shift(); },
    querySelector: function () { return makeEl('div'); },
    querySelectorAll: function () { return []; },
    getContext: function () { return makeCtx(); },
    click: function () { if (el.onclick) el.onclick(); },
    scrollTop: 0, scrollHeight: 0,
    set className(v) {}, get className() { return ''; }
  };
  Object.defineProperty(el, 'firstChild', { get: function () { return el.children[0]; } });
  Object.defineProperty(el, 'innerHTML', { set: function (v) { el._html = v; }, get: function () { return el._html || ''; } });
  return el;
}

var ids = ['cv', 'clock', 'simState', 'log', 'specBtns', 'specInfo',
  'dev-vib', 'dev-gate', 'dev-conv', 'btnPause', 'btnStep', 'btnReset',
  'btnSound', 'btnClearFault', 'btnAllScn', 'btnExport', 'report', 'faultInfo'];
var els = {};
ids.forEach(function (id) { els[id] = makeEl('div'); });

var scnBtns = ['normal', 'overlimit', 'shutdown'].map(function (n) {
  var b = makeEl('button'); b.dataset = { scn: n }; return b;
});

var rafQueue = [];
global.window = global;
global.document = {
  getElementById: function (id) { return els[id] || makeEl('div'); },
  createElement: function (t) { return makeEl(t); },
  querySelectorAll: function (sel) { return sel === '[data-scn]' ? scnBtns : []; }
};
global.performance = { now: function () { return Date.now(); } };
global.requestAnimationFrame = function (cb) { rafQueue.push(cb); };
global.Blob = function () {};
global.URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} };

eval(fs.readFileSync(__dirname + '/sim.js', 'utf8'));
eval(fs.readFileSync(__dirname + '/ui.js', 'utf8'));

// 跑 120 帧
var t = 0;
for (var i = 0; i < 120; i++) {
  var q = rafQueue; rafQueue = [];
  t += 16.7;
  q.forEach(function (cb) { cb(t); });
}

// 交互:启动设备、暂停、单步、重置、场景、导出
els['btnPause'].click();
els['btnStep'].click();
els['btnReset'].click();
els['btnAllScn'].click();
els['btnExport'].click();
scnBtns[0].click();
for (var j = 0; j < 60; j++) {
  var q2 = rafQueue; rafQueue = [];
  t += 16.7;
  q2.forEach(function (cb) { cb(t); });
}

if (!els['report']._html || els['report']._html.indexOf('正常生产') < 0) {
  console.log('FAIL 报告未渲染');
  process.exit(1);
}
console.log('PASS ui.js 冒烟测试(帧循环/按钮/场景/导出/报告渲染)');
