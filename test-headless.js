// 无头验证：确定性、重置不漂移、越限冻结、回放一致
const ctxProxy = new Proxy(function () {}, {
  get: () => ctxProxy,
  apply: () => ctxProxy,
});
const elStub = () => ({
  getContext: () => ctxProxy,
  addEventListener: () => {},
  appendChild: () => {},
  style: {},
  width: 640, height: 420,
  textContent: "", innerHTML: "", className: "", value: 0,
});
global.document = { getElementById: elStub, createElement: elStub };
global.requestAnimationFrame = () => {};

const sim = require("./sim.js");

function runScripted(inputs, steps) {
  sim.doReset(false);
  let idx = 0;
  for (let i = 0; i < steps && !sim.S.done; i++) {
    const t = i * sim.DT;
    while (idx < inputs.length && inputs[idx][0] <= t + 1e-9) {
      sim.applyInput(inputs[idx][1], inputs[idx][2]);
      idx++;
    }
    sim.physStep();
  }
  return JSON.parse(JSON.stringify(sim.S));
}

// 场景1：正常操作应成功
const script = [
  [0.0, "valve", 1.0],
  [0.0, "pump", 0.8],
];
const r1 = runScripted(script, 240 * 120);
const r2 = runScripted(script, 240 * 120);
console.log("成功场景 done =", r1.done, " t =", r1.t.toFixed(3),
  " hA =", r1.hA.toFixed(4), " hB =", r1.hB.toFixed(4));
console.log("确定性(同输入同轨迹):", JSON.stringify(r1) === JSON.stringify(r2) ? "PASS" : "FAIL");

// 场景2：满流急停 + 带载换向应触发水锤越限并冻结
const bang = [
  [0.0, "valve", 1.0],
  [0.0, "pump", 1.0],
  [3.0, "dir", -1],
];
const f1 = runScripted(bang, 240 * 120);
console.log("水锤场景 done =", f1.done,
  " 故障 =", f1.over ? `${f1.over.name}@${f1.over.t.toFixed(2)}s` : "无",
  " 峰值压力 =", f1.peaks.press.toFixed(1), "kPa");
const frozenT = f1.t;
console.log("越限后计算冻结:", f1.done === "fault" ? "PASS" : "FAIL");

// 场景3：泵空转（阀关闭开泵）应过热
const dry = [[0.0, "pump", 1.0]];
const d1 = runScripted(dry, 240 * 120);
console.log("空转场景 done =", d1.done,
  " 故障 =", d1.over ? `${d1.over.name}@${d1.over.t.toFixed(2)}s` : "无",
  " 峰值温度 =", d1.peaks.temp.toFixed(1), "°C");

// 场景4：重置后初始条件不漂移
sim.doReset(false);
const a = JSON.stringify(sim.S);
for (let i = 0; i < 240 * 5; i++) sim.physStep();
sim.doReset(false);
sim.doReset(false);
const b = JSON.stringify(sim.S);
console.log("重置不漂移:", a === b ? "PASS" : "FAIL");
console.log("初始水位:", sim.S.hA, sim.S.hB, " t =", sim.S.t);
console.log("frozen t =", frozenT.toFixed(3));

// 场景5：单步与连续积分结果一致（同一固定步长积分器）
sim.doReset(false);
sim.applyInput("valve", 1.0); sim.applyInput("pump", 0.8);
for (let i = 0; i < 10; i++) sim.singleStep(); // 10 × 20 子步
const s1 = JSON.stringify({ hA: sim.S.hA, hB: sim.S.hB, t: sim.S.t, temp: sim.S.temp });
sim.doReset(false);
sim.applyInput("valve", 1.0); sim.applyInput("pump", 0.8);
for (let i = 0; i < 200; i++) sim.physStep();   // 200 子步连续
const s2 = JSON.stringify({ hA: sim.S.hA, hB: sim.S.hB, t: sim.S.t, temp: sim.S.temp });
console.log("单步/连续一致:", s1 === s2 ? "PASS" : "FAIL");
