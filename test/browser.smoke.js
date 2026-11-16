/* 浏览器集成冒烟测试：用最小 DOM/Canvas/Audio 桩加载 index 的全部脚本 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function makeCtx() {
  const noop = () => {};
  return new Proxy({
    measureText: () => ({ width: 80 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    save: noop, restore: noop, translate: noop, rotate: noop,
    clearRect: noop, fillRect: noop, beginPath: noop, arc: noop,
    fill: noop, stroke: noop, moveTo: noop, lineTo: noop, closePath: noop,
    setLineDash: noop, fillText: noop
  }, { get(t, k) { return k in t ? t[k] : noop; }, set() { return true; } });
}

function makeEl(id) {
  return {
    id, style: {}, classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); },
      contains(c) { return this._set.has(c); }
    },
    textContent: '', innerHTML: '', value: '20261117', width: 900, height: 640,
    getContext: () => makeCtx(),
    onclick: null
  };
}

test('浏览器脚本在 DOM 桩下完整加载并驱动一帧', async () => {
  const els = {};
  const ids = ['game', 'goal', 'podlist', 'cargo', 'battery', 'batteryBar',
    'wind', 'mass', 'brake', 'status', 'failure', 'log', 'banner',
    'btnPause', 'btnRestart', 'btnRecover', 'btnSave', 'btnLoad',
    'btnRoute', 'btnCrash', 'btnSeed', 'debug', 'btnMute', 'seedInput', 'saveMsg'];
  ids.forEach(id => els[id] = makeEl(id));
  const listeners = {};
  const storage = {};
  global.self = global;
  global.window = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    AudioContext: undefined
  };
  global.document = {
    getElementById: id => els[id],
    addEventListener: () => {}
  };
  global.localStorage = {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = v; }
  };
  global.performance = { now: () => Date.now() };
  let rafCb = null;
  global.requestAnimationFrame = cb => { rafCb = cb; };

  for (const f of ['prng.js', 'world.js', 'engine.js', 'render.js', 'audio.js', 'main.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    new Function(code).call(global);
  }

  assert.equal(typeof global.LunarEngine.step, 'function');
  assert.ok(rafCb, '主循环已注册 requestAnimationFrame');
  for (let i = 0; i < 5; i++) {
    const cb = rafCb;
    rafCb = null;
    cb(performance.now() + 16.7 * (i + 1));
    assert.ok(rafCb, '循环持续注册下一帧');
  }
  assert.match(els.goal.textContent, /\/ 3 舱已补给/);
  assert.ok(els.battery.textContent.length > 0);

  // 保存/载入走 localStorage 通路
  els.btnSave.onclick();
  assert.ok(storage['lunar-rover-save-v1']);
  els.btnLoad.onclick();
  assert.match(els.saveMsg.textContent, /载入/);

  // 演示按钮与暂停按钮可点击
  els.btnRoute.onclick();
  assert.ok(rafCb);
  els.btnPause.onclick();
  els.btnRestart.onclick();
});
