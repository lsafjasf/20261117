/* Minimal DOM stub smoke test for browser bundles (no jsdom dependency). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl(id) {
  const listeners = {};
  return {
    id,
    value: id === 'seed-input' ? '20261117' : '',
    textContent: '',
    innerHTML: '',
    className: '',
    checked: id === 'debug-toggle',
    files: [],
    getContext: () => ({
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, fill() {}, fillText() {}, arc() {}, save() {}, restore() {},
      translate() {}, rotate() {}, setLineDash() {}, closePath() {}
    }),
    addEventListener(ev, fn) {
      (listeners[ev] = listeners[ev] || []).push(fn);
    },
    dispatch(ev, payload) {
      (listeners[ev] || []).forEach((fn) => fn(payload || { preventDefault() {},
        target: { tagName: '', value: '' } }));
    },
    click() {
      (listeners.click || []).forEach((fn) => fn({ preventDefault() {} }));
    }
  };
}

const ids = [
  'canvas', 'hud-progress', 'hud-resources', 'hud-wind',
  'hud-failure', 'hud-status', 'hud-checkpoint', 'event-log', 'seed-input',
  'btn-start', 'btn-pause', 'btn-restart', 'btn-drop', 'btn-recover',
  'btn-save', 'btn-load', 'btn-export', 'btn-import', 'btn-demo',
  'btn-ground', 'btn-mute', 'debug-toggle', 'speed-select', 'file-import',
  'hud-seed', 'hud-time', 'hud-load', 'hud-current', 'hud-phase'
];
const elements = {};
ids.forEach((id) => { elements[id] = makeEl(id); });

const store = new Map();
const windowListeners = {};
const sandbox = {
  console,
  Math, JSON, Number, parseInt, URLSearchParams: class {
    constructor() { this.map = {}; }
    get() { return null; }
  },
  Blob: class {},
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  FileReader: class {
    readAsText() { this.onload && this.onload(); }
  },
  document: {
    getElementById: (id) => sandbox.elements[id],
    createElement: () => ({ click() {} }),
    addEventListener(ev, fn) {
      (windowListeners[ev] = windowListeners[ev] || []).push(fn);
    }
  },
  window: {
    AudioContext: undefined,
    webkitAudioContext: undefined,
    addEventListener(ev, fn) {
      (windowListeners[ev] = windowListeners[ev] || []).push(fn);
    }
  },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  },
  location: { search: '' },
  requestAnimationFrame: () => 0
};
sandbox.self = sandbox.window;
sandbox.elements = elements;
vm.createContext(sandbox);

for (const file of ['game.js', 'nav.js', 'demo.js', 'render.js', 'audio.js', 'app.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}

windowListeners.DOMContentLoaded.forEach((fn) => fn());
const assert = require('assert');
const g = sandbox.window;
assert.ok(g.BuoyGame && g.BuoyRender && g.BuoyDemo && g.BuoyAudio && g.BuoyNav,
  '全局模块装配失败');
assert.strictEqual(Number(elements['hud-seed'].textContent), 20261117);
assert.strictEqual(elements['hud-progress'].textContent, '0 / 3');

elements['btn-pause'].click();
assert.strictEqual(elements['btn-pause'].textContent, '▶ 继续');
elements['btn-pause'].click();
elements['btn-drop'].click();
assert.ok(elements['hud-failure'].textContent.includes('偏离浮标'));

elements['btn-save'].click();
assert.ok(store.has('buoy-game-save-v1'));
const saved = JSON.parse(store.get('buoy-game-save-v1'));
assert.strictEqual(saved.world.seed, 20261117);
elements['btn-restart'].click();
assert.strictEqual(elements['hud-progress'].textContent, '0 / 3');
elements['btn-load'].click();
assert.strictEqual(JSON.parse(store.get('buoy-game-save-v1')).markersLeft,
  saved.markersLeft);

elements['btn-demo'].click();
assert.ok(elements['hud-phase'].textContent.includes('浮标'));
elements['btn-ground'].click();
assert.ok(elements['hud-phase'].textContent.includes('搁浅'));
elements['btn-mute'].click();
assert.strictEqual(elements['btn-mute'].textContent, '🔇 已静音');

console.log('DOM 冒烟测试通过：装配、暂停、投放、存档/读档、重开、演示与静音均正常');
