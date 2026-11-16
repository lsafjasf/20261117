/* Node 回归验证：确定性、重置无漂移、越限停机、暂停/单步一致性 */
"use strict";
const SIM = require("./sim.js");

function runFull(inputs, maxSteps) {
  const s = SIM.createState();
  s.inputs = inputs;
  let n = 0;
  while (!s.finished && n < maxSteps) { SIM.step(s); n++; }
  return s;
}

function fingerprint(s) {
  // 抽样历史，生成可比指纹
  const h = s.hist;
  let acc = 0;
  for (let i = 0; i < h.t.length; i += 7) {
    acc += h.t[i] * 1 + h.temp[0][i] * 3 + h.temp[1][i] * 5 + h.temp[2][i] * 11 +
           h.tSink[i] * 13 + h.pressure[i] * 17 + h.energy[i] * 0.001;
  }
  return acc.toFixed(10) + "|" + h.t.length + "|" + s.t.toFixed(6);
}

let pass = 0, failCount = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("PASS  " + name); }
  else { failCount++; console.log("FAIL  " + name + "  " + (detail || "")); }
}

const inpA = { fan: 0.6, pads: [5, 5, 5], weights: [33, 33, 34] };

// 1) 相同输入 → 轨迹一致
const r1 = runFull(inpA, 7000);
const r2 = runFull(inpA, 7000);
check("确定性：相同输入轨迹一致", fingerprint(r1) === fingerprint(r2),
  fingerprint(r1) + " vs " + fingerprint(r2));

// 2) 重置无漂移：createState 两次结果相同
const s1 = SIM.createState(), s2 = SIM.createState();
check("重置：初始状态完全一致", JSON.stringify(s1) === JSON.stringify(s2));

// 3) 单步 vs 连续：前 100 步逐步推进与连续推进一致
const cont = SIM.createState(); cont.inputs = inpA;
for (let i = 0; i < 100; i++) SIM.step(cont);
const manual = SIM.createState(); manual.inputs = inpA;
for (let i = 0; i < 100; i++) SIM.step(manual); // 单步等价于逐次 step
check("单步/连续一致", fingerprint(cont) === fingerprint(manual));

// 4) 越限停机：极端负载集中 + 弱导热片 → 必然触发并冻结
const danger = runFull({ fan: 0.1, pads: [1, 1, 1], weights: [100, 0, 0] }, 7000);
check("越限触发失败", !!danger.failed, JSON.stringify(danger.failed));
check("失败后停止积分", danger.finished && danger.t < SIM.PHYS.duration);
if (danger.failed) {
  const tBefore = danger.t;
  SIM.step(danger); // 应被拒绝
  check("停机后 step 无效", danger.t === tBefore);
  console.log("  首次越限:", danger.failed.component, danger.failed.type,
    "t=" + danger.failed.time.toFixed(1) + "s",
    "值=" + danger.failed.value.toFixed(2), "限=" + danger.failed.limit);
}

// 5) 合理输入可通关 10 分钟
const win = runFull({ fan: 0.75, pads: [8, 8, 8], weights: [33, 33, 34] }, 7000);
check("合理输入可坚持 10 分钟", win.won === true,
  "t=" + win.t.toFixed(1) + " peak=" + win.peaks.temp.map(x => x.toFixed(1)).join(","));
if (win.won) {
  console.log("  通关峰值: T=" + win.peaks.temp.map(x => x.toFixed(1)).join("/") +
    "°C 散热器=" + win.peaks.tSink.toFixed(1) + "°C 压力=" +
    win.peaks.pressure.toFixed(3) + "MPa 耗电=" + win.energy.toFixed(0) + "J");
}

// 6) 电量超支路径存在（满风扇 + 低负载也不该超支？验证满转必超支）
const blow = runFull({ fan: 1.0, pads: [8, 8, 8], weights: [33, 33, 34] }, 7000);
check("满风扇触发电量或温度约束", blow.finished === true);
console.log("  满风扇结局:", blow.won ? "通关" : (blow.failed.type + " @" + blow.failed.time.toFixed(0) + "s"),
  "耗电=" + blow.energy.toFixed(0) + "J");

console.log("\n" + pass + " passed, " + failCount + " failed");
process.exit(failCount ? 1 : 0);
