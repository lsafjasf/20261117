/*
 * 三类流程自动化验证：
 *   normal     正常生产 —— 三块板材全部达到密度要求
 *   outOfLimit 参数越限 —— 压力/含水率/保温时间越限产生缺陷与异常位置
 *   downtime   设备停机 —— 泵/加热器停机后恢复，记录触发时刻、当前数值与恢复结果
 * 运行：node tests/scenarios.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { Simulation, TICK_S, LIMITS } = require('../js/simulation.js');

function findEvent(events, type, predicate) {
  return events.find((e) => e.type === type && (!predicate || predicate(e)));
}

function findAll(events, type, predicate) {
  return events.filter((e) => e.type === type && (!predicate || predicate(e)));
}

function scenarioNormal() {
  const sim = new Simulation();
  sim.runToComplete();
  const report = sim.exportReport();
  assert.strictEqual(report.goodCount, 3, '正常流程应为 3 块良品');
  assert.strictEqual(report.rejectCount, 0, '正常流程不应有废品');
  assert.strictEqual(report.yieldRate, 100, '良品率应为 100%');
  assert.ok(report.boards.every((b) => b.densityOk && b.passed), '所有板材密度必须达标');
  assert.ok(report.energyKWh > 0, '应累计能耗');
  assert.ok(report.peakPowerKW > 0 && report.peakPressure > 0, '应记录峰值');
  return report;
}

function scenarioOutOfLimit() {
  const sim = new Simulation();
  const triggerLog = [];
  sim.setParam('pressure', 4.6); // 越上限，过压开裂
  sim.setParam('moisture', 14);  // 越上限，高含水疏松
  sim.setParam('holdTime', 4);   // 越下限，保温不足
  const changeEvents = sim.getEvents().filter((e) => e.type === 'PARAM_CHANGE');
  triggerLog.push(...changeEvents.map((e) => ({
    t: e.t,
    param: e.source,
    old: e.detail.old,
    next: e.detail.next,
    valuesAtTrigger: Object.assign({}, e.values)
  })));
  sim.runToComplete();
  const report = sim.exportReport();
  assert.strictEqual(report.goodCount, 0, '越限流程不应有良品');
  assert.strictEqual(report.rejectCount, 3, '三块板材均应报废');
  const codes = new Set();
  report.boards.forEach((b) => b.defects.forEach((c) => codes.add(c)));
  assert.ok(codes.has('CRACK_OVERPRESSURE'), '应出现过压开裂');
  assert.ok(codes.has('LOOSE_WET'), '应出现高含水疏松');
  assert.ok(codes.has('UNDERHOLD'), '应出现保温不足');
  const defectEvents = findAll(sim.getEvents(), 'DEFECT');
  const positions = defectEvents.map((e) => ({ t: e.t, boardId: e.detail.boardId, code: e.detail.code }));
  assert.ok(positions.length >= 3, '应记录异常位置（板材编号+时刻）');
  return { report, triggerLog, positions };
}

function scenarioDowntime() {
  const sim = new Simulation();
  const triggerLog = [];
  // 先停蒸汽：板材仍在铺装/排队，热区必然会吃到蒸汽中断
  const heaterStopAt = sim.simTime;
  sim.setEquipment('heater', false, '蒸汽阀门故障');
  triggerLog.push({ t: heaterStopAt, action: 'HEATER_STOP', valuesAtTrigger: sim.getEvents().slice(-1)[0].values });
  let guard = 0;
  let preheatBoard = sim.getSnapshot().stations.preheat;
  while (
    guard++ < 200 &&
    !(preheatBoard && preheatBoard.defects.includes('GLUE_UNCURED'))
  ) {
    sim.tick();
    preheatBoard = sim.getSnapshot().stations.preheat;
  }
  const heaterRecoverAt = sim.simTime;
  sim.setEquipment('heater', true);
  triggerLog.push({ t: heaterRecoverAt, action: 'HEATER_RECOVER', valuesAtTrigger: sim.getEvents().slice(-1)[0].values });

  // 再停液压泵：等板材进入压机后停机，保证作用于在压板材
  guard = 0;
  while (!sim.getSnapshot().stations.press && guard++ < 200) sim.tick();
  const pumpStopAt = sim.simTime;
  sim.setEquipment('pump', false, '液压泵过载保护触发');
  triggerLog.push({ t: pumpStopAt, action: 'PUMP_STOP', valuesAtTrigger: sim.getEvents().slice(-1)[0].values });
  for (let i = 0; i < 4; i++) sim.tick();
  const pumpRecoverAt = sim.simTime;
  sim.setEquipment('pump', true);
  triggerLog.push({ t: pumpRecoverAt, action: 'PUMP_RECOVER', valuesAtTrigger: sim.getEvents().slice(-1)[0].values });

  sim.runToComplete();
  const report = sim.exportReport();
  assert.ok(report.downtime.length === 2, '应记录两次停机');
  assert.ok(report.downtime.every((d) => d.recovered && d.endAt !== null), '停机均应恢复');
  const glueDefect = findEvent(sim.getEvents(), 'DEFECT', (e) => e.detail.code === 'GLUE_UNCURED');
  assert.ok(glueDefect, '蒸汽不足应产生胶层未固化缺陷');
  const looseDefect = findEvent(sim.getEvents(), 'DEFECT', (e) => e.detail.code === 'LOOSE_PRESSURE');
  assert.ok(looseDefect, '泵停机应产生压力不足疏松缺陷');
  assert.ok(report.boards.some((b) => b.defects.includes('GLUE_UNCURED')), '废品应定位到具体板材');
  assert.strictEqual(report.openDowntime.length, 0, '批次结束时不应有未恢复停机');
  const recovery = report.downtime.map((d) => ({
    equipment: d.equipment,
    reason: d.reason,
    startAt: d.startAt,
    endAt: d.endAt,
    durationS: Math.round((d.endAt - d.startAt) * 100) / 100,
    recovered: d.recovered
  }));
  return { report, triggerLog, recovery };
}

function run() {
  const results = {};
  results.normal = { report: scenarioNormal() };
  results.outOfLimit = scenarioOutOfLimit();
  results.downtime = scenarioDowntime();
  results.reset = { report: scenarioReset() };

  const summary = Object.keys(results).map((name) => {
    const r = results[name].report;
    return {
      scenario: name,
      good: r.goodCount,
      reject: r.rejectCount,
      yieldRate: r.yieldRate,
      peakPowerKW: r.peakPowerKW,
      peakPressure: r.peakPressure,
      energyKWh: r.energyKWh,
      downtimeReasons: r.downtime.map((d) => d.reason)
    };
  });
  const outDir = path.join(__dirname, '..', 'exports');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'scenario-report.json');
  fs.writeFileSync(file, JSON.stringify({ summary, results }, null, 2));
  return { summary, file };
}

function scenarioReset() {
  const sim = new Simulation();
  sim.setParam('pressure', 3.9);
  sim.setEquipment('pump', false, '模拟停机');
  for (let i = 0; i < 5; i++) sim.tick();
  sim.setEquipment('pump', true);
  const snapshot = sim.reset();
  assert.strictEqual(snapshot.finished.length, 0, '重置后成品缓存必须清空');
  assert.strictEqual(snapshot.rawRemaining, 3, '重置后原料应恢复 3 块');
  assert.strictEqual(snapshot.stations.press, null, '工位必须清空');
  assert.strictEqual(snapshot.buffers.forming.length + snapshot.buffers.preheat.length, 0, '缓存区必须清空');
  assert.strictEqual(snapshot.energyKWh, 0, '能耗必须归零');
  assert.strictEqual(snapshot.downtime.length, 0, '停机记录必须清空');
  assert.strictEqual(snapshot.params.pressure, 3.2, '参数恢复默认值');
  assert.ok(snapshot.equipment.pump.running, '设备恢复运行状态');
  const resetEvent = sim.getEvents().find((e) => e.type === 'BATCH_RESET');
  assert.ok(resetEvent, '重置本身要留痕');
  assert.strictEqual(sim.getEvents().length, 1, '旧批次事件日志不得保留');
  return sim.exportReport();
}

if (require.main === module) {
  const { summary, file } = run();
  console.log('三类场景全部断言通过');
  console.table(summary);
  console.log('详细报告已导出：' + file);
}

module.exports = { scenarioNormal, scenarioOutOfLimit, scenarioDowntime, run };
