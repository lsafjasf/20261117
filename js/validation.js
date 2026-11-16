import { BoxMachine, RECIPES, recommendedParams } from "./engine.js";

const MAX_STEPS = 40000;
const PHASE_NAMES = { feed: "送料", glue: "上胶", press: "压合", eject: "出料" };

function simulationWithIdeal() {
  const machine = new BoxMachine();
  machine.applyRecommended("S", { log: false });
  return machine;
}

function advanceUntil(machine, predicate, limit = 6000) {
  let steps = 0;
  while (!predicate() && steps < limit) {
    if (machine.mode === "paused" && !machine.changeoverPending) break;
    if (machine.mode === "paused" && machine.changeoverPending) {
      machine.applyRecommended(machine.currentSize, { log: false });
      machine.resumeBatch("验证流程自动换型");
    }
    if (machine.mode === "stopped") {
      machine.restartEquipment({ reason: "验证流程自动复位" });
    }
    if (["complete", "failed", "idle"].includes(machine.mode)) break;
    machine.update(0.05);
    steps += 1;
  }
  return steps < limit && predicate();
}

function qualityValues(values) {
  return {
    glue: values.glue,
    press: values.press,
    speed: values.speed
  };
}

function baseResult(id, name, machine) {
  return {
    id,
    name,
    passed: false,
    yieldRate: machine.yieldRate === null ? 0 : Number(machine.yieldRate.toFixed(1)),
    goodCount: machine.goodCount,
    attempts: machine.attempts,
    anomalyLocation: null,
    anomaly: null,
    recovery: null,
    triggeredAt: null,
    triggeredLabel: null,
    valuesAtTrigger: null,
    duration: 0,
    events: []
  };
}

function relatedEvents(machine) {
  return machine.logs
    .filter((entry) => ["quality", "equipment", "stop", "recovery", "handoff", "batch"].includes(entry.category))
    .slice(-18)
    .map((entry) => ({
      t: entry.t,
      category: entry.category,
      event: entry.event,
      detail: entry.detail,
      tone: entry.tone
    }));
}

export function runNormalValidation() {
  const machine = simulationWithIdeal();
  machine.startBatch({ reason: "验证：正常生产" });
  const started = machine.simTime;
  advanceUntil(machine, () => ["complete", "failed"].includes(machine.mode), MAX_STEPS);
  const result = baseResult("normal", "正常生产", machine);
  const lastQuality = machine.qualityHistory[machine.qualityHistory.length - 1];
  result.passed = machine.batchResult?.success === true && machine.goodCount === 12;
  result.triggeredAt = lastQuality?.time ?? machine.completedAt;
  result.triggeredLabel = "完成 12 件";
  result.valuesAtTrigger = lastQuality ? qualityValues(lastQuality.values) : qualityValues(machine.params);
  result.completedAt = machine.completedAt;
  result.duration = Number((machine.completedAt - started).toFixed(2));
  result.anomalyLocation = "无";
  result.recovery = {
    result: result.passed ? "无需恢复，批次通过" : "未通过",
    at: machine.completedAt,
    detail: `良品 ${machine.goodCount}/12，尝试 ${machine.attempts} 次`
  };
  result.detail = `12 件全部合格，三种盒型换型后均自动校准推荐值。`;
  result.events = relatedEvents(machine);
  return result;
}

export function runExtremeValidation() {
  const machine = new BoxMachine();
  const recipe = RECIPES.S;
  const extreme = {
    glue: Number((recipe.glue.min - 0.16).toFixed(2)),
    press: Number((recipe.press.min - 0.08).toFixed(2)),
    speed: Number((recipe.speed.max + 10).toFixed(0))
  };
  for (const [name, value] of Object.entries(extreme)) machine.setParam(name, value, { log: false });
  machine.startBatch({ reason: "验证：参数越限" });
  const started = machine.simTime;
  advanceUntil(machine, () => machine.anomalies.length >= 1);
  const anomaly = machine.anomalies[0] || null;
  const result = baseResult("extreme", "参数越限", machine);
  result.triggeredAt = anomaly?.time ?? null;
  result.triggeredLabel = "首件质量异常";
  result.valuesAtTrigger = anomaly ? qualityValues(anomaly.values) : qualityValues(machine.params);
  result.anomaly = anomaly
    ? {
        code: anomaly.code,
        label: anomaly.label,
        effect: anomaly.effect,
        location: anomaly.location,
        locations: [...new Set(anomaly.issues.map((issue) => issue.location))]
      }
    : null;
  result.anomalyLocation = result.anomaly?.locations.join(" / ") || "未捕获";

  machine.applyRecommended("S", { log: false });
  const recovered = advanceUntil(machine, () => machine.goodCount >= 1);
  const recoveryBox = machine.qualityHistory.find((item) => item.ok && item.time > (anomaly?.time ?? 0));
  result.recovery = {
    result: recovered && recoveryBox ? "恢复生产并产出合格品" : "恢复失败",
    at: recoveryBox?.time ?? null,
    values: recoveryBox ? qualityValues(recoveryBox.values) : qualityValues(machine.params)
  };
  result.yieldRate = machine.attempts ? Number(((machine.goodCount / machine.attempts) * 100).toFixed(1)) : 0;
  result.goodCount = machine.goodCount;
  result.attempts = machine.attempts;
  result.duration = Number((machine.simTime - started).toFixed(2));
  result.passed = Boolean(
    anomaly &&
      anomaly.issues.some((issue) => issue.code === "GLUE_LOW") &&
      anomaly.issues.some((issue) => issue.code === "SPEED_HIGH") &&
      recoveryBox
  );
  result.detail = anomaly
    ? `${anomaly.label}导致${anomaly.issues.map((issue) => issue.effect).join("、")}；复位至推荐值后恢复。`
    : "未触发预设越限。";
  result.events = relatedEvents(machine);
  return result;
}

export function runFaultValidation() {
  const machine = simulationWithIdeal();
  machine.startBatch({ reason: "验证：设备停机" });
  const started = machine.simTime;
  advanceUntil(machine, () => machine.phase === "press" && machine.cycleProgress > 0.55);
  const producedBefore = machine.totalProduced;
  const energyBefore = machine.energyKwh;
  const clockBefore = machine.simTime;
  const snapshot = machine.stopEquipment("自检：主轴过载", "主驱动轴");
  for (let i = 0; i < 18; i += 1) machine.update(0.1);
  const duringStop = {
    clock: machine.simTime,
    produced: machine.totalProduced,
    energy: machine.energyKwh,
    buffer: machine.bufferCount
  };
  const recovery = machine.restartEquipment({ reason: "验证：复位并恢复" });
  const recovered = advanceUntil(machine, () => machine.goodCount >= 1);
  const recoveryBox = machine.qualityHistory.find((item) => item.ok);
  const result = baseResult("fault", "设备停机", machine);
  result.triggeredAt = snapshot?.time ?? clockBefore;
  result.triggeredLabel = "主轴过载急停";
  result.valuesAtTrigger = snapshot ? qualityValues(snapshot.values) : qualityValues(machine.params);
  result.anomalyLocation = "主驱动轴";
  result.anomaly = {
    code: "EQUIPMENT_STOP",
    label: "设备停机",
    effect: "生产中断",
    location: snapshot ? "主驱动轴" : "未捕获",
    locations: ["主驱动轴"]
  };
  result.recovery = {
    result: recovered && recoveryBox ? "停机后恢复并产出合格品" : "恢复失败",
    at: recoveryBox?.time ?? null,
    restoredAt: recovery?.restoredAt ?? null,
    stoppedFor: recovery?.stoppedFor ?? null,
    values: recovery ? qualityValues(recovery.values) : qualityValues(machine.params)
  };
  result.duringStop = duringStop;
  result.yieldRate = machine.attempts ? Number(((machine.goodCount / machine.attempts) * 100).toFixed(1)) : 0;
  result.goodCount = machine.goodCount;
  result.attempts = machine.attempts;
  result.duration = Number((machine.simTime - started).toFixed(2));
  const clockAdvanced = duringStop.clock > clockBefore + 1.2;
  const productionHeld = duringStop.produced === producedBefore;
  const idleEnergyLogged = duringStop.energy > energyBefore;
  result.passed = Boolean(snapshot && clockAdvanced && productionHeld && idleEnergyLogged && recoveryBox);
  result.detail = snapshot
    ? `T+${snapshot.time.toFixed(2)}s 在${PHASE_NAMES[snapshot.phase] || snapshot.phase}相停机；共模时钟继续，产量保持 ${producedBefore}，停机 ${recovery?.stoppedFor ?? "—"}s 后恢复。`
    : "未触发停机。";
  result.events = relatedEvents(machine);
  return result;
}

export function runAllValidations() {
  const normal = runNormalValidation();
  const extreme = runExtremeValidation();
  const fault = runFaultValidation();
  return {
    runAt: new Date().toISOString(),
    passed: [normal, extreme, fault].filter((item) => item.passed).length,
    total: 3,
    results: { normal, extreme, fault }
  };
}

export const VALIDATION_RUNNERS = {
  normal: runNormalValidation,
  extreme: runExtremeValidation,
  fault: runFaultValidation
};
