"use strict";

/* 用 DOM/Canvas 桩加载完整 app.js，验证初始化与按钮事件绑定不抛异常。 */
const path = require("path");
const fs = require("fs");
const { FakeCanvas } = require("./fake-canvas.js");

function fakeElement(id) {
  return {
    id: id,
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    files: [],
    listeners: {},
    hidden: false,
    width: id === "stage-canvas" ? 960 : 1200,
    height: id === "stage-canvas" ? 270 : 360,
    getContext: function () { return new FakeCanvas(this.width, this.height).getContext("2d"); },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: this.width, height: this.height }; },
    setPointerCapture: function () {},
    releasePointerCapture: function () {},
    addEventListener: function (type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    removeEventListener: function () {},
    appendChild: function (child) { this._lastChild = child; },
    setAttribute: function () {},
    click: function () {},
    querySelector: function () { return { innerHTML: "", appendChild: function () {} }; },
    scrollTop: 0,
    scrollHeight: 0
  };
}

const registry = {};
global.window = global;
global.document = {
  createElement: function () { return fakeElement("dynamic"); },
  addEventListener: function (type, fn) {
    if (type === "DOMContentLoaded") global._onReady = fn;
  },
  getElementById: function (id) { return registry[id] || (registry[id] = fakeElement(id)); }
};
global.localStorage = {
  _store: {},
  setItem: function (k, v) { this._store[k] = v; },
  getItem: function (k) { return this._store[k] || null; }
};
global.performance = { now: function () { return Date.now(); } };
global.requestAnimationFrame = function (fn) { return setTimeout(function () { fn(performance.now()); }, 16); };
global.cancelAnimationFrame = function (id) { clearTimeout(id); };
global.Blob = function (parts, opts) { this.parts = parts; this.type = opts.type; this.size = String(parts).length; };
global.URL = { createObjectURL: function () { return "blob:fake"; }, revokeObjectURL: function () {} };
global.FileReader = function () {
  this.readAsText = function () { this.onload({ target: { result: "WEBVTT\n\n1\n00:01.000 --> 00:02.000\n<00:01.000>测<00:01.500>试" } }); };
};

const files = ["util.js", "model.js", "vtt.js", "storage.js", "audio.js",
  "transport.js", "renderer.js", "exporter.js", "selftest.js", "app.js"];
files.forEach(function (file) {
  new Function(fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8")).call(global);
});

global._onReady();
const app = global.TC_APP;
if (!app || !app.state.transport) throw new Error("应用未完成初始化");

/* 触发若干按钮，验证事件闭环 */
function click(id) {
  registry[id].listeners.click.forEach(function (fn) { fn({ target: registry[id] }); });
}
["btn-verify", "btn-save", "btn-reload", "btn-export-vtt", "btn-replay-fail",
  "btn-selftest", "btn-clear-log", "btn-loop", "btn-seek-zero", "btn-stop"].forEach(click);

/* 模拟一次时间线指针拖拽（命中片段体并移动） */
const canvas = registry["timeline-canvas"];
const down = canvas.listeners.pointerdown[0];
const move = canvas.listeners.pointermove[0];
const up = canvas.listeners.pointerup[0];
down({ clientX: 300, clientY: 160, pointerId: 1 });
move({ clientX: 320, clientY: 160, pointerId: 1 });
up({ clientX: 320, clientY: 160, pointerId: 1 });

app.state.transport.dispose();
console.log("app-smoke OK：初始化、按钮、拖拽事件全部无异常");
