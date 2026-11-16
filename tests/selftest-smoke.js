"use strict";

/* 在 Node 中用最小 DOM 桩执行浏览器自测脚本，保证页面按钮路径不腐坏。 */
const path = require("path");
const { FakeCanvas } = require("./fake-canvas.js");

global.window = global;
global.document = {
  createElement: function (tag) {
    if (tag === "canvas") return new FakeCanvas(960, 270);
    throw new Error("未模拟元素 " + tag);
  }
};

const files = ["util.js", "model.js", "vtt.js", "storage.js", "audio.js",
  "transport.js", "renderer.js", "exporter.js", "selftest.js"];
const fs = require("fs");
files.forEach(function (file) {
  const code = fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8");
  new Function(code).call(global);
});

const outcome = global.TC_SELFTEST.run();
console.log(JSON.stringify(outcome, null, 2));
process.exit(outcome.ok ? 0 : 1);
