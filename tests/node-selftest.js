/* 无头自检运行器：在同一 VM 全局中依次加载浏览器 UMD 模块并执行场景。
   运行：node tests/node-selftest.js */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { console, Math, JSON, Date, isFinite, setTimeout: function (fn) { fn(); } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = [
  "js/track.js", "js/engine.js", "js/input.js", "js/render.js",
  "js/replay.js", "js/selftest.js"
];
files.forEach(function (f) {
  const code = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  vm.runInContext(code, sandbox, { filename: f });
});

const report = sandbox.MC.Selftest.run();
console.log("=== MAGLEV 三圈协同试车 · 无头自检 ===");
report.cases.forEach(function (c) {
  console.log((c.ok ? "PASS" : "FAIL") + " | " + c.name);
  c.detail.split("\n").forEach(function (line) { console.log("       " + line); });
});
console.log("--- " + report.pass + "/" + report.total + " 通过 ---");
process.exit(report.pass === report.total ? 0 : 1);
