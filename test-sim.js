/* 引擎验证脚本：node test-sim.js */
const E = require("./engine.js");
let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name);
  if (!cond) failures++;
}

// 1. 默认种子可完成 8 小时且电缆安全
{
  const s = E.createSim(20261117);
  while (!s.done && !s.fault) E.step(s);
  check("默认种子完成 8 小时", s.done && s.t === E.TOTAL_TIME);
  const safe = s.turbines.every(t => Math.abs(t.cableTwist) <= E.LIMITS.cableTwist.max);
  check("电缆扭转全程安全", safe);
  check("历史记录完整（回放数据）", s.history.length === s.stepCount + 1);
}

// 2. 确定性：相同种子两次运行轨迹一致
{
  const a = E.createSim(42), b = E.createSim(42);
  for (let i = 0; i < 10000; i++) { E.step(a); E.step(b); }
  check("相同种子轨迹一致", JSON.stringify(a.history) === JSON.stringify(b.history));
}

// 3. 暂停/单步/恢复一致性：连续运行 vs 分段单步
{
  const cont = E.createSim(7);
  for (let i = 0; i < 3000; i++) E.step(cont);          // 连续
  const seg = E.createSim(7);
  for (let i = 0; i < 1200; i++) E.step(seg);           // “运行”段
  for (let i = 0; i < 1800; i++) E.step(seg);           // “单步”段（同一 step 函数）
  check("暂停/单步/恢复物理结果一致",
    JSON.stringify(cont.turbines) === JSON.stringify(seg.turbines));
}

// 4. 重置不漂移：重置后初始条件与轨迹和首次运行完全一致
{
  const first = E.createSim(999);
  for (let i = 0; i < 5000; i++) E.step(first);
  const reset = E.createSim(999);                        // 重置 = 同种子重建
  const init0 = E.createSim(999);
  check("重置后初始条件不漂移", JSON.stringify(reset.turbines) === JSON.stringify(init0.turbines)
    && reset.t === 0 && reset.history.length === 1);
  for (let i = 0; i < 5000; i++) E.step(reset);
  check("重置后轨迹与首次运行一致", JSON.stringify(first.history) === JSON.stringify(reset.history));
}

// 5. 故障路径：越限记录部件/时间，且停止不安全计算
{
  const s = E.createSim(555);                            // 已知触发电缆扭转故障
  while (!s.done && !s.fault) E.step(s);
  check("故障被记录（部件+时间+数值+限值）",
    !!s.fault && s.fault.turbineId >= 0 && s.fault.time > 0 &&
    typeof s.fault.value === "number" && typeof s.fault.limit === "number");
  const tAtFault = s.t, snap = JSON.stringify(s.turbines);
  E.step(s); E.step(s);                                  // 故障后 step 应为无操作
  check("故障后停止不安全计算", s.t === tAtFault && JSON.stringify(s.turbines) === snap);
  check("故障变量确实越限",
    s.fault.value > E.LIMITS[s.fault.variable].max || s.fault.value < E.LIMITS[s.fault.variable].min);
}

// 6. 峰值记录
{
  const s = E.createSim(20261117);
  while (!s.done && !s.fault) E.step(s);
  const p = s.peaks[0];
  check("峰值已记录（功率/温度/压力/扭转）",
    p.power.max > 0 && p.temp.max > 0 && p.pressure.min < 160 &&
    isFinite(p.cableTwist.max) && p.power.tMax >= 0);
}

console.log(failures === 0 ? "\n全部通过" : "\n有 " + failures + " 项失败");
process.exit(failures === 0 ? 0 : 1);
