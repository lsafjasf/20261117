// 三类流程自动化验证：正常生产 / 参数越限 / 设备停机。
// 记录触发时刻、当前数值与恢复结果，导出良品数、峰值与停机原因。
const S = require('./src/sim.js');
const fs = require('fs');
const path = require('path');

function run(m, seconds, each) {
  const steps = Math.round(seconds / S.CFG.dt);
  for (let i = 0; i < steps; i++) {
    S.step(m);
    if (each) each(m);
    if (m.inspected || m.shutdown) break;
  }
}

function runUntilSeg(m, count, maxSec) {
  const steps = Math.round(maxSec / S.CFG.dt);
  for (let i = 0; i < steps; i++) {
    S.step(m);
    if (m.segments.length >= count || m.shutdown) break;
  }
}

function heatTo(m, target) {
  S.setTempTarget(m, target);
  let guard = 0;
  while (m.temp < target - 2 && guard++ < 20000 && !m.shutdown) S.step(m);
}

// ---------- 场景 1：正常生产 ----------
function scenarioNormal() {
  const m = S.createMachine();
  const plan = [
    { id: 'A', speed: 60, tension: 40 },
    { id: 'B', speed: 60, tension: 40 },
    { id: 'C', speed: 65, tension: 42 }
  ];
  heatTo(m, m.spec.tempOpt); // 停机预热，缓存不积压
  S.start(m);
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (m.spec.id !== p.id) {
      S.setSpeed(m, 0);            // 换规格：停机螺杆
      S.selectSpec(m, p.id);
      S.purge(m);                  // 必须清理旧料
      heatTo(m, m.spec.tempOpt);   // 等待清料并升温
    }
    S.setSpeed(m, p.speed);
    S.setTension(m, p.tension);
    runUntilSeg(m, i + 1, 900);
  }
  S.stop(m, '三段完成');
  const ok = S.inspect(m);
  const report = S.exportReport(m);
  return {
    name: '正常生产',
    pass: ok && report.goodCount === 3 && report.goodRate === 1 && report.shutdownReasons.length === 0,
    inspectSuccess: ok,
    goodCount: report.goodCount, totalCount: report.totalCount, goodRate: report.goodRate,
    peaks: report.peaks, energyKWh: report.energyKWh,
    shutdownReasons: report.shutdownReasons,
    anomalies: report.anomalies,
    segments: report.segments
  };
}

// ---------- 场景 2：参数越限（温度不足 + 牵引过快），随后恢复 ----------
function scenarioOutOfLimits() {
  const m = S.createMachine();
  heatTo(m, m.spec.tempOpt);
  S.start(m);
  S.setSpeed(m, 60); S.setTension(m, 40);
  run(m, 20);

  // 越限 1：温度不足 -> 表面粗糙
  S.setTempTarget(m, 120);
  run(m, 40);
  // 越限 2：牵引过快 -> 外径拉细
  S.setTempTarget(m, m.spec.tempOpt);
  heatTo(m, m.spec.tempOpt);
  run(m, 5);
  S.setTension(m, 95);
  run(m, 20);
  // 恢复正常参数
  S.setTension(m, 40);
  run(m, 30);
  S.stop(m, '场景结束');

  const report = S.exportReport(m);
  const rough = report.anomalies.find(a => a.type.indexOf('粗糙') >= 0);
  const thin = report.anomalies.find(a => a.type.indexOf('拉细') >= 0);
  return {
    name: '参数越限',
    pass: !!(rough && rough.recovered) && !!(thin && thin.recovered),
    triggers: report.anomalies.map(a => ({
      type: a.type, triggerT: a.triggerT, positionM: a.positionM,
      values: a.values, recovered: a.recovered, recoverT: a.recoverT
    })),
    recoveryResult: report.anomalies.every(a => a.recovered) ? '全部缺陷在参数恢复后消除' : '存在未恢复缺陷',
    goodRate: report.goodRate, peaks: report.peaks,
    shutdownReasons: report.shutdownReasons
  };
}

// ---------- 场景 3：设备停机（缓存溢出 + 超温），复位后恢复 ----------
function scenarioShutdown() {
  const m = S.createMachine();
  S.start(m);
  // 运行但不挤出，只进料 -> 缓存溢出停机
  run(m, 120);
  const firstStop = m.shutdown;
  // 复位并恢复生产
  S.clearShutdown(m);
  heatTo(m, m.spec.tempOpt);
  S.start(m);
  S.setSpeed(m, 60);
  run(m, 10);
  // 超温停机
  S.setTempTarget(m, 280);
  run(m, 120);
  const secondStop = m.shutdown;
  const stopEvents = m.events.filter(e => e.type === 'shutdown');
  S.clearShutdown(m);
  S.setTempTarget(m, m.spec.tempOpt);
  S.start(m);
  run(m, 5);
  const recovered = m.running && !m.shutdown;
  S.stop(m, '场景结束');

  const report = S.exportReport(m);
  return {
    name: '设备停机',
    pass: !!firstStop && !!secondStop && recovered && stopEvents.length === 2,
    shutdowns: stopEvents.map(e => ({ t: e.t, reason: e.reason, values: e.values })),
    recoveryResult: recovered ? '两次停机均复位成功并恢复运行' : '复位失败',
    shutdownReasons: report.shutdownReasons,
    peaks: report.peaks
  };
}

// ---------- 时钟控制验证：暂停 / 单步 / 批次重置 ----------
function scenarioClock() {
  const m = S.createMachine();
  S.start(m); S.setSpeed(m, 60);
  run(m, 5);
  const t1 = m.clock, e1 = m.energy, p1 = m.pool;
  S.pause(m);
  run(m, 5); // 暂停期间时钟不得推进
  const pausedOk = m.clock === t1 && m.energy === e1 && m.pool === p1;
  S.stepOnce(m); // 单步：恰好推进一个 dt
  const stepOk = Math.abs(m.clock - (t1 + S.CFG.dt)) < 1e-9;
  S.resume(m);
  run(m, 2);
  const resumedOk = m.clock > t1 + S.CFG.dt;
  // 暂停中检查当前批次状态（允许暂停检查并恢复）
  S.pause(m);
  const inspectedState = { segLength: m.segLength, pool: m.pool, energy: m.energy };
  S.resume(m);
  run(m, 1);
  const stateKept = m.segLength >= inspectedState.segLength;
  // 批次重置：不得保留旧缓存
  S.resetBatch(m);
  const resetOk = m.clock === 0 && m.pool === S.CFG.poolStart && m.energy === 0 &&
    m.segments.length === 0 && m.events.filter(e => e.type !== 'device').length === 0;
  return {
    name: '时钟控制（暂停/单步/重置）',
    pass: pausedOk && stepOk && resumedOk && stateKept && resetOk,
    pausedOk, stepOk, resumedOk, stateKept, resetOk
  };
}

const results = [scenarioNormal(), scenarioOutOfLimits(), scenarioShutdown(), scenarioClock()];
const allPass = results.every(r => r.pass);
const out = { generatedAt: new Date().toISOString(), allPass, scenarios: results };
const file = path.join(__dirname, 'artifacts', 'verification-report.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2));

for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (r.name === '正常生产') console.log(`     良品 ${r.goodCount}/${r.totalCount} 良品率 ${(r.goodRate * 100).toFixed(0)}% 能耗 ${r.energyKWh} kWh`);
  if (r.triggers) for (const t of r.triggers) console.log(`     越限[${t.type}] t=${t.triggerT}s 位置=${t.positionM}m 恢复=${t.recovered}@${t.recoverT}s`);
  if (r.shutdowns) for (const s of r.shutdowns) console.log(`     停机 t=${s.t}s 原因=${s.reason}`);
}
console.log(allPass ? '全部场景通过' : '存在失败场景');
process.exit(allPass ? 0 : 1);
