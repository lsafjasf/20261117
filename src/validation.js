import {
  BATCHES,
  advance,
  createSimulation,
  currentBatch,
  exportReport,
  loadNextBatch,
  recoverEquipment,
  resetBatch,
  setParameter,
  startProduction
} from "./simulation.js";

export const SCENARIOS = Object.freeze([
  {
    id: "normal",
    category: "正常",
    name: "正常生产",
    description: "三批均使用推荐参数，验证连续检查与批次流转。"
  },
  {
    id: "parameter-limit",
    category: "故障",
    name: "参数越限",
    description: "运行中把超声时长调至质量窗口外，验证腐蚀、记录与返工恢复。"
  },
  {
    id: "equipment-stop",
    category: "故障",
    name: "设备停机",
    description: "运行中触发篮体超速联锁，验证停机原因、当前值与复位返工。"
  },
  {
    id: "extreme",
    category: "极限",
    name: "极限边界",
    description: "三批均取各自工艺窗口的上边界，验证临界通过。"
  }
]);

const round = (value, digits = 2) => Number(value.toFixed(digits));

function setParameters(sim, values) {
  for (const [key, value] of Object.entries(values)) {
    setParameter(sim, key, value, { source: "scenario" });
  }
}

function runToResult(sim) {
  advance(sim, 360);
  return sim.inspection;
}

function startAndRun(sim, values) {
  setParameters(sim, values);
  const start = startProduction(sim);
  if (!start.started) return { start, inspection: null };
  return { start, inspection: runToResult(sim) };
}

function loadNext(sim) {
  if (sim.status === "awaiting-next") loadNextBatch(sim);
}

function completeRemaining(sim, firstCompleted = false) {
  if (!firstCompleted) {
    while (sim.status === "awaiting-next") {
      loadNext(sim);
      const batch = currentBatch(sim);
      startAndRun(sim, batch.recommended);
    }
  } else {
    while (sim.status === "awaiting-next") {
      loadNext(sim);
      const batch = currentBatch(sim);
      startAndRun(sim, batch.recommended);
    }
  }
}

function cleanRun() {
  const sim = createSimulation();
  for (let index = 0; index < BATCHES.length; index += 1) {
    if (index > 0) loadNext(sim);
    const batch = currentBatch(sim);
    startAndRun(sim, batch.recommended);
  }
  return sim;
}

function scenarioBase(sim, metadata, trigger, recovery) {
  const report = exportReport(sim);
  return {
    ...metadata,
    status: sim.status,
    success: report.success,
    goodUnits: report.goodUnits,
    inspectedUnits: report.inspectedUnits,
    yieldRate: report.goodRatePercent,
    yieldText: `${report.goodUnits}/${report.inspectedUnits} · ${report.goodRatePercent}%`,
    firstPassGood: report.firstPassGood,
    endedAt: report.simClock,
    peakKw: report.peakKw,
    stopCount: report.stopCount,
    stopReasons: report.stopReasons,
    anomalies: report.anomalies,
    batchResults: report.batchResults,
    trigger,
    recovery,
    clockAudit: {
      production: round(sim.production.lastUpdate),
      energy: round(sim.energy.lastUpdate),
      cache: round(sim.cache.lastUpdate),
      sharedClock: round(sim.clock)
    }
  };
}

function runNormal() {
  const sim = cleanRun();
  const checks = [
    {
      label: "三批检查合格",
      passed:
        sim.status === "complete" &&
        sim.production.goodUnits === 3 &&
        sim.production.failedInspections === 0
    },
    {
      label: "共享时钟一致",
      passed:
        sim.production.lastUpdate === sim.clock &&
        sim.energy.lastUpdate === sim.clock &&
        sim.cache.lastUpdate === sim.clock
    }
  ];
  return scenarioBase(
    sim,
    {
      id: "normal",
      name: "正常生产",
      category: "正常",
      passed: checks.every((check) => check.passed),
      checks
    },
    null,
    null
  );
}

function runParameterLimit() {
  const sim = createSimulation();
  startAndRunPartial(sim, BATCHES[0].recommended, 4);
  setParameter(sim, "duration", 66, { source: "scenario" });
  const warning = [...sim.events]
    .reverse()
    .find((event) => event.type === "quality-limit" && event.parameter === "duration");
  const failed = runToResult(sim);
  const recoveryAt = sim.clock;
  resetBatch(sim, { reason: "scenario-requalify" });
  const recovered = startAndRun(sim, BATCHES[0].recommended).inspection;
  const recoveryPassed = Boolean(recovered?.passed);
  completeRemaining(sim, true);
  const checks = [
    { label: "越限被捕获", passed: Boolean(warning) },
    { label: "越限批次判废", passed: failed?.passed === false },
    { label: "返工恢复合格", passed: recoveryPassed },
    { label: "恢复后可完成三批", passed: sim.production.goodUnits === 3 }
  ];
  return scenarioBase(
    sim,
    {
      id: "parameter-limit",
      name: "参数越限",
      category: "故障",
      passed: checks.every((check) => check.passed),
      checks
    },
    warning
      ? {
          type: "parameter-window-exceeded",
          at: warning.at,
          parameter: warning.parameter,
          values: warning.values,
          limit: { min: warning.min, max: warning.max },
          result: failed?.reason
        }
      : null,
    {
      attempted: true,
      at: round(recoveryAt),
      action: "返工当前批次",
      result: recoveryPassed ? "pass" : "fail",
      inspection: recovered
    }
  );
}

function startAndRunPartial(sim, values, seconds) {
  setParameters(sim, values);
  const started = startProduction(sim);
  if (started.started) advance(sim, seconds);
  return started;
}

function runEquipmentStop() {
  const sim = createSimulation();
  startAndRunPartial(sim, BATCHES[0].recommended, 6);
  setParameter(sim, "rpm", 1500, { source: "scenario" });
  const fault = structuredClone(sim.fault);
  const recoveryAt = Number(fault?.at ?? sim.clock);
  const recovery = recoverEquipment(sim);
  const recovered = startAndRun(sim, BATCHES[0].recommended).inspection;
  const recoveryPassed = Boolean(recovery.recovered && recovered?.passed);
  completeRemaining(sim, true);
  const checks = [
    { label: "联锁立即停机", passed: fault?.code === "BASKET_OVERLOAD" },
    { label: "全部设备已停止", passed: sim.events.some((event) => event.type === "equipment-stop") },
    { label: "复位后当前批次返工合格", passed: recoveryPassed },
    { label: "恢复后可完成三批", passed: sim.production.goodUnits === 3 }
  ];
  return scenarioBase(
    sim,
    {
      id: "equipment-stop",
      name: "设备停机",
      category: "故障",
      passed: checks.every((check) => check.passed),
      checks
    },
    fault
      ? {
          type: "equipment-interlock",
          at: fault.at,
          code: fault.code,
          message: fault.message,
          location: fault.location,
          values: fault.values
        }
      : null,
    {
      attempted: true,
      at: round(recoveryAt),
      action: "安全复位并返工当前批次",
      result: recoveryPassed ? "pass" : "fail",
      values: recovery.fault?.recoveryResult?.values,
      inspection: recovered
    }
  );
}

function boundaryValues(batch) {
  return {
    duration: batch.window.duration[1],
    temp: batch.window.temp[1],
    rpm: batch.window.rpm[1]
  };
}

function runExtreme() {
  const sim = createSimulation();
  const boundaryValuesByBatch = {};
  for (let index = 0; index < BATCHES.length; index += 1) {
    if (index > 0) loadNext(sim);
    const batch = currentBatch(sim);
    const values = boundaryValues(batch);
    boundaryValuesByBatch[batch.id] = values;
    startAndRun(sim, values);
  }
  const checks = [
    {
      label: "上边界三批全部合格",
      passed:
        sim.status === "complete" &&
        sim.production.goodUnits === 3 &&
        sim.production.failedInspections === 0
    },
    {
      label: "极限值未触发联锁",
      passed: sim.stops.length === 0
    }
  ];
  return scenarioBase(
    sim,
    {
      id: "extreme",
      name: "极限边界",
      category: "极限",
      passed: checks.every((check) => check.passed),
      checks,
      boundaryValues: boundaryValuesByBatch
    },
    {
      type: "process-upper-boundary",
      at: 0,
      values: boundaryValuesByBatch,
      result: "三批均处于窗口上边界并通过检查"
    },
    null
  );
}

export function runScenario(id) {
  if (id === "normal") return runNormal();
  if (id === "parameter-limit") return runParameterLimit();
  if (id === "equipment-stop") return runEquipmentStop();
  if (id === "extreme") return runExtreme();
  throw new Error(`Unknown scenario: ${id}`);
}

export function runAllScenarios() {
  return SCENARIOS.map((scenario) => runScenario(scenario.id));
}

export function buildFullReport(sim, scenarios = []) {
  return exportReport(sim, { scenarios });
}
