'use strict';
// 浏览器层冒烟测试：stub DOM/Canvas，加载 main.js 跑若干帧 + 模拟按键
const assert = require('assert');

const noop = () => {};
const gradient = { addColorStop: noop };
const ctx2d = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
    if (prop === 'measureText') return () => ({ width: 0 });
    return typeof target[prop] !== 'undefined' ? target[prop] : noop;
  },
  set: () => true,
});

const canvas = { width: 1000, height: 640, getContext: () => ctx2d };
const elements = { game: canvas, status: { textContent: '' } };
for (const id of ['btnPause', 'btnRestart', 'btnMode', 'btnReplay', 'btnExport']) {
  elements[id] = { onclick: null };
}

const listeners = {};
let rafCallback = null;
let now = 0;

global.window = {
  addEventListener: (type, fn) => { listeners[type] = fn; },
};
global.document = {
  getElementById: (id) => elements[id],
  createElement: () => ({ click: noop, href: '', download: '' }),
};
global.requestAnimationFrame = (fn) => { rafCallback = fn; };
global.performance = { now: () => now };
global.Blob = class {};
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: noop };

require('./game.js');
global.window.GameCore = global.GameCore || require('./game.js');
// game.js 在 Node 中把 GameCore 挂到了 module.exports，这里手动挂到 window
window.GameCore = require('./game.js');

require('./main.js');

function frames(n, dtMs = 50) {
  for (let i = 0; i < n; i++) {
    now += dtMs;
    const cb = rafCallback;
    rafCallback = null;
    cb(now);
    assert.ok(rafCallback, '应持续请求下一帧');
  }
}

function key(code, down) {
  listeners[down ? 'keydown' : 'keyup']({ code, repeat: false, preventDefault: noop });
}

frames(10);                       // 空闲渲染
key('KeyW', true);                // P1 增压
key('ArrowRight', true);          // P2 转向
frames(40);
key('KeyW', false);
key('ArrowRight', false);
key('KeyP', true); key('KeyP', false);   // 暂停
frames(5);
key('KeyP', true); key('KeyP', false);   // 继续
key('KeyM', true); key('KeyM', false);   // 切调试模式
frames(10);
key('KeyM', true); key('KeyM', false);   // 切回双人
key('KeyR', true); key('KeyR', false);   // 重开
frames(10);
key('KeyV', true); key('KeyV', false);   // 无对局可回放 → 仅提示
key('KeyE', true); key('KeyE', false);   // 导出当前回放
frames(5);

assert.ok(elements.status.textContent.length > 0, '状态栏应有提示');
console.log('✔ 冒烟测试通过：main.js 渲染/输入/暂停/重开/调试/回放/导出无运行时错误');
