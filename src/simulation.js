export const FIXED_STEP = 0.1;

export const HARD_LIMITS = Object.freeze({
  duration: 80,
  temp: 72,
  rpm: 1450
});

export const PARAMETER_META = Object.freeze({
  duration: { label: "超声时长", unit: "s", min: 20, max: 85, step: 1 },
  temp: { label: "槽液温度", unit: "°C", min: 30, max: 75, step: 1 },
  rpm: { label: "篮体转速", unit: "rpm", min: 400, max: 1600, step: 10 }
});

export const BATCHES = Object.freeze([
  {
    id: "B-01",
    name: "精密齿轮",
    oil: "轻质切削油",
    oilLoad: 100,
    cleanFactor: 1,
    recommended: { duration: 40, temp: 50, rpm: 900 },
    window: { duration: [28, 56], temp: [40, 62], rpm: [600, 1350] },
    corrosionDuration: 54
  },
  {
    id: "B-02",
    name: "液压轴套",
    oil: "中粘度防锈油",
    oilLoad: 112,
    cleanFactor: 0.9,
    recommended: { duration: 46, temp: 54, rpm: 1000 },
    window: { duration: [32, 58], temp: [43, 64], rpm: [650, 1300] },
    corrosionDuration: 56
  },
  {
    id: "B-03",
    name: "不锈钢阀体",
    oil: "重质拉伸油",
    oilLoad: 126,
    cleanFactor: 0.8,
    recommended: { duration: 54, temp: 58, rpm: 1100 },
    window: { duration: [40, 60], temp: [45, 64], rpm: [700, 1250] },
    corrosionDuration: 58
  }
]);

export const QUALITY_LIMITS = Object.freeze({
  residue: 15,
  corrosion: 12,
  rust: 12
});

export const STAGE_DURATIONS = Object.freeze({ rinse: 6, drying: 9 });

export const EQUIPMENT = Object.freeze(["ultrasonic", "pump", "heater", "basket", "fan"]);

const POWER = Object.freeze({
  idle: 0.18,
  ultrasonic: 3.6,
  rinse: 2.2,
  drying: 2.8
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 1) => Number(value.toFixed(digits));

function freshBatchState() {
  return {
    residue: 0,
    corrosion: 0,
    rust: 0,
    wetness: 0
  };
}

function initialState() {
  const quality = freshBatchState();
  quality.residue = BATCHES[0].oilLoad;
  return {
    clock: 0,
    tick: 0,
    status: "idle",
    stage: "idle",
    stageElapsed: 0,
    stageDuration: 0,
    batchIndex: 0,
    attempt: 1,
    parameters: { duration: 40, temp: 50, rpm: 900 },
    quality,
    inspection: null,
    fault: null,
    sessionEpoch: 1,
    batchStartedAt: null,
    production: {
      goodUnits: 0,
      inspectedUnits: 0,
      failedInspections: 0,
      firstPassGood: 0,
      batchResults: [],
      lastUpdate: 0
    },
    energy: {
      totalKwh: 0,
      peakKw: 0,
      currentKw: 0,
      bySource: { ultrasonic: 0, pump: 0, heater: 0, basket: 0, fan: 0 },
      lastUpdate: 0
    },
    cache: {
      entries: [],
      hits: 0,
      lastUpdate: 0,
      lastSampleAt: -1,
      plan: null
    },
    stops: [],
    violations: [],
    events: [],
    activeEquipment: []
  };
}

export function createSimulation() {
  return initialState();
}

export function currentBatch(sim) {
  return BATCHES[sim.batchIndex];
}

export function qualityLimits(batch = null) {
  return {
    residue: QUALITY_LIMITS.residue * (batch ? batch.oilLoad / 100 : 1),
    corrosion: QUALITY_LIMITS.corrosion,
    rust: QUALITY_LIMITS.rust
  };
}

function formatClock(clock) {
  return `${clock.toFixed(2)}s`;
}

function addEvent(sim, type, detail = {}) {
  const event = {
    id: sim.events.length + 1,
    at: round(sim.clock, 2),
    clock: formatClock(sim.clock),
    type,
    batch: currentBatch(sim)?.id ?? null,
    attempt: sim.attempt,
    ...detail
  };
  sim.events.push(event);
  return event;
}

export function getSnapshot(sim) {
  return {
    ...structuredClone(sim),
    batch: currentBatch(sim),
    yieldRate: sim.production.inspectedUnits
      ? sim.production.goodUnits / sim.production.inspectedUnits
      : 0
  };
}

export function getBatchWindow(batch = currentBatch()) {
  if (!batch) return null;
  return {
    duration: batch.window.duration,
    temp: batch.window.temp,
    rpm: batch.window.rpm
  };
}

export function detectWindowViolations(sim) {
  const batch = currentBatch(sim);
  if (!batch) return [];
  const issues = [];
  for (const key of ["duration", "temp", "rpm"]) {
    const [min, max] = batch.window[key];
    const value = sim.parameters[key];
    if (value < min || value > max) {
      issues.push({
        key,
        label: PARAMETER_META[key].label,
        value,
        min,
        max,
        side: value < min ? "below" : "above"
      });
    }
  }
  return issues;
}

export function describeProcessWindow(batch = currentBatch()) {
  const window = getBatchWindow(batch);
  if (!window) return "";
  return `时长 ${window.duration[0]}–${window.duration[1]}s · 温度 ${window.temp[0]}–${window.temp[1]}°C · 转速 ${window.rpm[0]}–${window.rpm[1]}rpm`;
}

function stageEquipment(stage) {
  if (stage === "ultrasonic") return ["heater", "pump", "basket", "ultrasonic"];
  if (stage === "rinse") return ["pump", "basket", "heater"];
  if (stage === "drying") return ["fan", "heater", "basket"];
  return [];
}

function startEquipment(sim, names) {
  for (const name of names) {
    if (sim.activeEquipment.includes(name)) continue;
    sim.activeEquipment.push(name);
    addEvent(sim, "equipment-start", {
      equipment: name,
      batch: currentBatch(sim)?.id,
      stage: sim.stage
    });
  }
}

function stopEquipment(
  sim,
  names,
  reason = "cycle-end",
  location = null,
  stage = sim.stage
) {
  for (const name of names) {
    const index = sim.activeEquipment.indexOf(name);
    if (index === -1) continue;
    sim.activeEquipment.splice(index, 1);
    addEvent(sim, "equipment-stop", {
      equipment: name,
      batch: currentBatch(sim)?.id,
      stage,
      reason,
      location
    });
  }
}

function stopAllEquipment(sim, reason, location = null) {
  stopEquipment(sim, [...sim.activeEquipment], reason, location, sim.stage);
}

function switchEquipment(sim, nextStage, reason = "stage-change", previousStage = sim.stage) {
  const next = stageEquipment(nextStage);
  stopEquipment(
    sim,
    sim.activeEquipment.filter((name) => !next.includes(name)),
    reason,
    null,
    previousStage
  );
  startEquipment(sim, next);
}

function recordViolation(sim, issue, kind = "quality-window") {
  const violation = {
    id: sim.violations.length + 1,
    at: round(sim.clock, 2),
    kind,
    ...issue,
    values: { ...sim.parameters }
  };
  sim.violations.push(violation);
  addEvent(sim, kind === "hard-limit" ? "hard-limit" : "quality-limit", {
    parameter: issue.key,
    ...violation
  });
  return violation;
}

function checkQualityWindow(sim, { log = true } = {}) {
  const issues = detectWindowViolations(sim);
  if (log) issues.forEach((issue) => recordViolation(sim, issue, "quality-window"));
  return issues;
}

function hardLimitIssue(sim) {
  for (const key of ["duration", "temp", "rpm"]) {
    if (sim.parameters[key] > HARD_LIMITS[key]) {
      return {
        key,
        label: PARAMETER_META[key].label,
        value: sim.parameters[key],
        limit: HARD_LIMITS[key]
      };
    }
  }
  return null;
}

function faultDefinition(key) {
  if (key === "rpm") {
    return {
      code: "BASKET_OVERLOAD",
      message: "篮体驱动过载，安全联锁停机",
      location: "篮体驱动总成 / 变频器"
    };
  }
  if (key === "temp") {
    return {
      code: "OVER_TEMPERATURE",
      message: "槽液超温，加热联锁停机",
      location: "超声槽 / 加热器"
    };
  }
  return {
    code: "CYCLE_OVERRUN",
    message: "超声周期超过设备额定，联锁停机",
    location: "超声发生器 / 槽体"
  };
}

export function triggerFault(sim, issue, stage = sim.stage) {
  if (sim.status === "fault") return sim.fault;
  const definition = faultDefinition(issue.key);
  sim.status = "fault";
  sim.fault = {
    code: definition.code,
    message: definition.message,
    location: definition.location,
    at: round(sim.clock, 2),
    clock: formatClock(sim.clock),
    stage,
    issue,
    values: { ...sim.parameters },
    equipment: [...sim.activeEquipment],
    recoveryResult: null
  };
  sim.stops.push({
    at: sim.fault.at,
    code: definition.code,
    reason: definition.message,
    location: definition.location,
    values: { ...sim.parameters }
  });
  if (issue.key) recordViolation(sim, issue, "hard-limit");
  stopAllEquipment(sim, definition.code, definition.location);
  sim.energy.currentKw = 0;
  addEvent(sim, "equipment-fault", {
    code: definition.code,
    reason: definition.message,
    location: definition.location,
    values: { ...sim.parameters }
  });
  return sim.fault;
}

export function setParameter(sim, key, rawValue, { source = "operator" } = {}) {
  if (!(key in sim.parameters)) throw new Error(`Unknown parameter: ${key}`);
  if (sim.status === "complete") return { accepted: false, reason: "session-complete" };
  const meta = PARAMETER_META[key];
  const value = clamp(Number(rawValue), meta.min, meta.max);
  const previous = sim.parameters[key];
  if (!Number.isFinite(value) || value === previous) return { accepted: false, value: previous };
  sim.parameters[key] = value;
  if (sim.stage === "ultrasonic" && key === "duration" && sim.status !== "fault") {
    sim.stageDuration = Math.max(sim.stageElapsed, value);
  }
  addEvent(sim, "parameter-change", {
    parameter: key,
    label: meta.label,
    previous,
    value,
    values: { ...sim.parameters },
    source
  });

  if (sim.status === "running" || sim.status === "paused") {
    const issues = detectWindowViolations(sim);
    const issue = issues.find((item) => item.key === key);
    if (issue) recordViolation(sim, issue, "quality-window");
    const hardIssue = hardLimitIssue(sim);
    if (hardIssue) triggerFault(sim, hardIssue);
  }
  return { accepted: true, value };
}

function resetAttemptQuality(sim) {
  sim.quality = freshBatchState();
  sim.quality.residue = currentBatch(sim).oilLoad;
  sim.inspection = null;
  sim.stageElapsed = 0;
  sim.stageDuration = 0;
  sim.batchStartedAt = null;
}

export function startProduction(sim) {
  if (sim.status !== "idle") {
    return { started: false, reason: `Cannot start from ${sim.status}` };
  }
  const hardIssue = hardLimitIssue(sim);
  if (hardIssue) {
    triggerFault(sim, hardIssue, "preflight");
    return { started: false, reason: "hard-limit", fault: sim.fault };
  }
  resetAttemptQuality(sim);
  sim.batchStartedAt = sim.clock;
  sim.status = "running";
  sim.stage = "ultrasonic";
  sim.stageElapsed = 0;
  sim.stageDuration = sim.parameters.duration;
  checkQualityWindow(sim);
  addEvent(sim, "production-start", {
    stage: sim.stage,
    values: { ...sim.parameters }
  });
  switchEquipment(sim, "ultrasonic", "production-start");
  return { started: true, at: sim.clock, stage: sim.stage };
}

export function pauseSimulation(sim) {
  if (sim.status !== "running") return { paused: false, status: sim.status };
  sim.status = "paused";
  addEvent(sim, "simulation-pause", {
    stage: sim.stage,
    values: { ...sim.parameters }
  });
  return { paused: true, at: sim.clock };
}

export function resumeSimulation(sim) {
  if (sim.status !== "paused") return { resumed: false, status: sim.status };
  sim.status = "running";
  addEvent(sim, "simulation-resume", {
    stage: sim.stage,
    values: { ...sim.parameters }
  });
  return { resumed: true, at: sim.clock };
}

export function stepSimulation(sim, seconds = 0.5) {
  if (sim.status !== "paused") {
    return { stepped: false, reason: "pause-first", at: sim.clock };
  }
  const from = sim.clock;
  sim.status = "running";
  advanceInternal(sim, Math.max(0.1, Number(seconds) || 0.5));
  if (sim.status === "running") sim.status = "paused";
  addEvent(sim, "simulation-step", {
    from: round(from, 2),
    to: round(sim.clock, 2),
    stage: sim.stage
  });
  return { stepped: true, at: sim.clock, status: sim.status };
}

export function resetBatch(sim, { reason = "operator-reset" } = {}) {
  if (sim.status === "complete") {
    return { reset: false, reason: "session-complete" };
  }
  const batch = currentBatch(sim);
  stopAllEquipment(sim, "batch-reset");
  addEvent(sim, "batch-reset", {
    batch: batch.id,
    reason,
    values: { ...sim.parameters }
  });
  sim.status = "idle";
  sim.stage = "idle";
  sim.attempt += 1;
  sim.fault = null;
  sim.parameters = { ...batch.recommended };
  resetAttemptQuality(sim);
  return { reset: true, at: sim.clock, batch: batch.id, attempt: sim.attempt };
}

export function recoverEquipment(sim) {
  if (sim.status !== "fault") {
    return { recovered: false, reason: `Cannot recover from ${sim.status}` };
  }
  const batch = currentBatch(sim);
  const fault = sim.fault;
  sim.parameters = { ...batch.recommended };
  sim.attempt += 1;
  sim.quality.residue = batch.oilLoad;
  sim.stage = "idle";
  sim.stageElapsed = 0;
  sim.stageDuration = 0;
  sim.batchStartedAt = null;
  sim.status = "idle";
  sim.fault = null;
  fault.recoveryResult = {
    result: "ready",
    at: round(sim.clock, 2),
    batch: batch.id,
    attempt: sim.attempt,
    values: { ...sim.parameters },
    message: "安全联锁已复位，当前批次可从清洗起点返工"
  };
  addEvent(sim, "equipment-recover", {
    faultCode: fault.code,
    batch: batch.id,
    attempt: sim.attempt,
    values: { ...sim.parameters },
    result: "ready"
  });
  return { recovered: true, at: sim.clock, batch: batch.id, fault };
}

export function resetSession(sim) {
  const next = initialState();
  next.sessionEpoch = sim.sessionEpoch + 1;
  for (const key of Object.keys(sim)) delete sim[key];
  Object.assign(sim, next);
  addEvent(sim, "session-reset", {
    cacheCleared: true,
    values: { ...sim.parameters }
  });
  return sim;
}

export function loadNextBatch(sim) {
  if (sim.status !== "awaiting-next") {
    return { loaded: false, reason: `Cannot load next from ${sim.status}` };
  }
  sim.batchIndex += 1;
  sim.attempt = 1;
  sim.status = "idle";
  sim.stage = "idle";
  sim.inspection = null;
  sim.parameters = { ...currentBatch(sim).recommended };
  resetAttemptQuality(sim);
  addEvent(sim, "batch-loaded", {
    batch: currentBatch(sim).id,
    values: { ...sim.parameters }
  });
  return { loaded: true, batch: currentBatch(sim), at: sim.clock };
}

function getQualityIssues(sim, batch) {
  const limits = qualityLimits(batch);
  const quality = sim.quality;
  const issues = [];
  if (quality.residue > limits.residue) {
    issues.push({
      type: "residue",
      label: "油污残留",
      value: round(quality.residue),
      limit: round(limits.residue),
      location: "槽体液流死角 / 工件盲孔"
    });
  }
  if (quality.corrosion > limits.corrosion) {
    issues.push({
      type: "corrosion",
      label: "表面腐蚀",
      value: round(quality.corrosion),
      limit: round(limits.corrosion),
      location: "超声槽加热区 / 工件表面"
    });
  }
  if (quality.rust > limits.rust) {
    issues.push({
      type: "rust",
      label: "烘干不足生锈",
      value: round(quality.rust),
      limit: round(limits.rust),
      location: "烘干腔 / 工件表面水膜"
    });
  }
  return issues;
}

function worstIssue(issues) {
  if (!issues.length) return null;
  return [...issues].sort((a, b) => b.value / b.limit - a.value / a.limit)[0];
}

export function inspectBatch(sim) {
  if (sim.status !== "running") {
    return { inspected: false, reason: `Cannot inspect from ${sim.status}` };
  }
  stopAllEquipment(sim, "inspection");
  sim.energy.currentKw = 0;
  sim.stage = "inspection";
  sim.quality.residue = Math.max(0, sim.quality.residue);
  sim.quality.corrosion = Math.max(0, sim.quality.corrosion);
  sim.quality.rust = Math.max(0, sim.quality.rust);
  const batch = currentBatch(sim);
  const issues = getQualityIssues(sim, batch);
  const passed = issues.length === 0;
  const anomaly = worstIssue(issues);
  const cachedSample = [...sim.cache.entries]
    .reverse()
    .find((entry) => entry.kind === "telemetry");
  if (cachedSample) sim.cache.hits += 1;
  const result = {
    batchId: batch.id,
    batchName: batch.name,
    at: round(sim.clock, 2),
    clock: formatClock(sim.clock),
    attempt: sim.attempt,
    passed,
    reason: passed ? "检查合格" : issues.map((issue) => issue.label).join("、"),
    issues,
    anomalyLocation: anomaly?.location ?? null,
    metrics: {
      residue: round(sim.quality.residue),
      corrosion: round(sim.quality.corrosion),
      rust: round(sim.quality.rust)
    },
    cacheHit: Boolean(cachedSample),
    cacheSampleAt: cachedSample?.at ?? null,
    parameters: { ...sim.parameters }
  };
  sim.inspection = result;
  sim.production.inspectedUnits += 1;
  sim.production.lastUpdate = sim.clock;
  sim.production.batchResults.push(result);
  if (passed) {
    sim.production.goodUnits += 1;
    if (sim.attempt === 1) sim.production.firstPassGood += 1;
  } else {
    sim.production.failedInspections += 1;
  }
  sim.cache.entries.push({
    at: round(sim.clock, 2),
    kind: "inspection",
    batch: batch.id,
    passed,
    metrics: result.metrics
  });
  sim.cache.lastUpdate = sim.clock;
  addEvent(sim, "batch-result", {
    batch: batch.id,
    passed,
    reason: result.reason,
    metrics: result.metrics,
    anomalyLocation: result.anomalyLocation
  });
  if (!passed) {
    sim.status = "inspection";
  } else if (sim.batchIndex === BATCHES.length - 1) {
    sim.status = "complete";
    addEvent(sim, "session-complete", {
      goodUnits: sim.production.goodUnits,
      inspectedUnits: sim.production.inspectedUnits
    });
  } else {
    sim.status = "awaiting-next";
  }
  return result;
}

function removalRate(sim, batch) {
  return (
    1.25 +
    Math.max(0, sim.parameters.temp - 40) * 0.028 +
    sim.parameters.rpm * 0.00085
  ) * batch.cleanFactor;
}

function corrosionRate(sim, batch) {
  return (
    Math.max(0, sim.parameters.temp - 62) * 0.018 +
    Math.max(0, sim.parameters.rpm - 1200) * 0.0009 +
    Math.max(0, sim.parameters.duration - batch.corrosionDuration) * 0.02
  );
}

function updateQuality(sim, dt) {
  const batch = currentBatch(sim);
  if (sim.stage === "ultrasonic") {
    sim.quality.residue = Math.max(0, sim.quality.residue - removalRate(sim, batch) * dt);
    sim.quality.corrosion += corrosionRate(sim, batch) * dt;
  } else if (sim.stage === "rinse") {
    const rinseRate = 0.8 + Math.max(0, sim.parameters.temp - 35) * 0.025;
    sim.quality.residue = Math.max(0, sim.quality.residue - rinseRate * dt);
    sim.quality.corrosion += corrosionRate(sim, batch) * dt * 0.35;
  } else if (sim.stage === "drying") {
    const dryRate =
      6.5 +
      Math.max(0, sim.parameters.temp - 36) * 0.7 +
      sim.parameters.rpm * 0.001;
    sim.quality.wetness = Math.max(0, sim.quality.wetness - dryRate * dt);
    if (sim.quality.wetness > 8) {
      sim.quality.rust +=
        dt * Math.max(0, 42 - sim.parameters.temp) * 0.28;
    }
  }
}

function powerForStage(stage) {
  return POWER[stage] ?? POWER.idle;
}

function powerSplit(stage) {
  if (stage === "ultrasonic") {
    return { ultrasonic: 0.48, heater: 0.28, pump: 0.16, basket: 0.08, fan: 0 };
  }
  if (stage === "rinse") {
    return { ultrasonic: 0, heater: 0.33, pump: 0.42, basket: 0.25, fan: 0 };
  }
  if (stage === "drying") {
    return { ultrasonic: 0, heater: 0.35, pump: 0, basket: 0.15, fan: 0.5 };
  }
  return { ultrasonic: 0, heater: 0, pump: 0, basket: 0, fan: 0 };
}

function updateEnergy(sim, dt) {
  const kw = sim.stage === "idle" ? POWER.idle * 0.2 : powerForStage(sim.stage);
  const kwh = (kw * dt) / 3600;
  const split = powerSplit(sim.stage);
  sim.energy.currentKw = kw;
  sim.energy.totalKwh += kwh;
  sim.energy.peakKw = Math.max(sim.energy.peakKw, kw);
  for (const [source, fraction] of Object.entries(split)) {
    sim.energy.bySource[source] += kwh * fraction;
  }
  sim.energy.lastUpdate = sim.clock;
}

function updateCache(sim) {
  sim.cache.lastUpdate = sim.clock;
  if (sim.clock - sim.cache.lastSampleAt < 0.5) return;
  sim.cache.lastSampleAt = sim.clock;
  sim.cache.entries.push({
    at: round(sim.clock, 2),
    kind: "telemetry",
    stage: sim.stage,
    powerKw: sim.energy.currentKw,
    residue: round(sim.quality.residue),
    batch: currentBatch(sim).id
  });
  if (sim.cache.entries.length > 200) sim.cache.entries.shift();
}

function advanceStage(sim) {
  if (sim.stage === "ultrasonic") {
    const previous = sim.stage;
    sim.stage = "rinse";
    sim.stageElapsed = 0;
    sim.stageDuration = STAGE_DURATIONS.rinse;
    sim.quality.wetness = 100;
    addEvent(sim, "stage-change", { from: "ultrasonic", to: "rinse" });
    switchEquipment(sim, "rinse", "stage-change", previous);
    return;
  }
  if (sim.stage === "rinse") {
    const previous = sim.stage;
    sim.stage = "drying";
    sim.stageElapsed = 0;
    sim.stageDuration = STAGE_DURATIONS.drying;
    sim.quality.wetness = 100;
    addEvent(sim, "stage-change", { from: "rinse", to: "drying" });
    switchEquipment(sim, "drying", "stage-change", previous);
    return;
  }
  if (sim.stage === "drying") {
    sim.quality.rust += Math.max(0, sim.quality.wetness - 6) * 1.2;
    addEvent(sim, "stage-change", { from: "drying", to: "inspection" });
    inspectBatch(sim);
  }
}

function tick(sim, dt) {
  sim.clock += dt;
  sim.tick += 1;
  sim.stageElapsed += dt;
  updateQuality(sim, dt);
  updateEnergy(sim, dt);
  sim.production.lastUpdate = sim.clock;
  updateCache(sim);
  if (sim.stageElapsed + 1e-9 >= sim.stageDuration) advanceStage(sim);
}

function advanceInternal(sim, seconds) {
  let remaining = Math.max(0, Number(seconds) || 0);
  while (remaining > 1e-9 && sim.status === "running") {
    const dt = Math.min(FIXED_STEP, remaining);
    tick(sim, dt);
    remaining -= dt;
  }
}

export function advance(sim, seconds) {
  if (sim.status !== "running") return 0;
  const before = sim.clock;
  advanceInternal(sim, seconds);
  return sim.clock - before;
}

export function exportReport(sim, { scenarios = [], generatedAt = new Date().toISOString() } = {}) {
  const inspected = sim.production.inspectedUnits;
  const yieldRate = inspected ? sim.production.goodUnits / inspected : 0;
  const anomalies = sim.production.batchResults
    .filter((result) => !result.passed)
    .map((result) => ({
      batch: result.batchId,
      at: result.at,
      reason: result.reason,
      location: result.anomalyLocation,
      metrics: result.metrics
    }));
  return {
    schema: "precision-wash-report/v1",
    generatedAt,
    sessionEpoch: sim.sessionEpoch,
    simClock: round(sim.clock, 2),
    status: sim.status,
    success: sim.status === "complete" && sim.production.goodUnits === BATCHES.length,
    goodUnits: sim.production.goodUnits,
    inspectedUnits: inspected,
    failedInspections: sim.production.failedInspections,
    goodRatePercent: round(yieldRate * 100, 2),
    firstPassGood: sim.production.firstPassGood,
    peakKw: round(sim.energy.peakKw, 3),
    energyKwh: round(sim.energy.totalKwh, 5),
    stopCount: sim.stops.length,
    stopReasons: [...new Set(sim.stops.map((stop) => stop.reason))],
    stops: structuredClone(sim.stops),
    anomalies,
    batchResults: structuredClone(sim.production.batchResults),
    violations: structuredClone(sim.violations),
    scenarios: structuredClone(scenarios),
    events: structuredClone(sim.events),
    cacheClearedOnReset: sim.sessionEpoch > 1
  };
}
