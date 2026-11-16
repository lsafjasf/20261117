/* app.js 端到端冒烟测试：最小 DOM 桩 + 真实 sim.js */
"use strict";

function makeCtx() {
  return new Proxy({}, { get: function (t, k) {
    if (k === "canvas") return {};
    return function () {};
  }, set: function () { return true; } });
}
function makeEl(id) {
  return {
    id: id, value: "50", textContent: "", innerHTML: "", hidden: false,
    className: "", max: "0", disabled: false,
    classList: { toggle: function () {}, add: function () {}, remove: function () {} },
    listeners: {},
    addEventListener: function (ev, fn) { this.listeners[ev] = fn; },
    getContext: function () { return makeCtx(); },
    width: 760, height: 420
  };
}

var els = {};
var ids = ["scene", "chart", "btnRun", "btnStep", "btnReset", "btnReplay",
  "replaybar", "replayCursor", "replayTime", "statusline", "report", "reportBody",
  "fan", "oFan", "oPad0", "oPad1", "oPad2", "oW0", "oW1", "oW2"];
ids.forEach(function (id) { els[id] = makeEl(id); });
["0", "1", "2"].forEach(function (i) {
  els["pad" + i] = makeEl("pad" + i); els["pad" + i].value = "50";
  els["wt" + i] = makeEl("wt" + i); els["wt" + i].value = i === "2" ? "34" : "33";
});
els.fan.value = "50";

global.window = global;
global.document = {
  getElementById: function (id) { return els[id]; },
  querySelector: function (sel) {
    if (sel === "#tbl tbody") return els.tbody || (els.tbody = makeEl("tbody"));
    return makeEl(sel);
  },
  querySelectorAll: function (sel) {
    if (sel === ".pad") return [els.pad0, els.pad1, els.pad2];
    if (sel === ".wt") return [els.wt0, els.wt1, els.wt2];
    return [];
  }
};
var rafQueue = [];
global.requestAnimationFrame = function (fn) { rafQueue.push(fn); };

global.SIM = require("./sim.js");
require("./app.js");

var pass = 0, failN = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("PASS  " + name); }
  else { failN++; console.log("FAIL  " + name + " " + (detail || "")); }
}
function pump(frames, dtMs) {
  var t = 0;
  for (var i = 0; i < frames; i++) {
    var q = rafQueue; rafQueue = [];
    t += dtMs;
    q.forEach(function (fn) { fn(t); });
  }
}

// 1) 初始渲染
check("初始化状态行", els.statusline.textContent.indexOf("待机") === 0,
  els.statusline.textContent);

// 2) 单步推进
els.btnStep.listeners.click();
check("单步后 t=0.1s", els.statusline.textContent.indexOf("t=0.1") >= 0,
  els.statusline.textContent);

// 3) 运行若干帧（20 倍速，每帧 16.7ms → 每帧约 3 步）
els.btnRun.listeners.click(); // 开始
pump(300, 16.7);              // ≈5s 真实 → 100s 模拟
check("连续运行推进", els.statusline.textContent.indexOf("运行中") === 0,
  els.statusline.textContent);

// 4) 暂停 → 单步 → 恢复 一致性：与纯 sim 对比
els.btnRun.listeners.click(); // 暂停
var tBefore = parseFloat(els.statusline.textContent.match(/t=([\d.]+)/)[1]);
els.btnStep.listeners.click();
var tAfter = parseFloat(els.statusline.textContent.match(/t=([\d.]+)/)[1]);
check("暂停后单步 +0.1s", Math.abs(tAfter - tBefore - 0.1) < 1e-9,
  tBefore + " -> " + tAfter);

// 5) 重置：初始条件零漂移
els.btnReset.listeners.click();
check("重置后回到待机", els.statusline.textContent.indexOf("待机") === 0,
  els.statusline.textContent);
els.btnStep.listeners.click();
var first = els.statusline.textContent;
els.btnReset.listeners.click();
els.btnStep.listeners.click();
check("重复重置轨迹一致", els.statusline.textContent === first, first);

// 6) 危险输入 → 故障停机 + 报告
els.btnReset.listeners.click();
els.pad0.value = "10"; els.pad1.value = "10"; els.pad2.value = "10";
els.wt0.value = "100"; els.wt1.value = "0"; els.wt2.value = "0";
els.fan.value = "10";
els.btnRun.listeners.click();
pump(3000, 16.7);
check("危险输入触发故障", els.statusline.textContent.indexOf("故障") === 0,
  els.statusline.textContent);
check("报告面板显示", els.report.hidden === false);
check("报告含首次越限时间", els.reportBody.innerHTML.indexOf("首次越限时间") >= 0);
check("报告含故障部件", els.reportBody.innerHTML.indexOf("热源1") >= 0,
  els.reportBody.innerHTML.slice(0, 120));

// 7) 回放模式
els.btnReplay.listeners.click();
check("回放条出现", els.replaybar.hidden === false);
check("回放游标范围=历史长度", +els.replayCursor.max > 0, els.replayCursor.max);
pump(10, 16.7);
check("回放游标推进", +els.replayCursor.value > 0, els.replayCursor.value);

// 8) 合理输入可通关（满帧推进）
els.btnReset.listeners.click();
els.pad0.value = "80"; els.pad1.value = "80"; els.pad2.value = "80";
els.wt0.value = "33"; els.wt1.value = "33"; els.wt2.value = "34";
els.fan.value = "75";
els.btnRun.listeners.click();
pump(4000, 16.7);
check("合理输入通关", els.statusline.textContent.indexOf("成功") === 0,
  els.statusline.textContent);
check("通关报告含峰值", els.reportBody.innerHTML.indexOf("峰值") >= 0);

console.log("\n" + pass + " passed, " + failN + " failed");
process.exit(failN ? 1 : 0);
