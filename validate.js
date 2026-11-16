/* 三类流程验证: 正常生产 / 参数越限 / 设备停机
 * 记录触发时刻、当前数值与恢复结果, 导出良品数、峰值与停机原因。
 * 运行: node validate.js  (报告写入 artifacts/validation_report.json)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { FillingSim } = require('./sim.js');

const DT = 0.1;
const results = [];

function runUntil(sim, cond, maxT = 600) {
  while (!cond() && sim.time < maxT) sim.tick(DT);
}

function snapshot(sim) {
  return {
    t: +sim.time.toFixed(2),
    params: Object.assign({}, sim.params),
    temp: +sim.temp.toFixed(2),
    cache: sim.cache.length,
    pipeline: sim.pipeline.length,
    qualified: sim.qualified,
    attempts: sim.bottles.length,
    energyKJ: +sim.energyKJ.toFixed(1),
    halted: sim.halted,
  };
}

function check(name, cond, detail) {
  results.push({ check: name, pass: !!cond, detail });
  if (!cond) console.error(`  [FAIL] ${name}: ${detail}`);
}

/* ---------- 场景一: 正常生产 ---------- */
function scenarioNormal() {
  const sim = new FillingSim('soda');
  runUntil(sim, () => sim.batchDone);
  const report = sim.exportReport();
  check('正常生产: 12瓶合格', report.qualified === 12 && report.batchDone, `qualified=${report.qualified}`);
  check('正常生产: 良品率100%', report.goodRate === 1, `rate=${report.goodRate}`);
  check('正常生产: 无停机', report.shutdownReasons.length === 0, JSON.stringify(report.shutdownReasons));
  check('正常生产: 能耗随时钟累积', report.energyKJ > 0, `energy=${report.energyKJ}kJ`);
  return {
    scenario: '正常生产',
    trigger: null,
    recovery: null,
    export: {
      qualified: report.qualified, attempts: report.attempts, goodRate: report.goodRate,
      peaks: report.peaks, shutdownReasons: report.shutdownReasons, energyKJ: report.energyKJ,
      anomalies: report.anomalies,
    },
  };
}

/* ---------- 场景二: 参数越限 (压力过高喷溅 -> 恢复) ---------- */
function scenarioOutOfLimit() {
  const sim = new FillingSim('soda');
  runUntil(sim, () => sim.time >= 20);
  sim.setParam('pressure', 5.0);
  sim.setParam('fillSpeed', 24);
  const trigger = snapshot(sim);
  trigger.note = '压力5.0bar x 速度24bpm, 湍流超限';
  runUntil(sim, () => sim.time >= 45);
  const duringDefects = sim.bottles.filter((b) => !b.qualified).length;
  const splashEvents = sim.events.filter((e) => e.type === 'splash').length;
  sim.setParam('pressure', 3.0);
  sim.setParam('fillSpeed', 12);
  const recoveredAt = sim.time;
  runUntil(sim, () => sim.batchDone);
  const report = sim.exportReport();
  const okAfter = sim.bottles.filter((b) => b.qualified && b.cappedAt >= recoveredAt).length;
  const recovery = {
    resumedAt: +recoveredAt.toFixed(2),
    qualifiedAfterRecovery: okAfter,
    result: okAfter > 0 ? '参数恢复后重新产出合格品' : '恢复失败',
  };
  check('参数越限: 触发喷溅缺陷', splashEvents > 0 && duringDefects > 0, `splash=${splashEvents} defects=${duringDefects}`);
  check('参数越限: 恢复后产出合格品', okAfter > 0, `okAfter=${okAfter}`);
  check('参数越限: 批次最终完成', report.batchDone, `qualified=${report.qualified}`);
  return {
    scenario: '参数越限',
    trigger,
    defectWindow: { splashEvents, defects: duringDefects },
    recovery,
    export: {
      qualified: report.qualified, attempts: report.attempts, goodRate: report.goodRate,
      peaks: report.peaks, shutdownReasons: report.shutdownReasons, energyKJ: report.energyKJ,
      anomalies: report.anomalies, defectTally: report.defectTally,
    },
  };
}

/* ---------- 场景三: 设备停机 (封盖机停机 -> 缓存溢出 -> 恢复 -> 重置) ---------- */
function scenarioShutdown() {
  const sim = new FillingSim('cola');
  sim.setParam('pressure', 2.5);
  sim.setParam('tempSet', 6);
  runUntil(sim, () => sim.time >= 20);

  // 暂停检查: 暂停时时钟冻结, 单步只推进一步
  sim.pause();
  const pausedT = sim.time;
  sim.tick(DT);
  const frozen = sim.time === pausedT;
  sim.step();
  const stepped = Math.abs(sim.time - (pausedT + 0.1)) < 1e-9;
  sim.resume();
  check('设备停机: 暂停冻结时钟', frozen, `t=${sim.time}`);
  check('设备停机: 单步推进0.1s', stepped, `t=${sim.time}`);

  sim.setDevice('capper', false);
  const trigger = snapshot(sim);
  trigger.note = '封盖机停机';
  runUntil(sim, () => sim.halted);
  const haltedSnap = snapshot(sim);
  const energyAtHalt = sim.energyKJ;
  runUntil(sim, () => sim.time >= haltedSnap.t + 10);
  const energyWhileHalted = +(sim.energyKJ - energyAtHalt).toFixed(1);

  sim.setDevice('capper', true);
  runUntil(sim, () => !sim.halted && sim.cache.length === 0 && sim.pipeline.length === 0 || sim.batchDone);
  runUntil(sim, () => sim.batchDone);
  const resumeEvent = sim.events.find((e) => e.type === 'line_resume');
  const report = sim.exportReport();
  const recovery = {
    haltReason: report.shutdownReasons.length ? report.shutdownReasons[0].reason : null,
    haltAt: report.shutdownReasons.length ? report.shutdownReasons[0].t : null,
    resumed: !!resumeEvent,
    downtime: resumeEvent ? resumeEvent.data.downtime : null,
    energyWhileHaltedKJ: energyWhileHalted,
    result: report.batchDone ? '封盖机重启后产线恢复, 批次完成' : '恢复失败',
  };
  check('设备停机: 缓存溢出触发停机', report.shutdownReasons.length > 0, JSON.stringify(report.shutdownReasons));
  check('设备停机: 停机时缓存积压', haltedSnap.cache > 0, `cache=${haltedSnap.cache}`);
  check('设备停机: 停机期间能耗仍累积(冷水机)', energyWhileHalted > 0, `dE=${energyWhileHalted}kJ`);
  check('设备停机: 重启后恢复并完成批次', !!resumeEvent && report.batchDone, `resumed=${!!resumeEvent}`);

  // 批次重置: 重开不得保留旧缓存
  sim.resetBatch();
  const cleared = sim.cache.length === 0 && sim.pipeline.length === 0 &&
    sim.bottles.length === 0 && sim.qualified === 0 && sim.energyKJ === 0;
  check('设备停机: 重置后缓存清零', cleared, `cache=${sim.cache.length} bottles=${sim.bottles.length}`);

  return {
    scenario: '设备停机',
    trigger,
    haltedSnapshot: haltedSnap,
    recovery,
    resetCheck: { cacheCleared: cleared },
    export: {
      qualified: report.qualified, attempts: report.attempts, goodRate: report.goodRate,
      peaks: report.peaks, shutdownReasons: report.shutdownReasons, energyKJ: report.energyKJ,
      anomalies: report.anomalies, defectTally: report.defectTally,
    },
  };
}

/* ---------- 主流程 ---------- */
function main() {
  const scenarios = [scenarioNormal(), scenarioOutOfLimit(), scenarioShutdown()];
  const allPass = results.every((r) => r.pass);
  const out = {
    generatedAt: new Date().toISOString(),
    allPass,
    checks: results,
    scenarios,
  };
  const dir = path.join(__dirname, 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'validation_report.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  for (const s of scenarios) {
    console.log(`[${s.scenario}] 良品 ${s.export.qualified}/${s.export.attempts} 良品率 ${(s.export.goodRate * 100).toFixed(1)}% 停机 ${s.export.shutdownReasons.length}次 异常 ${s.export.anomalies.length}处`);
  }
  console.log(`检查 ${results.filter((r) => r.pass).length}/${results.length} 通过 -> ${file}`);
  process.exit(allPass ? 0 : 1);
}

main();
