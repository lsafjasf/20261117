/* DOM 冒烟：用最小 stub 验证 ui.js / main.js 的元素绑定与刷新逻辑不抛异常。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeNode(id) {
  return {
    id: id, className: "", innerHTML: "", textContent: "", style: { setProperty: function () {} },
    dataset: {}, children: [], _attrs: {},
    classList: {
      _set: new Set(),
      add: function (c) { this._set.add(c); },
      remove: function (c) { this._set.delete(c); },
      toggle: function (c, on) { on ? this._set.add(c) : this._set.delete(c); },
      contains: function (c) { return this._set.has(c); }
    },
    appendChild: function (c) { this.children.push(c); },
    addEventListener: function () {},
    setAttribute: function (k, v) { this._attrs[k] = v; },
    getAttribute: function (k) { return this._attrs[k]; },
    querySelector: function () { return makeNode("q"); },
    querySelectorAll: function () { return []; },
    getContext: function () {
      return new Proxy({}, { get: function () { return function () {}; } });
    }
  };
}
const ids = [
  "trackCanvas", "panelP1", "panelP2", "btnPause", "btnRestart", "btnReplay",
  "btnDebug", "btnArm", "timerValue", "timerState", "ssSpeed", "ssTraction",
  "ssBrake", "barTraction", "barBrake", "ssLap", "ssLapSub", "ssConflict",
  "ssSync", "ssMode", "ssModeSub", "overlayArm", "overlayProtect",
  "protectTitle", "protectKey", "protectKeySub", "protectWatch",
  "replayBar", "rbMeta", "rbScrub", "rbSpeed", "rbPlay", "rbTime", "rbEvent",
  "missionLog", "bufP1", "bufP2", "bufP1Count", "bufP2Count", "bufferCount",
  "bufferDetail", "phaseTitle", "phaseSub", "selftest", "footerKeys"
];
const registry = {};
ids.forEach(function (id) { registry[id] = makeNode(id); });

const sandbox = {
  console, Math, JSON, Date, isFinite, parseInt, parseFloat,
  setTimeout: function (fn) { fn(); }, setInterval: function () { return 0; },
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function () { return 0; },
  localStorage: { getItem: function () { return null; }, setItem: function () {} },
  document: {
    getElementById: function (id) { return registry[id] || (registry[id] = makeNode(id)); },
    createElement: function (tag) { return makeNode(tag); }
  },
  window: { addEventListener: function () {}, removeEventListener: function () {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = [
  "js/track.js", "js/engine.js", "js/input.js", "js/render.js", "js/ui.js",
  "js/replay.js", "js/selftest.js", "js/main.js"
];
files.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), sandbox, { filename: f });
});

// 驱动若干帧并手动刷新，确认无异常
const app = sandbox.window.MC_APP;
for (let i = 0; i < 120; i++) app.engine.step({
  p1: { accelHeld: true, decelHeld: false },
  p2: { brakeUp: false, brakeDown: false, switchInner: true, switchOuter: false, emergency: false }
});
app.refresh(app.engine, null);
app.engine.disconnect("p1");
app.refresh(app.engine, null);
app.engine.reconnect("p1");
app.restart();
console.log("DOM smoke OK · phase =", app.engine.phase, "· mode =", app.getMode());
