import { BATCH_TARGET_KG, FIXED_STEP, RECIPES } from "./config.js";
import { FlourSimulation } from "./simulation.js";

function fail(message, sim) {
  throw new Error(`${message} @ t=${sim.clock.toFixed(1)}s, phase=${sim.phase}`);
}

function runUntil(sim, predicate, label, maxSteps = 30000) {
  for (let index = 0; index < maxSteps; index += 1) {
    if (predicate(sim)) return;
    sim.advance(FIXED_STEP);
  }
  fail(`等待超时：${label}`, sim);
}

function prepareBatch(sim, { recipeId, speeds, mixTime }) {
  if (recipeId !== sim.recipeId) {
    if (!sim.selectRecipe(recipeId)) fail(`无法切换配方 ${recipeId}`, sim);
  }
  if (sim.purgeRequired) {
    if (!sim.clearLine()) fail("无法执行清线", sim);
    runUntil(sim, (state) => !state.purgeInProgress, "换配料清线");
  }
  if (!sim.setSpeeds(speeds)) fail("设置螺旋速度失败", sim);
  if (!sim.setMixTime(mixTime)) fail("设置混合时间失败", sim);
  if (!sim.startDosing()) fail("启动配料失败", sim);
}

function settleAndDump(sim) {
  runUntil(sim, (state) => state.phase === "weighing" || state.phase === "stopped", "称重稳定");
  if (sim.phase === "stopped") fail("称重阶段意外停机", sim);
  if (!sim.openWeighGate()) fail("打开称重门失败", sim);
  runUntil(sim, (state) => state.phase === "mix_ready" || state.phase === "stopped", "称重斗卸料");
  if (sim.phase === "stopped") fail("卸料阶段意外停机", sim);
}

function mixAndPack(sim) {
  if (!sim.startMixing()) fail("启动混合失败", sim);
  runUntil(sim, (state) => state.phase === "mix_done" || state.phase === "stopped", "完成混合");
  if (sim.phase === "stopped") fail("混合阶段意外停机", sim);
  if (!sim.dischargeBatch()) fail("批次出料失败", sim);
  runUntil(sim, (state) => ["batch_done", "success"].includes(state.phase), "包装入仓结算");
}

function finishDosing(sim) {
  runUntil(sim, (state) => state.phase === "settling" || state.phase === "stopped", "配料达到称重目标");
  if (sim.phase === "stopped") fail("配料阶段意外停机", sim);
}

function compactTriggers(sim) {
  return sim.anomalies.map((item) => ({
    kind: item.kind,
    location: item.location,
    detail: item.detail,
    at: item.at,
    values: item.values,
    recoveredAt: item.recoveredAt,
    recovery: item.recovery
  }));
}

function summarize(name, sim, passed, checks, extra = {}) {
  const report = sim.exportReport();
  const summary = {
    scenario: name,
    passed,
    checks,
    simClock: report.simClock,
    goodBatches: report.goodBatches,
    totalBatches: report.totalBatches,
    goodRate: report.goodRate,
    goodKg: report.goodKg,
    peakPowerKw: report.peakPowerKw,
    energyKwh: report.energyKwh,
    wasteKg: report.wasteKg,
    success: report.success,
    stops: report.stops,
    triggers: compactTriggers(sim),
    exceptionLocations: [...new Set(sim.anomalies.map((item) => item.location))],
    batches: report.batches.map((batch) => ({
      no: batch.no,
      recipeId: batch.recipeId,
      result: batch.result,
      totalKg: batch.totalKg,
      reasons: batch.reasons,
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt
    })),
    ...extra
  };
  Object.defineProperty(summary, "_report", {
    value: report,
    enumerable: false
  });
  return summary;
}

export function runNormalScenario() {
  const sim = new FlourSimulation({ silent: true });
  prepareBatch(sim, { recipeId: "R1", speeds: [50, 30, 20], mixTime: 20 });
  finishDosing(sim);
  settleAndDump(sim);
  mixAndPack(sim);

  prepareBatch(sim, { recipeId: "R2", speeds: [25, 40, 35], mixTime: 20 });
  finishDosing(sim);
  settleAndDump(sim);
  mixAndPack(sim);

  prepareBatch(sim, { recipeId: "R1", speeds: [50, 30, 20], mixTime: 20 });
  finishDosing(sim);
  settleAndDump(sim);
  mixAndPack(sim);

  const allGood = sim.batches.length === 3 && sim.batches.every((batch) => batch.result === "good");
  const ratiosValid = sim.batches.every((batch) =>
    batch.checks.every((check) => check.errPct <= 2.001) &&
    Math.abs(batch.totalKg - BATCH_TARGET_KG) <= BATCH_TARGET_KG * 0.02 + 0.01
  );
  const checks = [
    { name: "三批全部合格", passed: allGood },
    { name: "总重与比例在 2% 容差内", passed: ratiosValid },
    { name: "达到成功条件", passed: sim.success }
  ];
  return summarize("正常生产", sim, allGood && ratiosValid && sim.success, checks);
}

export function runLimitScenario() {
  const sim = new FlourSimulation({ silent: true });
  const speedReject = sim.setScrewSpeed(0, -10);
  const speedRecover = sim.setScrewSpeed(0, 100);
  const mixReject = sim.setMixTime(120);
  const mixRecover = sim.setMixTime(20);
  const speedAnomaly = sim.anomalies.find((item) => item.location.includes("高筋粉螺旋"));
  const mixAnomaly = sim.anomalies.find((item) => item.location.includes("混合时间"));

  prepareBatch(sim, { recipeId: "R1", speeds: [100, 60, 20], mixTime: 20 });
  finishDosing(sim);
  const gateRejected = !sim.openWeighGate();
  const gateAnomaly = sim.anomalies.find((item) => item.location.includes("称重门联锁"));
  runUntil(sim, (state) => state.phase === "weighing", "高速振荡衰减");
  if (!sim.openWeighGate()) fail("稳定后仍无法打开称重门", sim);
  runUntil(sim, (state) => state.phase === "mix_ready", "称重斗卸料");
  mixAndPack(sim);
  const firstResult = sim.batches[0];

  prepareBatch(sim, { recipeId: "R1", speeds: [50, 30, 20], mixTime: 20 });
  finishDosing(sim);
  settleAndDump(sim);
  mixAndPack(sim);

  prepareBatch(sim, { recipeId: "R1", speeds: [50, 30, 20], mixTime: 20 });
  finishDosing(sim);
  settleAndDump(sim);
  mixAndPack(sim);

  const checks = [
    { name: "负转速被拒绝并记录", passed: !speedReject && Boolean(speedAnomaly) },
    { name: "合法转速恢复记录", passed: speedRecover && speedAnomaly?.recoveredAt !== null },
    { name: "超长混合时间被拒绝", passed: !mixReject && Boolean(mixAnomaly) },
    { name: "合法混合时间恢复记录", passed: mixRecover && mixAnomaly?.recoveredAt !== null },
    { name: "高速振荡阻止开秤门", passed: gateRejected && Boolean(gateAnomaly) },
    { name: "错误配比整批报废", passed: firstResult?.result === "scrap" },
    { name: "后续两批恢复为良品", passed: sim.goodBatches === 2 }
  ];
  return summarize("参数越限", sim, checks.every((check) => check.passed), checks);
}

export function runFaultScenario() {
  const sim = new FlourSimulation({ silent: true });

  prepareBatch(sim, { recipeId: "R1", speeds: [50, 30, 20], mixTime: 20 });
  runUntil(sim, (state) => state.clock >= 5, "配料运行至故障点");
  const preservedAtScrewFault = sim.weigh.trueKg;
  if (!sim.injectFault("screwB", "卡料")) fail("无法注入中筋粉螺旋卡料", sim);
  const screwStop = sim.stops.at(-1);
  sim.advance(1);
  if (!sim.repairDevice("screwB")) fail("无法修复中筋粉螺旋", sim);
  if (!sim.resumeProduction()) fail("无法恢复配料批次", sim);
  if (sim.weigh.trueKg < preservedAtScrewFault - 0.001) fail("故障恢复丢失批次物料", sim);
  finishDosing(sim);
  settleAndDump(sim);
  mixAndPack(sim);

  prepareBatch(sim, { recipeId: "R1", speeds: [50, 30, 20], mixTime: 20 });
  finishDosing(sim);
  settleAndDump(sim);
  if (!sim.startMixing()) fail("无法启动第二批混合", sim);
  runUntil(sim, (state) => state.mixer.mixElapsed >= 5, "混合运行至故障点");
  const preservedMixElapsed = sim.mixer.mixElapsed;
  const preservedMixerKg = sim.mixer.totalKg;
  if (!sim.injectFault("mixer", "过载")) fail("无法注入混合机过载", sim);
  const mixerStop = sim.stops.at(-1);
  sim.advance(0.8);
  if (!sim.repairDevice("mixer")) fail("无法修复混合机", sim);
  if (!sim.resumeProduction()) fail("无法恢复当前混合批次", sim);
  if (sim.mixer.mixElapsed < preservedMixElapsed - 0.001) fail("混合进度回退", sim);
  if (sim.mixer.totalKg < preservedMixerKg - 0.002) fail("混合物料丢失", sim);
  runUntil(sim, (state) => state.phase === "mix_done", "恢复后完成混合");
  if (!sim.dischargeBatch()) fail("恢复批次出料失败", sim);
  runUntil(sim, (state) => ["batch_done", "success"].includes(state.phase), "恢复批次入仓");

  prepareBatch(sim, { recipeId: "R1", speeds: [50, 30, 20], mixTime: 20 });
  finishDosing(sim);
  settleAndDump(sim);
  mixAndPack(sim);

  const recovered = sim.anomalies
    .filter((item) => item.kind === "equipment_stop")
    .every((item) => item.recoveredAt !== null && item.recovery);
  const checks = [
    { name: "螺旋卡料触发停机", passed: Boolean(screwStop) && screwStop.values.batchKg > 0 },
    { name: "螺旋停机时记录设定值与批次值", passed: screwStop?.values.setpoint === 30 },
    { name: "混合机过载触发停机", passed: Boolean(mixerStop) && mixerStop.values.mixElapsed > 0 },
    { name: "故障均已记录恢复结果", passed: recovered },
    { name: "当前批次恢复且三批良品", passed: sim.goodBatches === 3 && sim.success }
  ];
  return summarize("设备停机", sim, checks.every((check) => check.passed), checks);
}

export function runAllScenarios() {
  const scenarios = [runNormalScenario(), runLimitScenario(), runFaultScenario()];
  return {
    generatedAt: new Date().toISOString(),
    passed: scenarios.every((item) => item.passed),
    scenarios
  };
}

export function recipeSummary(recipeId) {
  return RECIPES[recipeId];
}
