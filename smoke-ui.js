/* UI 冒烟测试：用 DOM 桩在 node 中加载 ui.js 并走一遍完整流程 */
const fs = require("fs");

function makeCtx() {
  return new Proxy({}, {
    get: (t, k) => (typeof t[k] !== "undefined" ? t[k] : function () {}),
    set: (t, k, v) => { t[k] = v; return true; }
  });
}
function makeEl(id) {
  const listeners = {};
  return {
    id, textContent: "", innerHTML: "", value: id === "speed-select" ? "64" : "20261117",
    disabled: false, max: "0",
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(ev, fn) { listeners[ev] = fn; },
    click() { if (listeners.click && !this.disabled) listeners.click.call(this); },
    getContext() { return makeCtx(); },
    _listeners: listeners
  };
}

const els = {};
global.document = { getElementById(id) { return els[id] || (els[id] = makeEl(id)); } };
global.window = global;

global.WindSim = require("./engine.js");
eval(fs.readFileSync("./ui.js", "utf8"));

const $ = id => els[id];
let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name);
  if (!cond) failures++;
}

$("btn-start").click();
check("开始后进入运行态", $("sim-state").textContent === "运行中");
check("运行中暂停可用", $("btn-pause").disabled === false);

$("btn-pause").click();
check("暂停生效", $("sim-state").textContent === "已暂停");
const t0 = $("sim-clock").textContent;
$("btn-step").click();
check("单步推进时钟", $("sim-clock").textContent !== t0);
$("btn-resume").click();
check("恢复运行", $("sim-state").textContent === "运行中");

setTimeout(() => {
  const state = $("sim-state").textContent;
  check("8 小时完成或故障停机", /完成|故障/.test(state));
  check("报告已生成（含峰值表）", $("report-content").innerHTML.indexOf("峰值功率") >= 0);
  check("回放按钮可用", $("btn-replay").disabled === false);

  $("btn-replay").click();
  check("进入回放", $("sim-state").textContent === "回放中");
  setTimeout(() => {
    $("btn-replay-exit").click();
    check("退出回放", $("sim-state").textContent !== "回放中");

    $("btn-reset").click();
    check("重置回到就绪", $("sim-state").textContent === "就绪");
    check("重置后时钟归零", $("sim-clock").textContent.indexOf("t = 00:00:00") === 0);
    check("重置后可重新开始", $("btn-start").disabled === false);

    console.log(failures === 0 ? "\nUI 冒烟测试全部通过" : "\n有 " + failures + " 项失败");
    process.exit(failures === 0 ? 0 : 1);
  }, 300);
}, 12000);
